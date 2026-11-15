"""Slack channel: signed requests only, linked accounts only, server-side roles, no writes without the web app."""
import hashlib
import hmac
import time
from urllib.parse import urlencode

import pytest
from fastapi.testclient import TestClient

SECRET = "test-slack-signing-secret"


@pytest.fixture
def ctx(api_settings, tmp_path, monkeypatch):
    from app.api.deps import embedder_dep, orchestrator_dep, repo_dep
    from app.agents.orchestrator import AgentOrchestrator
    from app.config import get_settings
    from app.integrations import slack
    from app.integrations.gemini.client import build_embedder, build_llm
    from app.main import create_app
    from app.repositories.memory import InMemoryRepository
    from app.security import demo_roles
    from app.workflows.campus import store
    from app.workflows.event_pipeline import store as pipeline_store

    monkeypatch.setitem(demo_roles.DEMO_ROLES, "demo-rep-1", {**demo_roles.DEMO_ROLES["demo-rep-1"], "organization_ids": ["club-ai-society"]})
    monkeypatch.setenv("CAMPUS_STORE", "json")
    monkeypatch.setattr(pipeline_store, "DATA_DIR", tmp_path)
    store.reset_backend_cache()
    replies: list[str] = []

    async def fake_respond(url, text, blocks=None):
        replies.append(text)

    async def no_channel(settings, text):
        return False

    monkeypatch.setattr(slack, "respond", fake_respond)
    monkeypatch.setattr(slack, "post_to_channel", no_channel)
    settings = api_settings.model_copy(update={"slack_signing_secret": SECRET,
                                               "slack_user_map": "UREP:demo-rep-1,USTU:demo-student-1"})
    repo = InMemoryRepository(dataset="demo")
    embedder = build_embedder(settings)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[repo_dep] = lambda: repo
    app.dependency_overrides[embedder_dep] = lambda: embedder
    app.dependency_overrides[orchestrator_dep] = lambda: AgentOrchestrator(repo, build_llm(settings), embedder)
    with TestClient(app) as c:
        yield c, replies


def send(client, user, text, ts=None, secret=SECRET):
    body = urlencode({"user_id": user, "text": text, "response_url": "https://hooks.slack.com/commands/x",
                      "trigger_id": f"t{time.time_ns()}"}).encode()
    ts = str(int(ts or time.time()))
    sig = "v0=" + hmac.new(secret.encode(), f"v0:{ts}:".encode() + body, hashlib.sha256).hexdigest()
    return client.post("/api/v1/webhooks/slack/commands", content=body,
                       headers={"x-slack-request-timestamp": ts, "x-slack-signature": sig,
                                "content-type": "application/x-www-form-urlencoded"})


def test_rejects_unsigned_stale_and_unlinked(ctx):
    client, _ = ctx
    assert send(client, "USTU", "help", secret="wrong").status_code == 401
    assert send(client, "USTU", "help", ts=time.time() - 600).status_code == 401  # replay window
    r = send(client, "UNOBODY", "help")
    assert r.status_code == 200 and "isn't linked" in r.json()["text"]


def test_student_gets_sourced_government_answer_and_cannot_post(ctx):
    client, replies = ctx
    send(client, "USTU", "usg How do I apply for USG funding?")
    assert "usg.usc.edu" in replies[-1]
    send(client, "USTU", "post update Hello | world")
    assert "Only a verified club representative" in replies[-1]
    send(client, "USTU", "accept")
    assert "web app" in replies[-1]


def test_rep_post_needs_preview_then_confirm(ctx):
    client, replies = ctx
    send(client, "UREP", "post event Model Marathon | 24-hour build | 2030-10-10 18:00-21:00 | Demo Hall")
    assert "Nothing is published yet" in replies[-1]
    code = replies[-1].rsplit("confirm ", 1)[1].split("`")[0]
    send(client, "USTU", f"confirm {code}")  # someone else's preview
    assert "isn't yours" in replies[-1]
    send(client, "UREP", f"confirm {code}")
    assert replies[-1].startswith("Posted")
    send(client, "UREP", f"confirm {code}")  # single use
    assert "expired" in replies[-1]


def test_url_verification(ctx):
    client, _ = ctx
    body = b'{"type":"url_verification","challenge":"abc"}'
    ts = str(int(time.time()))
    sig = "v0=" + hmac.new(SECRET.encode(), f"v0:{ts}:".encode() + body, hashlib.sha256).hexdigest()
    r = client.post("/api/v1/webhooks/slack/events", content=body, headers={"x-slack-request-timestamp": ts, "x-slack-signature": sig, "content-type": "application/json"})
    assert r.json() == {"challenge": "abc"}


def test_student_can_ask_a_club_agent_over_slack(ctx):
    client, replies = ctx
    send(client, "USTU", "club club-ai-society: Are beginners welcome?")
    assert replies[-1].startswith("*Trojan AI Society*")
