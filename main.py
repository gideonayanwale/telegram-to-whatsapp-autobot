"""
main.py — Telethon listener with dashboard state integration.
Handles all file sizes (up to Telegram's 2GB limit) and multiple channels.
"""

import os
import io
import json
import asyncio
import mimetypes
from dotenv import load_dotenv
from telethon import TelegramClient, events
from telethon.tl.types import (
    MessageMediaPhoto,
    MessageMediaDocument,
    DocumentAttributeFilename,
)

from config import ROUTING, WA_SIZE_LIMITS, CONTINUE_ON_RECIPIENT_FAILURE, NOTIFY_ON_SIZE_EXCEEDED, PREFER_MUSIC_COMPRESSION, HISTORY_REPLAY
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

# client is created inside main() so importing this module never touches
# the session file — prevents stale-session crashes at import time.
client: TelegramClient = None  # type: ignore[assignment]

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
        raw     = str(event.chat_id)
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

    # ── Audio over limit → send as document (up to 100MB) ────
    if wa_type == "audio" and len(file_bytes) > WA_AUDIO_LIMIT_BYTES:
        doc_limit = WA_SIZE_LIMITS.get("document", 100)
        if size_mb > doc_limit:
            state.add_log("warning", label, f"Audio too large even as document ({size_mb:.1f}MB > {doc_limit}MB) — skipped")
            if NOTIFY_ON_SIZE_EXCEEDED:
                await broadcast_text(recipients, f"🎵 *{filename}*\n_Audio too large to send ({size_mb:.1f}MB — limit {doc_limit}MB)_")
            return
        state.add_log("info", label, f"Audio too large for audio type ({size_mb:.1f}MB) — sending as document...")
        wa_type = "document"

    # ── Other media over limit → text notice ───
    if size_mb > limit:
        state.add_log("warning", label, f"{filename} too large ({size_mb:.1f}MB > {limit}MB limit)")
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
    audio_bytes:  bytes,
    mime:         str,
    filename:     str,
    caption:      str,
    recipients:   list[dict],
    label:        str,
    channel_key:  str,
    prefer_music: bool = False,
):
    outcome = await process_large_audio(audio_bytes, mime, filename, prefer_music=prefer_music)

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

    elif outcome["action"] == "split":
        chunks = outcome["chunks"]
        total  = outcome["total"]
        state.add_log("info", label, f"Split into {total} parts — uploading each...")
        for i, chunk_bytes in enumerate(chunks, start=1):
            part_label    = f"🎵 *{filename}* — Part {i}/{total}"
            chunk_caption = part_label if not (i == 1 and caption) else f"{part_label}\n\n{caption}"
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

    else:
        reason = outcome.get("reason", "Unknown error")
        state.add_log("error", label, f"Audio processing failed: {reason}")
        state.record_failure(channel_key)
        notice = f"🎵 *{filename}*\n_Audio too large and could not be processed._\n_{reason}_"
        if caption:
            notice += f"\n\n{caption}"
        await broadcast_text(recipients, notice)


# ─────────────────────────────────────────────
# History replay
# ─────────────────────────────────────────────
def _load_replay_state() -> dict:
    path = HISTORY_REPLAY.get("state_file", "replay_state.json")
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_replay_state(data: dict):
    path = HISTORY_REPLAY.get("state_file", "replay_state.json")
    with open(path, "w") as f:
        json.dump(data, f)


async def replay_history():
    if not HISTORY_REPLAY.get("enabled", False):
        return

    limit        = HISTORY_REPLAY.get("limit", 50)
    delay        = HISTORY_REPLAY.get("delay_seconds", 4)
    include_text = HISTORY_REPLAY.get("include_text", True)
    replayed     = _load_replay_state()

    state.add_log("info", "System", f"History replay: fetching last {limit} messages per channel...")

    for route in ROUTING:
        channel    = route["telegram_channel"]
        label      = route["label"]
        recipients = route["recipients"]
        key        = channel.lower().lstrip("@")
        done_ids   = set(replayed.get(key, []))

        try:
            entity = await client.get_entity(channel)
        except Exception as e:
            state.add_log("error", label, f"Replay: could not resolve channel — {e}")
            continue

        try:
            messages = list(reversed(await client.get_messages(entity, limit=limit)))
        except Exception as e:
            state.add_log("error", label, f"Replay: could not fetch messages — {e}")
            continue

        pending = [m for m in messages if m.id not in done_ids]
        if not pending:
            state.add_log("info", label, "Replay: all messages already sent — skipping")
            continue

        state.add_log("info", label, f"Replay: sending {len(pending)} message(s) with {delay}s delay...")

        for msg in pending:
            if not msg.media and (not include_text or not (msg.message or "").strip()):
                done_ids.add(msg.id)
                continue
            try:
                await forward_message(msg, recipients, label, key)
            except Exception as e:
                state.add_log("error", label, f"Replay: error on msg {msg.id} — {e}")

            done_ids.add(msg.id)
            replayed[key] = list(done_ids)
            _save_replay_state(replayed)
            await asyncio.sleep(delay)

        state.add_log("success", label, f"Replay complete ✓ ({len(pending)} messages sent)")

    state.add_log("success", "System", "History replay finished — now listening for new messages")


# ─────────────────────────────────────────────
# Start
# ─────────────────────────────────────────────
async def main():
    global client

    state.add_log("info", "System", "Bot starting up...")

    # Create client here — never at module import time
    client = TelegramClient("forwarder_session", API_ID, API_HASH)

    # Register event handler now that client exists
    @client.on(events.NewMessage(chats=ALL_CHANNELS))
    async def on_new_message(event):
        recipients, label, channel_key = await get_route(event)

        if not recipients:
            state.add_log("warning", "System", f"No recipients for chat {event.chat_id}")
            return

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

    await client.start(phone=PHONE)

    state.add_log("success", "System", f"Connected — listening to {len(ALL_CHANNELS)} channel(s)")
    for route in ROUTING:
        r_labels = ", ".join(r["label"] for r in route["recipients"])
        state.add_log("info", route["label"], f"→ [{r_labels}]")

    import os as _os
    port = _os.getenv("DASHBOARD_PORT", "8000")
    print(f"✅ Bot running. Dashboard: http://localhost:{port}")

    await replay_history()
    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())
