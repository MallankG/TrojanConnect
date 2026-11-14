"""Club discovery, fit check, save and interest submission."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import Field

from app.api.deps import embedder_dep, repo_dep
from app.schemas.common import StrictModel, ToolResult
from app.schemas.student import ClubInterestCreate, ClubSearchHit
from app.security.actor import Actor
from app.security.auth import get_actor

from ._common import require_club, svc

router = APIRouter()


class ClubInterestBody(StrictModel):
    """ClubInterestCreate minus organization_id (the path wins)."""
    interest_type: Literal["membership", "event", "general"] = "membership"
    message: str = Field(default="", max_length=1000)
    share_contact: bool = False
    user_confirmed: bool = False
    idempotency_key: str = Field(min_length=8, max_length=200)


def _public(events):
    return [e for e in events if e.visibility == "public"]


@router.get("/clubs")
async def list_clubs(
    query: str = Query(default="", max_length=300),
    tags: str = Query(default="", max_length=500, description="Comma-separated interest tags"),
    limit: Optional[int] = Query(default=None, ge=1, le=50),
    actor: Actor = Depends(get_actor),
    repo=Depends(repo_dep),
    embedder=Depends(embedder_dep),
) -> ToolResult:
    """Returns a list of {club, score, matched_tags}. Without query/tags: every club, score 0."""
    tag_list = [t.strip() for t in tags.split(",") if t.strip()]
    if not query.strip() and not tag_list:
        clubs = await repo.list_clubs()
        hits = [ClubSearchHit(club=c, score=0.0) for c in (clubs[:limit] if limit else clubs)]
    else:
        hits = await svc("clubs").search_clubs(repo, embedder, query.strip(), tag_list, limit or 10)
    return ToolResult.success(hits)


@router.get("/events")
async def list_events(upcoming_only: bool = True, actor: Actor = Depends(get_actor), repo=Depends(repo_dep)) -> ToolResult:
    return ToolResult.success(_public(await repo.list_events(None, upcoming_only)))


@router.get("/clubs/{organization_id}")
async def get_club(organization_id: str, actor: Actor = Depends(get_actor), repo=Depends(repo_dep)) -> ToolResult:
    return ToolResult.success(await require_club(repo, organization_id))


@router.get("/clubs/{organization_id}/events")
async def club_events(
    organization_id: str, upcoming_only: bool = True, actor: Actor = Depends(get_actor), repo=Depends(repo_dep)
) -> ToolResult:
    await require_club(repo, organization_id)
    return ToolResult.success(_public(await repo.list_events(organization_id, upcoming_only)))


@router.get("/clubs/{organization_id}/fit")
async def club_fit(
    organization_id: str, actor: Actor = Depends(get_actor), repo=Depends(repo_dep), embedder=Depends(embedder_dep)
) -> ToolResult:
    await require_club(repo, organization_id)
    return ToolResult.success(await svc("recommendations").fit_check(repo, embedder, actor.user_id, organization_id))


@router.post("/clubs/{organization_id}/save")
async def save_club(organization_id: str, actor: Actor = Depends(get_actor), repo=Depends(repo_dep)) -> ToolResult:
    await require_club(repo, organization_id)
    await repo.save_club(actor.user_id, organization_id)
    return ToolResult.success({"organization_id": organization_id, "saved": True})


@router.delete("/clubs/{organization_id}/save")
async def unsave_club(organization_id: str, actor: Actor = Depends(get_actor), repo=Depends(repo_dep)) -> ToolResult:
    await repo.unsave_club(actor.user_id, organization_id)
    return ToolResult.success({"organization_id": organization_id, "saved": False})


@router.post("/clubs/{organization_id}/interest")
async def submit_interest(
    organization_id: str, body: ClubInterestBody, actor: Actor = Depends(get_actor), repo=Depends(repo_dep)
) -> ToolResult:
    await require_club(repo, organization_id)
    req = ClubInterestCreate(organization_id=organization_id, **body.model_dump())
    return ToolResult.success(await svc("interests").submit_club_interest(repo, actor, req))
