"""Model backends. Subscription backends spawn the official CLI that is already signed in on this
machine, exactly as typing the prompt into the app would. This code never reads or stores a login.
"""

import contextlib
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Protocol

SCRATCH = Path(tempfile.gettempdir()) / "vibepod-script-agent"


class ProviderError(RuntimeError):
    """The backend could not produce text (not installed, signed out, usage limit, timeout)."""


class Cancelled(ProviderError):
    pass


class Provider(Protocol):
    name: str
    supports_web: bool

    def run(
        self,
        prompt: str,
        *,
        web: bool = False,
        timeout: float = 600,
        cancel: threading.Event | None = None,
    ) -> str: ...


def _kill_tree(proc: subprocess.Popen) -> None:
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, check=False
        )
    else:
        proc.kill()


def run_process(
    args: list[str], prompt: str, timeout: float, cancel: threading.Event | None
) -> tuple[int, str, str]:
    """Run a CLI with the prompt on stdin, polling for cancellation and the deadline."""
    SCRATCH.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        args,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=SCRATCH,
    )
    deadline = time.monotonic() + timeout
    pending: str | None = prompt
    while True:
        try:
            out, err = proc.communicate(input=pending, timeout=0.5)
            return proc.returncode, out, err
        except subprocess.TimeoutExpired:
            pending = None
            if cancel and cancel.is_set():
                _kill_tree(proc)
                proc.communicate()
                raise Cancelled("Cancelled") from None
            if time.monotonic() > deadline:
                _kill_tree(proc)
                proc.communicate()
                raise ProviderError(f"Timed out after {int(timeout)} s") from None


def explain(message: str) -> str:
    """Add the fix for the failures that are the user's setup, not the model's."""
    lower = message.lower()
    if "not supported" in lower and "model" in lower:
        return f"{message} Update the CLI, or choose a model your account supports."
    if any(k in lower for k in ("oauth", "authenticate", "not logged in", "log in", "login")):
        return f"{message} Sign in to the CLI, then retry."
    return message


def _executable(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise ProviderError(f"`{name}` is not installed or not on PATH")
    return path


class ClaudeCli:
    name = "claude"
    supports_web = True

    def __init__(self, model: str | None = None):
        self.model = model

    def command(self, web: bool) -> list[str]:
        tools = "WebSearch,WebFetch" if web else ""
        args = [
            _executable("claude"),
            "-p",
            "--output-format",
            "json",
            "--no-session-persistence",
            "--permission-mode",
            "dontAsk",
            "--setting-sources",
            "",
            "--tools",
            tools,
        ]
        if web:
            args += ["--allowedTools", "WebSearch", "WebFetch"]
        if self.model:
            args += ["--model", self.model]
        return args

    def run(self, prompt, *, web=False, timeout=600, cancel=None):
        code, out, err = run_process(self.command(web), prompt, timeout, cancel)
        try:
            data = json.loads(out)
        except json.JSONDecodeError:
            raise ProviderError(
                (err or out).strip()[:400] or f"claude exited with {code}"
            ) from None
        if data.get("is_error") or code != 0:
            raise ProviderError(explain(str(data.get("result") or err).strip()[:400]))
        return str(data.get("result", ""))


class CodexCli:
    name = "codex"
    supports_web = True

    def __init__(self, model: str | None = None):
        self.model = model

    def command(self, web: bool, last_message: Path) -> list[str]:
        args = [_executable("codex")]
        if web:
            args.append("--search")
        args += [
            "exec",
            "--skip-git-repo-check",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--output-last-message",
            str(last_message),
        ]
        if self.model:
            args += ["--model", self.model]
        return args + ["-"]

    def run(self, prompt, *, web=False, timeout=600, cancel=None):
        SCRATCH.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(suffix=".txt", dir=SCRATCH)
        os.close(fd)
        last = Path(name)
        try:
            code, out, err = run_process(self.command(web, last), prompt, timeout, cancel)
            text = last.read_text(encoding="utf-8", errors="replace").strip()
            if code != 0 or not text:
                raise ProviderError(explain(_codex_error(out, err)) or f"codex exited with {code}")
            return text
        finally:
            last.unlink(missing_ok=True)


def _codex_error(stdout: str, stderr: str) -> str:
    for line in reversed(stdout.splitlines()):
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") in ("error", "turn.failed"):
            detail = event.get("message") or event.get("error", {}).get("message", "")
            with contextlib.suppress(ValueError, KeyError, TypeError):
                detail = json.loads(detail)["error"]["message"]
            return str(detail)[:400]
    return stderr.strip()[-400:]


class Ollama:
    name = "ollama"
    supports_web = False

    def __init__(self, model: str, host: str = "http://127.0.0.1:11434"):
        self.model, self.host = model, host.rstrip("/")

    def run(self, prompt, *, web=False, timeout=600, cancel=None):
        if cancel and cancel.is_set():
            raise Cancelled("Cancelled")
        body = json.dumps(
            {
                "model": self.model,
                "stream": False,
                "messages": [{"role": "user", "content": prompt}],
            }
        ).encode()
        request = urllib.request.Request(
            f"{self.host}/api/chat", body, {"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)["message"]["content"]
        except urllib.error.HTTPError as exc:
            raise ProviderError(exc.read().decode(errors="replace")[:400]) from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise ProviderError(f"Cannot reach Ollama at {self.host}: {exc}") from exc


def make_provider(name: str, model: str | None = None) -> Provider:
    if name == "claude":
        return ClaudeCli(model)
    if name == "codex":
        return CodexCli(model)
    if name == "ollama":
        if not model:
            raise ProviderError("Ollama needs a model name, e.g. llama3.1")
        return Ollama(model)
    raise ProviderError(f"Unknown provider: {name}")


def status(name: str) -> dict:
    """Is this backend usable right now? state is ready, signed_out, missing or offline."""
    labels = {"claude": "Claude", "codex": "Codex", "ollama": "Ollama"}
    result: dict = {"id": name, "name": labels[name], "state": "ready", "models": []}
    try:
        if name == "ollama":
            with urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=2) as response:
                result["models"] = [m["name"] for m in json.load(response).get("models", [])]
            return result
        args = (
            [_executable(name), "auth", "status"]
            if name == "claude"
            else [_executable(name), "login", "status"]
        )
        code, out, err = run_process(args, "", 15, None)
        text = out + err
        signed_in = code == 0 and (
            json.loads(out).get("loggedIn") if name == "claude" else "logged in" in text.lower()
        )
        if not signed_in:
            result["state"] = "signed_out"
    except ProviderError:
        result["state"] = "missing"
    except (urllib.error.URLError, TimeoutError, OSError):
        result["state"] = "offline"
    except (ValueError, KeyError):
        result["state"] = "signed_out"
    return result
