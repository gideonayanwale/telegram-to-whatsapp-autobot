"""
logger.py — Simple structured logger used across the project.
Wraps Python's standard logging so all modules share one consistent format.
"""

import logging
import sys

_fmt = logging.Formatter(
    fmt="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(_fmt)

log = logging.getLogger("tg_wa_bot")
log.setLevel(logging.INFO)

if not log.handlers:
    log.addHandler(_handler)
