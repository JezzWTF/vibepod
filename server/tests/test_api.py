"""Exercise durable takes and cancellation with a controllable adapter."""

import io
import json
import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

import generation_store as store
import tts_server as server
import voice_store
from model_adapter import Audio, Cancelled


class FakeAdapter:
    entered = threading.Event()
    release = threading.Event()

    def synthesize(self, text, voice, settings, cancel):
        self.entered.set()
        self.release.wait(3)
        if cancel.is_set():
            raise Cancelled()
        return Audio(np.sin(np.arange(24000) * 0.03).astype(np.float32) * 0.1, 24000)


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.patches = [
            patch.object(store, "DB_PATH", root / "db" / "test.db"),
            patch.object(store, "GENERATIONS_DIR", root / "generations"),
            patch.object(voice_store, "ROOT", root / "voices"),
            patch.object(server, "QwenAdapter", FakeAdapter),
        ]
        for p in self.patches:
            p.start()
        # Start from the actual Phase 1 schema, without provenance columns.
        store.DB_PATH.parent.mkdir(parents=True)
        with sqlite3.connect(store.DB_PATH) as conn:
            conn.execute(store._CREATE_GENERATIONS)
        conn.close()
        FakeAdapter.entered.clear()
        FakeAdapter.release.clear()
        self.client = TestClient(server.app)
        self.client.__enter__()
        wav = io.BytesIO()
        sf.write(wav, np.sin(np.arange(48000) * 0.03) * 0.1, 16000, format="WAV")
        response = self.client.post(
            "/voices", data={"name": "Host"}, files={"file": ("ref.wav", wav.getvalue())}
        )
        self.assertEqual(response.status_code, 201)
        self.voice = response.json()["id"]

    def tearDown(self):
        FakeAdapter.release.set()
        self.client.__exit__(None, None, None)
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def create(self):
        response = self.client.post(
            "/takes", json={"text": "Hello", "voice_id": self.voice, "seed": 9}
        )
        self.assertEqual(response.status_code, 202)
        return response.json()["id"]

    def wait(self, tid, status):
        for _ in range(100):
            row = self.client.get(f"/takes/{tid}").json()
            if row["status"] == status:
                return row
            time.sleep(0.02)
        self.fail(f"Take did not become {status}")

    def test_complete_assets_and_legacy_record(self):
        FakeAdapter.release.set()
        tid = self.create()
        row = self.wait(tid, "complete")
        self.assertEqual(json.loads(row["settings_json"]), {"seed": 9})
        self.assertEqual(row["voice_id"], self.voice)
        self.assertEqual(self.client.get(f"/takes/{tid}/audio").status_code, 200)
        self.assertGreater(self.client.get(f"/takes/{tid}/waveform").json()["length"], 0)
        store.save_completed_job(
            "gen_old",
            "Old line",
            "Alice",
            1.5,
            10,
            1,
            24000,
            row["audio_path"],
            row["waveform_path"],
        )
        self.assertEqual(self.client.get("/generations/gen_old/audio").status_code, 200)
        self.assertEqual(self.client.delete(f"/takes/{tid}").status_code, 200)
        self.assertEqual(self.client.get(f"/takes/{tid}").status_code, 404)

    def test_cancel_cannot_be_completed_or_deleted_by_active_worker(self):
        tid = self.create()
        self.assertTrue(FakeAdapter.entered.wait(2))
        queued = self.create()
        self.assertEqual(self.client.post(f"/takes/{queued}/cancel").json()["status"], "cancelled")
        self.assertEqual(self.client.post(f"/takes/{tid}/cancel").json()["status"], "cancelled")
        self.assertEqual(self.client.delete(f"/takes/{tid}").status_code, 409)
        FakeAdapter.release.set()
        for _ in range(100):
            if not server.app.state.pending:
                break
            time.sleep(0.02)
        self.assertEqual(store.get_job(tid)["status"], "cancelled")
        self.assertIsNone(store.get_job(tid)["audio_path"])
        self.assertEqual(store.get_job(queued)["status"], "cancelled")
        self.assertEqual(self.client.delete(f"/takes/{tid}").status_code, 200)

    def test_restart_and_input_validation(self):
        store.create_job("take_interrupted", "Hello", "Host", self.voice, "{}")
        store.init_db()
        self.assertEqual(store.get_job("take_interrupted")["status"], "error")
        self.assertEqual(
            self.client.post("/takes", json={"text": " ", "voice_id": self.voice}).status_code, 422
        )
        self.assertEqual(
            self.client.post("/takes", json={"text": "Hello", "voice_id": "missing"}).status_code,
            404,
        )
        self.assertEqual(
            self.client.post(
                "/voices", data={"name": "Bad"}, files={"file": ("bad.wav", b"bad")}
            ).status_code,
            400,
        )
        with self.assertRaises(ValueError):
            store.job_dir("../outside")
