"""Student-agent domain models. Source of truth for the student side (PRD 9.4, 13).
Do not change field names without updating docs/student-agent-contract.md."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Any, Literal, Optional
from uuid import uuid4

from pydantic import Field, field_validator

from .common import StrictModel

CAMPUS_TZ = ZoneInfo("America/Los_Angeles")


def _uuid() -> str:
    return str(uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- Clubs ----------
class FAQItem(StrictModel):
    question: str = Field(max_length=300)
    answer: str = Field(max_length=2000)


class ClubProfile(StrictModel):
    """Public club profile. Everything here is safe to show any student."""
    organization_id: str
    name: str = Field(max_length=120)
    slug: str = Field(max_length=120)
    category: str = Field(max_length=60)
    tags: list[str] = Field(default_factory=list, max_length=20)
    public_description: str = Field(max_length=2000)
    history: str = Field(default="", max_length=4000)
    founded_year: Optional[int] = None
    activities: list[str] = Field(default_factory=list, max_length=20)
    notable_events: list[str] = Field(default_factory=list, max_length=20)
    meeting_schedule: str = Field(default="", max_length=300)
    time_commitment: str = Field(default="", max_length=300)
    time_commitment_hours_per_week: Optional[float] = None
    membership_requirements: str = Field(default="", max_length=600)
    # "unknown" = the source pages never stated it. Agents must not assert a recruitment
    # state from the default; see services/recommendations.py.
    recruitment_status: Literal["open", "application", "closed", "unknown"] = "unknown"
    how_to_join: str = Field(default="", max_length=600)
    who_thrives_here: str = Field(default="", max_length=600)
    faq: list[FAQItem] = Field(default_factory=list, max_length=30)
    public_contact: str = Field(default="", max_length=200)
    verification_status: Literal["verified", "pending", "unverified"] = "verified"
    # demo = invented sample data; public_web = collected from public pages (see source_urls); live = club-managed
    data_label: Literal["demo", "public_web", "live"] = "demo"
    website: str = Field(default="", max_length=300)
    social_links: dict[str, str] = Field(default_factory=dict)  # instagram / linkedin / facebook / x / youtube / discord ...
    source_urls: list[str] = Field(default_factory=list, max_length=20)
    collected_at: Optional[str] = None  # ISO date the public data was collected


class ClubEvent(StrictModel):
    id: str = Field(default_factory=_uuid)
    organization_id: str
    title: str = Field(max_length=200)
    description: str = Field(default="", max_length=2000)
    start_at: datetime
    end_at: datetime
    location: str = Field(default="", max_length=200)
    visibility: Literal["public", "members"] = "public"

    @field_validator("start_at", "end_at")
    @classmethod
    def _require_timezone(cls, value: datetime) -> datetime:
        """Collected data sometimes omits the offset. Assume campus time rather than
        letting a naive datetime reach comparisons against aware "now"."""
        return value.replace(tzinfo=CAMPUS_TZ) if value.tzinfo is None else value


class ClubSearchHit(StrictModel):
    club: ClubProfile
    score: float
    matched_tags: list[str] = Field(default_factory=list)


# ---------- Student ----------
class StudentPreferences(StrictModel):
    """Only attributes the student explicitly supplied. Never infer sensitive traits."""
    user_id: str
    interest_tags: list[str] = Field(default_factory=list, max_length=30)
    goals: str = Field(default="", max_length=1000)
    year_level: Optional[Literal["freshman", "sophomore", "junior", "senior", "graduate"]] = None
    hours_per_week_available: Optional[float] = Field(default=None, ge=0, le=60)
    personalization_enabled: bool = True
    updated_at: datetime = Field(default_factory=_now)


class StudentPreferencesUpdate(StrictModel):
    interest_tags: Optional[list[str]] = Field(default=None, max_length=30)
    goals: Optional[str] = Field(default=None, max_length=1000)
    year_level: Optional[Literal["freshman", "sophomore", "junior", "senior", "graduate"]] = None
    hours_per_week_available: Optional[float] = Field(default=None, ge=0, le=60)
    personalization_enabled: Optional[bool] = None


ReasonCode = Literal[
    "INTEREST_TAG_MATCH", "SEMANTIC_MATCH", "GOAL_MATCH", "TIME_FIT", "RECRUITING_NOW", "UPCOMING_EVENT", "POPULAR_DEFAULT"
]


class Recommendation(StrictModel):
    organization_id: str
    club_name: str
    score: float = Field(ge=0, le=1, description="Relevance score, NOT a probability of joining")
    reason_codes: list[ReasonCode]
    matched_tags: list[str] = Field(default_factory=list)
    explanation: str = Field(max_length=500)


class RecommendationFeedback(StrictModel):
    organization_id: str
    feedback: Literal["helpful", "not_relevant", "hide"]


class FitCheckResult(StrictModel):
    """'Is this club a fit for me?' grounded only in explicit preferences + club profile."""
    organization_id: str
    fit_level: Literal["strong", "possible", "weak", "unknown"]
    reasons: list[str] = Field(default_factory=list, max_length=8)
    concerns: list[str] = Field(default_factory=list, max_length=8)
    questions_to_ask: list[str] = Field(default_factory=list, max_length=5)


class ClubInterestCreate(StrictModel):
    organization_id: str
    interest_type: Literal["membership", "event", "general"] = "membership"
    message: str = Field(default="", max_length=1000)
    share_contact: bool = False
    user_confirmed: bool = False
    idempotency_key: str = Field(min_length=8, max_length=200)


class ClubInterest(StrictModel):
    id: str = Field(default_factory=_uuid)
    student_id: str
    organization_id: str
    interest_type: Literal["membership", "event", "general"]
    message: str = ""
    share_contact: bool = False
    consent_snapshot: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str
    created_at: datetime = Field(default_factory=_now)


# ---------- Conversations ----------
AgentType = Literal["student", "club"]
Channel = Literal["web", "whatsapp", "telegram"]


class Conversation(StrictModel):
    id: str = Field(default_factory=_uuid)
    owner_user_id: str
    agent_type: AgentType
    agent_id: str  # student_agent:{user_id} | club_agent:{organization_id}
    organization_id: Optional[str] = None
    channel: Channel = "web"
    title: str = Field(default="", max_length=200)
    created_at: datetime = Field(default_factory=_now)


class Message(StrictModel):
    id: str = Field(default_factory=_uuid)
    conversation_id: str
    sender_type: Literal["user", "agent", "system"]
    content: str = Field(max_length=8000)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=_now)


class ToolActivity(StrictModel):
    """Concise, user-visible summary of a tool call. Never chain-of-thought."""
    tool: str
    summary: str
    ok: bool = True


class AgentCard(StrictModel):
    """Structured UI card. type: club | recommendation | event | fit_check | interest_confirmation"""
    type: Literal["club", "recommendation", "event", "fit_check", "interest_confirmation"]
    data: dict[str, Any]


class PendingConfirmation(StrictModel):
    """A write the agent wants to do but that needs explicit user confirmation first."""
    action: Literal["submit_club_interest"]
    summary: str
    payload: dict[str, Any]


class AgentTurn(StrictModel):
    conversation_id: str
    message: Message
    tool_activity: list[ToolActivity] = Field(default_factory=list)
    cards: list[AgentCard] = Field(default_factory=list)
    pending_confirmation: Optional[PendingConfirmation] = None
    used_fallback_model: bool = False


class ConversationCreate(StrictModel):
    agent_type: AgentType
    organization_id: Optional[str] = None  # required when agent_type == "club"
    channel: Channel = "web"
    message: Optional[str] = Field(default=None, max_length=4000)


class MessageCreate(StrictModel):
    content: str = Field(min_length=1, max_length=4000)


class AuditLog(StrictModel):
    id: str = Field(default_factory=_uuid)
    actor_id: str
    action: str
    resource_type: str
    resource_id: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=_now)
