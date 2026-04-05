"""
main.py — Telethon listener with dashboard state integration.
Handles all file sizes (up to Telegram's 2GB limit) and multiple channels.
"""

import os
import io
import asyncio
import mimetypes
from dotenv import load_dotenv
from telethon import TelegramClient, events
from telethon.tl.types import (
    MessageMediaPhoto,
    MessageMediaDocument,
    DocumentAttributeFilename,
)

from config import ROUTING, WA_SIZE_LIMITS, CONTINUE_ON_RECIPIENT_FAILURE, NOTIFY_ON_SIZE_EXCEEDED
from whatsapp import upload_to_whatsapp, broadcast_text, broadcast_media
from audio_processor import process_large_audio, WA_AUDIO_LIMIT_BYTES
import state

load_dotenv()

_api_id  = os.getenv("TELEGRAM_API_ID")
API_ID   = int(_api_id) if _api_id else None
API_HASH = os.getenv("TELEGRAM_API_HASH")
PHONE    = os.getenv("TELEGRAM_PHONE")

if not all([API_ID, API_HASH, PHONE]):
    raise EnvironmentError(
        "Missing Telegram credentials in .env — "
        "TELEGRAM_API_ID, TELEGRAM_API_HASH and TELEGRAM_PHONE are all required."
    )

client = TelegramClient("forwarder_session", API_ID, API_HASH)

# State is initialised once by dashboard.py at import time.
# Guard here prevents double-init when run.py imports both modules.


# ─────────────────────────────────────────────
# Routing map
# ─────────────────────────────────────────────
def build_routing_map() -> dict:
    mapping = {}
    for route in ROUTING:
        ch = route["telegram_channel"].lower().lstrip("@")
        mapping[ch] = {
            "label":      route["label"],
            "recipients": route["recipients"],
        }
    return mapping

ROUTING_MAP  = build_routing_map()
ALL_CHANNELS = [r["telegram_channel"] for r in ROUTING]


async def get_route(event) -> tuple[list[dict], str, str]:
    """Return (recipients, channel_label, channel_key)."""
    chat     = await event.get_chat()
    username = (getattr(chat, "username", None) or "").lower().lstrip("@")
    route    = ROUTING_MAP.get(username)

    if not route:
        # Fallback: match by numeric ID
        # chat_id for supergroups/channels is negative like -1001234567890
        # strip the leading -100 prefix to get the bare ID
        raw = str(event.chat_id)
        chat_id = raw[4:] if raw.startswith("-100") else raw.lstrip("-")
        for key, val in ROUTING_MAP.items():
            if key == chat_id:
                return val["recipients"], val["label"], key
        return [], "Unknown", ""

    return route["recipients"], route["label"], username


# ─────────────────────────────────────────────
# Media helpers
# ─────────────────────────────────────────────
def get_document_info(doc) -> tuple[str, str, str]:
    mime     = doc.mime_type or "application/octet-stream"
    filename = "file"
    wa_type  = "document"

    for attr in doc.attributes:
        if isinstance(attr, DocumentAttributeFilename):
            filename = attr.file_name

    if mime.startswith("image/"):
        wa_type  = "image"
        filename = filename if filename != "file" else f"image{mimetypes.guess_extension(mime) or '.jpg'}"
    elif mime.startswith("video/"):
        wa_type  = "video"
        filename = filename if filename != "file" else "video.mp4"
    elif mime.startswith("audio/"):
        wa_type  = "audio"
        filename = filename if filename != "file" else "audio.ogg"

    return wa_type, mime, filename


async def download_media(message) -> tuple[bytes, str, str, str] | None:
    if not message.media:
        return None

    buffer = io.BytesIO()

    if isinstance(message.media, MessageMediaPhoto):
        await client.download_media(message.media, file=buffer)
        return buffer.getvalue(), "image", "image/jpeg", "photo.jpg"

    elif isinstance(message.media, MessageMediaDocument):
        doc     = message.media.document
        wa_type, mime, filename = get_document_info(doc)
        size_mb = doc.size / (1024 * 1024)
        state.add_log("info", "System", f"Downloading {filename} ({size_mb:.1f} MB)")
        async for chunk in client.iter_download(message.media):
            buffer.write(chunk)
        return buffer.getvalue(), wa_type, mime, filename

    return None


# ─────────────────────────────────────────────
# Core forward logic
# ─────────────────────────────────────────────
async def forward_message(message, recipients: list[dict], label: str, channel_key: str):
    caption = message.message or ""

    # ── Text only ──────────────────────────────
    if not message.media:
        if caption:
            state.add_log("info", label, f"Forwarding text to {len(recipients)} recipient(s)")
            await broadcast_text(recipients, caption)
            state.record_success(channel_key)
            state.add_log("success", label, "Text forwarded ✓")
        return

    # ── Media ──────────────────────────────────
    result = await download_media(message)
    if not result:
        state.add_log("warning", label, "Could not download media — skipped")
        return

    file_bytes, wa_type, mime, filename = result
    size_mb = len(file_bytes) / (1024 * 1024)
    limit   = WA_SIZE_LIMITS.get(wa_type, 100)

    # ── Audio over limit → compress / split ────
    if wa_type == "audio" and len(file_bytes) > WA_AUDIO_LIMIT_BYTES:
        state.add_log("warning", label, f"Audio too large ({size_mb:.1f}MB) — processing...")
        await _handle_large_audio(file_bytes, mime, filename, caption, recipients, label, channel_key)
        return

    # ── Other media over limit → text notice ───
    if size_mb > limit:
        msg = f"{filename} too large ({size_mb:.1f}MB > {limit}MB limit)"
        state.add_log("warning", label, msg)
        if NOTIFY_ON_SIZE_EXCEEDED:
            notice = (
                f"📎 *{filename}*\n"
                f"_{wa_type.capitalize()} too large ({size_mb:.1f}MB — limit {limit}MB)_"
            )
            if caption:
                notice += f"\n\n{caption}"
            await broadcast_text(recipients, notice)
        return

    # ── Normal upload & send ────────────────────
    state.add_log("info", label, f"Uploading {filename} ({size_mb:.1f}MB) → WhatsApp...")
    media_id = await upload_to_whatsapp(file_bytes, filename, mime)

    if not media_id:
        state.add_log("error", label, f"Upload failed for {filename}")
        state.record_failure(channel_key)
        return

    state.add_log("info", label, f"Broadcasting {wa_type} to {len(recipients)} recipient(s)...")
    await broadcast_media(recipients, media_id, wa_type, caption, filename)
    state.record_success(channel_key)
    state.add_log("success", label, f"{wa_type.capitalize()} forwarded ✓ ({size_mb:.1f}MB)")


async def _handle_large_audio(
    audio_bytes: bytes,
    mime:        str,
    filename:    str,
    caption:     str,
    recipients:  list[dict],
    label:       str,
    channel_key: str,
):
    """
    Compress or split audio that exceeds WhatsApp's 16MB limit,
    then broadcast the result to all recipients.
    """
    outcome = await process_large_audio(audio_bytes, mime, filename)

    # ── Compressed successfully ─────────────────
    if outcome["action"] == "compressed":
        compressed_bytes = outcome["bytes"]
        size_mb = len(compressed_bytes) / (1024 * 1024)
        state.add_log("info", label, f"Compressed to {size_mb:.1f}MB — uploading...")

        media_id = await upload_to_whatsapp(compressed_bytes, filename, "audio/mpeg")
        if media_id:
            await broadcast_media(recipients, media_id, "audio", caption, filename)
            state.record_success(channel_key)
            state.add_log("success", label, f"Compressed audio forwarded ✓ ({size_mb:.1f}MB)")
        else:
            state.add_log("error", label, "Upload of compressed audio failed")
            state.record_failure(channel_key)

    # ── Split into chunks ───────────────────────
    elif outcome["action"] == "split":
        chunks = outcome["chunks"]
        total  = outcome["total"]
        state.add_log("info", label, f"Split into {total} parts — uploading each...")

        # Send caption only with the first chunk
        for i, chunk_bytes in enumerate(chunks, start=1):
            part_label = f"🎵 *{filename}* — Part {i}/{total}"
            chunk_caption = part_label
            if i == 1 and caption:
                chunk_caption = f"{part_label}\n\n{caption}"

            chunk_size_mb = len(chunk_bytes) / (1024 * 1024)
            state.add_log("info", label, f"Uploading part {i}/{total} ({chunk_size_mb:.1f}MB)...")

            media_id = await upload_to_whatsapp(chunk_bytes, f"part{i}_{filename}", "audio/mpeg")
            if media_id:
                await broadcast_media(recipients, media_id, "audio", chunk_caption, filename)
                state.add_log("success", label, f"Part {i}/{total} sent ✓")
            else:
                state.add_log("error", label, f"Upload failed for part {i}/{total}")
                state.record_failure(channel_key)

        state.record_success(channel_key)
        state.add_log("success", label, f"Audio forwarded in {total} parts ✓")

    # ── Both failed ─────────────────────────────
    else:
        reason = outcome.get("reason", "Unknown error")
        state.add_log("error", label, f"Audio processing failed: {reason}")
        state.record_failure(channel_key)

        notice = (
            f"🎵 *{filename}*\n"
            f"_Audio too large for WhatsApp and could not be processed automatically._\n"
            f"_{reason}_"
        )
        if caption:
            notice += f"\n\n{caption}"
        await broadcast_text(recipients, notice)


# ─────────────────────────────────────────────
# Telethon event handler
# ─────────────────────────────────────────────
@client.on(events.NewMessage(chats=ALL_CHANNELS))
async def on_new_message(event):
    recipients, label, channel_key = await get_route(event)

    if not recipients:
        state.add_log("warning", "System", f"No recipients for chat {event.chat_id}")
        return

    # Check if channel is paused from dashboard
    if not state.is_channel_enabled(channel_key):
        state.add_log("info", label, "Channel paused — message skipped")
        return

    state.add_log("info", label, f"New message received (ID: {event.message.id})")

    try:
        await forward_message(event.message, recipients, label, channel_key)
    except Exception as e:
        state.add_log("error", label, f"Unhandled error: {e}")
        state.record_failure(channel_key)
        if not CONTINUE_ON_RECIPIENT_FAILURE:
            raise


# ─────────────────────────────────────────────
# Start
# ─────────────────────────────────────────────
async def main():
    state.add_log("info", "System", "Bot starting up...")
    await client.start(phone=PHONE)

    state.add_log("success", "System", f"Connected — listening to {len(ALL_CHANNELS)} channel(s)")
    for route in ROUTING:
        r_labels = ", ".join(r["label"] for r in route["recipients"])
        state.add_log("info", route["label"], f"→ [{r_labels}]")

    print(f"✅ Bot running. Dashboard: http://localhost:8000")
    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())
