"""USG/GSG assistant (PRD 5.3, 8.4, 9.5): answers only from approved, attributed sources.

Retrieval is deterministic keyword overlap over the approved sources (collected from usg.usc.edu and
gsg.usc.edu, plus clearly labelled news reports), so an answer is always an excerpt with its link. If no
source covers the question, it says it cannot verify. Concerns are offered for routing; nothing is
forwarded without the student's consent, and identity only on a separate opt-in.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Literal

from app.schemas.common import PERMISSION_DENIED, VALIDATION_ERROR, AppError
from app.security.demo_roles import gov_scope
from app.services.text import keywords

from . import store

Scope = Literal["USG", "GSG"]
SOURCES_FILE = Path(__file__).with_name("government_sources.json")
COLLECTED_AT = "2026-11-14T12:00:00-08:00"
MIN_SCORE = 2  # keywords in common before an excerpt counts as an answer

CONCERN = re.compile(r"\b(should|problem|issue|complain|concern|unfair|broken|frustrat|wish|needs? to|too (slow|hard|long)|hard to)\b", re.I)
CATEGORIES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"fund|budget|money|grant|fee", re.I), "Funding"),
    (re.compile(r"class|course|professor|academic|grade", re.I), "Academic affairs"),
    (re.compile(r"access|disab|ramp|elevator", re.I), "Accessibility"),
    (re.compile(r"dining|food|housing|shuttle|library|room|space|venue|book", re.I), "Campus services"),
    (re.compile(r"health|wellness|mental", re.I), "Wellness"),
]


def _seed() -> list[dict[str, Any]]:
    docs = json.loads(SOURCES_FILE.read_text())
    for d in docs:
        d.setdefault("verified_at", COLLECTED_AT)
        d.setdefault("version", "v1")
        d["added_by"] = "seed"
    return docs


def sources(scope: str | None = None) -> list[dict[str, Any]]:
    """Seed sources overlaid by representative-managed ones (same id = newer version)."""
    by_id = {d["id"]: d for d in _seed()}
    for d in reversed(store.list_records("gov_source")):
        by_id[d["source_id"]] = {**d, "id": d["source_id"]}
    out = [d for d in by_id.values() if not d.get("archived")]
    return [d for d in out if scope is None or d["scope"] == scope]


def _require_rep(actor, scope: str) -> None:
    if gov_scope(actor) != scope:
        raise AppError(PERMISSION_DENIED, f"Only a {scope} representative can do this.", status_code=403)


def save_source(actor, body: dict[str, Any]) -> dict[str, Any]:
    scope = body["scope"]
    _require_rep(actor, scope)
    if not body.get("url", "").startswith("https://"):
        raise AppError(VALIDATION_ERROR, "Every source needs an https link so answers can cite it.", status_code=422)
    existing = next((d for d in sources(scope) if d["id"] == body.get("id")), None)
    version = f"v{int(existing['version'][1:]) + 1}" if existing else "v1"
    source_id = body.get("id") or f"{scope.lower()}-{re.sub(r'[^a-z0-9]+', '-', body['title'].lower()).strip('-')[:40]}"
    doc = {
        "source_id": source_id, "scope": scope, "title": body["title"].strip(), "excerpt": body["excerpt"].strip(),
        "url": body["url"].strip(), "owner": body.get("owner") or f"{scope} (added by a representative)",
        "kind": "official", "verified_at": store._now(), "version": version, "added_by": actor.user_id,
        "archived": bool(body.get("archived")),
    }
    store.add("gov_source", scope, doc)
    return {**doc, "id": source_id}


def _category(text: str) -> str:
    return next((name for pattern, name in CATEGORIES if pattern.search(text)), "General")


SCOPE_WORDS = {"usg", "gsg", "student", "government", "undergraduate", "graduate", "body", "doe", "does", "do", "did"}
OVERVIEW = re.compile(r"\b(what\s+(is|are|does|do)\b(?!.*\b(fund|senate|senator|election|vote|contact|office|committee|assembl|advoca|fee)\w*)"
                      r"|tell me about|who (is|are)|overview|purpose|role of)", re.I)


def _root(word: str) -> str:
    """Crude shared root so meet/meeting, senate/senator and fund/funding match. Deterministic, no model."""
    return word[:4] if len(word) > 4 else word


def _score(topic: set[str], doc: dict[str, Any]) -> int:
    """Exact word in the title 3, in the text 2, shared root only 1."""
    title, body = keywords(doc["title"]), keywords(doc["excerpt"])
    roots = {_root(w) for w in title | body}
    return sum(3 if w in title else 2 if w in body else 1 if _root(w) in roots else 0 for w in topic)


def ask(actor, scope: Scope, question: str) -> dict[str, Any]:
    q = keywords(question)
    topic = q - SCOPE_WORDS
    docs = sources(scope)
    if not topic or OVERVIEW.search(question) and len(topic) <= 2:
        # "What is USG?" / "What does GSG do?": the body's own description first.
        about = next((d for d in docs if d["id"] == f"{scope.lower()}-about"), None)
        hits = [about] if about else []
    else:
        ranked = sorted(((_score(topic, d), d) for d in docs), key=lambda x: -x[0])
        need = 2  # at least one exact word in common (or two shared roots)
        top = ranked[0][0] if ranked else 0
        # A second source only when it matches as well as the first; otherwise it is noise.
        hits = [d for score, d in ranked if score >= need and score >= top][:2]
    concern = bool(CONCERN.search(question))
    store.add("gov_question", scope, {
        # Analytics keep the topic only: no identity, no question text (PRD 8.4, 16).
        "topic": hits[0]["title"] if hits else "Not covered by approved sources",
        "answered": bool(hits), "concern": concern,
    })
    if hits:
        answer = "\n\n".join(f"From \"{d['title']}\" ({d['owner']}):\n{d['excerpt']}" for d in hits)
        if any(d.get("kind") == "news" for d in hits):
            answer += "\n\nNews reports are included for context; they are not official statements."
    else:
        answer = (f"I can't verify that from {scope}'s approved sources, so I won't guess. "
                  f"You can send it to {scope} as feedback and a representative will see it.")
    return {
        "answer": answer,
        "sources": [{"title": d["title"], "url": d["url"], "owner": d["owner"], "verified_at": d["verified_at"],
                     "version": d["version"], "kind": d.get("kind", "official")} for d in hits],
        "verified": bool(hits),
        "feedback_offer": {"scope": scope, "category": _category(question), "message": question.strip()}
        if (concern or not hits) else None,
        "disclaimer": f"An assistant, not an elected {scope} representative. It cannot make commitments for {scope}.",
    }


def create_feedback(actor, body: dict[str, Any]) -> dict[str, Any]:
    if not body.get("user_confirmed"):
        raise AppError("CONFIRMATION_REQUIRED", "Sending feedback requires explicit confirmation.", status_code=422)
    message = body["message"].strip()
    if not message:
        raise AppError(VALIDATION_ERROR, "Feedback needs a message.", status_code=422)
    share = bool(body.get("share_identity"))
    doc = store.add("feedback", body["scope"], {
        "scope": body["scope"], "category": body.get("category") or _category(message), "message": message,
        "identity_sharing_consent": share,
        "from_user_id": actor.user_id if share else None,
        "from_name": (actor.display_name or actor.user_id) if share else None,
        "status": "new", "idempotency_key": body.get("idempotency_key"),
    })
    return {"id": doc["id"], "status": "received", "shared_identity": share,
            "acknowledgement": "Logged and routed to a representative. This is a tracking acknowledgement, not a promise of a reply or resolution."}


def inbox(actor, scope: Scope) -> list[dict[str, Any]]:
    _require_rep(actor, scope)
    return store.list_records("feedback", [scope])


def acknowledge(actor, scope: Scope, feedback_id: str) -> dict[str, Any]:
    _require_rep(actor, scope)
    doc = next((d for d in store.list_records("feedback", [scope]) if d["id"] == feedback_id), None)
    if doc is None:
        raise AppError("NOT_FOUND", "Feedback not found.", status_code=404)
    return store.update(feedback_id, {"status": "acknowledged", "acknowledged_by": actor.user_id, "acknowledged_at": store._now()}) or doc


def analytics(actor, scope: Scope) -> dict[str, Any]:
    _require_rep(actor, scope)
    qs = store.list_records("gov_question", [scope], limit=1000)
    topics: dict[str, int] = {}
    for q in qs:
        topics[q["topic"]] = topics.get(q["topic"], 0) + 1
    answered = sum(1 for q in qs if q["answered"])
    return {
        "questions": len(qs),
        "answered_pct": round(100 * answered / len(qs)) if qs else None,
        "concerns": sum(1 for q in qs if q["concern"]),
        "top_topics": sorted(({"topic": t, "count": c} for t, c in topics.items()), key=lambda x: -x["count"])[:8],
    }


def publish(actor, scope: Scope, title: str, body: str) -> dict[str, Any]:
    _require_rep(actor, scope)
    if not title.strip() or not body.strip():
        raise AppError(VALIDATION_ERROR, "An announcement needs a title and a message.", status_code=422)
    return store.add("announcement", scope, {"scope": scope, "title": title.strip(), "body": body.strip(),
                                             "author": actor.display_name or actor.user_id, "source": "government"})


def announcements(scope: str | None = None) -> list[dict[str, Any]]:
    return store.list_records("announcement", [scope] if scope else ["USG", "GSG"])
