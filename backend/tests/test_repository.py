"""InMemoryRepository + seed data tests (DATA layer)."""
import json
import re
from datetime import datetime, timedelta, timezone

from app.config import Settings
from app.repositories.base import StudentRepository
from app.repositories.factory import build_repository
from app.repositories.memory import SEED_DIR, InMemoryRepository
from app.schemas.student import (
    AuditLog, ClubEvent, ClubInterest, ClubProfile, Conversation, Message,
    RecommendationFeedback, StudentPreferences,
)

TAG_RE = re.compile(r"^[a-z0-9]+(_[a-z0-9]+)*$")


# ---------- seeds ----------
def test_seed_clubs_validate_and_are_rich():
    raw = json.loads((SEED_DIR / "clubs.json").read_text("utf-8"))
    clubs = [ClubProfile.model_validate(c) for c in raw]
    assert len(clubs) == 12
    assert len({c.organization_id for c in clubs}) == 12
    assert len({c.slug for c in clubs}) == 12
    assert len({c.category for c in clubs}) == 12
    assert {c.recruitment_status for c in clubs} == {"open", "application", "closed"}
    for c in clubs:
        assert c.organization_id.startswith("club-")
        assert c.data_label == "demo"
        assert c.tags and all(TAG_RE.match(t) for t in c.tags), c.organization_id
        assert len(c.public_description) > 150
        assert len(c.history) > 300 and c.founded_year and str(c.founded_year) in c.history
        assert 4 <= len(c.activities) <= 6
        assert 3 <= len(c.notable_events) <= 4
        assert 5 <= len(c.faq) <= 7
        assert c.meeting_schedule and c.time_commitment and c.time_commitment_hours_per_week
        assert c.membership_requirements and c.how_to_join and c.who_thrives_here
        assert c.public_contact.endswith(".example.edu")


async def test_repo_lists_and_gets_clubs():
    repo = InMemoryRepository()
    assert isinstance(repo, StudentRepository)
    clubs = await repo.list_clubs()
    assert len(clubs) == 12
    club = await repo.get_club("club-ai-society")
    assert club is not None and club.name == "Trojan AI Society"
    assert await repo.get_club("club-does-not-exist") is None
    assert await repo.match_clubs([0.1] * 768, 5) is None


async def test_seed_events_are_future_and_linked():
    repo = InMemoryRepository()
    now = datetime.now(timezone.utc)
    events = await repo.list_events()
    assert all(isinstance(e, ClubEvent) for e in events)
    assert len({e.id for e in events}) == len(events)
    assert all(e.start_at > now and e.end_at > e.start_at for e in events)
    assert all(e.start_at.tzinfo is not None for e in events)
    assert all(e.visibility == "public" for e in events)
    assert events == sorted(events, key=lambda e: e.start_at)
    assert len(await repo.list_events(upcoming_only=False)) == len(events)
    club_ids = {c.organization_id for c in await repo.list_clubs()}
    for org in club_ids:
        own = await repo.list_events(organization_id=org)
        assert 2 <= len(own) <= 3, org
        assert all(e.organization_id == org for e in own)
    assert {e.organization_id for e in events} == club_ids


async def test_past_events_hidden_when_upcoming_only():
    repo = InMemoryRepository()
    past = ClubEvent(id="evt-past", organization_id="club-ai-society", title="Old",
                     start_at=datetime.now(timezone.utc) - timedelta(days=2),
                     end_at=datetime.now(timezone.utc) - timedelta(days=2, hours=-1))
    repo._events.append(past)
    assert "evt-past" not in {e.id for e in await repo.list_events("club-ai-society")}
    assert "evt-past" in {e.id for e in await repo.list_events("club-ai-society", upcoming_only=False)}


# ---------- demo users / preferences ----------
async def test_demo_students_seeded():
    repo = InMemoryRepository()
    assert {u["user_id"] for u in repo.list_demo_users()} == {"demo-student-1", "demo-student-2"}
    user = repo.get_demo_user("demo-student-1")
    assert user["display_name"] and user["email"].endswith("example.edu")
    assert repo.get_demo_user("nobody") is None
    prefs = await repo.get_preferences("demo-student-1")
    assert prefs is not None
    assert {"artificial_intelligence", "entrepreneurship", "hackathons"} <= set(prefs.interest_tags)
    assert prefs.year_level == "graduate" and prefs.hours_per_week_available == 5 and prefs.goals
    assert await repo.get_preferences("demo-student-2") is None


async def test_preferences_upsert_refreshes_updated_at():
    repo = InMemoryRepository()
    stale = datetime(2020, 1, 1, tzinfo=timezone.utc)
    saved = await repo.upsert_preferences(
        StudentPreferences(user_id="demo-student-2", interest_tags=["design"], updated_at=stale))
    assert saved.updated_at > stale
    got = await repo.get_preferences("demo-student-2")
    assert got.interest_tags == ["design"] and got.updated_at == saved.updated_at
    again = await repo.upsert_preferences(got.model_copy(update={"interest_tags": ["design", "music"], "goals": "x"}))
    assert again.updated_at >= saved.updated_at
    got2 = await repo.get_preferences("demo-student-2")
    assert got2.interest_tags == ["design", "music"] and got2.goals == "x"
    # returned objects are copies: mutating them must not change stored state
    got2.interest_tags.append("hacked")
    assert (await repo.get_preferences("demo-student-2")).interest_tags == ["design", "music"]


# ---------- saved clubs / feedback ----------
async def test_saved_clubs():
    repo = InMemoryRepository()
    assert await repo.list_saved_clubs("demo-student-1") == []
    await repo.save_club("demo-student-1", "club-ai-society")
    await repo.save_club("demo-student-1", "club-founders-forge")
    await repo.save_club("demo-student-1", "club-ai-society")  # duplicate is a no-op
    assert await repo.list_saved_clubs("demo-student-1") == ["club-ai-society", "club-founders-forge"]
    assert await repo.list_saved_clubs("demo-student-2") == []
    await repo.unsave_club("demo-student-1", "club-ai-society")
    await repo.unsave_club("demo-student-1", "club-never-saved")  # no error
    assert await repo.list_saved_clubs("demo-student-1") == ["club-founders-forge"]


async def test_recommendation_feedback_latest_wins_per_club():
    repo = InMemoryRepository()
    await repo.add_recommendation_feedback("u1", RecommendationFeedback(organization_id="club-ai-society", feedback="helpful"))
    await repo.add_recommendation_feedback("u1", RecommendationFeedback(organization_id="club-pixel-foundry", feedback="hide"))
    await repo.add_recommendation_feedback("u1", RecommendationFeedback(organization_id="club-ai-society", feedback="not_relevant"))
    fb = {f.organization_id: f.feedback for f in await repo.list_recommendation_feedback("u1")}
    assert fb == {"club-ai-society": "not_relevant", "club-pixel-foundry": "hide"}
    assert await repo.list_recommendation_feedback("u2") == []


# ---------- conversations ----------
async def test_conversations_and_message_ordering():
    repo = InMemoryRepository()
    t0 = datetime.now(timezone.utc)
    c1 = await repo.create_conversation(Conversation(
        owner_user_id="demo-student-1", agent_type="student", agent_id="student_agent:demo-student-1", created_at=t0))
    c2 = await repo.create_conversation(Conversation(
        owner_user_id="demo-student-1", agent_type="club", agent_id="club_agent:club-ai-society",
        organization_id="club-ai-society", created_at=t0 + timedelta(seconds=5)))
    await repo.create_conversation(Conversation(
        owner_user_id="demo-student-2", agent_type="student", agent_id="student_agent:demo-student-2"))

    assert (await repo.get_conversation(c2.id)).organization_id == "club-ai-society"
    assert await repo.get_conversation("missing") is None
    assert [c.id for c in await repo.list_conversations("demo-student-1")] == [c2.id, c1.id]  # newest first
    assert len(await repo.list_conversations("demo-student-2")) == 1

    for i in range(6):
        sender = "user" if i % 2 == 0 else "agent"
        await repo.add_message(Message(conversation_id=c1.id, sender_type=sender, content=f"m{i}"))
    await repo.add_message(Message(conversation_id=c2.id, sender_type="user", content="other"))

    assert [m.content for m in await repo.list_messages(c1.id)] == [f"m{i}" for i in range(6)]
    assert [m.content for m in await repo.list_messages(c1.id, limit=3)] == ["m3", "m4", "m5"]
    assert [m.content for m in await repo.list_messages(c2.id)] == ["other"]
    assert await repo.list_messages("missing") == []


# ---------- interests / audit ----------
async def test_interest_idempotency():
    repo = InMemoryRepository()
    first = await repo.create_interest(ClubInterest(
        student_id="demo-student-1", organization_id="club-ai-society", interest_type="membership",
        message="hi", idempotency_key="key-00000001"))
    replay = await repo.create_interest(ClubInterest(
        student_id="demo-student-1", organization_id="club-ai-society", interest_type="membership",
        message="changed on replay", idempotency_key="key-00000001"))
    assert replay.id == first.id and replay.message == "hi"

    # same key, different student -> separate record
    other = await repo.create_interest(ClubInterest(
        student_id="demo-student-2", organization_id="club-ai-society", interest_type="general",
        idempotency_key="key-00000001"))
    assert other.id != first.id
    # same student, new key -> separate record
    second = await repo.create_interest(ClubInterest(
        student_id="demo-student-1", organization_id="club-founders-forge", interest_type="event",
        idempotency_key="key-00000002"))

    mine = await repo.list_interests_for_student("demo-student-1")
    assert [i.id for i in mine] == [first.id, second.id]
    assert {i.student_id for i in await repo.list_interests_for_org("club-ai-society")} == {"demo-student-1", "demo-student-2"}
    assert await repo.list_interests_for_org("club-pixel-foundry") == []


async def test_audit_log_recorded():
    repo = InMemoryRepository()
    await repo.add_audit_log(AuditLog(actor_id="demo-student-1", action="club_interest.create",
                                      resource_type="club_interest", resource_id="abc"))
    assert [e.action for e in repo.audit_entries()] == ["club_interest.create"]


# ---------- isolation / factory ----------
async def test_instances_are_isolated():
    a, b = InMemoryRepository(), InMemoryRepository()
    await a.save_club("demo-student-1", "club-ai-society")
    await a.upsert_preferences(StudentPreferences(user_id="demo-student-2", interest_tags=["finance"]))
    conv = await a.create_conversation(Conversation(owner_user_id="u", agent_type="student", agent_id="student_agent:u"))
    await a.create_interest(ClubInterest(student_id="u", organization_id="club-ai-society",
                                         interest_type="general", idempotency_key="key-iso-0001"))
    club = await a.get_club("club-ai-society")
    club.name = "Mutated"
    club.tags.append("mutated")

    assert await b.list_saved_clubs("demo-student-1") == []
    assert await b.get_preferences("demo-student-2") is None
    assert await b.get_conversation(conv.id) is None
    assert await b.list_interests_for_student("u") == []
    assert (await a.get_club("club-ai-society")).name == "Trojan AI Society"
    assert "mutated" not in (await b.get_club("club-ai-society")).tags


def test_factory_defaults_to_memory_and_falls_back():
    assert isinstance(build_repository(Settings(_env_file=None, supabase_url="", supabase_service_role_key="")),
                      InMemoryRepository)
    # Unusable Supabase credentials must not crash boot.
    bad = Settings(_env_file=None, supabase_url="not-a-url", supabase_service_role_key="not-a-key")
    assert isinstance(build_repository(bad), InMemoryRepository)


def test_supabase_repo_implements_protocol_surface():
    from app.repositories import supabase_repo

    for name, member in vars(StudentRepository).items():
        if not name.startswith("_") and callable(member):
            assert callable(getattr(supabase_repo.SupabaseRepository, name, None)), name
            assert callable(getattr(InMemoryRepository, name, None)), name


def test_seed_sql_matches_json():
    """supabase/seed.sql is generated; fail if someone edited the JSON without re-running the script."""
    sql_path = SEED_DIR.parents[3] / "supabase" / "seed.sql"
    sql = sql_path.read_text("utf-8")
    for c in json.loads((SEED_DIR / "clubs.json").read_text("utf-8")):
        assert f"'{c['organization_id']}'" in sql
        assert c["history"].replace("'", "''") in sql
    for e in json.loads((SEED_DIR / "events.json").read_text("utf-8")):
        assert f"'{e['id']}'" in sql
