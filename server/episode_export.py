"""FFmpeg two-pass normalization with measured, downloadable output."""

import json
import math
import os
import re
import shutil
import subprocess
import tempfile

import soundfile as sf

import export_store as exports
from episode_audio import assemble


def ffmpeg():
    path = shutil.which("ffmpeg")
    if not path:
        raise ValueError("Install FFmpeg before exporting an episode")
    return path


def run(args, eid, stage, start, span, duration):
    exports.update(eid, status="running", stage=stage, progress=start)
    # Keep stderr off the pipe to avoid deadlock while reading progress.
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as errors:
        with subprocess.Popen(
            [ffmpeg(), "-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", *args],
            stdout=subprocess.PIPE,
            stderr=errors,
            text=True,
            encoding="utf-8",
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        ) as process:
            for line in process.stdout:
                if line.startswith("out_time_us="):
                    try:
                        progress = start + span * min(
                            1, float(line.split("=", 1)[1]) / 1e6 / max(duration, 0.1)
                        )
                        exports.update(eid, progress=progress)
                    except ValueError:
                        pass
            code = process.wait()
        errors.seek(0)
        message = errors.read()
    if code:
        raise ValueError("FFmpeg could not complete the export: " + message[-1200:])
    return message


def stats(message):
    matches = re.findall(r'\{\s*"input_i".*?\}', message, re.S)
    if not matches:
        raise ValueError("Could not measure audio loudness")
    result = json.loads(matches[-1])
    if not all(
        math.isfinite(float(result[key]))
        for key in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")
    ):
        raise ValueError("Selected audio has no measurable speech loudness")
    return result


def render(eid):
    temporary = None
    try:
        job = exports.get(eid)
        options = job["options"]
        exports.update(eid, status="running", stage="Assembling selected takes", progress=0.02)
        source, _ = assemble(job["snapshot"])
        info = sf.info(source)
        target = -19 if info.channels == 1 else -16
        base = f"loudnorm=I={target}:LRA=11:TP=-1.5"
        measured = stats(
            run(
                ["-i", str(source), "-af", base + ":print_format=json", "-f", "null", "-"],
                eid,
                "Measuring loudness",
                0.05,
                0.25,
                info.duration,
            )
        )
        norm = (
            base
            + ":linear=true:print_format=json"
            + "".join(
                f":{name}={measured[key]}"
                for name, key in [
                    ("measured_I", "input_i"),
                    ("measured_TP", "input_tp"),
                    ("measured_LRA", "input_lra"),
                    ("measured_thresh", "input_thresh"),
                    ("offset", "target_offset"),
                ]
            )
        )
        directory = exports.root(eid)
        directory.mkdir(parents=True, exist_ok=True)
        final = directory / f"episode.{options['format']}"
        temporary = directory / f"pending.{options['format']}"
        args = ["-i", str(source)]
        if options.get("artwork"):
            args += [
                "-i",
                options["artwork"],
                "-map",
                "0:a:0",
                "-map",
                "1:v:0",
                "-c:v",
                "png",
                "-disposition:v:0",
                "attached_pic",
                "-metadata:s:v",
                "title=Cover",
                "-metadata:s:v",
                "comment=Cover (front)",
            ]
        else:
            args += ["-map", "0:a:0"]
        args += [
            "-af",
            norm,
            "-ar",
            "48000",
            "-ac",
            str(info.channels),
            "-metadata",
            f"title={options['title']}",
            "-metadata",
            f"album={options['show']}",
        ]
        if options.get("number"):
            args += ["-metadata", f"track={options['number']}"]
        args += (
            ["-c:a", "libmp3lame", "-b:a", "192k", "-id3v2_version", "3"]
            if options["format"] == "mp3"
            else ["-c:a", "pcm_s24le"]
        )
        # Dynamic limiting on short speech can miss the integrated target even
        # with the first-pass offset. Re-encode from the original (never from
        # another MP3) with measured correction, then validate the actual file.
        offset = float(measured["target_offset"])
        for attempt in range(3):
            args[args.index("-af") + 1] = re.sub(r":offset=[^:]+", f":offset={offset}", norm)
            run(
                [*args, str(temporary)],
                eid,
                "Encoding " + options["format"].upper()
                if attempt == 0
                else "Correcting measured loudness",
                0.3 if attempt == 0 else 0.8,
                0.5 if attempt == 0 else 0.08,
                info.duration,
            )
            verified = stats(
                run(
                    [
                        "-i",
                        str(temporary),
                        "-map",
                        "0:a:0",
                        "-af",
                        base + ":print_format=json",
                        "-f",
                        "null",
                        "-",
                    ],
                    eid,
                    "Verifying loudness",
                    0.8,
                    0.18,
                    info.duration,
                )
            )
            loudness = float(verified["input_i"])
            if abs(loudness - target) <= 0.5:
                break
            offset += target - loudness
        loudness = float(verified["input_i"])
        if abs(loudness - target) > 1:
            raise ValueError(f"Export measured {loudness:.1f} LUFS, outside the {target} ±1 target")
        if float(verified["input_tp"]) > -1:
            raise ValueError("Encoded audio exceeds the -1 dB true peak ceiling")
        temporary.replace(final)
        exports.update(
            eid,
            status="complete",
            stage="Ready to download",
            progress=1,
            audio_path=str(final),
            measured_lufs=loudness,
        )
    except Exception as exc:
        exports.update(eid, status="error", stage="Export failed", error=str(exc)[:2000])
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
