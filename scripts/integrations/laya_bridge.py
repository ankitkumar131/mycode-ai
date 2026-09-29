#!/usr/bin/env python3
"""JSON-over-stdin bridge for NandhaKishorM/laya.

Install Laya in a Python environment first:

    python -m pip install laya

MyCode sends one request containing `state` and typed `questions`; the bridge
returns Laya's JSON result. Model loading is lazy, so the first call may take
longer while a checkpoint downloads from Hugging Face.
"""

from __future__ import annotations

import json
import sys
import traceback


def emit(value: dict) -> None:
    print(json.dumps(value, ensure_ascii=False), flush=True)


def main() -> int:
    try:
        request = json.load(sys.stdin)
        if "state" not in request or not isinstance(request.get("questions"), dict):
            emit({"success": False, "summary": "Laya bridge requires state and a questions object.", "error": "Invalid request"})
            return 2

        try:
            from laya import Router
        except Exception as exc:  # pragma: no cover - exercised in integration env
            emit({
                "success": False,
                "status": "unavailable",
                "summary": "The laya Python package is not installed.",
                "error": str(exc),
            })
            return 3

        router = Router()
        kwargs = {}
        if isinstance(request.get("model"), str):
            kwargs["model"] = request["model"]
        if isinstance(request.get("maxLen"), int):
            kwargs["max_len"] = request["maxLen"]
        if isinstance(request.get("minConfidence"), (int, float)):
            kwargs["min_confidence"] = request["minConfidence"]

        result = router.predict(request["state"], request["questions"], **kwargs)
        if hasattr(result, "model_dump"):
            result = result.model_dump()
        elif not isinstance(result, dict):
            result = dict(result)
        emit({"success": True, "status": "completed", "summary": "Laya decision completed.", **result})
        return 0
    except Exception as exc:  # pragma: no cover - exercised in integration env
        print(traceback.format_exc(), file=sys.stderr)
        emit({
            "success": False,
            "status": "failed",
            "summary": "Laya bridge failed while making a decision.",
            "error": str(exc),
        })
        return 5


if __name__ == "__main__":
    raise SystemExit(main())
