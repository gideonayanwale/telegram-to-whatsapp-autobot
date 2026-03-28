"""
state.py — Shared in-memory state between the bot and the dashboard.
All mutations go through this module so both sides stay in sync.
"""

import time
from collections import deque
from dataclasses import dataclass
from typing import Optional


MAX_LOG_ENTRIES = 200   # keep last 200 log lines in memory


@dataclass
class ChannelState:
    telegram_channel: str
    label: str
    enabled: bool = True
    total_forwarded: int = 0
    total_failed: int = 0
    last_activity: Optional[float] = None   # unix timestamp


@dataclass
class LogEntry:
    timestamp: float
    level: str          # "info" | "warning" | "error" | "success"
    channel_label: str
    message: str


# ── Live state ──────────────────────────────────────────────
channel_states: dict[str, ChannelState] = {}   # keyed by telegram_channel (lowercase, no @)
log_entries: deque[LogEntry] = deque(maxlen=MAX_LOG_ENTRIES)
bot_started_at: float = time.time()


# ── Init from config ────────────────────────────────────────
def init_from_config(routing: list[dict]):
    for route in routing:
        key = route["telegram_channel"].lower().lstrip("@")
        channel_states[key] = ChannelState(
            telegram_channel=route["telegram_channel"],
            label=route["label"],
        )


# ── Helpers ─────────────────────────────────────────────────
def is_channel_enabled(channel_key: str) -> bool:
    state = channel_states.get(channel_key)
    return state.enabled if state else True


def toggle_channel(channel_key: str, enabled: bool):
    if channel_key in channel_states:
        channel_states[channel_key].enabled = enabled


def record_success(channel_key: str):
    if channel_key in channel_states:
        channel_states[channel_key].total_forwarded += 1
        channel_states[channel_key].last_activity = time.time()


def record_failure(channel_key: str):
    if channel_key in channel_states:
        channel_states[channel_key].total_failed += 1
        channel_states[channel_key].last_activity = time.time()


def add_log(level: str, channel_label: str, message: str):
    log_entries.append(LogEntry(
        timestamp=time.time(),
        level=level,
        channel_label=channel_label,
        message=message,
    ))


def get_summary() -> dict:
    total_forwarded = sum(c.total_forwarded for c in channel_states.values())
    total_failed    = sum(c.total_failed    for c in channel_states.values())
    active_channels = sum(1 for c in channel_states.values() if c.enabled)
    return {
        "total_forwarded": total_forwarded,
        "total_failed":    total_failed,
        "active_channels": active_channels,
        "total_channels":  len(channel_states),
        "uptime_seconds":  int(time.time() - bot_started_at),
    }
