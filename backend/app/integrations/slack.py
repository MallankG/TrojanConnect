"""Slack transport: request verification and outbound messages (the PRD 8.5 / 9.6 rules, applied to Slack).

- Every inbound request is signed by Slack (HMAC-SHA256 over `v0:{timestamp}:{body}`); unsigned or stale
  (> 5 minutes) requests are rejected, which also stops replays.
- Retried deliveries are deduplicated by their id.
- A Slack user is acted on only if linked to a TrojanConnect identity (SLACK_USER_MAP). The link says
  *who*; what they may do still comes from the server's roles.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import time
from collections import OrderedDict
from typing import Any, Optional

import httpx

from app.config import Settings

log = logging.getLogger("trojanconnect.slack")
MAX_SKEW_SECONDS = 300
_seen: "OrderedDict[str, float]" = OrderedDict()  # ponytail: per-process dedupe; move to the DB for several workers


def verify(settings: Settings, timestamp: str, signature: str, body: bytes, now: Optional[float] = None) -> bool:
    if not settings.slack_signing_secret or not timestamp or not signature:
        return False
    try:
        if abs((now or time.time()) - int(timestamp)) > MAX_SKEW_SECONDS:
            return False
    except ValueError:
        return False
    base = f"v0:{timestamp}:".encode() + body
    expected = "v0=" + hmac.new(settings.slack_signing_secret.encode(), base, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def first_delivery(delivery_id: str) -> bool:
    """False if this id was already handled (Slack retries on slow responses)."""
    if not delivery_id:
        return True
    now = time.time()
    while _seen and next(iter(_seen.values())) < now - 3600:
        _seen.popitem(last=False)
    if delivery_id in _seen:
        return False
    _seen[delivery_id] = now
    return True


def linked_user(settings: Settings, slack_user_id: str) -> Optional[str]:
    for pair in settings.slack_user_map.split(","):
        slack_id, _, user_id = pair.strip().partition(":")
        if slack_id and slack_id == slack_user_id and user_id:
            return user_id.strip()
    return None


async def respond(response_url: str, text: str, blocks: Optional[list[dict[str, Any]]] = None) -> None:
    """Reply to a slash command after the 3-second acknowledgement (only to Slack's own response URL)."""
    if not response_url.startswith("https://hooks.slack.com/"):
        log.warning("Refusing to post to a non-Slack response URL")
        return
    payload: dict[str, Any] = {"response_type": "ephemeral", "text": text}
    if blocks:
        payload["blocks"] = blocks
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(response_url, json=payload)
    except httpx.HTTPError as e:
        log.warning("Slack response failed: %s", e)


async def post_to_channel(settings: Settings, text: str) -> bool:
    """chat.postMessage to the configured outreach channel. The destination comes from config, never a model."""
    if not settings.slack_bot_token or not settings.slack_outreach_channel:
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post("https://slack.com/api/chat.postMessage",
                                  headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
                                  json={"channel": settings.slack_outreach_channel, "text": text, "unfurl_links": False})
        ok = bool(r.json().get("ok"))
        if not ok:
            log.warning("Slack chat.postMessage failed: %s", r.json().get("error"))
        return ok
    except httpx.HTTPError as e:
        log.warning("Slack chat.postMessage failed: %s", e)
        return False
