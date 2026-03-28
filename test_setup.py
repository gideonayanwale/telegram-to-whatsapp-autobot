"""
test_setup.py — Verify all credentials and connections before going live.
Run with: python test_setup.py

Tests:
  1. .env file completeness
  2. WhatsApp API token validity
  3. WhatsApp Phone Number ID
  4. Each recipient (individual numbers + channels)
  5. Telegram API credentials
  6. Telegram channel access
  7. Send a real test message to every recipient
"""

import os
import asyncio
import httpx
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.errors import (
    ApiIdInvalidError,
    PhoneNumberInvalidError,
    ChannelPrivateError,
    UsernameNotOccupiedError,
)

load_dotenv()

# ── Colors ───────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
BLUE   = "\033[94m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

def ok(msg):    print(f"  {GREEN}✅ {msg}{RESET}")
def fail(msg):  print(f"  {RED}❌ {msg}{RESET}")
def warn(msg):  print(f"  {YELLOW}⚠️  {msg}{RESET}")
def info(msg):  print(f"  {BLUE}ℹ️  {msg}{RESET}")
def header(msg):print(f"\n{BOLD}{msg}{RESET}\n{'─'*50}")

# ── Load config safely ────────────────────────────────────────
try:
    from config import ROUTING
except ImportError:
    fail("config.py not found. Make sure it exists in this directory.")
    exit(1)

# ── ENV vars ──────────────────────────────────────────────────
REQUIRED_ENV = [
    "TELEGRAM_API_ID",
    "TELEGRAM_API_HASH",
    "TELEGRAM_PHONE",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_ACCESS_TOKEN",
]

WA_PHONE_ID  = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
WA_TOKEN     = os.getenv("WHATSAPP_ACCESS_TOKEN")
WA_API_BASE  = "https://graph.facebook.com/v19.0"
WA_MEDIA_URL = f"{WA_API_BASE}/{WA_PHONE_ID}/media"
HEADERS      = {"Authorization": f"Bearer {WA_TOKEN}"}

passed = 0
failed = 0


# ════════════════════════════════════════════════════════════════
# TEST 1 — .env completeness
# ════════════════════════════════════════════════════════════════
def test_env():
    global passed, failed
    header("TEST 1 — Environment Variables")
    all_ok = True
    for key in REQUIRED_ENV:
        val = os.getenv(key)
        if val:
            ok(f"{key} = {'*' * min(6, len(val))}{'...' if len(val) > 6 else ''}")
            passed += 1
        else:
            fail(f"{key} is missing from .env")
            failed += 1
            all_ok = False
    return all_ok


# ════════════════════════════════════════════════════════════════
# TEST 2 — WhatsApp token + Phone Number ID
# ════════════════════════════════════════════════════════════════
async def test_whatsapp_auth():
    global passed, failed
    header("TEST 2 — WhatsApp API Authentication")

    url = f"{WA_API_BASE}/{WA_PHONE_ID}"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers=HEADERS)
        data = r.json()

    if r.status_code == 200:
        name         = data.get("display_phone_number", "unknown")
        verified     = data.get("verified_name", "unknown")
        quality      = data.get("quality_rating", "unknown")
        ok(f"Phone Number ID is valid")
        ok(f"Display number : {name}")
        ok(f"Verified name  : {verified}")
        info(f"Quality rating : {quality}")
        passed += 3
        return True
    else:
        error_msg = data.get("error", {}).get("message", r.text)
        fail(f"Auth failed ({r.status_code}): {error_msg}")
        failed += 1
        return False


# ════════════════════════════════════════════════════════════════
# TEST 3 — Each WhatsApp recipient
# ════════════════════════════════════════════════════════════════
async def test_whatsapp_recipients():
    global passed, failed
    header("TEST 3 — WhatsApp Recipients")

    all_recipients = []
    for route in ROUTING:
        for r in route["recipients"]:
            if not any(x["id"] == r["id"] for x in all_recipients):
                all_recipients.append(r)

    info(f"Found {len(all_recipients)} unique recipient(s) across all routes")

    for r in all_recipients:
        rtype = r.get("type", "individual")
        label = r.get("label", r["id"])

        if rtype == "channel":
            await _test_channel_recipient(r)
        else:
            await _test_individual_recipient(r)


async def _test_channel_recipient(r: dict):
    global passed, failed
    label = r.get("label", r["id"])
    url   = f"{WA_API_BASE}/{r['id']}"

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, headers=HEADERS)
        data = resp.json()

    if resp.status_code == 200:
        name        = data.get("name", "unknown")
        subscribers = data.get("follower_count", "unknown")
        ok(f"[Channel] {label} → '{name}' ({subscribers} subscribers)")
        passed += 1
    else:
        err = data.get("error", {}).get("message", resp.text)
        fail(f"[Channel] {label} → {err}")
        failed += 1


async def _test_individual_recipient(r: dict):
    global passed, failed
    label = r.get("label", r["id"])

    # For individuals, we check reachability by sending a test text
    # (Meta doesn't have a "validate number" endpoint)
    url     = f"{WA_API_BASE}/{WA_PHONE_ID}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to":                r["id"],
        "type":              "text",
        "text":              {"body": "✅ Test message from your Telegram→WhatsApp forwarder. Setup is working!"},
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json=payload,
                                 headers={**HEADERS, "Content-Type": "application/json"})
        data = resp.json()

    if resp.status_code == 200 and data.get("messages"):
        ok(f"[Individual] {label} ({r['id']}) → test message sent ✓")
        passed += 1
    else:
        err = data.get("error", {}).get("message", resp.text)
        fail(f"[Individual] {label} ({r['id']}) → {err}")
        warn("Make sure this number has messaged your business number first (24hr window rule)")
        failed += 1


# ════════════════════════════════════════════════════════════════
# TEST 4 — Send test message to WhatsApp Channels
# ════════════════════════════════════════════════════════════════
async def test_send_to_channels():
    global passed, failed
    header("TEST 4 — Send Test Message to WhatsApp Channels")

    channel_recipients = [
        r
        for route in ROUTING
        for r in route["recipients"]
        if r.get("type") == "channel"
    ]

    # Deduplicate
    seen = set()
    unique = []
    for r in channel_recipients:
        if r["id"] not in seen:
            seen.add(r["id"])
            unique.append(r)

    if not unique:
        warn("No WhatsApp Channel recipients found in config — skipping")
        return

    for r in unique:
        label = r.get("label", r["id"])
        url   = f"{WA_API_BASE}/{r['id']}/messages"
        payload = {
            "messaging_product": "whatsapp",
            "type":              "text",
            "text":              {"body": "✅ Test broadcast from your Telegram→WhatsApp forwarder. Setup is working!"},
        }

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                url, json=payload,
                headers={**HEADERS, "Content-Type": "application/json"},
            )
            data = resp.json()

        if resp.status_code == 200:
            ok(f"[Channel] {label} → broadcast test sent ✓")
            passed += 1
        else:
            err = data.get("error", {}).get("message", resp.text)
            fail(f"[Channel] {label} → {err}")
            failed += 1


# ════════════════════════════════════════════════════════════════
# TEST 5 — Telegram credentials + channel access
# ════════════════════════════════════════════════════════════════
async def test_telegram():
    global passed, failed
    header("TEST 5 — Telegram Credentials & Channel Access")

    api_id   = os.getenv("TELEGRAM_API_ID")
    api_hash = os.getenv("TELEGRAM_API_HASH")
    phone    = os.getenv("TELEGRAM_PHONE")

    if not all([api_id, api_hash, phone]):
        fail("Missing Telegram credentials in .env")
        failed += 1
        return

    try:
        client = TelegramClient("test_session", int(api_id), api_hash)
        await client.start(phone=phone)
        me = await client.get_me()
        ok(f"Logged in as: {me.first_name} (@{me.username or 'no username'})")
        passed += 1

        info(f"Testing access to {len(ROUTING)} configured channel(s)...")

        for route in ROUTING:
            ch    = route["telegram_channel"]
            label = route["label"]
            try:
                entity = await client.get_entity(ch)
                title  = getattr(entity, "title", ch)
                ok(f"[{label}] {ch} → '{title}' ✓")
                passed += 1
            except ChannelPrivateError:
                fail(f"[{label}] {ch} → Private channel — bot/account not a member")
                warn(f"  Fix: Join the channel with this Telegram account first")
                failed += 1
            except UsernameNotOccupiedError:
                fail(f"[{label}] {ch} → Username doesn't exist")
                failed += 1
            except Exception as e:
                fail(f"[{label}] {ch} → {e}")
                failed += 1

        await client.disconnect()

    except ApiIdInvalidError:
        fail("TELEGRAM_API_ID or TELEGRAM_API_HASH is invalid")
        warn("Get them from https://my.telegram.org → API development tools")
        failed += 1
    except PhoneNumberInvalidError:
        fail("TELEGRAM_PHONE is invalid — use international format e.g. +2348012345678")
        failed += 1
    except Exception as e:
        fail(f"Telegram error: {e}")
        failed += 1


# ════════════════════════════════════════════════════════════════
# TEST 6 — Config sanity check
# ════════════════════════════════════════════════════════════════
def test_config():
    global passed, failed
    header("TEST 6 — Config Sanity Check")

    for route in ROUTING:
        ch    = route.get("telegram_channel", "")
        label = route.get("label", "?")
        recs  = route.get("recipients", [])

        if not ch:
            fail(f"Route '{label}' is missing 'telegram_channel'")
            failed += 1
            continue

        if not recs:
            fail(f"Route '{label}' has no recipients")
            failed += 1
            continue

        for r in recs:
            rtype = r.get("type", "")
            rid   = r.get("id", "")
            rlabel= r.get("label", "?")

            if rtype not in ("individual", "channel"):
                fail(f"  [{label} → {rlabel}] type must be 'individual' or 'channel', got '{rtype}'")
                failed += 1
            elif rtype == "individual" and not rid.isdigit():
                fail(f"  [{label} → {rlabel}] individual ID should be digits only (no + sign), got '{rid}'")
                failed += 1
            elif rtype == "channel" and not rid.startswith("120363"):
                warn(f"  [{label} → {rlabel}] Channel ID '{rid}' doesn't start with 120363 — double check it")
            else:
                ok(f"  [{label} → {rlabel}] ({rtype}) config looks good")
                passed += 1


# ════════════════════════════════════════════════════════════════
# MAIN
# ════════════════════════════════════════════════════════════════
async def run_all_tests():
    print(f"\n{BOLD}{'═'*50}")
    print("  TELEGRAM → WHATSAPP FORWARDER — SETUP TEST")
    print(f"{'═'*50}{RESET}")

    env_ok = test_env()
    test_config()

    if not env_ok:
        print(f"\n{RED}{BOLD}Cannot continue — fix missing .env values first.{RESET}")
    else:
        wa_ok = await test_whatsapp_auth()
        if wa_ok:
            await test_whatsapp_recipients()
            await test_send_to_channels()
        await test_telegram()

    # ── Summary ─────────────────────────────────────────────
    total = passed + failed
    print(f"\n{BOLD}{'═'*50}")
    print("  RESULTS")
    print(f"{'═'*50}{RESET}")
    print(f"  {GREEN}Passed : {passed}{RESET}")
    print(f"  {RED}Failed : {failed}{RESET}")
    print(f"  Total  : {total}")

    if failed == 0:
        print(f"\n  {GREEN}{BOLD}🎉 All tests passed! You're ready to run: python run.py{RESET}\n")
    else:
        print(f"\n  {YELLOW}{BOLD}⚠️  Fix the failed items above then re-run this script.{RESET}\n")


if __name__ == "__main__":
    asyncio.run(run_all_tests())
