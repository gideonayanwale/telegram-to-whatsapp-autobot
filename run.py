#!/usr/bin/env python3
"""
run.py — Starts both the Telethon bot and the FastAPI dashboard together.
Run with: python run.py
"""

import asyncio
import uvicorn
from main import main as bot_main
from dashboard import app


async def run_all():
    # Run bot + dashboard server concurrently
    config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="warning",   # suppress uvicorn noise; bot logs go to state
    )
    server = uvicorn.Server(config)

    await asyncio.gather(
        bot_main(),
        server.serve(),
    )


if __name__ == "__main__":
    print("🚀 Starting Telegram → WhatsApp Forwarder")
    print("📊 Dashboard → http://localhost:8000")
    print("Press Ctrl+C to stop\n")
    asyncio.run(run_all())
