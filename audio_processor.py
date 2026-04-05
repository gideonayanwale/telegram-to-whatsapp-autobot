"""
audio_processor.py — Handles audio files that exceed WhatsApp's 16MB limit.

Strategy (applied in order):
  1. Compress with ffmpeg → if result < 16MB, use it
  2. If still too large → split into numbered chunks
  3. If ffmpeg not installed → return None (caller sends a text notice)
"""

import io
import math
import asyncio
import shutil
import tempfile
import os
from typing import Optional

# WhatsApp audio limit in bytes
WA_AUDIO_LIMIT_BYTES = 16 * 1024 * 1024   # 16 MB

# Target bitrate for compression (kbps)
# 64kbps is good quality for speech; 128kbps for music
COMPRESS_BITRATE_SPEECH = "64k"
COMPRESS_BITRATE_MUSIC  = "96k"

# Max chunk duration in seconds when splitting (9 min = safe under 16MB at 64kbps)
MAX_CHUNK_SECONDS = 540


def ffmpeg_available() -> bool:
    """Check if ffmpeg is installed on the system."""
    return shutil.which("ffmpeg") is not None


async def _run_ffmpeg(*args: str) -> tuple[int, str]:
    """Run an ffmpeg command asynchronously. Returns (returncode, stderr)."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", *args,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    return proc.returncode, stderr.decode(errors="replace")


async def get_audio_duration(input_path: str) -> Optional[float]:
    """Get duration of audio file in seconds using ffprobe."""
    if not shutil.which("ffprobe"):
        return None
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        input_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    stdout, _ = await proc.communicate()
    try:
        return float(stdout.decode().strip())
    except (ValueError, AttributeError):
        return None


async def compress_audio(
    audio_bytes: bytes,
    original_mime: str,
    prefer_music: bool = False,
) -> Optional[bytes]:
    """
    Compress audio bytes using ffmpeg to fit under WhatsApp's 16MB limit.
    Returns compressed bytes, or None if compression failed or ffmpeg is missing.
    """
    if not ffmpeg_available():
        return None

    bitrate = COMPRESS_BITRATE_MUSIC if prefer_music else COMPRESS_BITRATE_SPEECH

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path  = os.path.join(tmpdir, "input.audio")
        output_path = os.path.join(tmpdir, "output.mp3")

        # Write input
        with open(input_path, "wb") as f:
            f.write(audio_bytes)

        # Compress: re-encode to MP3 at target bitrate
        returncode, stderr = await _run_ffmpeg(
            "-y",                    # overwrite output
            "-i", input_path,        # input file
            "-vn",                   # no video stream
            "-ar", "44100",          # sample rate
            "-ac", "2",              # stereo
            "-b:a", bitrate,         # target bitrate
            output_path,
        )

        if returncode != 0:
            print(f"[AudioProcessor] ffmpeg compress failed: {stderr[-300:]}")
            return None

        with open(output_path, "rb") as f:
            compressed = f.read()

    size_before = len(audio_bytes) / (1024 * 1024)
    size_after  = len(compressed) / (1024 * 1024)
    print(f"[AudioProcessor] Compressed: {size_before:.1f}MB → {size_after:.1f}MB at {bitrate}")

    return compressed


async def split_audio(
    audio_bytes: bytes,
    original_mime: str,
) -> Optional[list[bytes]]:
    """
    Split audio into chunks, each under WhatsApp's 16MB limit.
    Returns list of chunk bytes, or None if splitting failed.
    """
    if not ffmpeg_available():
        return None

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path   = os.path.join(tmpdir, "input.audio")
        output_pattern = os.path.join(tmpdir, "chunk_%03d.mp3")

        with open(input_path, "wb") as f:
            f.write(audio_bytes)

        # Get total duration
        duration = await get_audio_duration(input_path)
        if not duration:
            print("[AudioProcessor] Could not determine audio duration for splitting.")
            return None

        # Calculate how many chunks we need
        total_chunks = math.ceil(duration / MAX_CHUNK_SECONDS)
        print(f"[AudioProcessor] Splitting {duration:.0f}s audio into {total_chunks} chunk(s) of {MAX_CHUNK_SECONDS}s max")

        if total_chunks == 1:
            # Shouldn't happen but guard anyway
            return None

        # Split using segment muxer
        returncode, stderr = await _run_ffmpeg(
            "-y",
            "-i", input_path,
            "-f", "segment",
            "-segment_time", str(MAX_CHUNK_SECONDS),
            "-vn",
            "-ar", "44100",
            "-ac", "2",
            "-b:a", COMPRESS_BITRATE_SPEECH,
            "-reset_timestamps", "1",
            output_pattern,
        )

        if returncode != 0:
            print(f"[AudioProcessor] ffmpeg split failed: {stderr[-300:]}")
            return None

        # Read all generated chunks in order
        chunks = []
        i = 0
        while True:
            chunk_path = os.path.join(tmpdir, f"chunk_{i:03d}.mp3")
            if not os.path.exists(chunk_path):
                break
            with open(chunk_path, "rb") as f:
                chunk_bytes = f.read()
            chunks.append(chunk_bytes)
            size_mb = len(chunk_bytes) / (1024 * 1024)
            print(f"[AudioProcessor] Chunk {i+1}/{total_chunks}: {size_mb:.1f}MB")
            i += 1

    return chunks if chunks else None


# ─────────────────────────────────────────────
# Main entry point called from main.py
# ─────────────────────────────────────────────
async def process_large_audio(
    audio_bytes: bytes,
    mime_type:   str,
    filename:    str,
    prefer_music: bool = False,
) -> dict:
    """
    Handle an audio file that exceeds WhatsApp's 16MB limit.

    Returns a dict with one of these shapes:

      { "action": "compressed", "bytes": <bytes>, "mime": "audio/mpeg" }
      { "action": "split",      "chunks": [<bytes>, ...], "total": N }
      { "action": "failed",     "reason": <str> }
    """
    size_mb = len(audio_bytes) / (1024 * 1024)
    print(f"[AudioProcessor] Processing {filename} ({size_mb:.1f}MB) — over 16MB limit")

    if not ffmpeg_available():
        return {
            "action": "failed",
            "reason": (
                f"ffmpeg is not installed on the server. "
                f"Install it with: sudo apt install ffmpeg"
            ),
        }

    # ── Step 1: Try compression first ──────────────
    print("[AudioProcessor] Step 1: Attempting compression...")
    compressed = await compress_audio(audio_bytes, mime_type, prefer_music=prefer_music)

    if compressed and len(compressed) <= WA_AUDIO_LIMIT_BYTES:
        return {
            "action": "compressed",
            "bytes":  compressed,
            "mime":   "audio/mpeg",
        }

    # ── Step 2: Compression not enough → split ─────
    print("[AudioProcessor] Step 2: Compression insufficient, splitting into chunks...")
    source = compressed if compressed else audio_bytes
    chunks = await split_audio(source, mime_type)

    if chunks:
        # Verify all chunks are under the limit
        oversized = [i for i, c in enumerate(chunks) if len(c) > WA_AUDIO_LIMIT_BYTES]
        if oversized:
            print(f"[AudioProcessor] Warning: chunks {oversized} still over limit after split")

        return {
            "action": "split",
            "chunks": chunks,
            "total":  len(chunks),
        }

    # ── Step 3: Both failed ────────────────────────
    return {
        "action": "failed",
        "reason": f"Could not compress or split audio ({size_mb:.1f}MB). Manual download required.",
    }
