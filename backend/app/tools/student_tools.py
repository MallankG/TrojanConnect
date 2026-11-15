"""LLM-callable tools for the Student Agent and public Club Agents (PRD 9.4).

Identity always comes from the server-injected Actor: any user_id/role the model supplies is dropped.
Arguments are validated with pydantic (extra="forbid"). submit_club_interest never writes: it returns a
PendingConfirmation that the user must confirm through the orchestrator."""
from typing import Any, Literal, Optional
from uuid import uuid4

from pydantic import Field, ValidationError

from app.integrations.llm import ToolSpec
from app.schemas.common import NOT_FOUND, VALIDATION_ERROR, AppError, StrictModel, ToolResult
from app.schemas.student import ClubEvent, ClubProfile, PendingConfirmation, StudentPreferencesUpdate, ToolActivity
from app.security.actor import Actor
from app.services import clubs as club_service
from app.services import preferences as pref_service
from app.services import recommendations as rec_service
from app.services.interests import shared_fields

IDENTITY_ARGS = {"user_id", "student_id", "student_profile_id", "owner_user_id", "actor", "actor_id", "role", "roles", "user_confirmed"}
YearLevel = Literal["freshman", "sophomore", "junior", "senior", "graduate"]


# ---------- argument models
class NoArgs(StrictModel):
    pass


class UpdatePreferencesArgs(StrictModel):
    interest_tags: Optional[list[str]] = Field(default=None, max_length=30, description="Full replacement list of interests the student explicitly stated")
    add_interest_tags: Optional[list[str]] = Field(default=None, max_length=30, description="Interests to add to the existing list")
    goals: Optional[str] = Field(default=None, max_length=1000)
    year_level: Optional[YearLevel] = None
    hours_per_week_available: Optional[float] = Field(default=None, ge=0, le=60)
    personalization_enabled: Optional[bool] = None


class SearchClubsArgs(StrictModel):
    query: str = Field(default="", max_length=300)
    interest_tags: list[str] = Field(default_factory=list, max_length=20)
    limit: int = Field(default=5, ge=1, le=20)


class RecommendClubsArgs(StrictModel):
    limit: int = Field(default=5, ge=1, le=20)
    explain: bool = True


class ClubArgs(StrictModel):
    organization_id: str = Field(max_length=120)


class ListEventsArgs(StrictModel):
    organization_id: Optional[str] = Field(default=None, max_length=120, description="Omit to list events across all clubs")


class FitArgs(StrictModel):
    organization_id: str = Field(max_length=120)
    interest_tags: Optional[list[str]] = Field(default=None, max_length=20, description="Interests the student stated in this chat (used for this check only)")
    goals: Optional[str] = Field(default=None, max_length=1000, description="What the student said they are looking for")
    hours_per_week_available: Optional[float] = Field(default=None, ge=0, le=60)


class SubmitInterestArgs(StrictModel):
    organization_id: str = Field(max_length=120)
    interest_type: Literal["membership", "event", "general"] = "membership"
    message: str = Field(default="", max_length=1000)
    share_contact: bool = Field(default=False, description="True only if the student explicitly asked to share their name and email")


def _clean_schema(node: Any, drop: frozenset = frozenset()) -> Any:
    """Pydantic JSON schema -> the small subset every function-calling API accepts."""
    if isinstance(node, list):
        return [_clean_schema(n, drop) for n in node]
    if not isinstance(node, dict):
        return node
    if "anyOf" in node:  # Optional[X] -> X
        inner = next((n for n in node["anyOf"] if n.get("type") != "null"), {})
        node = {**{k: v for k, v in node.items() if k != "anyOf"}, **inner}
    out = {k: _clean_schema(v, drop) for k, v in node.items() if k not in ("title", "additionalProperties", "default")}
    if "properties" in out:
        out["properties"] = {k: v for k, v in out["properties"].items() if k not in drop}
        out["required"] = [r for r in out.get("required", []) if r not in drop]
    return out


_TOOLS: dict[str, tuple[type[StrictModel], str]] = {
    "get_student_preferences": (NoArgs, "Return the signed-in student's own explicitly saved preferences."),
    "update_student_preferences": (UpdatePreferencesArgs, "Save preferences the student has EXPLICITLY stated in their own words "
                                   "(interests, goals, year, weekly hours). Never infer or guess values."),
    "search_clubs": (SearchClubsArgs, "Search public club profiles by free-text query and/or interest tags."),
    "recommend_clubs": (RecommendClubsArgs, "Rank clubs for the signed-in student from their saved preferences, with reason codes and explanations."),
    "get_club_profile": (ClubArgs, "Get a club's full public profile (history, activities, time commitment, how to join, FAQ)."),
    "list_club_events": (ListEventsArgs, "List upcoming public events for a club (or all clubs)."),
    "check_club_fit": (FitArgs, "Deterministic fit assessment between the student's stated preferences and a club: reasons, honest concerns, questions to ask."),
    "submit_club_interest": (SubmitInterestArgs, "Prepare an expression of interest for a club. This does NOT send anything: "
                             "it returns a pending confirmation the student must approve in the UI."),
}
STUDENT_TOOL_NAMES = list(_TOOLS)
CLUB_TOOL_NAMES = ["get_club_profile", "list_club_events", "check_club_fit", "submit_club_interest"]


def _spec(name: str, scoped: bool) -> ToolSpec:
    model, description = _TOOLS[name]
    drop = frozenset({"organization_id"}) if scoped else frozenset()
    if scoped:
        description += " Applies to this club only."
    return ToolSpec(name=name, description=description, parameters=_clean_schema(model.model_json_schema(), drop))


def student_tool_specs() -> list[ToolSpec]:
    return [_spec(n, False) for n in STUDENT_TOOL_NAMES]


def club_tool_specs() -> list[ToolSpec]:
    """Tools for a club agent; organization_id is fixed server-side to that club."""
    return [_spec(n, True) for n in CLUB_TOOL_NAMES]


# ---------- compact, public-only views returned to the model / UI
def club_summary(club: ClubProfile) -> dict[str, Any]:
    return {
        "organization_id": club.organization_id, "name": club.name, "category": club.category, "tags": club.tags,
        "description": club.public_description[:280], "time_commitment": club.time_commitment,
        "time_commitment_hours_per_week": club.time_commitment_hours_per_week,
        "recruitment_status": club.recruitment_status, "data_label": club.data_label,
    }


def event_summary(event: ClubEvent, club_name: str = "") -> dict[str, Any]:
    return {"id": event.id, "organization_id": event.organization_id, "club_name": club_name, "title": event.title,
            "description": event.description[:280], "start_at": event.start_at.isoformat(),
            "end_at": event.end_at.isoformat(), "location": event.location}


async def _require_club(repo, organization_id: str) -> ClubProfile:
    club = await repo.get_club(organization_id)
    if club is None:
        raise AppError(NOT_FOUND, "Club not found.", status_code=404)
    return club


# ---------- executor
async def execute_tool(name: str, args: dict, *, actor: Actor, repo, embedder, scope_org_id: Optional[str] = None) -> ToolResult:
    allowed = CLUB_TOOL_NAMES if scope_org_id else STUDENT_TOOL_NAMES
    if name not in allowed:
        return ToolResult.failure(VALIDATION_ERROR, f"Unknown or unavailable tool '{name}'.")
    model, _ = _TOOLS[name]
    raw = {k: v for k, v in (args or {}).items() if k not in IDENTITY_ARGS and v is not None}
    if scope_org_id and "organization_id" in model.model_fields:
        raw["organization_id"] = scope_org_id  # a club agent can only ever act on its own club
    try:
        a = model.model_validate(raw)
    except ValidationError as exc:
        problems = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()[:4])
        return ToolResult.failure(VALIDATION_ERROR, f"Invalid arguments for {name}: {problems}")
    uid = actor.user_id
    try:
        if name == "get_student_preferences":
            return ToolResult.success((await pref_service.get_preferences(repo, uid)).model_dump(mode="json", exclude={"user_id"}))
        if name == "update_student_preferences":
            fields = a.model_dump(exclude_unset=True, exclude={"add_interest_tags"})
            if a.add_interest_tags:
                current = await pref_service.get_preferences(repo, uid)
                fields["interest_tags"] = (fields.get("interest_tags") or current.interest_tags) + a.add_interest_tags
            if not fields:
                return ToolResult.failure(VALIDATION_ERROR, "No preference values were provided.")
            prefs = await pref_service.update_preferences(repo, uid, StudentPreferencesUpdate(**fields))
            return ToolResult.success(prefs.model_dump(mode="json", exclude={"user_id"}))
        if name == "search_clubs":
            hits = await club_service.search_clubs(repo, embedder, a.query, a.interest_tags, a.limit)
            return ToolResult.success({"hits": [{**club_summary(h.club), "score": h.score, "matched_tags": h.matched_tags} for h in hits]})
        if name == "recommend_clubs":
            recs = await rec_service.recommend_clubs(repo, embedder, uid, a.limit)
            return ToolResult.success({
                "personalized": bool(recs) and "POPULAR_DEFAULT" not in recs[0].reason_codes,
                "score_meaning": "relevance score between 0 and 1, not a probability of joining",
                "recommendations": [r.model_dump(mode="json") for r in recs],
            })
        if name == "get_club_profile":
            return ToolResult.success((await _require_club(repo, a.organization_id)).model_dump(mode="json"))
        if name == "list_club_events":
            if a.organization_id:
                await _require_club(repo, a.organization_id)
            names = {c.organization_id: c.name for c in await repo.list_clubs()}
            events = [e for e in await repo.list_events(a.organization_id, True) if e.visibility == "public"]
            events.sort(key=lambda e: e.start_at)
            return ToolResult.success({"events": [event_summary(e, names.get(e.organization_id, "")) for e in events[:10]]})
        if name == "check_club_fit":
            club = await _require_club(repo, a.organization_id)
            stated = a.model_dump(exclude_unset=True, exclude={"organization_id"})
            overrides = StudentPreferencesUpdate(**stated) if stated else None
            fit = await rec_service.fit_check(repo, embedder, uid, a.organization_id, overrides=overrides)
            return ToolResult.success({**fit.model_dump(mode="json"), "club_name": club.name})
        if name == "submit_club_interest":
            club = await _require_club(repo, a.organization_id)
            shared = "your message" + (" plus your name and email" if a.share_contact else "; your contact details will NOT be shared")
            pending = PendingConfirmation(
                action="submit_club_interest",
                summary=f"Send a {a.interest_type} interest to {club.name}. Shared with the club: {shared}.",
                payload={"organization_id": club.organization_id, "club_name": club.name, "interest_type": a.interest_type,
                         "message": a.message, "share_contact": a.share_contact,
                         "shared_fields": shared_fields(a.share_contact), "idempotency_key": f"chat-{uuid4().hex}"},
            )
            return ToolResult.success({"status": "awaiting_user_confirmation", "submitted": False,
                                       "pending_confirmation": pending.model_dump(mode="json")})
    except AppError as exc:
        return ToolResult.failure(exc.code, exc.message, exc.retryable)
    except ValidationError:
        return ToolResult.failure(VALIDATION_ERROR, f"Invalid values for {name}.")
    return ToolResult.failure(VALIDATION_ERROR, f"Unknown tool '{name}'.")


def summarize_activity(name: str, args: dict, result: ToolResult) -> ToolActivity:
    """Concise user-visible line about what a tool did (never reasoning, never private data)."""
    args, data = args or {}, result.data if isinstance(result.data, dict) else {}
    if not result.ok:
        return ToolActivity(tool=name, summary=f"{name.replace('_', ' ').capitalize()} failed: {result.error.message[:120]}", ok=False)
    if name == "search_clubs":
        what = ", ".join(filter(None, [str(args.get("query", ""))[:60], ", ".join(map(str, args.get("interest_tags") or []))]))
        summary = f"Searched clubs for '{what}' ({len(data.get('hits', []))} found)"
    elif name == "recommend_clubs":
        summary = f"Ranked {len(data.get('recommendations', []))} clubs " + (
            "from your saved interests" if data.get("personalized") else "(not personalised - no interests saved)")
    elif name == "get_club_profile":
        summary = f"Read the public profile of {data.get('name', 'the club')}"
    elif name == "list_club_events":
        summary = f"Checked upcoming public events ({len(data.get('events', []))} found)"
    elif name == "check_club_fit":
        summary = f"Checked your fit with {data.get('club_name', 'the club')}: {data.get('fit_level')}"
    elif name == "get_student_preferences":
        summary = "Looked up your saved preferences"
    elif name == "update_student_preferences":
        summary = "Saved preferences you stated: " + ", ".join(sorted(k for k in args if k in UpdatePreferencesArgs.model_fields))
    elif name == "submit_club_interest":
        summary = f"Prepared an interest for {(data.get('pending_confirmation') or {}).get('payload', {}).get('club_name', 'the club')} - waiting for your confirmation"
    else:
        summary = name.replace("_", " ").capitalize()
    return ToolActivity(tool=name, summary=summary[:200], ok=True)
