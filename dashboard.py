"""
dashboard.py — FastAPI web dashboard for monitoring and controlling the forwarder.
Run alongside main.py using: uvicorn dashboard:app --host 0.0.0.0 --port 8000
"""

import time
import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

import state
from config import ROUTING

# Init state once here — main.py guards against re-init
state.init_from_config(ROUTING)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start background push task
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


# ── WebSocket connection manager ─────────────────────────────
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


# ── Background task: push live updates to all WS clients ────
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
                    for e in list(state.log_entries)[-50:]   # last 50 logs
                ],
            })



@app.get("/api/status")
def get_status():
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
    body    = await request.json()
    enabled = body.get("enabled", True)
    state.toggle_channel(channel_key, enabled)
    action = "enabled" if enabled else "paused"
    ch = state.channel_states.get(channel_key)
    label = ch.label if ch else channel_key
    state.add_log("info", label, f"Channel {action} via dashboard")
    await manager.broadcast({"type": "toggle", "key": channel_key, "enabled": enabled})
    return {"ok": True, "channel_key": channel_key, "enabled": enabled}


@app.get("/api/logs")
def get_logs():
    return [
        {
            "timestamp":     e.timestamp,
            "level":         e.level,
            "channel_label": e.channel_label,
            "message":       e.message,
        }
        for e in list(state.log_entries)
    ]


# ── WebSocket ────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    # Send initial state immediately on connect
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
            await ws.receive_text()   # keep alive
    except WebSocketDisconnect:
        manager.disconnect(ws)


# ── Serve the dashboard HTML ─────────────────────────────────
@app.get("/", response_class=HTMLResponse)
def dashboard():
    html_path = os.path.join(BASE_DIR, "dashboard", "index.html")
    with open(html_path) as f:
        return f.read()
