"""In-memory StudentRepository seeded from seed/*.json. Default backend when Supabase keys
are absent. Every instance owns its own state, so tests and requests never share data
unless they share the instance."""
from __future__ import annotations

import json
from datetime import datetime, time, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

from app.schemas.student import (
    AuditLog, ClubEvent, ClubInterest, ClubProfile, Conversation, Message,
    RecommendationFeedback, StudentPreferences,
)

SEED_DIR = Path(__file__).parent / "seed"
CAMPUS_TZ = ZoneInfo("America/Los_Angeles")


@lru_cache
def _read_seed(name: str) -> str:
    return (SEED_DIR / name).read_text(encoding="utf-8")


def _load_json(name: str) -> Any:
    # json.loads on the cached text gives each caller its own fresh objects.
    return json.loads(_read_seed(name))


def load_seed_clubs() -> list[ClubProfile]:
    return [ClubProfile.model_validate(c) for c in _load_json("clubs.json")]


def build_seed_event(raw: dict[str, Any], now: Optional[datetime] = None) -> ClubEvent:
    """Seed events store `days_from_now` / `start_hour` / `duration_hours` so they are always
    in the future. Times are campus-local (America/Los_Angeles)."""
    today = (now or datetime.now(timezone.utc)).astimezone(CAMPUS_TZ).date()
    start_hour = float(raw["start_hour"])
    hour = int(start_hour)
    minute = int(round((start_hour - hour) * 60))
    day = today + timedelta(days=int(raw["days_from_now"]))
    start = datetime.combine(day, time(hour, minute), tzinfo=CAMPUS_TZ)
    # Do the duration arithmetic in UTC so a DST change cannot shift the end time.
    end = (start.astimezone(timezone.utc) + timedelta(hours=float(raw["duration_hours"]))).astimezone(CAMPUS_TZ)
    return ClubEvent(
        id=raw["id"],
        organization_id=raw["organization_id"],
        title=raw["title"],
        description=raw.get("description", ""),
        start_at=start,
        end_at=end,
        location=raw.get("location", ""),
        visibility=raw.get("visibility", "public"),
    )


def load_seed_events(now: Optional[datetime] = None) -> list[ClubEvent]:
    return [build_seed_event(e, now) for e in _load_json("events.json")]


def load_seed_students() -> list[dict[str, Any]]:
    return _load_json("students.json")


class InMemoryRepository:
    def __init__(self) -> None:
        self._clubs: dict[str, ClubProfile] = {c.organization_id: c for c in load_seed_clubs()}
        self._events: list[ClubEvent] = load_seed_events()
        self._demo_users: dict[str, dict[str, Any]] = {}
        self._preferences: dict[str, StudentPreferences] = {}
        for s in load_seed_students():
            uid = s["user_id"]
            self._demo_users[uid] = {
                "user_id": uid,
                "display_name": s.get("display_name", ""),
                "email": s.get("email", ""),
            }
            if s.get("preferences"):
                self._preferences[uid] = StudentPreferences(user_id=uid, **s["preferences"])
        self._saved: dict[str, list[str]] = {}
        self._feedback: dict[str, list[RecommendationFeedback]] = {}
        self._conversations: dict[str, Conversation] = {}
        self._messages: dict[str, list[Message]] = {}
        self._interests: dict[tuple[str, str], ClubInterest] = {}
        self._audit: list[AuditLog] = []

    # ---- demo users (dev auth layer; not part of the protocol) ----
    def get_demo_user(self, user_id: str) -> Optional[dict[str, Any]]:
        user = self._demo_users.get(user_id)
        return dict(user) if user else None

    def list_demo_users(self) -> list[dict[str, Any]]:
        return [dict(u) for u in self._demo_users.values()]

    # ---- clubs / events ----
    async def list_clubs(self) -> list[ClubProfile]:
        return [c.model_copy(deep=True) for c in self._clubs.values()]

    async def get_club(self, organization_id: str) -> Optional[ClubProfile]:
        club = self._clubs.get(organization_id)
        return club.model_copy(deep=True) if club else None

    async def list_events(self, organization_id: Optional[str] = None, upcoming_only: bool = True) -> list[ClubEvent]:
        """Public events only, soonest first."""
        now = datetime.now(timezone.utc)
        events = [
            e for e in self._events
            if e.visibility == "public"
            and (organization_id is None or e.organization_id == organization_id)
            and (not upcoming_only or e.end_at >= now)
        ]
        events.sort(key=lambda e: e.start_at)
        return [e.model_copy(deep=True) for e in events]

    async def match_clubs(self, embedding: list[float], limit: int) -> Optional[list[tuple[str, float]]]:
        return None  # no vector index in memory; callers do in-process cosine similarity

    # ---- preferences ----
    async def get_preferences(self, user_id: str) -> Optional[StudentPreferences]:
        prefs = self._preferences.get(user_id)
        return prefs.model_copy(deep=True) if prefs else None

    async def upsert_preferences(self, prefs: StudentPreferences) -> StudentPreferences:
        stored = prefs.model_copy(deep=True, update={"updated_at": datetime.now(timezone.utc)})
        self._preferences[stored.user_id] = stored
        return stored.model_copy(deep=True)

    # ---- saved clubs ----
    async def save_club(self, user_id: str, organization_id: str) -> None:
        saved = self._saved.setdefault(user_id, [])
        if organization_id not in saved:
            saved.append(organization_id)

    async def unsave_club(self, user_id: str, organization_id: str) -> None:
        saved = self._saved.get(user_id, [])
        if organization_id in saved:
            saved.remove(organization_id)

    async def list_saved_clubs(self, user_id: str) -> list[str]:
        return list(self._saved.get(user_id, []))

    # ---- recommendation feedback ----
    async def add_recommendation_feedback(self, user_id: str, feedback: RecommendationFeedback) -> None:
        """Latest feedback per (user, club) wins."""
        items = [f for f in self._feedback.get(user_id, []) if f.organization_id != feedback.organization_id]
        items.append(feedback.model_copy(deep=True))
        self._feedback[user_id] = items

    async def list_recommendation_feedback(self, user_id: str) -> list[RecommendationFeedback]:
        return [f.model_copy(deep=True) for f in self._feedback.get(user_id, [])]

    # ---- conversations ----
    async def create_conversation(self, conversation: Conversation) -> Conversation:
        self._conversations[conversation.id] = conversation.model_copy(deep=True)
        self._messages.setdefault(conversation.id, [])
        return conversation.model_copy(deep=True)

    async def get_conversation(self, conversation_id: str) -> Optional[Conversation]:
        conv = self._conversations.get(conversation_id)
        return conv.model_copy(deep=True) if conv else None

    async def list_conversations(self, user_id: str) -> list[Conversation]:
        """Newest first."""
        convs = [c for c in self._conversations.values() if c.owner_user_id == user_id]
        convs.sort(key=lambda c: c.created_at, reverse=True)
        return [c.model_copy(deep=True) for c in convs]

    async def add_message(self, message: Message) -> Message:
        self._messages.setdefault(message.conversation_id, []).append(message.model_copy(deep=True))
        return message.model_copy(deep=True)

    async def list_messages(self, conversation_id: str, limit: int = 50) -> list[Message]:
        msgs = self._messages.get(conversation_id, [])
        tail = msgs[-limit:] if limit > 0 else []
        return [m.model_copy(deep=True) for m in tail]

    # ---- interests ----
    async def create_interest(self, interest: ClubInterest) -> ClubInterest:
        key = (interest.student_id, interest.idempotency_key)
        existing = self._interests.get(key)
        if existing is None:
            existing = interest.model_copy(deep=True)
            self._interests[key] = existing
        return existing.model_copy(deep=True)

    async def list_interests_for_student(self, user_id: str) -> list[ClubInterest]:
        return [i.model_copy(deep=True) for i in self._interests.values() if i.student_id == user_id]

    async def list_interests_for_org(self, organization_id: str) -> list[ClubInterest]:
        return [i.model_copy(deep=True) for i in self._interests.values() if i.organization_id == organization_id]

    # ---- audit ----
    async def add_audit_log(self, entry: AuditLog) -> None:
        self._audit.append(entry.model_copy(deep=True))

    def audit_entries(self) -> list[AuditLog]:
        """Test/debug helper (not part of the protocol)."""
        return [e.model_copy(deep=True) for e in self._audit]
