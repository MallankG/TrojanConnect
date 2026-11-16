"""Client-side pacing for Gemini calls, so we stay under the requests-per-minute quota instead of
finding it through 429s.

Gemini quotas are per project and per model and depend on the usage tier; they are listed at
https://aistudio.google.com/rate-limit. Set GEMINI_CHAT_RPM / GEMINI_EMBEDDING_RPM to match (0 = off)."""
import asyncio
import threading
import time
from collections import deque
from functools import lru_cache
from typing import Optional

from app.config import get_settings


class RateLimited(Exception):
    """The next free slot is further away than the caller is willing to wait."""
    code = 429  # same attribute the SDK's errors carry, so callers handle it like a provider 429


class RateLimiter:
    """Sliding 60-second window: at most `rpm` calls start in any minute; extra calls queue for a slot.

    ponytail: the window lives in this process. Each worker / serverless instance gets the full budget;
    move the window to a shared store (Supabase/Redis) if several instances run hot. Only RPM is
    counted here; tokens per minute and requests per day are learned from the API's 429 (see penalize)."""

    def __init__(self, rpm: int, max_wait: Optional[float] = None, clock=time.monotonic):
        self.rpm, self.max_wait, self._clock = rpm, max_wait, clock
        self._slots: deque[float] = deque()  # start times of booked calls, oldest first
        self._blocked_until = 0.0  # set by penalize() when the API itself says the quota is spent
        self._lock = threading.Lock()

    def reserve(self) -> float:
        """Book the next slot and return the seconds to wait before using it."""
        if self.rpm <= 0:
            return 0.0
        with self._lock:
            now = self._clock()
            while self._slots and self._slots[0] <= now - 60:
                self._slots.popleft()
            at = now if len(self._slots) < self.rpm else self._slots[-self.rpm] + 60
            at = max(at, self._blocked_until)
            if self.max_wait is not None and at - now > self.max_wait:
                raise RateLimited(f"Gemini rate limit reached; next request allowed in {at - now:.0f}s")
            self._slots.append(at)
            return at - now

    def penalize(self, exc: Exception) -> None:
        """The API answered 429: hold further calls for the retryDelay it gave. A spent per-day quota
        (20 requests/day per model on the free tier) gives hours, so callers fall back at once
        instead of paying a doomed round trip on every message."""
        if getattr(exc, "code", None) != 429 or isinstance(exc, RateLimited):
            return
        details = (getattr(exc, "details", None) or {}).get("error", {}).get("details", [])
        delay = next((d["retryDelay"] for d in details if isinstance(d, dict) and "retryDelay" in d), "")
        try:
            seconds = float(str(delay).rstrip("s"))
        except ValueError:
            return
        with self._lock:
            self._blocked_until = max(self._blocked_until, self._clock() + seconds)

    def wait(self) -> None:
        time.sleep(self.reserve())

    async def wait_async(self) -> None:
        await asyncio.sleep(self.reserve())


# One limiter per quota bucket, shared by every caller of that model in this process.
@lru_cache
def chat_limiter() -> RateLimiter:
    # Chat is interactive: past 10s, fail like a 429 so the caller's existing fallback/friendly message runs.
    return RateLimiter(get_settings().gemini_chat_rpm, max_wait=10)


@lru_cache
def embed_limiter() -> RateLimiter:
    # Embeddings wait it out: falling back to the hash embedder would mix vector spaces.
    return RateLimiter(get_settings().gemini_embedding_rpm)
