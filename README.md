# 📲 Telegram → WhatsApp Forwarder

A production-ready Python bot that automatically forwards messages from your Telegram channels to WhatsApp Channels and individual numbers in real time — including text, images, videos, audio, documents, and stickers.

Built with **Telethon** (Telegram client), the **official WhatsApp Business API** (Meta), and a live **web dashboard** for monitoring and control.

---

## ✨ Features

- ⚡ **Real-time forwarding** — messages arrive on WhatsApp within seconds of being posted on Telegram
- 📁 **All media types** — text, photos, videos, audio, voice notes, documents, GIFs, stickers
- 🗂️ **Large file support** — handles files up to Telegram's 2 GB limit via Telethon streaming
- 📡 **Multiple channels** — listen to as many Telegram channels as you want simultaneously
- 👥 **Multiple recipients** — forward each channel to several WhatsApp destinations at once
- 🔀 **Flexible routing** — map each Telegram channel to its own set of WhatsApp recipients
- 📊 **Live dashboard** — web UI showing real-time stats, logs, and channel controls
- ⏸️ **Pause/resume channels** — toggle any channel on or off from the dashboard without restarting
- 🔒 **Official API only** — uses Meta's official WhatsApp Business API, no risk of number bans
- 🧪 **Built-in test script** — verify all credentials before going live

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     TELEGRAM SIDE                           │
│                                                             │
│   Channel A ──┐                                             │
│   Channel B ──┼──► Telethon Client (main.py)                │
│   Channel C ──┘         │                                   │
└─────────────────────────┼───────────────────────────────────┘
                          │
              Download media (up to 2GB)
              Detect message type
              Check routing config
                          │
┌─────────────────────────┼───────────────────────────────────┐
│                   YOUR SERVER                               │
│                         │                                   │
│              ┌──────────▼──────────┐                        │
│              │     state.py        │                        │
│              │  (shared memory)    │◄──── dashboard.py      │
│              └──────────┬──────────┘      (FastAPI + WS)    │
│                         │                      │            │
│                   whatsapp.py            Browser UI         │
│                         │            (monitor & toggle)     │
└─────────────────────────┼───────────────────────────────────┘
                          │
              Upload media once → get media_id
              Broadcast to all recipients
                          │
┌─────────────────────────┼───────────────────────────────────┐
│                   WHATSAPP SIDE                             │
│                                                             │
│              ┌───────────────────────────────┐              │
│              │   Meta WhatsApp Business API  │              │
│              └───────────────────────────────┘              │
│                         │                                   │
│   WA Channel A ◄────────┤                                   │
│   WA Channel B ◄────────┤                                   │
│   Individual   ◄────────┘                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
telegram-to-whatsapp/
│
├── run.py                  # ← Single entry point. Start everything here.
├── main.py                 # Telethon listener — reads Telegram, triggers forwarding
├── dashboard.py            # FastAPI server — REST API + WebSocket for live dashboard
├── whatsapp.py             # WhatsApp Business API sender module
├── state.py                # Shared in-memory state (stats, logs, channel toggles)
├── config.py               # YOUR routing config — channels & recipients
│
├── dashboard/
│   └── index.html          # Web dashboard UI (dark monitoring interface)
│
├── .env                    # Your secrets — never commit this to Git
├── requirements.txt        # Python dependencies
├── test_setup.py           # Pre-flight credential & connection checker
└── README.md               # This file
```

---

## ⚙️ Prerequisites

| Requirement | Details |
|---|---|
| Python | 3.10 or higher (uses `X \| Y` type hints) |
| Telegram account | Personal account used by Telethon to read channels |
| Telegram API credentials | From [my.telegram.org](https://my.telegram.org) |
| Meta Developer account | From [developers.facebook.com](https://developers.facebook.com) |
| WhatsApp Business account | Verified phone number on Meta |
| Server / computer | Must stay online 24/7 to forward messages continuously |

---

## 🚀 Installation

### 1. Clone or download the project

```bash
git clone https://github.com/gideonayanwale/telegram-to-whatsapp-autobot.git
cd telegram-to-whatsapp
```

Or simply download the files into a folder.

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

This installs:
- `telethon` — Telegram client library (handles large files up to 2 GB)
- `httpx` — async HTTP client for WhatsApp API calls
- `python-dotenv` — loads `.env` file into environment
- `cryptg` — speeds up Telegram media downloads significantly
- `fastapi` — web framework for the dashboard
- `uvicorn[standard]` — ASGI server to run FastAPI

### 3. Set up your `.env` file

Copy the `.env` template and fill in your credentials:

```bash
cp .env .env.local   # optional backup
```

Open `.env` and fill in all 5 values (see **Credentials Setup** section below).

### 4. Create your `config.py`

Copy the example below and edit it with your actual channels and recipients. See **Configuration** section for full details.

### 5. Run the pre-flight test

```bash
python test_setup.py
```

This verifies every credential, checks channel access, and sends test messages before you go live. Fix anything it flags before proceeding.

### 6. Start the forwarder

```bash
python run.py
```

**First run only:** Telethon will send a login code to your Telegram app. Enter it when prompted. After that, a `forwarder_session.session` file is saved and you won't be asked again.

---

## 🔑 Credentials Setup

### Telegram API Credentials

1. Go to **[my.telegram.org](https://my.telegram.org)**
2. Log in with your Telegram phone number
3. Click **"API development tools"**
4. Fill in any App title and short name, then submit
5. Copy your **App api_id** and **App api_hash**

> ⚠️ These credentials are tied to your personal Telegram account. Keep them secret and never share them.

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
TELEGRAM_PHONE=+2348012345678
```

---

### WhatsApp Business API Credentials

#### Step 1 — Create a Meta Developer App

1. Go to **[developers.facebook.com](https://developers.facebook.com)**
2. Click **My Apps → Create App**
3. Choose **Business** as the app type
4. Give it a name and connect your Business account
5. On the app dashboard, click **Add Product → WhatsApp → Set Up**

#### Step 2 — Get your Phone Number ID

1. In your app, go to **WhatsApp → API Setup**
2. Under **Send and receive messages**, find your test/production number
3. Copy the **Phone Number ID** (a long number, not the phone number itself)

```env
WHATSAPP_PHONE_NUMBER_ID=109283746512938
```

#### Step 3 — Generate a Permanent Access Token

> ⚠️ The temporary token shown on the API Setup page **expires every 24 hours**. Your bot will stop working overnight if you use it. You must create a permanent token:

1. Go to **[business.facebook.com](https://business.facebook.com)**
2. Navigate to **Settings → System Users**
3. Click **Add → System User** (name it anything, set role to Admin)
4. Click **Generate New Token**
5. Select your WhatsApp app from the dropdown
6. Grant permission: `whatsapp_business_messaging`
7. Copy the token — it never expires

```env
WHATSAPP_ACCESS_TOKEN=EAAGm0PX4ZCpsBAKZBxxxxxxxxxxxxx
```

#### Step 4 — Get your WhatsApp Channel IDs (for channel recipients)

1. Go to **[business.facebook.com](https://business.facebook.com)**
2. Navigate to **WhatsApp Manager → Channels (Newsletters)**
3. Click your channel → **Settings**
4. Copy the **Channel ID** — it looks like `120363XXXXXXXXXX`

---

## ⚙️ Configuration (`config.py`)

This is the only file you edit day-to-day. It controls which Telegram channels are forwarded to which WhatsApp destinations.

### Full example

```python
ROUTING = [
    {
        "telegram_channel": "@mynewschannel",
        "label": "News Channel",               # shown in dashboard logs
        "recipients": [
            {
                "id":    "120363XXXXXXXXXX",    # WhatsApp Channel ID
                "label": "WA News Channel",
                "type":  "channel",             # WhatsApp Channel (newsletter)
            },
            {
                "id":    "2348012345678",        # phone number, no + sign
                "label": "Personal Notify",
                "type":  "individual",          # individual WhatsApp number
            },
        ],
    },
    {
        "telegram_channel": "@mysportschannel",
        "label": "Sports",
        "recipients": [
            {
                "id":    "120363YYYYYYYYYY",
                "label": "WA Sports Channel",
                "type":  "channel",
            },
        ],
    },
]

# ── Global settings ──────────────────────────────────────
# Don't stop all recipients if one fails
CONTINUE_ON_RECIPIENT_FAILURE = True

# Send a text notice to recipients when a file is too large for WhatsApp
NOTIFY_ON_SIZE_EXCEEDED = True

# WhatsApp media size limits in MB (don't change unless Meta updates them)
WA_SIZE_LIMITS = {
    "image":    5,
    "video":    16,
    "audio":    16,
    "document": 100,
}
```

### Recipient types

| Type | `"type"` value | `"id"` format | Use for |
|---|---|---|---|
| WhatsApp Channel | `"channel"` | Newsletter ID e.g. `120363XXXXXXXXXX` | Broadcast to channel subscribers |
| Individual number | `"individual"` | Phone number without `+` e.g. `2348012345678` | Send to a specific person |

### Adding a new channel later

Just add a new block to `ROUTING` in `config.py` and restart:

```python
{
    "telegram_channel": "@mybrandnewchannel",
    "label": "Brand New Channel",
    "recipients": [
        {
            "id":    "120363ZZZZZZZZZZ",
            "label": "New WA Channel",
            "type":  "channel",
        },
    ],
},
```

No other file needs to change.

---

## 📊 Dashboard

Open **[http://localhost:8000](http://localhost:8000)** after running `python run.py`.

### Features

| Section | What it shows |
|---|---|
| **Stat cards** | Total messages forwarded, total failures, active channels, overall success rate |
| **Uptime counter** | How long the bot has been running |
| **Channel list** | Each configured channel with its message count, last activity, and enable/disable toggle |
| **Live log** | Real-time stream of all forwarding activity with filterable log levels |
| **WebSocket indicator** | Green dot = live connection, red = disconnected |

### Pausing a channel

Click the toggle switch next to any channel in the dashboard. Messages from that Telegram channel will be skipped until you re-enable it. No restart needed.

### Log levels

| Level | Colour | Meaning |
|---|---|---|
| `info` | Grey | Normal activity — message received, download started, etc. |
| `success` | Green | Message successfully delivered to WhatsApp |
| `warning` | Yellow | Non-fatal issue — file too large, channel paused, etc. |
| `error` | Red | Delivery failed — API error, upload failed, etc. |

---

## 🧪 Test Script

Before running the bot for the first time (or after changing credentials), run:

```bash
python test_setup.py
```

### What it checks

| Test | What it does |
|---|---|
| **1. Environment variables** | Confirms all 5 required `.env` values exist |
| **2. WhatsApp authentication** | Hits the Meta API to verify your token and Phone Number ID |
| **3. Recipients** | Verifies each channel ID, sends a test message to each individual number |
| **4. Channel broadcasts** | Sends a real test broadcast to every WhatsApp Channel in your config |
| **5. Telegram credentials** | Logs into Telegram and confirms your API ID/hash/phone are valid |
| **6. Channel access** | Checks your account can actually read each configured Telegram channel |
| **7. Config sanity** | Validates your `config.py` structure and catches common mistakes |

### Example output

```
══════════════════════════════════════════════════
  TELEGRAM → WHATSAPP FORWARDER — SETUP TEST
══════════════════════════════════════════════════

TEST 1 — Environment Variables
──────────────────────────────────────────────────
  ✅ TELEGRAM_API_ID = 123456...
  ✅ TELEGRAM_API_HASH = abcdef...
  ✅ TELEGRAM_PHONE = +23480...
  ✅ WHATSAPP_PHONE_NUMBER_ID = 10928...
  ✅ WHATSAPP_ACCESS_TOKEN = EAAGm...

TEST 2 — WhatsApp API Authentication
──────────────────────────────────────────────────
  ✅ Phone Number ID is valid
  ✅ Display number : +234 801 234 5678
  ✅ Verified name  : My Business Name
  ℹ️  Quality rating : GREEN

...

══════════════════════════════════════════════════
  RESULTS
══════════════════════════════════════════════════
  Passed : 14
  Failed : 0
  Total  : 14

  🎉 All tests passed! You're ready to run: python run.py
```

---

## 📦 Media Support

| Media Type | Forwarded | Notes |
|---|---|---|
| Text | ✅ | Fully supported |
| Photo | ✅ | Re-uploaded to WhatsApp |
| Video | ✅ | With caption |
| GIF / Animation | ✅ | Sent as video |
| Voice note | ✅ | |
| Audio file | ✅ | |
| Document / File | ✅ | Filename preserved |
| Sticker | ✅ | Sent as image (WebP) |

### WhatsApp file size limits

| Type | Limit | What happens if exceeded |
|---|---|---|
| Image | 5 MB | Text notice sent instead (if `NOTIFY_ON_SIZE_EXCEEDED = True`) |
| Video | 16 MB | Text notice sent instead |
| Audio | 16 MB | Text notice sent instead |
| Document | 100 MB | Text notice sent instead |

Telegram supports files up to 2 GB. Files above WhatsApp's limits are not silently dropped — recipients get a notification explaining the file was too large.

---

## 🖥️ Running 24/7 on a Server

The bot must stay running to forward messages. Here are your options:

### Option A — Screen (simplest)

```bash
screen -S forwarder
python run.py
# Press Ctrl+A then D to detach and leave it running
# Re-attach later with: screen -r forwarder
```

### Option B — systemd service (recommended for Linux servers)

Create the service file:

```bash
sudo nano /etc/systemd/system/tg-forwarder.service
```

Paste this (update the paths):

```ini
[Unit]
Description=Telegram to WhatsApp Forwarder
After=network.target

[Service]
User=your_username
WorkingDirectory=/path/to/telegram-to-whatsapp
ExecStart=/usr/bin/python3 /path/to/telegram-to-whatsapp/run.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable tg-forwarder
sudo systemctl start tg-forwarder

# Check status
sudo systemctl status tg-forwarder

# View logs
sudo journalctl -u tg-forwarder -f
```

### Option C — Free cloud hosting

| Platform | Free tier | Notes |
|---|---|---|
| **Railway.app** | 500 hrs/month free | Easiest setup, connects to GitHub |
| **Render.com** | Free background workers | May sleep after inactivity on free plan |
| **Oracle Cloud Free Tier** | Always free VM | Best for permanent hosting, requires setup |
| **Fly.io** | Generous free tier | Good performance |

---

## 🔧 Troubleshooting

### Bot stops forwarding after 24 hours
**Cause:** You're using the temporary WhatsApp access token which expires daily.
**Fix:** Generate a permanent System User token — see **Credentials Setup → Step 3** above.

### `ChannelPrivateError` on startup
**Cause:** Your Telegram account is not a member of the channel you're trying to listen to.
**Fix:** Join the channel using the same Telegram account whose phone number is in `.env`.

### `ApiIdInvalidError`
**Cause:** Wrong `TELEGRAM_API_ID` or `TELEGRAM_API_HASH`.
**Fix:** Double-check them at [my.telegram.org](https://my.telegram.org). Make sure there are no extra spaces.

### WhatsApp API returns 401
**Cause:** Access token is invalid or expired.
**Fix:** Regenerate the token from Business Settings → System Users.

### Dashboard shows "Disconnected"
**Cause:** The FastAPI server isn't running or the WebSocket connection dropped.
**Fix:** Check the terminal for errors. If running on a remote server, make sure port 8000 is open in your firewall.

### Files not forwarding (only text works)
**Cause:** WhatsApp file size limit exceeded, or upload failed.
**Fix:** Check the dashboard log for `warning` or `error` entries. Enable `NOTIFY_ON_SIZE_EXCEEDED = True` in `config.py` to get notices when files are too large.

### `TypeError: int() argument must be a string, not 'NoneType'`
**Cause:** `TELEGRAM_API_ID` is missing from your `.env` file.
**Fix:** Open `.env` and make sure the value is filled in (not just the placeholder text).

---

## 📋 Complete File Reference

| File | Purpose | Edit? |
|---|---|---|
| `run.py` | Single startup entry point | ❌ No |
| `main.py` | Telethon listener, message handler | ❌ No |
| `dashboard.py` | FastAPI server + WebSocket | ❌ No |
| `whatsapp.py` | WhatsApp API sender | ❌ No |
| `state.py` | Shared in-memory state | ❌ No |
| `config.py` | Channel & recipient routing | ✅ Yes — your main config |
| `.env` | API credentials & secrets | ✅ Yes — fill in your keys |
| `dashboard/index.html` | Web dashboard UI | ❌ No |
| `requirements.txt` | Python dependencies | ❌ No |
| `test_setup.py` | Pre-flight checker | ❌ No |

---

## 🔐 Security Notes

- **Never commit `.env` to Git.** Add it to `.gitignore` immediately.
- **Keep your Telegram API credentials private.** They give full access to your Telegram account.
- **Use a System User token for WhatsApp**, not your personal Facebook token.
- **The `forwarder_session.session` file** stores your Telegram login. Keep it secure and don't share it.
- If your server is public-facing, consider restricting dashboard access to localhost or adding basic auth to `dashboard.py`.

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

## 🙋 Quick Start Checklist

- [ ] Python 3.10+ installed
- [ ] `pip install -r requirements.txt` done
- [ ] `.env` filled in with all 5 values
- [ ] Permanent WhatsApp System User token generated
- [ ] `config.py` created with your channels and recipients
- [ ] Telegram account has joined all channels listed in `config.py`
- [ ] `python test_setup.py` passes all checks
- [ ] `python run.py` started
- [ ] Dashboard open at http://localhost:8000
- [ ] Test message posted to Telegram channel → appears on WhatsApp ✅
