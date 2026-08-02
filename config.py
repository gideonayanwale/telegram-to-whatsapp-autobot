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
        "telegram_channel": "@yourbusinesschannel",
        "label": "Business Channel",
        "recipients": [
            {
                "id":    "120363ZZZZZZZZZZ",
                "label": "WA Business Channel",
                "type":  "channel",
            },
            {
                "id":    "2348099998888",
                "label": "CEO Direct",
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

WA_SIZE_LIMITS = {
    "image":    5,
    "video":    16,
    "audio":    16,
    "document": 100,
}