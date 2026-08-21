# ─────────────────────────────────────────────────────────────
# ROUTING CONFIG
#
# Recipient types:
#   "individual" → regular WhatsApp number (no + sign)
#   "channel"    → WhatsApp Channel/Newsletter ID from Meta dashboard
# ─────────────────────────────────────────────────────────────

ROUTING = [
    {
        "telegram_channel": "@moltbot4",
        "label": "News Channel",
        "recipients": [
            {
                "id":    "120363XXXXXXXXXX",   # your WhatsApp Channel ID
                "label": "WA News Channel",
                "type":  "channel",            # ← WhatsApp Channel (newsletter)
            },
            {
                "id":    "2349135276009",       # individual number
                "label": "Personal Notify",
                "type":  "individual",
            },
        ],
    },
    {
        "telegram_channel": "@yoursportschannel",
        "label": "Sports Updates",
        "recipients": [
            {
                "id":    "120363YYYYYYYYYY",
                "label": "WA Sports Channel",
                "type":  "channel",
            },
        ],
    },
    {
        "telegram_channel": "@lfbc_international",
        "label": "CHURCH Channel",
        "recipients": [
            {
                "id":    "120363ZZZZZZZZZZ",
                "label": "WA Business Channel",
                "type":  "channel",
            },
            {
                "id":    "2349135276009",
                "label": "CEO Direct(mEDIA)",
                "type":  "individual",
            },
        ],
    },
]


# ─────────────────────────────────────────────────────────────
# GLOBAL SETTINGS
# ─────────────────────────────────────────────────────────────

CONTINUE_ON_RECIPIENT_FAILURE = True
NOTIFY_ON_SIZE_EXCEEDED       = True

# Set to True for channels that carry music (uses 96kbps compression instead of 64kbps)
PREFER_MUSIC_COMPRESSION      = False

WA_SIZE_LIMITS = {
    "image":    5,
    "video":    16,
    "audio":    16,
    "document": 100,
}

# ─────────────────────────────────────────────────────────────
# HISTORY REPLAY
# On bot startup, replay past messages from each Telegram channel
# to WhatsApp with rate-limited delays to avoid Meta blocks.
# ─────────────────────────────────────────────────────────────

HISTORY_REPLAY = {
    # Set to True to enable replay on startup
    "enabled": True,

    # How many past messages to fetch per channel (most recent N)
    "limit": 50,

    # Seconds to wait between each forwarded message.
    # 3–5s is safe for Meta; go higher if you see rate-limit errors.
    "delay_seconds": 30,

    # If True, text-only messages are also replayed (not just media)
    "include_text": True,

    # File used to track already-replayed message IDs across restarts.
    # Prevents double-sending if the bot is restarted.
    "state_file": "replay_state.json",
}