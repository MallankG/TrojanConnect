"""Supabase (Postgres + pgvector) StudentRepository. Schema: supabase/migrations/.

Uses the service-role key, which bypasses RLS, so EVERY student-private query here must be
filtered by the server-supplied user id. The supabase client is synchronous; calls run in a
worker thread via asyncio.to_thread. Not exercised by the test suite (needs real keys)."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Optional, TypeVar

from app.config import Settings
from app.schemas.student import (
    AuditLog, ClubEvent, ClubInterest, ClubProfile, Conversation, Message,
    RecommendationFeedback, StudentPreferences,
)

logger = logging.getLogger(__name__)
T = TypeVar("T")


def _cols(model: type) -> str:
    """Select exactly the model's fields so extra DB columns (embedding, timestamps) never
    reach the extra='forbid' pydantic models."""
    return ",".join(model.model_fields.keys())


CLUB_COLS = _cols(ClubProfile)
EVENT_COLS = _cols(ClubEvent)
PREF_COLS = _cols(StudentPreferences)
CONV_COLS = _cols(Conversation)
MSG_COLS = _cols(Message)
INTEREST_COLS = _cols(ClubInterest)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SupabaseRepository:
    def __init__(self, settings: Settings) -> None:
        if not settings.use_supabase:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        from supabase import create_client  # imported lazily so the module imports without keys

        self._client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        self._known_profiles: set[str] = set()

    async def _run(self, fn: Callable[[], T]) -> T:
        return await asyncio.to_thread(fn)

    async def _rows(self, build: Callable[[], Any]) -> list[dict[str, Any]]:
        """`build` returns a ready-to-execute query builder; returns the response rows."""
        resp = await self._run(lambda: build().execute())
        return list(getattr(resp, "data", None) or [])

    async def _ensure_profile(self, user_id: str) -> None:
        """Student tables reference profiles(id); make sure the row exists before writing."""
        if user_id in self._known_profiles:
            return
        await self._rows(lambda: self._client.table("profiles").upsert(
            {"id": user_id}, on_conflict="id", ignore_duplicates=True))
        self._known_profiles.add(user_id)

    # ---- clubs / events ----
    async def list_clubs(self) -> list[ClubProfile]:
        rows = await self._rows(lambda: self._client.table("club_profiles").select(CLUB_COLS).order("name"))
        return [ClubProfile.model_validate(r) for r in rows]

    async def get_club(self, organization_id: str) -> Optional[ClubProfile]:
        rows = await self._rows(lambda: self._client.table("club_profiles").select(CLUB_COLS)
                                .eq("organization_id", organization_id).limit(1))
        return ClubProfile.model_validate(rows[0]) if rows else None

    async def list_events(self, organization_id: Optional[str] = None, upcoming_only: bool = True) -> list[ClubEvent]:
        """Public events only, soonest first."""
        def build():
            q = self._client.table("events").select(EVENT_COLS).eq("visibility", "public")
            if organization_id is not None:
                q = q.eq("organization_id", organization_id)
            if upcoming_only:
                q = q.gte("end_at", _now_iso())
            return q.order("start_at")
        return [ClubEvent.model_validate(r) for r in await self._rows(build)]

    async def match_clubs(self, embedding: list[float], limit: int) -> Optional[list[tuple[str, float]]]:
        """Returns None (caller falls back to in-process similarity) when the RPC fails, e.g.
        embedding dimension != 768, or when no club has a stored embedding yet."""
        try:
            rows = await self._rows(lambda: self._client.rpc(
                "match_clubs", {"query_embedding": [float(x) for x in embedding], "match_count": int(limit)}))
        except Exception as exc:
            logger.warning("match_clubs RPC failed (%s: %s); using in-process fallback.", type(exc).__name__, exc)
            return None
        if not rows:
            return None
        return [(r["organization_id"], float(r["similarity"])) for r in rows]

    async def set_club_embedding(self, organization_id: str, embedding: list[float]) -> None:
        """Not part of the protocol: backfill helper for club_profiles.embedding (768 dims)."""
        await self._rows(lambda: self._client.table("club_profiles")
                         .update({"embedding": [float(x) for x in embedding]})
                         .eq("organization_id", organization_id))

    # ---- preferences ----
    async def get_preferences(self, user_id: str) -> Optional[StudentPreferences]:
        rows = await self._rows(lambda: self._client.table("student_preferences").select(PREF_COLS)
                                .eq("user_id", user_id).limit(1))
        return StudentPreferences.model_validate(rows[0]) if rows else None

    async def upsert_preferences(self, prefs: StudentPreferences) -> StudentPreferences:
        await self._ensure_profile(prefs.user_id)
        stored = prefs.model_copy(update={"updated_at": datetime.now(timezone.utc)})
        payload = stored.model_dump(mode="json")
        await self._rows(lambda: self._client.table("student_preferences").upsert(payload, on_conflict="user_id"))
        return stored

    # ---- saved clubs ----
    async def save_club(self, user_id: str, organization_id: str) -> None:
        await self._ensure_profile(user_id)
        await self._rows(lambda: self._client.table("saved_clubs").upsert(
            {"user_id": user_id, "organization_id": organization_id},
            on_conflict="user_id,organization_id", ignore_duplicates=True))

    async def unsave_club(self, user_id: str, organization_id: str) -> None:
        await self._rows(lambda: self._client.table("saved_clubs").delete()
                         .eq("user_id", user_id).eq("organization_id", organization_id))

    async def list_saved_clubs(self, user_id: str) -> list[str]:
        rows = await self._rows(lambda: self._client.table("saved_clubs").select("organization_id")
                                .eq("user_id", user_id).order("created_at"))
        return [r["organization_id"] for r in rows]

    # ---- recommendation feedback ----
    async def add_recommendation_feedback(self, user_id: str, feedback: RecommendationFeedback) -> None:
        """Latest feedback per (user, club) wins."""
        await self._ensure_profile(user_id)
        payload = {"user_id": user_id, "organization_id": feedback.organization_id,
                   "feedback": feedback.feedback, "created_at": _now_iso()}
        await self._rows(lambda: self._client.table("recommendation_feedback").upsert(
            payload, on_conflict="user_id,organization_id"))

    async def list_recommendation_feedback(self, user_id: str) -> list[RecommendationFeedback]:
        rows = await self._rows(lambda: self._client.table("recommendation_feedback")
                                .select("organization_id,feedback").eq("user_id", user_id).order("created_at"))
        return [RecommendationFeedback.model_validate(r) for r in rows]

    # ---- conversations ----
    async def create_conversation(self, conversation: Conversation) -> Conversation:
        await self._ensure_profile(conversation.owner_user_id)
        payload = conversation.model_dump(mode="json")
        await self._rows(lambda: self._client.table("conversations").insert(payload))
        return conversation

    async def get_conversation(self, conversation_id: str) -> Optional[Conversation]:
        rows = await self._rows(lambda: self._client.table("conversations").select(CONV_COLS)
                                .eq("id", conversation_id).limit(1))
        return Conversation.model_validate(rows[0]) if rows else None

    async def list_conversations(self, user_id: str) -> list[Conversation]:
        """Newest first."""
        rows = await self._rows(lambda: self._client.table("conversations").select(CONV_COLS)
                                .eq("owner_user_id", user_id).order("created_at", desc=True))
        return [Conversation.model_validate(r) for r in rows]

    async def add_message(self, message: Message) -> Message:
        payload = message.model_dump(mode="json")
        await self._rows(lambda: self._client.table("messages").insert(payload))
        return message

    async def list_messages(self, conversation_id: str, limit: int = 50) -> list[Message]:
        if limit <= 0:
            return []
        rows = await self._rows(lambda: self._client.table("messages").select(MSG_COLS)
                                .eq("conversation_id", conversation_id)
                                .order("created_at", desc=True).limit(limit))
        rows.reverse()  # newest-N fetched, returned oldest-first
        return [Message.model_validate(r) for r in rows]

    async def claim_pending_confirmation(self, conversation_id: str, message_id: str,
                                         confirmed: bool) -> Optional[dict[str, Any]]:
        rows = await self._rows(lambda: self._client.rpc("claim_pending_confirmation", {
            "p_conversation_id": conversation_id, "p_message_id": message_id, "p_confirmed": confirmed,
        }))
        return rows[0].get("pending_confirmation") if rows else None

    # ---- interests ----
    async def _find_interest(self, student_id: str, organization_id: str, idempotency_key: str) -> Optional[ClubInterest]:
        rows = await self._rows(lambda: self._client.table("club_interests").select(INTEREST_COLS)
                                .eq("student_id", student_id).eq("organization_id", organization_id)
                                .eq("idempotency_key", idempotency_key).limit(1))
        return ClubInterest.model_validate(rows[0]) if rows else None

    async def create_interest(self, interest: ClubInterest) -> ClubInterest:
        existing = await self._find_interest(interest.student_id, interest.organization_id, interest.idempotency_key)
        if existing:
            return existing
        await self._ensure_profile(interest.student_id)
        payload = interest.model_dump(mode="json")
        try:
            await self._rows(lambda: self._client.table("club_interests").insert(payload))
        except Exception:
            # Lost a race on unique (student_id, idempotency_key): return the winner's row.
            existing = await self._find_interest(interest.student_id, interest.organization_id, interest.idempotency_key)
            if existing:
                return existing
            raise
        return interest

    async def list_interests_for_student(self, user_id: str) -> list[ClubInterest]:
        rows = await self._rows(lambda: self._client.table("club_interests").select(INTEREST_COLS)
                                .eq("student_id", user_id).order("created_at"))
        return [ClubInterest.model_validate(r) for r in rows]

    async def list_interests_for_org(self, organization_id: str) -> list[ClubInterest]:
        rows = await self._rows(lambda: self._client.table("club_interests").select(INTEREST_COLS)
                                .eq("organization_id", organization_id).order("created_at"))
        return [ClubInterest.model_validate(r) for r in rows]

    # ---- audit ----
    async def add_audit_log(self, entry: AuditLog) -> None:
        payload = entry.model_dump(mode="json")
        await self._rows(lambda: self._client.table("audit_logs").upsert(
            payload, on_conflict="id", ignore_duplicates=True))
