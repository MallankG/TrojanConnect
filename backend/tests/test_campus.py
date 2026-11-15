"""Student government and club outreach: scope checks, consent, sourced answers, notifications."""
import pytest
from fastapi.testclient import TestClient

HDR = {"X-TrojanConnect-Client": "web"}
REP, STUDENT, USG, GSG = ("demo-rep-1", "demo-student-1", "demo-usg-rep", "demo-gsg-rep")


@pytest.fixture
def client(api_settings, tmp_path, monkeypatch):
    from app.api.deps import embedder_dep, repo_dep
    from app.config import get_settings
    from app.main import create_app
    from app.repositories.memory import InMemoryRepository
    from app.workflows.campus import store
    from app.workflows.event_pipeline import store as pipeline_store

    from app.security import demo_roles
    monkeypatch.setitem(demo_roles.DEMO_ROLES, "demo-rep-1", {**demo_roles.DEMO_ROLES["demo-rep-1"], "organization_ids": ["club-ai-society"]})
    monkeypatch.setenv("CAMPUS_STORE", "json")
    monkeypatch.setattr(pipeline_store, "DATA_DIR", tmp_path)
    store.reset_backend_cache()
    repo = InMemoryRepository(dataset="demo")
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: api_settings
    app.dependency_overrides[repo_dep] = lambda: repo
    app.dependency_overrides[embedder_dep] = lambda: object()
    with TestClient(app) as c:
        yield c


def as_(user):
    return {**HDR, "X-Demo-User": user}


def test_government_answers_cite_sources_or_refuse(client):
    r = client.post("/api/v1/government/ask", json={"scope": "USG", "question": "How do I apply for USG funding?"}, headers=as_(STUDENT)).json()["data"]
    assert r["verified"] and r["sources"][0]["url"].startswith("https://usg.usc.edu")
    r = client.post("/api/v1/government/ask", json={"scope": "USG", "question": "Who wins the Rose Bowl?"}, headers=as_(STUDENT)).json()["data"]
    assert not r["verified"] and "can't verify" in r["answer"] and r["feedback_offer"]


def test_feedback_needs_consent_and_scoped_inbox(client):
    body = {"scope": "USG", "message": "Room booking is too hard", "idempotency_key": "fb-test-0001"}
    assert client.post("/api/v1/feedback", json=body, headers=as_(STUDENT)).status_code == 422
    r = client.post("/api/v1/feedback", json={**body, "user_confirmed": True}, headers=as_(STUDENT)).json()["data"]
    assert r["shared_identity"] is False
    assert client.get("/api/v1/government/feedback?scope=USG", headers=as_(STUDENT)).status_code == 403
    assert client.get("/api/v1/government/feedback?scope=USG", headers=as_(GSG)).status_code == 403
    inbox = client.get("/api/v1/government/feedback?scope=USG", headers=as_(USG)).json()["data"]
    assert inbox[0]["from_name"] is None  # identity withheld without separate consent
    ack = client.post(f"/api/v1/government/feedback/{inbox[0]['id']}/acknowledge?scope=USG", headers=as_(USG)).json()["data"]
    assert ack["status"] == "acknowledged"


def test_only_the_clubs_rep_can_post_and_followers_are_notified(client):
    post = {"kind": "event", "title": "Model Marathon", "body": "24-hour build night.",
            "event": {"start_at": "2030-10-10T18:00:00-07:00", "end_at": "2030-10-11T18:00:00-07:00", "location": "Demo Hall"}}
    assert client.post("/api/v1/clubs/club-ai-society/posts", json=post, headers=as_(STUDENT)).status_code == 403
    assert client.post("/api/v1/clubs/club-founders-forge/posts", json=post, headers=as_(REP)).status_code == 403
    client.post("/api/v1/clubs/club-ai-society/save", headers=as_(STUDENT))
    created = client.post("/api/v1/clubs/club-ai-society/posts", json=post, headers=as_(REP)).json()["data"]
    assert created["event_id"]
    events = client.get("/api/v1/clubs/club-ai-society/events", headers=as_(STUDENT)).json()["data"]
    assert any(e["id"] == created["event_id"] for e in events)
    notes = client.get("/api/v1/me/notifications", headers=as_(STUDENT)).json()["data"]
    assert any("Model Marathon" in n["text"] for n in notes)


def test_rep_profile_edit_and_inbox_respect_consent(client):
    assert client.patch("/api/v1/clubs/club-ai-society", json={"recruitment_status": "closed"}, headers=as_(STUDENT)).status_code == 403
    r = client.patch("/api/v1/clubs/club-ai-society", json={"recruitment_status": "application"}, headers=as_(REP)).json()["data"]
    assert r["recruitment_status"] == "application"
    client.post("/api/v1/clubs/club-ai-society/interest", headers=as_(STUDENT), json={
        "interest_type": "membership", "message": "hi", "share_contact": False, "user_confirmed": True, "idempotency_key": "int-test-001"})
    inbox = client.get("/api/v1/clubs/club-ai-society/interests", headers=as_(REP)).json()["data"]
    assert inbox and inbox[0]["from"] is None
    assert client.get("/api/v1/clubs/club-ai-society/interests", headers=as_(STUDENT)).status_code == 403


def test_announcements_need_the_right_government_scope(client):
    a = {"scope": "GSG", "title": "Town hall", "body": "Join us."}
    assert client.post("/api/v1/government/announcements", json=a, headers=as_(USG)).status_code == 403
    assert client.post("/api/v1/government/announcements", json=a, headers=as_(GSG)).json()["ok"]
    assert client.get("/api/v1/government/announcements", headers=as_(STUDENT)).json()["data"][0]["title"] == "Town hall"


def test_basic_overview_questions_get_answers(client):
    for scope, q in [("USG", "what is USG"), ("USG", "What does USG do?"), ("GSG", "what is GSG"), ("GSG", "When does the GSG Senate meet?")]:
        r = client.post("/api/v1/government/ask", json={"scope": scope, "question": q}, headers=as_(STUDENT)).json()["data"]
        assert r["verified"] and r["feedback_offer"] is None, q


def test_club_agent_answers_what_the_club_does():
    from app.integrations.gemini.client import RuleBasedLLM
    club = {"name": "Spark SC", "public_description": "A student entrepreneurship community.", "faq": [], "tags": []}
    assert "entrepreneurship" in RuleBasedLLM()._answer_from_profile("what does spark sc do", club)
    assert "doesn't cover that" in RuleBasedLLM()._answer_from_profile("what is the annual budget?", club)
