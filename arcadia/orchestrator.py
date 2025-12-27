#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from datetime import datetime

LOG_DIR = Path.home() / "Library" / "Logs" / "Arcadia"
LOG_DIR.mkdir(parents=True, exist_ok=True)

def log(msg: str) -> None:
    ts = datetime.now().isoformat(timespec="seconds")
    line = f"{ts} {msg}"
    (LOG_DIR / "orchestrator.log").open("a", encoding="utf-8").write(line + "\n")
    print(line, flush=True)

def main() -> int:
    log("Arcadia orchestrator starting")
    inbox = Path.home() / "AI" / "workspaces" / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    log(f"Inbox path: {inbox}")

    while True:
        try:
            items = sorted(inbox.glob("*.json"))
            if items:
                for p in items[:10]:
                    try:
                        data = json.loads(p.read_text(encoding="utf-8"))
                        log(f"Received inbox item: {p.name} keys={list(data.keys())}")
                        done = p.with_suffix(".done.json")
                        p.rename(done)
                    except Exception as e:
                        log(f"Error reading {p.name}: {e}")
            time.sleep(2.0)
        except KeyboardInterrupt:
            log("Arcadia orchestrator stopping")
            return 0
        except Exception as e:
            log(f"Loop error: {e}")
            time.sleep(5.0)

if __name__ == "__main__":
    raise SystemExit(main())
