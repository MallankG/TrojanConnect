"""Stream a finished agent reply to the browser as Server-Sent Events.

The turn runs to completion first, so the output guardrails (no invented facts, confirmation rules) have
checked the whole reply before any of it is shown. Then the text goes out word by word, followed by a
`done` event carrying exactly what the non-streaming endpoint returns (cards, pending confirmations).

    event: delta   data: {"text": "Spark "}
    event: done    data: <the endpoint's normal JSON body>
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from fastapi.responses import StreamingResponse

WORD_DELAY = 0.02   # seconds between words
MAX_DURATION = 1.5  # a long reply speeds up rather than taking longer than this


def _event(name: str, data: Any) -> str:
    return f"event: {name}\ndata: {json.dumps(data, default=str)}\n\n"


def stream_reply(text: str, done: Any) -> StreamingResponse:
    pieces = re.findall(r"\s*\S+", text or "") or [""]
    delay = min(WORD_DELAY, MAX_DURATION / len(pieces))

    async def events():
        for piece in pieces:
            yield _event("delta", {"text": piece})
            await asyncio.sleep(delay)
        yield _event("done", done)

    # no-cache / no-transform / X-Accel-Buffering: proxies (Next.js rewrites, Replit) must pass events through unbuffered
    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})
