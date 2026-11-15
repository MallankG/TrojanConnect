"""Small fakes for tests/test_api.py so the API tests don't depend on the real repo/services/agents."""
from datetime import datetime, timedelta, timezone
from types import ModuleType

from app.schemas.common import CONFIRMATION_REQUIRED, NOT_FOUND, PERMISSION_DENIED, AppError
from app.schemas.student import (
    AgentTurn, ClubEvent, ClubInterest, ClubProfile, ClubSearchHit, Conversation, FitCheckResult,
    Message, PendingConfirmation, Recommendation, StudentPreferences,
)

CLUBS = [
    ClubProfile(organization_id="club-ai", name="AI Club", slug="ai-club", category="tech",
                tags=["ai", "ml"], public_description="We build ML projects."),
    ClubProfile(organization_id="club-hike", name="Hiking Club", slug="hiking-club", category="outdoors",
                tags=["hiking"], public_description="Weekend hikes."),
]


class FakeRepo:
    def __init__(self):
        now = datetime.now(timezone.utc)
        self.clubs = {c.organization_id: c for c in CLUBS}
        self.events = [
            ClubEvent(organization_id="club-ai", title="Demo night", start_at=now + timedelta(days=1), end_at=now + timedelta(days=1, hours=2)),
            ClubEvent(organization_id="club-ai", title="Members only", start_at=now + timedelta(days=2), end_at=now + timedelta(days=2, hours=1), visibility="members"),
        ]
        self.prefs, self.saved, self.feedback = {}, {}, []
        self.conversations, self.messages, self.interests = {}, [], []

    def get_demo_user(self, user_id):
        return {"display_name": "Demo One", "email": "demo1@usc.edu"} if user_id == "demo-student-1" else None

    async def list_clubs(self):
        return list(self.clubs.values())

    async def get_club(self, organization_id):
        return self.clubs.get(organization_id)

    async def list_events(self, organization_id=None, upcoming_only=True):
        return [e for e in self.events if organization_id in (None, e.organization_id)]

    async def get_preferences(self, user_id):
        return self.prefs.get(user_id)

    async def upsert_preferences(self, prefs):
        self.prefs[prefs.user_id] = prefs
        return prefs

    async def save_club(self, user_id, organization_id):
        self.saved.setdefault(user_id, [])
        if organization_id not in self.saved[user_id]:
            self.saved[user_id].append(organization_id)

    async def unsave_club(self, user_id, organization_id):
        if organization_id in self.saved.get(user_id, []):
            self.saved[user_id].remove(organization_id)

    async def list_saved_clubs(self, user_id):
        return list(self.saved.get(user_id, []))

    async def add_recommendation_feedback(self, user_id, feedback):
        self.feedback.append((user_id, feedback))

    async def create_conversation(self, conversation):
        self.conversations[conversation.id] = conversation
        return conversation

    async def get_conversation(self, conversation_id):
        return self.conversations.get(conversation_id)

    async def list_conversations(self, user_id):
        return [c for c in self.conversations.values() if c.owner_user_id == user_id]

    async def add_message(self, message):
        self.messages.append(message)
        return message

    async def list_messages(self, conversation_id, limit=50):
        return [m for m in self.messages if m.conversation_id == conversation_id][-limit:]

    async def claim_pending_confirmation(self, conversation_id, message_id, confirmed):
        for message in reversed(self.messages):
            if message.conversation_id == conversation_id and message.id == message_id and message.sender_type == "agent":
                pending = message.metadata.get("pending_confirmation")
                decision = message.metadata.get("confirmation_decision")
                if not isinstance(pending, dict) or (decision is not None and decision is not confirmed):
                    return None
                message.metadata["confirmation_decision"] = confirmed
                return pending.copy()
        return None

    async def create_interest(self, interest):
        self.interests.append(interest)
        return interest

    async def list_interests_for_student(self, user_id):
        return [i for i in self.interests if i.student_id == user_id]


class FakeOrchestrator:
    def __init__(self, repo):
        self.repo = repo

    async def _reply(self, conversation_id, text, pending=None):
        msg = await self.repo.add_message(Message(conversation_id=conversation_id, sender_type="agent", content=text))
        return AgentTurn(conversation_id=conversation_id, message=msg, pending_confirmation=pending, used_fallback_model=True)

    async def _owned(self, actor, conversation_id):
        conv = await self.repo.get_conversation(conversation_id)
        if conv is None:
            raise AppError(NOT_FOUND, "Conversation not found.", status_code=404)
        if conv.owner_user_id != actor.user_id:
            raise AppError(PERMISSION_DENIED, "Not your conversation.", status_code=403)
        return conv

    async def start_conversation(self, actor, req):
        agent_id = f"club_agent:{req.organization_id}" if req.agent_type == "club" else f"student_agent:{actor.user_id}"
        conv = await self.repo.create_conversation(Conversation(
            owner_user_id=actor.user_id, agent_type=req.agent_type, agent_id=agent_id, organization_id=req.organization_id))
        turn = await self.send_message(actor, conv.id, req.message) if req.message else None
        return conv, turn

    async def send_message(self, actor, conversation_id, content):
        await self._owned(actor, conversation_id)
        await self.repo.add_message(Message(conversation_id=conversation_id, sender_type="user", content=content))
        pending = None
        if "join" in content.lower():
            pending = PendingConfirmation(action="submit_club_interest", summary="Send interest to AI Club?",
                                          payload={"organization_id": "club-ai"})
        return await self._reply(conversation_id, f"echo: {content}", pending)

    async def confirm_pending(self, actor, conversation_id, confirmed):
        await self._owned(actor, conversation_id)
        return await self._reply(conversation_id, "Interest submitted." if confirmed else "Cancelled.")


def build_service_modules() -> dict[str, ModuleType]:
    """Fake app.services.* modules matching docs/student-agent-contract.md signatures."""
    clubs, recs, prefs, interests = (ModuleType(f"app.services.{n}") for n in ("clubs", "recommendations", "preferences", "interests"))

    async def search_clubs(repo, embedder, query, interest_tags, limit=10):
        hits = []
        for c in await repo.list_clubs():
            matched = [t for t in c.tags if t in interest_tags]
            if matched or (query and query.lower() in (c.name + " " + c.public_description).lower()):
                hits.append(ClubSearchHit(club=c, score=0.9, matched_tags=matched))
        return hits[:limit]

    async def recommend_clubs(repo, embedder, user_id, limit=10):
        return [Recommendation(organization_id=c.organization_id, club_name=c.name, score=0.5,
                               reason_codes=["POPULAR_DEFAULT"], explanation="Popular club.")
                for c in await repo.list_clubs()][:limit]

    async def fit_check(repo, embedder, user_id, organization_id):
        return FitCheckResult(organization_id=organization_id, fit_level="possible", reasons=["Shares the tag ai"])

    async def get_preferences(repo, user_id):
        return await repo.get_preferences(user_id) or StudentPreferences(user_id=user_id)

    async def update_preferences(repo, user_id, update):
        current = await get_preferences(repo, user_id)
        return await repo.upsert_preferences(current.model_copy(update=update.model_dump(exclude_none=True)))

    async def submit_club_interest(repo, actor, req):
        if not req.user_confirmed:
            raise AppError(CONFIRMATION_REQUIRED, "Please confirm before sending your interest.")
        return await repo.create_interest(ClubInterest(
            student_id=actor.user_id, organization_id=req.organization_id, interest_type=req.interest_type,
            message=req.message, share_contact=req.share_contact, idempotency_key=req.idempotency_key))

    clubs.search_clubs = search_clubs
    recs.recommend_clubs, recs.fit_check = recommend_clubs, fit_check
    prefs.get_preferences, prefs.update_preferences = get_preferences, update_preferences
    interests.submit_club_interest = submit_club_interest
    return {m.__name__: m for m in (clubs, recs, prefs, interests)}
