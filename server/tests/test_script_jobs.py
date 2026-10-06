import json
import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import generation_store as store
import tts_server as server
import voice_store
from script_agent import api, jobs, providers
from script_agent.providers import Cancelled

OUTLINE = {
    "title": "Tea Time",
    "sections": [{"heading": "Origins", "summary": "where tea began", "blocks": 2}],
}


class FakeProvider:
    name = "fake"
    supports_web = True
    gate = threading.Event()
    hold = False
    fence = False

    def run(self, prompt, *, web=False, timeout=600, cancel=None):
        if FakeProvider.hold:
            while not FakeProvider.gate.wait(0.05):
                if cancel and cancel.is_set():
                    raise Cancelled("Cancelled")
        if "Reply with JSON only" in prompt:
            text = json.dumps(OUTLINE)
            fenced = "Sure!\n```json\n" + text + "\n```"
            return fenced if FakeProvider.fence else text
        if "Search the web" in prompt:
            return "- Tea began in China (https://example.com/tea)"
        return "Alice: Tea began in China.\nFrank: Really? How long ago?"


class JobsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        FakeProvider.hold = False
        FakeProvider.fence = False
        FakeProvider.gate.clear()
        self.patches = [
            patch.object(store, "DB_PATH", root / "db" / "test.db"),
            patch.object(store, "GENERATIONS_DIR", root / "generations"),
            patch.object(voice_store, "ROOT", root / "voices"),
            patch.object(jobs, "RUNS", root / "runs"),
            patch.object(jobs, "make_provider", lambda name, model=None: FakeProvider()),
            patch.object(api, "make_provider", lambda name, model=None: FakeProvider()),
        ]
        for p in self.patches:
            p.start()
        store.DB_PATH.parent.mkdir(parents=True)
        conn = sqlite3.connect(store.DB_PATH)
        with conn:
            conn.execute(store._CREATE_GENERATIONS)
        conn.close()
        self.client = TestClient(server.app)
        self.client.__enter__()

    def tearDown(self):
        FakeProvider.gate.set()
        self.client.__exit__(None, None, None)
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def start(self, **extra):
        body = {"topic": "Tea", "minutes": 3, **extra}
        response = self.client.post("/script-jobs", json=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["id"]

    def wait(self, jid, *states):
        for _ in range(200):
            job = self.client.get(f"/script-jobs/{jid}").json()
            if job["status"] in states:
                return job
            time.sleep(0.02)
        self.fail(f"job stayed {job['status']}")

    def test_job_runs_and_creates_an_episode_with_sources(self):
        jid = self.start()
        job = self.wait(jid, "done")
        self.assertEqual(job["title"], "Tea Time")
        self.assertEqual((job["blocks"], job["research"]["sources"]), (2, 1))
        self.assertEqual(self.client.get("/script-jobs/current").json()["id"], jid)
        episode = self.client.post(f"/script-jobs/{jid}/apply", json={}).json()
        self.assertEqual([b["speaker"] for b in episode["blocks"]], ["Alice", "Frank"])
        self.assertIn("https://example.com/tea", episode["sources"])
        self.assertIsNone(self.client.get("/script-jobs/current").json())
        self.assertEqual(self.client.post(f"/script-jobs/{jid}/apply", json={}).status_code, 409)

    def test_autosave_keeps_sources_and_append_reuses_cast_and_merges_notes(self):
        voice = self._voice()
        episode = self.client.post(
            "/episodes",
            json={
                "title": "Mine",
                "blocks": [{"speaker": "Alice", "voice_id": voice, "text": "Hi"}],
            },
        ).json()
        saved = self.client.put(
            f"/episodes/{episode['id']}",
            json={
                "title": "Mine",
                "blocks": [
                    {
                        "id": episode["blocks"][0]["id"],
                        "speaker": "Alice",
                        "voice_id": voice,
                        "text": "Hi",
                    }
                ],
                "revision": episode["revision"],
            },
        ).json()
        jid = self.start(target="this")
        self.wait(jid, "done")
        stale = self.client.post(
            f"/script-jobs/{jid}/apply", json={"episode_id": episode["id"], "revision": 99}
        )
        self.assertEqual(stale.status_code, 409)
        result = self.client.post(
            f"/script-jobs/{jid}/apply",
            json={"episode_id": episode["id"], "revision": saved["revision"]},
        ).json()
        self.assertEqual(len(result["blocks"]), 3)
        self.assertEqual(result["blocks"][1]["voice_id"], voice)
        self.assertIsNone(result["blocks"][2]["voice_id"])
        self.assertIn("example.com/tea", result["sources"])
        again = self.client.put(
            f"/episodes/{episode['id']}",
            json={
                "title": "Mine",
                "blocks": [
                    {k: b[k] for k in ("id", "speaker", "voice_id", "text")}
                    for b in result["blocks"]
                ],
                "revision": result["revision"],
            },
        ).json()
        self.assertEqual(again["sources"], result["sources"])

    def test_status_and_apply_survive_an_outline_wrapped_in_a_code_fence(self):
        FakeProvider.fence = True
        jid = self.start()
        job = self.wait(jid, "done")
        self.assertEqual(job["outline"], {"done": True, "sections": 1})
        self.assertEqual(self.client.get("/script-jobs/current").json()["id"], jid)
        self.assertEqual(self.client.post(f"/script-jobs/{jid}/apply", json={}).status_code, 200)

    def test_a_model_name_with_shell_characters_is_refused(self):
        real = patch.object(api, "make_provider", providers.make_provider)
        for model in ("x&whoami", "a b", 'q"r', "m|n", "m;n", "$(x)"):
            with self.subTest(model=model), real:
                body = {"topic": "Tea", "provider": "codex", "model": model}
                self.assertEqual(self.client.post("/script-jobs", json=body).status_code, 422)

    def test_one_job_at_a_time_cancel_and_resume(self):
        FakeProvider.hold = True
        jid = self.start()
        self.assertEqual(self.client.post("/script-jobs", json={"topic": "More"}).status_code, 409)
        self.client.post(f"/script-jobs/{jid}/cancel")
        self.wait(jid, "cancelled")
        self.assertEqual(self.client.post(f"/script-jobs/{jid}/discard").status_code, 200)
        self.assertIsNone(self.client.get("/script-jobs/current").json())

        FakeProvider.hold = True
        jid = self.start()
        self.client.post(f"/script-jobs/{jid}/cancel")
        self.wait(jid, "cancelled")
        FakeProvider.hold = False
        resumed = self.client.post(f"/script-jobs/{jid}/resume", json={"provider": "codex"})
        self.assertEqual(resumed.json()["provider"], "codex")
        self.wait(jid, "done")

    def test_failures_are_reported_and_restart_marks_running_jobs(self):
        with patch.object(FakeProvider, "run", side_effect=api.ProviderError("usage limit")):
            jid = self.start()
            job = self.wait(jid, "error")
        self.assertEqual(job["error"], "usage limit")
        jobs.update(jid, status="running", error=None)
        jobs.init()
        self.assertEqual(self.client.get(f"/script-jobs/{jid}").json()["status"], "error")

    def test_validation_and_provider_listing(self):
        bad = {"topic": "x", "speakers": ["Alice", "alice"]}
        self.assertEqual(self.client.post("/script-jobs", json=bad).status_code, 422)
        self.assertEqual(
            self.client.post("/script-jobs", json={"topic": "x", "provider": "ollama"}).status_code,
            422,
        )
        with patch.object(api, "status", lambda name: {"id": name, "state": "ready"}):
            items = self.client.get("/script-providers").json()["items"]
        self.assertEqual([i["id"] for i in items], ["claude", "codex", "ollama"])

    def _voice(self):
        import io

        import numpy as np
        import soundfile as sf

        wav = io.BytesIO()
        sf.write(wav, np.sin(np.arange(48000) * 0.03) * 0.1, 16000, format="WAV")
        response = self.client.post(
            "/voices", data={"name": "Host"}, files={"file": ("ref.wav", wav.getvalue())}
        )
        return response.json()["id"]


if __name__ == "__main__":
    unittest.main()
