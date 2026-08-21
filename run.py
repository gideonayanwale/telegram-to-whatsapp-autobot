#!/usr/bin/env python3
"""
run.py — Starts both the Telethon bot and the FastAPI dashboard together.
Run with: python run.py

Set DASHBOARD_PORT in .env to change the port (default: 8000).
"""

import asyncio
import socket
import os
import uvicorn
from dotenv import load_dotenv
from main import main as bot_main
from dashboard import app

load_dotenv()

PORT = int(os.getenv("DASHBOARD_PORT", "8000"))


def _port_in_use(port: int) -> bool:
    """Check if a port is already bound on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        return s.connect_ex(("127.0.0.1", port)) == 0


async def run_all():
    config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=PORT,
        log_level="warning",   # suppress uvicorn noise; bot logs go to state
    )
    server = uvicorn.Server(config)

    await asyncio.gather(
        bot_main(),
        server.serve(),
    )


if __name__ == "__main__":
    if _port_in_use(PORT):
        print(f"❌  Port {PORT} is already in use.")
        print(f"    Kill the process using it, or set DASHBOARD_PORT=<other> in .env")
        print(f"\n    To find and kill the process on Windows:")
        print(f"      netstat -ano | findstr :{PORT}")
        print(f"      taskkill /PID <pid> /F")
        raise SystemExit(1)

    print("🚀 Starting Telegram → WhatsApp Forwarder")
    print(f"📊 Dashboard → http://localhost:{PORT}")
    print("Press Ctrl+C to stop\n")
    asyncio.run(run_all())
