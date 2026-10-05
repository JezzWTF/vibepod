"""Exit when the process that started this backend is gone, taking tracked children with it.

The desktop and the development launcher set VIBEPOD_PARENT_PID. If either crashes, nothing else
would stop this backend, which would keep its port and GPU memory until the machine restarts.
"""

import contextlib
import os
import subprocess
import sys
import threading
import time

_tracked: set[subprocess.Popen] = set()
_lock = threading.Lock()
_SYNCHRONIZE = 0x00100000
_ERROR_ACCESS_DENIED = 5


def track(proc: subprocess.Popen) -> None:
    with _lock:
        _tracked.add(proc)


def untrack(proc: subprocess.Popen) -> None:
    with _lock:
        _tracked.discard(proc)


def kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, check=False
        )
    else:
        proc.kill()


def kill_tracked() -> None:
    with _lock:
        procs = list(_tracked)
    for proc in procs:
        with contextlib.suppress(OSError):
            kill_tree(proc)


def _wait_windows(pid: int) -> bool:
    """Block until the process ends. False when it cannot be watched at all."""
    import ctypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.restype = ctypes.c_void_p
    handle = kernel.OpenProcess(_SYNCHRONIZE, False, pid)
    if not handle:
        # Not found means it already ended; access denied means we cannot tell, so do not guess.
        return ctypes.get_last_error() != _ERROR_ACCESS_DENIED
    kernel.WaitForSingleObject(ctypes.c_void_p(handle), 0xFFFFFFFF)
    kernel.CloseHandle(ctypes.c_void_p(handle))
    return True


def _wait_posix(pid: int) -> bool:
    while True:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        except PermissionError:
            pass
        time.sleep(1)


def _parent_lost(exit_process) -> None:
    kill_tracked()
    exit_process(0)


def start(pid: int | None = None, wait=None, exit_process=os._exit) -> threading.Thread | None:
    """Watch the parent named by VIBEPOD_PARENT_PID. Returns the thread, or None when unset."""
    if pid is None:
        try:
            pid = int(os.environ.get("VIBEPOD_PARENT_PID", ""))
        except ValueError:
            return None
    if pid <= 0:
        return None
    waiter = wait or (_wait_windows if sys.platform == "win32" else _wait_posix)

    def watch() -> None:
        if waiter(pid):
            _parent_lost(exit_process)

    thread = threading.Thread(target=watch, name="parent-watch", daemon=True)
    thread.start()
    return thread
