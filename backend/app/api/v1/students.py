"""Student-private routes: profile, preferences, recommendations, saved clubs, interests."""
from fastapi import APIRouter, Depends, Query

from app.api.deps import embedder_dep, repo_dep
from app.schemas.common import ToolResult
from app.schemas.student import RecommendationFeedback, StudentPreferencesUpdate
from app.security.actor import Actor
from app.security.auth import get_actor

from ._common import require_club, svc

router = APIRouter()


@router.get("/me")
async def me(actor: Actor = Depends(get_actor), repo=Depends(repo_dep)) -> ToolResult:
    prefs = await repo.get_preferences(actor.user_id)
    return ToolResult.success({"actor": actor, "has_preferences": prefs is not None})


@router.get("/me/preferences")
async def get_preferences(actor: Actor = Depends(get_actor), repo=Depends(repo_dep)) -> ToolResult:
    return ToolResult.success(await svc("preferences").get_preferences(repo, actor.user_id))


@router.put("/me/preferences")
async def put_preferences(
    body: StudentPreferencesUpdate, actor: Actor = Depends(get_actor), repo=Depends(repo_dep)
) -> ToolResult:
    return ToolResult.success(await svc("preferences").update_preferences(repo, actor.user_id, body))


@router.get("/me/saved-clubs")
async def saved_clubs(actor: Actor = Depends(get_actor), repo=Depends(repo_dep)) -> ToolResult:
    clubs = [await repo.get_club(oid) for oid in await repo.list_saved_clubs(actor.user_id)]
    return ToolResult.success([c for c in clubs if c is not None])


@router.get("/me/interests")
async def my_interests(actor: Actor = Depends(get_actor), repo=Depends(repo_dep)) -> ToolResult:
    return ToolResult.success(await repo.list_interests_for_student(actor.user_id))


@router.get("/recommendations")
async def recommendations(
    limit: int = Query(default=10, ge=1, le=50),
    actor: Actor = Depends(get_actor),
    repo=Depends(repo_dep),
    embedder=Depends(embedder_dep),
) -> ToolResult:
    return ToolResult.success(await svc("recommendations").recommend_clubs(repo, embedder, actor.user_id, limit))


@router.post("/recommendations/feedback")
async def recommendation_feedback(
    body: RecommendationFeedback, actor: Actor = Depends(get_actor), repo=Depends(repo_dep)
) -> ToolResult:
    await require_club(repo, body.organization_id)
    await repo.add_recommendation_feedback(actor.user_id, body)
    return ToolResult.success({"recorded": True})
