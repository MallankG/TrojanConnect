"""Tiny in-memory StudentRepository with 3 clubs, so service/agent tests don't depend on seed content."""
from datetime import datetime, timedelta, timezone

from app.schemas.student import ClubEvent, ClubProfile, FAQItem


def make_clubs() -> list[ClubProfile]:
    return [
        ClubProfile(
            organization_id="org-ai", name="Trojan AI Society", slug="trojan-ai-society", category="technology",
            tags=["artificial_intelligence", "machine_learning", "startups"],
            public_description="We build machine learning projects and host research talks. Open to all majors.",
            history="Started by three graduate students who wanted a place to build models together.", founded_year=2016,
            activities=["Weekly build nights", "Paper reading group"], notable_events=["Spring AI Showcase"],
            meeting_schedule="Wednesdays 7pm", time_commitment="About 4 hours a week", time_commitment_hours_per_week=4,
            recruitment_status="open", how_to_join="Come to any Wednesday build night and sign up at the door.",
            who_thrives_here="Curious builders who like shipping small projects.",
            faq=[FAQItem(question="Do I need coding experience?", answer="No, beginners are welcome and paired with mentors.")],
            public_contact="ai-society@example.edu",
        ),
        ClubProfile(
            organization_id="org-consult", name="Marshall Consulting Group", slug="marshall-consulting-group", category="business",
            tags=["consulting", "finance", "startups"],
            public_description="Student consultants working on real client engagements each semester.",
            time_commitment="10-12 hours a week during projects", time_commitment_hours_per_week=12,
            recruitment_status="closed", membership_requirements="Two-round interview process.",
            how_to_join="Applications open at the start of each semester.", public_contact="",
        ),
        ClubProfile(
            organization_id="org-hike", name="Peaks Hiking Club", slug="peaks-hiking-club", category="outdoors",
            tags=["hiking", "outdoors", "wellness"],
            public_description="Weekend hikes around Los Angeles for every fitness level.",
            time_commitment="2 hours a week, optional", time_commitment_hours_per_week=2, recruitment_status="open",
            how_to_join="Join the mailing list.", public_contact="peaks@example.edu",
        ),
    ]


class FakeRepo:
    def __init__(self):
        now = datetime.now(timezone.utc)
        self.clubs = {c.organization_id: c for c in make_clubs()}
        self.events = [ClubEvent(id="ev-1", organization_id="org-ai", title="Intro to LLMs workshop", location="SAL 101",
                                 start_at=now + timedelta(days=3), end_at=now + timedelta(days=3, hours=2))]
        self.prefs, self.saved, self.feedback = {}, {}, {}
        self.conversations, self.messages, self.interests, self.audit = {}, [], [], []
        self.match_result = None  # set to [(org_id, sim)] to simulate pgvector

    async def list_clubs(self):
        return list(self.clubs.values())

    async def get_club(self, organization_id):
        return self.clubs.get(organization_id)

    async def list_events(self, organization_id=None, upcoming_only=True):
        return [e for e in self.events if organization_id in (None, e.organization_id)]

    async def match_clubs(self, embedding, limit):
        return self.match_result

    async def get_preferences(self, user_id):
        return self.prefs.get(user_id)

    async def upsert_preferences(self, prefs):
        self.prefs[prefs.user_id] = prefs
        return prefs

    async def save_club(self, user_id, organization_id):
        self.saved.setdefault(user_id, set()).add(organization_id)

    async def unsave_club(self, user_id, organization_id):
        self.saved.get(user_id, set()).discard(organization_id)

    async def list_saved_clubs(self, user_id):
        return sorted(self.saved.get(user_id, set()))

    async def add_recommendation_feedback(self, user_id, feedback):
        self.feedback.setdefault(user_id, []).append(feedback)

    async def list_recommendation_feedback(self, user_id):
        return list(self.feedback.get(user_id, []))

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
        for existing in self.interests:
            if (existing.student_id, existing.organization_id, existing.idempotency_key) == (
                interest.student_id, interest.organization_id, interest.idempotency_key
            ):
                return existing
        self.interests.append(interest)
        return interest

    async def list_interests_for_student(self, user_id):
        return [i for i in self.interests if i.student_id == user_id]

    async def list_interests_for_org(self, organization_id):
        return [i for i in self.interests if i.organization_id == organization_id]

    async def add_audit_log(self, entry):
        if not any(existing.id == entry.id for existing in self.audit):
            self.audit.append(entry)
