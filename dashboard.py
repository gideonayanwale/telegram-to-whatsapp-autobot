"""
dashboard.py — FastAPI web dashboard for monitoring and controlling the forwarder.
Run alongside main.py using: uvicorn dashboard:app --host 0.0.0.0 --port 8000
"""

import time
import asyncio
import os
import secrets
import hashlib
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

import state
from config import ROUTING

load_dotenv()

# Init state once here — main.py guards against re-init
state.init_from_config(ROUTING)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Auth config ───────────────────────────────────────────────
DASHBOARD_PASSWORD = os.getenv("DASHBOARD_PASSWORD", "")
SESSION_COOKIE     = "tgwa_session"
SESSION_MAX_AGE    = 60 * 60 * 8   # 8 hours

if not DASHBOARD_PASSWORD:
    print("⚠️  WARNING: DASHBOARD_PASSWORD is not set in .env — dashboard is unprotected!")

# In-memory session store: { token: expires_at }
_sessions: dict[str, float] = {}


def _hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


def _create_session() -> str:
    token = secrets.token_hex(32)
    _sessions[token] = time.time() + SESSION_MAX_AGE
    return token


def _is_valid_session(token: str | None) -> bool:
    if not token:
        return False
    expires = _sessions.get(token)
    if not expires:
        return False
    if time.time() > expires:
        _sessions.pop(token, None)
        return False
    return True


def _require_auth(request: Request) -> bool:
    """Return True if the request carries a valid session."""
    if not DASHBOARD_PASSWORD:
        return True   # no password set → open access (with warning at startup)
    token = request.cookies.get(SESSION_COOKIE)
    return _is_valid_session(token)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(push_updates())
    yield
    task.cancel()


app = FastAPI(title="TG→WA Forwarder Dashboard", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth routes ───────────────────────────────────────────────
@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    # Already logged in → go straight to dashboard
    if _require_auth(request):
        return RedirectResponse("/", status_code=302)
    html_path = os.path.join(BASE_DIR, "login.html")
    with open(html_path, encoding="utf-8") as f:
        return f.read()


@app.post("/auth/login")
async def do_login(request: Request):
    form = await request.form()
    pw   = str(form.get("password", ""))

    if DASHBOARD_PASSWORD and _hash_password(pw) == _hash_password(DASHBOARD_PASSWORD):
        token    = _create_session()
        response = RedirectResponse("/", status_code=302)
        response.set_cookie(
            SESSION_COOKIE,
            token,
            max_age=SESSION_MAX_AGE,
            httponly=True,
            samesite="lax",
        )
        return response

    return RedirectResponse("/login?error=1", status_code=302)


@app.get("/auth/logout")
def do_logout(request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    _sessions.pop(token, None)
    response = RedirectResponse("/login", status_code=302)
    response.delete_cookie(SESSION_COOKIE)
    return response


# ── WebSocket connection manager ──────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.active.remove(ws)


manager = ConnectionManager()


# ── Background task: push live updates to all WS clients ──────
async def push_updates():
    while True:
        await asyncio.sleep(2)
        if manager.active:
            await manager.broadcast({
                "type":     "update",
                "summary":  state.get_summary(),
                "channels": [
                    {
                        "key":              k,
                        "telegram_channel": v.telegram_channel,
                        "label":            v.label,
                        "enabled":          v.enabled,
                        "total_forwarded":  v.total_forwarded,
                        "total_failed":     v.total_failed,
                        "last_activity":    v.last_activity,
                    }
                    for k, v in state.channel_states.items()
                ],
                "logs": [
                    {
                        "timestamp":     e.timestamp,
                        "level":         e.level,
                        "channel_label": e.channel_label,
                        "message":       e.message,
                    }
                    for e in list(state.log_entries)[-50:]
                ],
            })


# ── Protected API routes ──────────────────────────────────────
@app.get("/api/status")
def get_status(request: Request):
    if not _require_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return {
        "summary":  state.get_summary(),
        "channels": {
            k: {
                "label":           v.label,
                "enabled":         v.enabled,
                "total_forwarded": v.total_forwarded,
                "total_failed":    v.total_failed,
                "last_activity":   v.last_activity,
            }
            for k, v in state.channel_states.items()
        },
    }


@app.post("/api/channel/{channel_key}/toggle")
async def toggle_channel(channel_key: str, request: Request):
    if not _require_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    body    = await request.json()
    enabled = body.get("enabled", True)
    state.toggle_channel(channel_key, enabled)
    action = "enabled" if enabled else "paused"
    ch     = state.channel_states.get(channel_key)
    label  = ch.label if ch else channel_key
    state.add_log("info", label, f"Channel {action} via dashboard")
    await manager.broadcast({"type": "toggle", "key": channel_key, "enabled": enabled})
    return {"ok": True, "channel_key": channel_key, "enabled": enabled}


@app.get("/api/logs")
def get_logs(request: Request):
    if not _require_auth(request):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return [
        {
            "timestamp":     e.timestamp,
            "level":         e.level,
            "channel_label": e.channel_label,
            "message":       e.message,
        }
        for e in list(state.log_entries)
    ]


# ── Protected WebSocket ───────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    # Check session cookie before accepting the upgrade
    token = ws.cookies.get(SESSION_COOKIE)
    if DASHBOARD_PASSWORD and not _is_valid_session(token):
        await ws.close(code=4401)
        return

    await manager.connect(ws)
    await ws.send_json({
        "type":    "init",
        "summary": state.get_summary(),
        "channels": [
            {
                "key":              k,
                "telegram_channel": v.telegram_channel,
                "label":            v.label,
                "enabled":          v.enabled,
                "total_forwarded":  v.total_forwarded,
                "total_failed":     v.total_failed,
                "last_activity":    v.last_activity,
            }
            for k, v in state.channel_states.items()
        ],
        "logs": [
            {
                "timestamp":     e.timestamp,
                "level":         e.level,
                "channel_label": e.channel_label,
                "message":       e.message,
            }
            for e in list(state.log_entries)
        ],
    })
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)


# ── Serve dashboard HTML (protected) ─────────────────────────
@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request):
    if not _require_auth(request):
        return RedirectResponse("/login", status_code=302)
    html_path = os.path.join(BASE_DIR, "index.html")
    with open(html_path, encoding="utf-8") as f:
        return f.read()
