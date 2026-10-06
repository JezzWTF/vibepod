import os
import subprocess
import sys
import time
import unittest
from pathlib import Path

import parent_watch

SERVER = Path(__file__).resolve().parent.parent
PARENT = (
    "import os, subprocess, sys, time\n"
    "env = dict(os.environ, VIBEPOD_PARENT_PID=str(os.getpid()))\n"
    "child = subprocess.Popen([sys.executable, '-c', sys.argv[1]], env=env, cwd=sys.argv[2])\n"
    "print(child.pid, flush=True)\n"
    "time.sleep(120)\n"
)
CHILD = "import parent_watch, time; parent_watch.start(); time.sleep(120)"


def alive(pid: int) -> bool:
    if sys.platform == "win32":
        import ctypes

        kernel = ctypes.WinDLL("kernel32")
        kernel.OpenProcess.restype = ctypes.c_void_p
        handle = kernel.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        kernel.GetExitCodeProcess(ctypes.c_void_p(handle), ctypes.byref(code))
        kernel.CloseHandle(ctypes.c_void_p(handle))
        return code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


class ParentWatchTest(unittest.TestCase):
    def test_unset_or_invalid_parent_starts_nothing(self):
        for value in ("", "abc", "0", "-3"):
            with self.subTest(value=value):
                os.environ["VIBEPOD_PARENT_PID"] = value
                try:
                    self.assertIsNone(parent_watch.start())
                finally:
                    del os.environ["VIBEPOD_PARENT_PID"]

    def test_losing_the_parent_kills_tracked_children_then_exits(self):
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
        self.addCleanup(child.kill)
        parent_watch.track(child)
        exited = []
        thread = parent_watch.start(pid=1234, wait=lambda pid: True, exit_process=exited.append)
        thread.join(5)
        self.assertEqual(exited, [0])
        self.assertIsNotNone(child.wait(10))

    def test_an_unwatchable_parent_does_not_exit_the_backend(self):
        exited = []
        thread = parent_watch.start(pid=1234, wait=lambda pid: False, exit_process=exited.append)
        thread.join(5)
        self.assertEqual(exited, [])

    def test_a_backend_exits_when_its_parent_is_killed(self):
        parent = subprocess.Popen(
            [sys.executable, "-c", PARENT, CHILD, str(SERVER)],
            stdout=subprocess.PIPE,
            text=True,
        )
        self.addCleanup(parent.kill)
        self.addCleanup(parent.stdout.close)
        child_pid = int(parent.stdout.readline())
        try:
            time.sleep(1.0)
            self.assertTrue(alive(child_pid), "the child should be running while its parent is")
            parent.kill()
            parent.wait(10)
            deadline = time.monotonic() + 10
            while alive(child_pid) and time.monotonic() < deadline:
                time.sleep(0.2)
            self.assertFalse(alive(child_pid), "the child should exit when its parent is gone")
        finally:
            if alive(child_pid):
                subprocess.run(["taskkill", "/PID", str(child_pid), "/F"], capture_output=True)


if __name__ == "__main__":
    unittest.main()
