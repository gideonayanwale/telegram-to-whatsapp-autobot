import os
import httpx
from dotenv import load_dotenv
from logger import log

load_dotenv()

WA_PHONE_ID = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
WA_TOKEN    = os.getenv("WHATSAPP_ACCESS_TOKEN")

WA_API_BASE  = "https://graph.facebook.com/v19.0"
WA_MEDIA_URL = f"{WA_API_BASE}/{WA_PHONE_ID}/media"

HEADERS = {"Authorization": f"Bearer {WA_TOKEN}"}


# ─────────────────────────────────────────────
# Upload media (same for all recipient types)
# ─────────────────────────────────────────────
async def upload_to_whatsapp(file_bytes: bytes, filename: str, mime_type: str) -> str | None:
    """Upload media once — media_id can be reused for all recipients."""
    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            WA_MEDIA_URL,
            headers=HEADERS,
            files={"file": (filename, file_bytes, mime_type)},
            data={"messaging_product": "whatsapp", "type": mime_type},
        )
        result   = response.json()
        media_id = result.get("id")
        if media_id:
            log.info(f"[WA Upload] ✅ media_id: {media_id}")
        else:
            log.error(f"[WA Upload] ❌ Failed: {result}")
        return media_id


# ─────────────────────────────────────────────
# Build correct API URL per recipient type
# ─────────────────────────────────────────────
def get_messages_url(recipient: dict) -> str:
    """
    - individual → uses your Phone Number ID as the sender
    - channel    → uses the Newsletter/Channel ID as the endpoint
    """
    if recipient.get("type") == "channel":
        # Post to WhatsApp Channel (newsletter) you own
        return f"{WA_API_BASE}/{recipient['id']}/messages"
    else:
        # Send to individual WhatsApp number
        return f"{WA_API_BASE}/{WA_PHONE_ID}/messages"


def get_recipient_field(recipient: dict) -> dict:
    """
    For channels, Meta doesn't need a 'to' field — the URL itself identifies the channel.
    For individuals, 'to' must be the phone number.
    """
    if recipient.get("type") == "channel":
        return {}   # no 'to' field for newsletters
    return {"to": recipient["id"]}


# ─────────────────────────────────────────────
# Core send (single recipient)
# ─────────────────────────────────────────────
async def _post_message(payload: dict, recipient: dict):
    url   = get_messages_url(recipient)
    label = recipient.get("label", recipient["id"])

    # Merge recipient targeting into payload
    payload = {**get_recipient_field(recipient), **payload}

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            url,
            json=payload,
            headers={**HEADERS, "Content-Type": "application/json"},
        )
        if r.status_code == 200:
            log.info(f"[WA → {label}] ✅ Sent ({recipient.get('type','individual')})")
        else:
            log.error(f"[WA → {label}] ❌ {r.status_code}: {r.text}")


# ─────────────────────────────────────────────
# Send text
# ─────────────────────────────────────────────
async def send_text_to(recipient: dict, text: str):
    await _post_message({
        "messaging_product": "whatsapp",
        "type":              "text",
        "text":              {"body": text},
    }, recipient)


# ─────────────────────────────────────────────
# Send media
# ─────────────────────────────────────────────
async def send_media_to(
    recipient:  dict,
    media_id:   str,
    media_type: str,
    caption:    str = "",
    filename:   str = "attachment",
):
    media_block = {"id": media_id}
    if caption and media_type in ("image", "video", "document"):
        media_block["caption"] = caption
    if media_type == "document":
        media_block["filename"] = filename

    await _post_message({
        "messaging_product": "whatsapp",
        "type":              media_type,
        media_type:          media_block,
    }, recipient)


# ─────────────────────────────────────────────
# Broadcast to multiple recipients
# ─────────────────────────────────────────────
async def broadcast_text(recipients: list[dict], text: str):
    for r in recipients:
        await send_text_to(r, text)


async def broadcast_media(
    recipients: list[dict],
    media_id:   str,
    media_type: str,
    caption:    str = "",
    filename:   str = "attachment",
):
    """Upload once, send to everyone — channels and individuals alike."""
    for r in recipients:
        await send_media_to(r, media_id, media_type, caption, filename)
```

---

## How the Routing Now Works
```
Telegram message arrives
         ↓
   For each recipient in config:

   type = "individual"              type = "channel"
         ↓                                ↓
POST /{phone_id}/messages      POST /{newsletter_id}/messages
  to: "2348012345678"            (no 'to' field — URL is the channel)