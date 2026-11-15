"""Agent conversations (student agent and club agents)."""
from fastapi import APIRouter, Depends, Query

from app.api.deps import orchestrator_dep, repo_dep
from app.schemas.common import NOT_FOUND, PERMISSION_DENIED, VALIDATION_ERROR, AppError, StrictModel, ToolResult
from app.schemas.student import ConversationCreate, MessageCreate
from app.security.actor import Actor
from app.security.auth import get_actor

router = APIRouter()


class ConfirmBody(StrictModel):
    confirmed: bool


@router.post("/conversations")
async def start_conversation(
    body: ConversationCreate, actor: Actor = Depends(get_actor), orchestrator=Depends(orchestrator_dep)
) -> ToolResult:
    if body.agent_type == "club" and not body.organization_id:
        raise AppError(VALIDATION_ERROR, "organization_id is required for a club conversation.", status_code=422)
    conversation, turn = await orchestrator.start_conversation(actor, body)
    return ToolResult.success({"conversation": conversation, "turn": turn})


@router.get("/conversations")
async def list_conversations(actor: Actor = Depends(get_actor), repo=Depends(repo_dep)) -> ToolResult:
    return ToolResult.success(await repo.list_conversations(actor.user_id))


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    actor: Actor = Depends(get_actor),
    repo=Depends(repo_dep),
) -> ToolResult:
    conversation = await repo.get_conversation(conversation_id)
    if conversation is None:
        raise AppError(NOT_FOUND, "Conversation not found.", status_code=404)
    if conversation.owner_user_id != actor.user_id:
        raise AppError(PERMISSION_DENIED, "This conversation belongs to another user.", status_code=403)
    messages = await repo.list_messages(conversation_id, limit)
    return ToolResult.success({"conversation": conversation, "messages": messages})


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str, body: MessageCreate, actor: Actor = Depends(get_actor), orchestrator=Depends(orchestrator_dep)
) -> ToolResult:
    return ToolResult.success(await orchestrator.send_message(actor, conversation_id, body.content))


@router.post("/conversations/{conversation_id}/confirm")
async def confirm(
    conversation_id: str, body: ConfirmBody, actor: Actor = Depends(get_actor), orchestrator=Depends(orchestrator_dep)
) -> ToolResult:
    return ToolResult.success(await orchestrator.confirm_pending(actor, conversation_id, body.confirmed))
