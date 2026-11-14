"""Agent orchestrator: conversation ownership, guardrails, bounded tool loop, persistence, confirmations."""
import json
import logging
from typing import Any, Optional

from app.agents import club_agent, student_agent
from app.agents.guardrails import check_input, check_output, refusal_message
from app.agents.prompts import INJECTION_NOTE
from app.integrations.llm import ChatMessage
from app.schemas.common import NOT_FOUND, PERMISSION_DENIED, VALIDATION_ERROR, AppError
from app.schemas.student import (
    AgentCard, AgentTurn, ClubInterestCreate, Conversation, ConversationCreate, Message, PendingConfirmation, ToolActivity,
)
from app.security.actor import Actor
from app.services.interests import submit_club_interest
from app.tools.student_tools import club_summary, execute_tool, summarize_activity

log = logging.getLogger(__name__)
MAX_TOOL_ROUNDS = 4
HISTORY_MESSAGES = 20
MAX_CARDS = 8


class AgentOrchestrator:
    def __init__(self, repo, llm, embedder):
        self.repo, self.llm, self.embedder = repo, llm, embedder

    # ---------------------------------------------------------------- public API
    async def start_conversation(self, actor: Actor, req: ConversationCreate) -> tuple[Conversation, Optional[AgentTurn]]:
        if req.agent_type == "club":
            club = await self.repo.get_club(req.organization_id) if req.organization_id else None
            if club is None:
                raise AppError(NOT_FOUND, "Club not found.", status_code=404)
            conv = Conversation(owner_user_id=actor.user_id, agent_type="club", agent_id=club_agent.agent_id(club.organization_id),
                                organization_id=club.organization_id, channel=req.channel, title=club.name[:200])
            greeting = club_agent.greeting(club)
        else:
            conv = Conversation(owner_user_id=actor.user_id, agent_type="student", agent_id=student_agent.agent_id(actor.user_id),
                                channel=req.channel, title="Student Agent")
            greeting = await student_agent.greeting(self.repo, actor)
        conv = await self.repo.create_conversation(conv)
        if req.message and req.message.strip():
            return conv, await self.send_message(actor, conv.id, req.message)
        return conv, await self._persist_turn(conv, greeting, model="greeting", is_fallback=False, extra={"greeting": True})

    async def send_message(self, actor: Actor, conversation_id: str, content: str) -> AgentTurn:
        conv = await self._owned(actor, conversation_id)
        check = check_input(content)
        if not check.text:
            raise AppError(VALIDATION_ERROR, "Message is empty.")
        history = await self.repo.list_messages(conv.id, limit=HISTORY_MESSAGES)
        await self.repo.add_message(Message(conversation_id=conv.id, sender_type="user", content=check.text,
                                            metadata={"guardrail_flags": check.reasons} if check.reasons else {}))
        if check.refuse:
            return await self._persist_turn(conv, refusal_message(), model="guardrail", is_fallback=False,
                                            extra={"guardrail_flags": check.reasons})

        system, tools, scope = await self._context(actor, conv)
        if check.flagged:
            system += INJECTION_NOTE
        messages = [ChatMessage(role="user" if m.sender_type == "user" else "assistant", content=m.content)
                    for m in history if m.sender_type in ("user", "agent") and m.content]
        messages.append(ChatMessage(role="user", content=check.text))

        activity: list[ToolActivity] = []
        cards: list[AgentCard] = []
        pending: Optional[PendingConfirmation] = None
        text, model, is_fallback = "", "", False
        for round_no in range(MAX_TOOL_ROUNDS + 1):
            # after MAX_TOOL_ROUNDS rounds of tool use the model must answer without tools
            resp = await self.llm.generate(system=system, messages=messages,
                                           tools=tools if round_no < MAX_TOOL_ROUNDS else None)
            model, is_fallback = resp.model or model, is_fallback or resp.is_fallback
            if not resp.tool_calls or round_no == MAX_TOOL_ROUNDS:
                text = resp.text
                break
            messages.append(ChatMessage(role="assistant", content=resp.text, tool_calls=resp.tool_calls))
            for call in resp.tool_calls[:6]:
                result = await execute_tool(call.name, call.args, actor=actor, repo=self.repo, embedder=self.embedder,
                                            scope_org_id=scope)
                activity.append(summarize_activity(call.name, call.args, result))
                if result.ok:
                    cards.extend(self._cards(call.name, result.data))
                    if call.name == "submit_club_interest":
                        pending = PendingConfirmation(**result.data["pending_confirmation"])
                messages.append(ChatMessage(
                    role="tool", tool_name=call.name, tool_call_id=call.id,
                    content=json.dumps(result.model_dump(mode="json", exclude={"request_id"}), default=str)))

        text = check_output(text, action_succeeded=False)  # model turns never complete a write themselves
        if not text:
            text = ("I've prepared that for you - please confirm to send it." if pending
                    else "Sorry, I couldn't put together an answer for that. Could you rephrase?")
        return await self._persist_turn(conv, text, model=model, is_fallback=is_fallback, activity=activity,
                                        cards=self._dedupe(cards), pending=pending)

    async def confirm_pending(self, actor: Actor, conversation_id: str, confirmed: bool) -> AgentTurn:
        conv = await self._owned(actor, conversation_id)
        last_agent = next((m for m in reversed(await self.repo.list_messages(conv.id, limit=50)) if m.sender_type == "agent"), None)
        raw = (last_agent.metadata or {}).get("pending_confirmation") if last_agent else None
        if not raw:
            raise AppError(VALIDATION_ERROR, "There is nothing waiting for confirmation in this conversation.", status_code=409)
        pending = PendingConfirmation(**raw)
        payload = pending.payload
        club_name = payload.get("club_name") or "the club"
        await self.repo.add_message(Message(conversation_id=conv.id, sender_type="system",
                                            content="User confirmed the pending action." if confirmed else "User cancelled the pending action.",
                                            metadata={"confirmation": confirmed, "action": pending.action}))
        if not confirmed:
            return await self._persist_turn(conv, f"Okay, cancelled - nothing was sent to {club_name}.", model="system", is_fallback=False,
                                            extra={"confirmation_result": "cancelled"})
        try:
            if conv.organization_id and payload.get("organization_id") != conv.organization_id:
                raise AppError(PERMISSION_DENIED, "This confirmation does not belong to this club conversation.", status_code=403)
            interest = await submit_club_interest(self.repo, actor, ClubInterestCreate(
                organization_id=payload["organization_id"], interest_type=payload.get("interest_type", "membership"),
                message=payload.get("message", ""), share_contact=bool(payload.get("share_contact")),
                user_confirmed=True, idempotency_key=payload["idempotency_key"]))
        except AppError as exc:
            act = ToolActivity(tool="submit_club_interest", summary=f"Submitting interest failed: {exc.message[:120]}", ok=False)
            return await self._persist_turn(conv, f"I couldn't send that: {exc.message} Nothing was shared.", model="system",
                                            is_fallback=False, activity=[act], extra={"confirmation_result": "failed"})
        fields = interest.consent_snapshot.get("shared_fields", [])
        shared = [f"your message (\"{interest.message}\")" if interest.message else "no message", f"interest type: {interest.interest_type}"]
        if interest.share_contact:
            shared.append(f"your name ({actor.display_name or 'not set'}) and email ({actor.email or 'not set'})")
        text = (f"Done - your {interest.interest_type} interest was sent to {club_name}. Shared with the club: " + "; ".join(shared) + "."
                + ("" if interest.share_contact else " Your contact details were not shared.")
                + " The club decides on next steps; this isn't a membership decision.")
        card = AgentCard(type="interest_confirmation", data={
            "status": "submitted", "interest_id": interest.id, "organization_id": interest.organization_id, "club_name": club_name,
            "interest_type": interest.interest_type, "message": interest.message, "share_contact": interest.share_contact,
            "shared_fields": fields})
        act = ToolActivity(tool="submit_club_interest", summary=f"Sent your interest to {club_name} (shared: {', '.join(fields)})")
        return await self._persist_turn(conv, text, model="system", is_fallback=False, activity=[act], cards=[card],
                                        extra={"confirmation_result": "submitted"})

    # ---------------------------------------------------------------- internals
    async def _owned(self, actor: Actor, conversation_id: str) -> Conversation:
        conv = await self.repo.get_conversation(conversation_id)
        if conv is None:
            raise AppError(NOT_FOUND, "Conversation not found.", status_code=404)
        if conv.owner_user_id != actor.user_id:
            raise AppError(PERMISSION_DENIED, "This conversation belongs to another user.", status_code=403)
        return conv

    async def _context(self, actor: Actor, conv: Conversation):
        if conv.agent_type == "club":
            club = await self.repo.get_club(conv.organization_id or "")
            if club is None:
                raise AppError(NOT_FOUND, "This club is no longer available.", status_code=404)
            system, tools = await club_agent.build_context(self.repo, club)
            return system, tools, club.organization_id
        system, tools = await student_agent.build_context(self.repo, actor)
        return system, tools, None

    async def _persist_turn(self, conv: Conversation, text: str, *, model: str, is_fallback: bool,
                            activity: Optional[list[ToolActivity]] = None, cards: Optional[list[AgentCard]] = None,
                            pending: Optional[PendingConfirmation] = None, extra: Optional[dict[str, Any]] = None) -> AgentTurn:
        activity, cards = activity or [], cards or []
        metadata = {
            "tool_activity": [a.model_dump(mode="json") for a in activity],
            "cards": [c.model_dump(mode="json") for c in cards],
            "pending_confirmation": pending.model_dump(mode="json") if pending else None,
            "model": model, "is_fallback": is_fallback, **(extra or {}),
        }
        message = await self.repo.add_message(Message(conversation_id=conv.id, sender_type="agent", content=text[:8000], metadata=metadata))
        return AgentTurn(conversation_id=conv.id, message=message, tool_activity=activity, cards=cards,
                         pending_confirmation=pending, used_fallback_model=is_fallback)

    @staticmethod
    def _cards(tool: str, data: Any) -> list[AgentCard]:
        if not isinstance(data, dict):
            return []
        if tool == "search_clubs":
            return [AgentCard(type="club", data=h) for h in data.get("hits", [])[:5]]
        if tool == "recommend_clubs":
            return [AgentCard(type="recommendation", data=r) for r in data.get("recommendations", [])[:5]]
        if tool == "get_club_profile":
            keep = ("organization_id", "name", "category", "tags", "time_commitment", "time_commitment_hours_per_week",
                    "recruitment_status", "meeting_schedule", "how_to_join", "data_label")
            return [AgentCard(type="club", data={**{k: data.get(k) for k in keep}, "description": (data.get("public_description") or "")[:280]})]
        if tool == "list_club_events":
            return [AgentCard(type="event", data=e) for e in data.get("events", [])[:4]]
        if tool == "check_club_fit":
            return [AgentCard(type="fit_check", data=data)]
        if tool == "submit_club_interest":
            pending = data.get("pending_confirmation") or {}
            return [AgentCard(type="interest_confirmation", data={"status": "pending", "summary": pending.get("summary"), **pending.get("payload", {})})]
        return []

    @staticmethod
    def _dedupe(cards: list[AgentCard]) -> list[AgentCard]:
        seen, out = set(), []
        for card in cards:
            key = (card.type, card.data.get("organization_id"), card.data.get("id"), card.data.get("status"))
            if key not in seen:
                seen.add(key)
                out.append(card)
        return out[:MAX_CARDS]
