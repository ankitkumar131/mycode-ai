#!/usr/bin/env python3
"""JSON-over-stdin bridge for browser-use/jev-ultrafast.

Install Jev separately in a Python 3.12 environment, then configure MyCode:

{
  "integrations": {
    "browser": {
      "enabled": true,
      "command": "python",
      "args": ["scripts/integrations/jev_bridge.py"]
    }
  }
}

The bridge intentionally keeps the protocol tiny: one JSON request on stdin,
one JSON result on stdout. Jev's logs are sent to stderr so MyCode can parse
stdout reliably.
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path


def emit(value: dict) -> None:
    print(json.dumps(value, ensure_ascii=False), flush=True)


def main() -> int:
    try:
        request = json.load(sys.stdin)
        url = str(request.get("url", "")).strip()
        goal = str(request.get("goal", "")).strip()
        if not url or not goal:
            emit({"success": False, "status": "failed", "summary": "Jev bridge requires url and goal."})
            return 2

        # Import only after input validation so a missing optional dependency
        # produces a useful JSON error rather than a Python traceback.
        try:
            from jev_ultrafast import Agent
        except Exception as exc:  # pragma: no cover - exercised in integration env
            emit({
                "success": False,
                "status": "unavailable",
                "summary": "The jev_ultrafast Python package is not installed.",
                "error": str(exc),
            })
            return 3

        record_dir = request.get("recordDir")
        if record_dir:
            candidate = (Path(request.get("cwd", ".")).resolve() / str(record_dir)).resolve()
            workspace = Path(request.get("cwd", ".")).resolve()
            if candidate != workspace and workspace not in candidate.parents:
                emit({"success": False, "status": "blocked", "summary": "recordDir must stay inside the workspace."})
                return 4
            record_dir = str(candidate)

        last = None
        with Agent(url, goal, record_dir=record_dir, screenshots=bool(record_dir)) as agent:
            for state in agent.run():
                last = state

        last = last or {}
        page = last.get("page", {}) if isinstance(last, dict) else {}
        page_text = str(page.get("text", ""))
        expected = [str(item) for item in request.get("expected", []) if isinstance(item, str)]
        missing = [item for item in expected if item.casefold() not in page_text.casefold()]
        done = last.get("status") == "done"
        passed = done and not missing
        emit({
            "success": passed,
            "passed": passed,
            "status": "passed" if passed else "failed",
            "summary": (
                "Jev reached DONE and all expected browser evidence was present."
                if passed
                else "Jev did not reach a verified DONE state or expected evidence was missing."
            ),
            "url": url,
            "finalUrl": page.get("url"),
            "pageText": page_text[:20_000],
            "evidence": {
                "jevStatus": last.get("status"),
                "steps": len(last.get("history", [])),
                "missingExpected": missing,
                "lastState": {"status": last.get("status"), "elapsedMs": last.get("elapsed_ms")},
            },
        })
        return 0 if passed else 1
    except Exception as exc:  # pragma: no cover - exercised in integration env
        print(traceback.format_exc(), file=sys.stderr)
        emit({
            "success": False,
            "status": "failed",
            "summary": "Jev bridge failed while running the browser task.",
            "error": str(exc),
        })
        return 5


if __name__ == "__main__":
    raise SystemExit(main())
