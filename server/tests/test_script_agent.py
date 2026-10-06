import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from script_agent import prompts, providers
from script_agent.formatting import parse
from script_agent.pipeline import Pipeline, PipelineError
from script_agent.prompts import Brief
from script_agent.providers import Cancelled, ClaudeCli, CodexCli, ProviderError, run_process

OUTLINE = {
    "title": "Tea",
    "sections": [
        {"heading": "Origins", "summary": "where tea began", "blocks": 2},
        {"heading": "Today", "summary": "tea now", "blocks": 2},
    ],
}
SECTION = "Alice: Tea began in China.\nFrank: Really? How long ago?"


class FakeProvider:
    name = "fake"

    def __init__(self, replies=None, web=True):
        self.supports_web = web
        self.prompts: list[str] = []
        self.replies = replies or []

    def run(self, prompt, *, web=False, timeout=600, cancel=None):
        self.prompts.append(prompt)
        if cancel and cancel.is_set():
            raise Cancelled("Cancelled")
        if self.replies:
            return self.replies.pop(0)
        if "Reply with JSON only" in prompt:
            return "```json\n" + json.dumps(OUTLINE) + "\n```"
        if "Search the web" in prompt:
            return "- Tea began in China (https://example.com)"
        return SECTION


class ParseTest(unittest.TestCase):
    def test_cleans_markup_and_directions(self):
        blocks, problems = parse(
            "**Alice:** Hello *there* [laughs] see https://x.io now\nFrank: (pause) Sure.",
            ["Alice", "Frank"],
        )
        self.assertEqual(problems, [])
        self.assertEqual([b.text for b in blocks], ["Hello there see now", "Sure."])

    def test_reports_unknown_speaker_and_unformatted_lines(self):
        _, problems = parse("Bob: hi\nno colon here", ["Alice", "Frank"])
        self.assertEqual(len(problems), 2)
        self.assertIn("unknown speaker", problems[0])

    def test_speaker_names_are_not_limited_to_ascii_letters(self):
        names = ["Émile", "李雷", "2nd Host"]
        text = "\n".join(f"{name}: Hello there." for name in names)
        blocks, problems = parse(text, names)
        self.assertEqual(problems, [])
        self.assertEqual([b.speaker for b in blocks], names)

    def test_long_line_is_a_problem(self):
        _, problems = parse("Alice: " + "word " * 200, ["Alice"])
        self.assertIn("split it", problems[0])

    def test_outline_parser_reads_fenced_json(self):
        data = prompts.parse_outline("Sure!\n```json\n" + json.dumps(OUTLINE) + "\n```")
        self.assertEqual(data["sections"][0]["blocks"], 2)
        with self.assertRaises(ValueError):
            prompts.parse_outline("no json")


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name) / "run"
        self.brief = Brief(topic="Tea", minutes=2)

    def test_full_run_writes_script_and_continues_from_previous_lines(self):
        provider = FakeProvider()
        events = []
        pipe = Pipeline(provider, self.brief, self.dir, progress=lambda *a: events.append(a[0]))
        title, blocks = pipe.run()
        self.assertEqual(title, "Tea")
        self.assertEqual(len(blocks), 4)
        self.assertEqual((self.dir / "script.txt").read_text().count("\n"), 3)
        self.assertIn("Tea began in China", provider.prompts[-1])
        self.assertEqual({"Researching", "Outlining", "Drafting", "Done"}, set(events))

    def test_resume_reuses_finished_stages(self):
        first = FakeProvider()
        Pipeline(first, self.brief, self.dir).run()
        second = FakeProvider()
        Pipeline(second, self.brief, self.dir).run()
        self.assertEqual(second.prompts, [])

    def test_failure_keeps_finished_stages_for_resume(self):
        provider = FakeProvider()
        pipe = Pipeline(provider, self.brief, self.dir)
        original = provider.run
        calls = {"n": 0}

        def flaky(prompt, **kw):
            calls["n"] += 1
            if calls["n"] == 4:
                raise ProviderError("usage limit reached")
            return original(prompt, **kw)

        provider.run = flaky
        with self.assertRaises(ProviderError):
            pipe.run()
        self.assertTrue((self.dir / "research.md").exists())
        self.assertTrue((self.dir / "section_01.txt").exists())
        resumed = FakeProvider()
        Pipeline(resumed, self.brief, self.dir).run()
        self.assertEqual(len(resumed.prompts), 1)

    def test_bad_format_is_repaired_once_then_fails(self):
        provider = FakeProvider(
            [
                "Notes",
                json.dumps(OUTLINE),
                "Bob: wrong",
                "Alice: fixed",
                "still wrong",
                "still wrong",
            ]
        )
        pipe = Pipeline(provider, self.brief, self.dir)
        with self.assertRaises(PipelineError) as ctx:
            pipe.run()
        self.assertEqual((self.dir / "section_01.txt").read_text(), "Alice: fixed")
        self.assertIn("Section 2", str(ctx.exception))

    def test_overlong_section_is_condensed_once(self):
        outline = {"title": "T", "sections": [{"heading": "A", "summary": "s", "blocks": 2}]}
        long = "\n".join("Alice: " + "word " * 50 for _ in range(4))
        provider = FakeProvider(["Notes", json.dumps(outline), long, "Alice: Short."])
        _, blocks = Pipeline(provider, self.brief, self.dir).run()
        self.assertEqual([b.text for b in blocks], ["Short."])
        self.assertIn("too long", provider.prompts[-1])

    def test_non_searching_provider_needs_notes(self):
        with self.assertRaises(PipelineError):
            Pipeline(FakeProvider(web=False), self.brief, self.dir).run()
        brief = Brief(topic="Tea", minutes=2, notes="Tea began in China.")
        Pipeline(FakeProvider(web=False), brief, self.dir / "n").run()

    def test_review_adds_a_pass_per_section(self):
        provider = FakeProvider()
        Pipeline(provider, self.brief, self.dir, review=True).run()
        self.assertEqual(sum("Review this podcast" in p for p in provider.prompts), 2)

    def test_cancel_stops_before_next_call(self):
        cancel = threading.Event()
        cancel.set()
        with self.assertRaises(Cancelled):
            Pipeline(FakeProvider(), self.brief, self.dir, cancel=cancel).run()


class ModelNameTest(unittest.TestCase):
    def test_only_plain_model_names_are_accepted(self):
        for ok in ("gpt-5.5", "llama3.1:8b", "org/model@v1", "claude-sonnet-5-5"):
            self.assertEqual(providers.make_provider("codex", ok).model, ok)
        for bad in ("x&whoami", "a b", 'q"r', "m|n", "m;n", "$(x)", "a" * 101):
            with self.subTest(model=bad), self.assertRaises(ProviderError):
                providers.make_provider("codex", bad)


class OllamaCancelTest(unittest.TestCase):
    def test_cancel_returns_promptly_while_the_model_is_still_answering(self):
        import http.server
        import time

        release = threading.Event()

        class Slow(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                release.wait(20)
                try:
                    self.send_response(200)
                    self.end_headers()
                except OSError:
                    pass

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Slow)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.addCleanup(release.set)
        cancel = threading.Event()
        threading.Timer(0.5, cancel.set).start()
        provider = providers.Ollama("m", f"http://127.0.0.1:{server.server_port}")
        started = time.monotonic()
        with self.assertRaises(Cancelled):
            provider.run("hi", timeout=30, cancel=cancel)
        self.assertLess(time.monotonic() - started, 5)

    def test_a_timeout_is_reported_without_waiting_for_the_model(self):
        import http.server
        import time

        release = threading.Event()

        class Slow(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                release.wait(20)

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Slow)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.addCleanup(release.set)
        provider = providers.Ollama("m", f"http://127.0.0.1:{server.server_port}")
        started = time.monotonic()
        with self.assertRaisesRegex(ProviderError, "Timed out"):
            provider.run("hi", timeout=1)
        self.assertLess(time.monotonic() - started, 6)


class ProcessTest(unittest.TestCase):
    def test_prompt_goes_through_stdin(self):
        code, out, _ = run_process(
            [sys.executable, "-c", "import sys;print(sys.stdin.read())"], "hi", 20, None
        )
        self.assertEqual((code, out.strip()), (0, "hi"))

    def test_cancel_and_timeout_stop_the_process(self):
        sleeper = [sys.executable, "-c", "import time;time.sleep(60)"]
        cancel = threading.Event()
        threading.Timer(0.3, cancel.set).start()
        with self.assertRaises(Cancelled):
            run_process(sleeper, "", 30, cancel)
        with self.assertRaisesRegex(ProviderError, "Timed out"):
            run_process(sleeper, "", 1, None)

    def test_commands_enable_search_only_when_asked(self):
        with mock.patch.object(providers, "_executable", lambda name: name):
            claude = ClaudeCli("m")
            self.assertEqual(claude.command(False)[claude.command(False).index("--tools") + 1], "")
            self.assertIn("WebSearch", claude.command(True))
            self.assertEqual(CodexCli().command(True, Path("o"))[1], "--search")
            self.assertNotIn("--search", CodexCli().command(False, Path("o")))

    def test_setup_failures_say_how_to_fix_them(self):
        self.assertIn("Update the CLI", providers.explain("The 'x' model is not supported"))
        self.assertIn("Sign in", providers.explain("OAuth session expired"))
        self.assertEqual(providers.explain("usage limit reached"), "usage limit reached")

    def test_missing_cli_is_a_clear_error(self):
        missing = mock.patch.object(providers.shutil, "which", lambda name: None)
        with missing, self.assertRaisesRegex(ProviderError, "not installed"):
            ClaudeCli().run("x")


if __name__ == "__main__":
    unittest.main()
