"""Student government (PRD 5.3, 9.5, 11.7) and club outreach routes. Identity and role come from the
server-side Actor; scope checks live in app.workflows.campus."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import Field

from app.api.deps import repo_dep
from app.api.streaming import stream_reply
from app.config import Settings, get_settings
from app.integrations import slack
from app.schemas.common import StrictModel, ToolResult
from app.security.actor import Actor
from app.security.auth import get_actor
from app.workflows.campus import government, outreach

router = APIRouter()
Scope = Literal["USG", "GSG"]


class AskBody(StrictModel):
    scope: Scope
    question: str = Field(min_length=1, max_length=1000)


class FeedbackBody(StrictModel):
    scope: Scope
    category: str = Field(default="", max_length=60)
    message: str = Field(min_length=1, max_length=2000)
    share_identity: bool = False
    user_confirmed: bool = False
    idempotency_key: str = Field(min_length=8, max_length=200)


class SourceBody(StrictModel):
    id: Optional[str] = Field(default=None, max_length=80)
    scope: Scope
    title: str = Field(min_length=1, max_length=200)
    excerpt: str = Field(min_length=1, max_length=2000)
    url: str = Field(min_length=8, max_length=500)
    owner: str = Field(default="", max_length=120)
    archived: bool = False


class AnnouncementBody(StrictModel):
    scope: Scope
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=2000)


class EventTime(StrictModel):
    start_at: str = Field(max_length=40)
    end_at: str = Field(max_length=40)
    location: str = Field(default="", max_length=200)


class PostBody(StrictModel):
    kind: Literal["event", "recruitment", "update"]
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=2000)
    event: Optional[EventTime] = None
    recruitment_status: Optional[Literal["open", "application", "closed"]] = None


class ProfilePatch(StrictModel):
    public_description: Optional[str] = Field(default=None, max_length=2000)
    meeting_schedule: Optional[str] = Field(default=None, max_length=300)
    recruitment_status: Optional[Literal["open", "application", "closed", "unknown"]] = None
    how_to_join: Optional[str] = Field(default=None, max_length=600)
    time_commitment: Optional[str] = Field(default=None, max_length=300)


# ---- student government -----------------------------------------------------------------------
# ponytail: campus store calls are synchronous; move to a thread pool if traffic grows.
@router.get("/government/sources")
async def list_sources(scope: Optional[Scope] = None, actor: Actor = Depends(get_actor)) -> ToolResult:
    return ToolResult.success(government.sources(scope))


@router.post("/government/sources")
async def save_source(body: SourceBody, actor: Actor = Depends(get_actor)) -> ToolResult:
    return ToolResult.success(government.save_source(actor, body.model_dump()))


@router.post("/government/ask")
async def ask(body: AskBody, actor: Actor = Depends(get_actor)) -> ToolResult:
    return ToolResult.success(government.ask(actor, body.scope, body.question))


@router.post("/government/ask/stream")
async def ask_stream(body: AskBody, actor: Actor = Depends(get_actor)):
    """Same answer as /government/ask, sent as Server-Sent Events."""
    result = ToolResult.success(government.ask(actor, body.scope, body.question))
    return stream_reply(result.data["answer"], result.model_dump(mode="json"))


@router.post("/feedback")
async def feedback(body: FeedbackBody, actor: Actor = Depends(get_actor)) -> ToolResult:
    return ToolResult.success(government.create_feedback(actor, body.model_dump()))


@router.get("/government/feedback")
async def feedback_inbox(scope: Scope = Query(...), actor: Actor = Depends(get_actor)) -> ToolResult:
    return ToolResult.success(government.inbox(actor, scope))


@router.post("/government/feedback/{feedback_id}/acknowledge")
async def acknowledge(feedback_id: str, scope: Scope = Query(...), actor: Actor = Depends(get_actor)) -> ToolResult:
    return ToolResult.success(government.acknowledge(actor, scope, feedback_id))


@router.get("/government/analytics")
async def analytics(scope: Scope = Query(...), actor: Actor = Depends(get_actor)) -> ToolResult:
    return ToolResult.success(government.analytics(actor, scope))


@router.get("/government/announcements")
async def list_announcements(scope: Optional[Scope] = None, actor: Actor = Depends(get_actor)) -> ToolResult:
    return ToolResult.success(government.announcements(scope))


@router.post("/government/announcements")
async def publish(body: AnnouncementBody, actor: Actor = Depends(get_actor)) -> ToolResult:
    return ToolResult.success(government.publish(actor, body.scope, body.title, body.body))


# ---- club outreach ------------------------------------------------------------------------------
@router.get("/clubs/{organization_id}/posts")
async def club_posts(organization_id: str, actor: Actor = Depends(get_actor)) -> ToolResult:
    return ToolResult.success(outreach.posts(organization_id))


@router.post("/clubs/{organization_id}/posts")
async def create_post(organization_id: str, body: PostBody, actor: Actor = Depends(get_actor), repo=Depends(repo_dep),
                      settings: Settings = Depends(get_settings)) -> ToolResult:
    post = await outreach.create_post(repo, actor, organization_id, body.model_dump(exclude_none=True))
    # Mirror to the club's Slack channel when one is configured (destination from config only).
    post["shared_to_slack"] = await slack.post_to_channel(settings, f"*{post['club_name']}* · {post['title']}\n{post['body']}")
    return ToolResult.success(post)


@router.patch("/clubs/{organization_id}")
async def update_club(organization_id: str, body: ProfilePatch, actor: Actor = Depends(get_actor), repo=Depends(repo_dep)) -> ToolResult:
    return ToolResult.success(await outreach.update_profile(repo, actor, organization_id, body.model_dump(exclude_none=True)))


@router.get("/clubs/{organization_id}/interests")
async def club_interests(organization_id: str, actor: Actor = Depends(get_actor), repo=Depends(repo_dep)) -> ToolResult:
    return ToolResult.success(await outreach.interest_inbox(repo, actor, organization_id))


@router.get("/me/notifications")
async def my_notifications(actor: Actor = Depends(get_actor), repo=Depends(repo_dep)) -> ToolResult:
    return ToolResult.success(await outreach.notifications(repo, actor))


@router.get("/me/role")
async def my_role(actor: Actor = Depends(get_actor)) -> ToolResult:
    return ToolResult.success({"user_id": actor.user_id, "roles": actor.roles, "organization_ids": actor.organization_ids})
