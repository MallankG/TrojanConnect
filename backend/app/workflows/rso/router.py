"""RSO recognition API (/api/v1/rso). Errors use the project's standard envelope via AppError.

The Assistant's /api/v1/pipeline/agent/chat routes RSO messages to the RSO agent automatically; these
endpoints back the RSO cards (fields, checklists, status buttons, email drafts) and the RSO tab.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from app.agents import rso_agent
from app.schemas.common import AppError
from app.security.client import require_client_header

from . import service

router = APIRouter(prefix="/api/v1/rso", tags=["rso-recognition"], dependencies=[Depends(require_client_header)])


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PathwayBody(Strict):
    pathway: Literal["new", "renew", "religious", "fall_applicant", "fsl", "club_sports"]
    listed_officer: bool | None = None


class CheckBody(Strict):
    key: str = Field(max_length=60)
    done: bool


class StatusBody(Strict):
    status: Literal["pending_approval", "requires_modifications", "denied", "recognized"]
    note: str = Field(default="", max_length=500)


class ChatBody(Strict):
    message: str = Field(min_length=1, max_length=4000)
    history: list[dict[str, str]] = Field(default_factory=list, max_length=60)


def _call(fn, *a: Any, **k: Any) -> Any:
    try:
        return fn(*a, **k)
    except service.RsoError as e:
        raise AppError(e.code, e.message, e.status) from e


@router.get("/schema")
def schema() -> dict[str, Any]:
    """Static: fields, pathways, steps per pathway, officer documents, advisor items, dates, sessions, contact, every USC link."""
    return service.schema()


@router.get("/state")
def state() -> dict[str, Any]:
    """The tracker: pathway, status, every step with done/links, next step, readiness, officers, advisor, dates, EngageSC hand-off."""
    return service.view()


@router.put("/fields")
def put_fields(patch: dict[str, Any]) -> dict[str, Any]:
    """Save organization, officer, advisor and roster fields. Invalid values come back in `rejected`; valid ones are saved."""
    saved, rejected = service.set_fields(patch)
    return {"saved": saved, "rejected": rejected, "state": service.view()}


@router.put("/pathway")
def put_pathway(body: PathwayBody) -> dict[str, Any]:
    return service.view(_call(service.set_pathway, body.pathway, body.listed_officer))


@router.put("/checks")
def put_check(body: CheckBody) -> dict[str, Any]:
    """Tick a checklist item: step.<id>, <officer role>.<accepted|hazing|learningPath|commitment>, advisor.<item>."""
    return service.view(_call(service.set_check, body.key, body.done))


@router.put("/status")
def put_status(body: StatusBody) -> dict[str, Any]:
    """Record what EngageSC shows. A person's action only: the RSO agent has no way to call this."""
    return service.view(_call(service.record_status, body.status, body.note))


@router.get("/emails/{target}")
def get_email(target: str) -> dict[str, Any]:
    """Reminder draft for an officer (by role) or the advisor: {to, subject, body, mailto, ready}. Nothing is sent."""
    return _call(service.email, target)


@router.post("/reset")
def reset() -> dict[str, Any]:
    return service.view(service.reset())


@router.post("/agent/chat")
def chat(body: ChatBody) -> dict[str, Any]:
    """Standalone RSO agent turn. The main Assistant (/api/v1/pipeline/agent/chat) also routes RSO messages here."""
    return rso_agent.run_turn(body.message, body.history)
