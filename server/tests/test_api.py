"""Exercise durable takes and cancellation with a controllable adapter."""

import io
import json
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
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

    def design(self, text, description, cancel):
        self.entered.set()
        self.release.wait(3)
        if cancel.is_set():
            raise Cancelled()
        return Audio(np.sin(np.arange(96000) * 0.03).astype(np.float32) * 0.1, 24000)

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

    def episode(self, count=2):
        response = self.client.post(
            "/episodes",
            json={
                "title": "Test episode",
                "blocks": [
                    {"speaker": "Host", "voice_id": self.voice, "text": f"Line {i}"}
                    for i in range(count)
                ],
                "gap_secs": 0.25,
            },
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    def test_episode_takes_selection_staleness_and_audio(self):
        FakeAdapter.release.set()
        ep = self.episode()
        eid = ep["id"]
        response = self.client.post(f"/episodes/{eid}/generate")
        self.assertEqual(response.status_code, 202)
        for take in response.json()["takes"]:
            self.wait(take["id"], "complete")
        ep = self.client.get(f"/episodes/{eid}").json()
        first = ep["blocks"][0]
        original = first["selected_take_id"]
        self.assertIsNotNone(original)
        retake = self.client.post(f"/episodes/{eid}/blocks/{first['id']}/generate").json()
        self.wait(retake["id"], "complete")
        ep = self.client.get(f"/episodes/{eid}").json()
        self.assertEqual(ep["blocks"][0]["selected_take_id"], original)
        self.assertEqual(len(ep["blocks"][0]["takes"]), 2)
        foreign = ep["blocks"][1]["selected_take_id"]
        self.assertEqual(
            self.client.post(
                f"/episodes/{eid}/blocks/{first['id']}/select",
                json={"take_id": foreign, "revision": ep["revision"]},
            ).status_code,
            422,
        )
        stale_revision = ep["revision"]
        ep = self.client.post(
            f"/episodes/{eid}/blocks/{first['id']}/select",
            json={"take_id": retake["id"], "revision": ep["revision"]},
        ).json()
        # A second tab with no unsaved edits must not overwrite this selection.
        self.assertEqual(
            self.client.post(
                f"/episodes/{eid}/blocks/{first['id']}/select",
                json={"take_id": original, "revision": stale_revision},
            ).status_code,
            409,
        )
        self.assertEqual(
            self.client.get(f"/episodes/{eid}").json()["blocks"][0]["selected_take_id"],
            retake["id"],
        )
        self.assertEqual(self.client.delete(f"/takes/{retake['id']}").status_code, 409)
        self.assertTrue(store.job_dir(retake["id"]).exists())
        audio = self.client.get(f"/episodes/{eid}/audio")
        self.assertEqual(audio.status_code, 200)
        samples, rate = sf.read(io.BytesIO(audio.content))
        self.assertEqual(rate, 24000)
        self.assertEqual(len(samples), 54000)
        self.assertTrue(np.all(samples[24000:30000] == 0))
        self.assertEqual(
            self.client.get(f"/episodes/{eid}/audio", headers={"Range": "bytes=0-100"}).status_code,
            206,
        )
        old = dict(ep)
        ep["blocks"][0]["text"] = "Rewritten line"
        changed = self.client.put(f"/episodes/{eid}", json=ep)
        self.assertEqual(changed.status_code, 200)
        self.assertTrue(changed.json()["blocks"][0]["stale"])
        self.assertEqual(self.client.put(f"/episodes/{eid}", json=old).status_code, 409)
        # Reopen from persistent storage, retaining selected take and every version.
        reopened = self.client.get(f"/episodes/{eid}").json()
        self.assertEqual(reopened["blocks"][0]["selected_take_id"], retake["id"])
        self.assertEqual(len(reopened["blocks"][0]["takes"]), 2)

    def test_selection_cannot_race_take_deletion(self):
        FakeAdapter.release.set()
        ep = self.episode(count=1)
        eid, bid = ep["id"], ep["blocks"][0]["id"]
        original = self.client.post(f"/episodes/{eid}/blocks/{bid}/generate").json()["id"]
        self.wait(original, "complete")
        tid = self.client.post(f"/episodes/{eid}/blocks/{bid}/generate").json()["id"]
        self.wait(tid, "complete")
        ep = self.client.get(f"/episodes/{eid}").json()
        deleting, release, selecting = threading.Event(), threading.Event(), threading.Event()
        connect = store._connect

        @contextmanager
        def paused_connect():
            with connect() as conn:

                def trace(sql):
                    if sql.startswith("DELETE FROM generations"):
                        deleting.set()
                        release.wait(3)

                conn.set_trace_callback(trace)
                yield conn

        def select():
            selecting.set()
            return self.client.post(
                f"/episodes/{eid}/blocks/{bid}/select",
                json={"take_id": tid, "revision": ep["revision"]},
            )

        with patch.object(store, "_connect", paused_connect), ThreadPoolExecutor(2) as pool:
            deletion = pool.submit(self.client.delete, f"/takes/{tid}")
            try:
                self.assertTrue(deleting.wait(2))
                self.assertTrue(store.job_dir(tid).exists())
                selection = pool.submit(select)
                self.assertTrue(selecting.wait(2))
                # The delete transaction still owns the write lock.
                self.assertFalse(selection.done())
            finally:
                release.set()
            self.assertEqual(deletion.result(timeout=3).status_code, 200)
            self.assertEqual(selection.result(timeout=3).status_code, 422)
        self.assertFalse(store.job_dir(tid).exists())
        self.assertEqual(
            self.client.get(f"/episodes/{eid}").json()["blocks"][0]["selected_take_id"],
            original,
        )

    def test_episode_generation_validation_and_cancellation(self):
        ep = self.episode()
        eid = ep["id"]
        ep["blocks"][1]["text"] = ""
        ep = self.client.put(f"/episodes/{eid}", json=ep).json()
        self.assertEqual(self.client.post(f"/episodes/{eid}/generate").status_code, 422)
        self.assertEqual(self.client.get("/takes").json()["items"], [])
        ep["blocks"][1]["text"] = "Second line"
        ep = self.client.put(f"/episodes/{eid}", json=ep).json()
        response = self.client.post(f"/episodes/{eid}/generate")
        self.assertEqual(response.status_code, 202)
        self.assertTrue(FakeAdapter.entered.wait(2))
        self.assertEqual(
            self.client.post(
                f"/episodes/{eid}/blocks/{ep['blocks'][0]['id']}/generate"
            ).status_code,
            409,
        )
        ep["blocks"] = ep["blocks"][:1]
        self.assertEqual(self.client.put(f"/episodes/{eid}", json=ep).status_code, 200)
        cancelled = self.client.post(f"/episodes/{eid}/cancel").json()
        self.assertTrue(
            all(
                self.client.get(f"/takes/{t['id']}").json()["status"] == "cancelled"
                for t in response.json()["takes"]
            )
        )
        self.assertTrue(
            all(t["status"] == "cancelled" for b in cancelled["blocks"] for t in b["takes"])
        )
        other = self.episode(1)
        other["blocks"][0]["id"] = ep["blocks"][0]["id"]
        self.assertEqual(self.client.put(f"/episodes/{other['id']}", json=other).status_code, 422)

    def test_designed_preview_is_saved_as_reusable_voice(self):
        FakeAdapter.release.set()
        response = self.client.post(
            "/voices/design",
            json={"name": "Designed Host", "description": "Warm clear conversational voice"},
        )
        self.assertEqual(response.status_code, 202)
        tid = response.json()["id"]
        take = self.wait(tid, "complete")
        self.assertEqual(take["model_id"], "Qwen3-TTS-12Hz-1.7B-VoiceDesign")
        saved = self.client.post(
            "/voices/design/save", json={"name": "Designed Host", "take_id": tid}
        )
        self.assertEqual(saved.status_code, 201)
        voice = saved.json()
        self.assertEqual(voice["kind"], "design")
        self.assertEqual(voice["transcript"], take["script"])
        job = self.client.post(
            "/takes", json={"voice_id": voice["id"], "text": "A new line using the saved voice"}
        )
        self.assertEqual(job.status_code, 202)
        self.wait(job.json()["id"], "complete")

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
    def test_export_loudness_metadata_artwork_and_download(self):
        from PIL import Image

        import export_store

        FakeAdapter.release.set()
        ep = self.episode(4)
        eid = ep["id"]
        for take in self.client.post(f"/episodes/{eid}/generate").json()["takes"]:
            self.wait(take["id"], "complete")
        cover = io.BytesIO()
        Image.new("RGB", (128, 128), (30, 40, 50)).save(cover, format="PNG")
        response = self.client.post(
            f"/episodes/{eid}/exports",
            data={"format": "mp3", "title": "Listening", "show": "Studio Show", "number": "4"},
            files={"artwork": ("cover.png", cover.getvalue(), "image/png")},
        )
        self.assertEqual(response.status_code, 202, response.text)
        xid = response.json()["id"]
        for _ in range(200):
            job = export_store.get(xid)
            if job["status"] in ("complete", "error"):
                break
            time.sleep(0.05)
        self.assertEqual(job["status"], "complete", job["error"])
        self.assertLessEqual(abs(job["measured_lufs"] + 19), 1)
        metadata = json.loads(
            subprocess.check_output(
                [
                    "ffprobe",
                    "-v",
                    "quiet",
                    "-show_format",
                    "-show_streams",
                    "-of",
                    "json",
                    job["audio_path"],
                ],
                text=True,
            )
        )
        self.assertEqual(metadata["format"]["tags"]["title"], "Listening")
        self.assertEqual(metadata["format"]["tags"]["album"], "Studio Show")
        self.assertEqual(metadata["format"]["tags"]["track"], "4")
        self.assertTrue(any(s["disposition"]["attached_pic"] for s in metadata["streams"]))
        download = self.client.get(f"/episodes/{eid}/exports/{xid}/download")
        self.assertEqual(download.status_code, 200)
        self.assertIn("Listening.mp3", download.headers["content-disposition"])
        self.assertEqual(
            self.client.get(f"/episodes/wrong/exports/{xid}/download").status_code, 404
        )
        # Completed export survives restart; unfinished work is explicit.
        export_store.init_exports()
        self.assertEqual(export_store.get(xid)["status"], "complete")
        self.assertEqual(self.client.get(f"/episodes/{eid}/exports").json()["items"][0]["id"], xid)
        wav = self.client.post(
            f"/episodes/{eid}/exports",
            data={"format": "wav", "title": "Lossless", "show": "Studio Show"},
        ).json()
        for _ in range(200):
            job = export_store.get(wav["id"])
            if job["status"] in ("complete", "error"):
                break
            time.sleep(0.05)
        self.assertEqual(job["status"], "complete", job["error"])
        self.assertEqual(sf.info(job["audio_path"]).subtype, "PCM_24")
        self.assertLessEqual(abs(job["measured_lufs"] + 19), 1)
        # Short, uneven speech-like envelopes exercise dynamic limiting rather
        # than the constant tone's straightforward linear gain.
        import episode_export

        short = self.client.get(f"/episodes/{eid}").json()
        short["blocks"] = short["blocks"][:1]
        first = short["blocks"][0]
        chosen = next(t for t in first["takes"] if t["id"] == first["selected_take_id"])
        signal_time = np.arange(8 * 24000) / 24000
        levels = np.repeat([0.02, 0.12, 0.6, 0.04, 0.3, 0.02, 0.5, 0.03], 24000)
        signal = (
            np.sin(signal_time * 2 * np.pi * 210) * levels * np.sin(np.pi * (signal_time % 1)) ** 2
        )
        dynamic = Path(self.temp.name) / "dynamic.wav"
        sf.write(dynamic, signal, 24000)
        chosen.update(audio_path=str(dynamic), duration_secs=8)
        regression = export_store.create(
            short, {"format": "mp3", "title": "Dynamic speech", "show": "Test", "number": None}
        )
        episode_export.render(regression["id"])
        result = export_store.get(regression["id"])
        self.assertEqual(result["status"], "complete", result["error"])
        self.assertLessEqual(abs(result["measured_lufs"] + 19), 1)
