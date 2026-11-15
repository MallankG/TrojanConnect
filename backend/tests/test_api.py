"""HTTP-level tests for the student API. Runs against fakes (tests/_api_fakes.py)."""
import time

import jwt

from app.config import Settings, get_settings
from tests.conftest import API_JWT_SECRET

V1 = "/api/v1"
OTHER = {"X-Demo-User": "demo-student-2"}


def ok(resp, status=200):
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert body["ok"] is True and body["error"] is None and body["request_id"]
    return body["data"]


def err(resp, status, code=None):
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert body["ok"] is False and body["data"] is None and body["request_id"]
    assert set(body["error"]) == {"code", "message", "retryable"}
    if code:
        assert body["error"]["code"] == code
    return body["error"]


def _token(secret=API_JWT_SECRET, **overrides):
    claims = {"sub": "user-123", "email": "tommy@usc.edu", "aud": "authenticated", "exp": int(time.time()) + 600}
    claims.update(overrides)
    return jwt.encode(claims, secret, algorithm="HS256")


# ---------- health / envelope ----------
def test_health(api_client):
    resp = api_client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["mode"] == {"repository": "memory", "llm": "fallback"}
    assert "secret" not in resp.text.lower() and "key" not in resp.text.lower()


def test_unknown_route_uses_envelope(api_client):
    err(api_client.get(f"{V1}/nope"), 404, "NOT_FOUND")


def test_cors_allows_frontend(api_client):
    resp = api_client.options(f"{V1}/clubs", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"})
    assert resp.headers["access-control-allow-origin"] == "http://localhost:3000"


# ---------- clubs ----------
def test_list_clubs(api_client):
    data = ok(api_client.get(f"{V1}/clubs"))
    assert {h["club"]["organization_id"] for h in data} == {"club-ai", "club-hike"}
    assert len(ok(api_client.get(f"{V1}/clubs?limit=1"))) == 1


def test_search_clubs_by_tags_and_query(api_client):
    data = ok(api_client.get(f"{V1}/clubs", params={"tags": "ai, robotics"}))
    assert [h["club"]["organization_id"] for h in data] == ["club-ai"]
    assert data[0]["matched_tags"] == ["ai"]
    data = ok(api_client.get(f"{V1}/clubs", params={"query": "hikes"}))
    assert [h["club"]["organization_id"] for h in data] == ["club-hike"]


def test_club_limit_validation(api_client):
    err(api_client.get(f"{V1}/clubs?limit=51"), 422, "VALIDATION_ERROR")
    err(api_client.get(f"{V1}/clubs?limit=0"), 422, "VALIDATION_ERROR")


def test_get_club_and_404(api_client):
    assert ok(api_client.get(f"{V1}/clubs/club-ai"))["name"] == "AI Club"
    err(api_client.get(f"{V1}/clubs/missing"), 404, "NOT_FOUND")
    err(api_client.get(f"{V1}/clubs/missing/events"), 404, "NOT_FOUND")
    err(api_client.get(f"{V1}/clubs/missing/fit"), 404, "NOT_FOUND")


def test_events_are_public_only(api_client):
    assert [e["title"] for e in ok(api_client.get(f"{V1}/clubs/club-ai/events"))] == ["Demo night"]
    assert [e["title"] for e in ok(api_client.get(f"{V1}/events"))] == ["Demo night"]


def test_fit_check(api_client):
    data = ok(api_client.get(f"{V1}/clubs/club-ai/fit"))
    assert data["organization_id"] == "club-ai" and data["fit_level"] == "possible"


# ---------- me / preferences ----------
def test_me_and_preferences_roundtrip(api_client):
    me = ok(api_client.get(f"{V1}/me"))
    assert me["actor"]["user_id"] == "demo-student-1" and me["actor"]["roles"] == ["student"]
    assert me["actor"]["display_name"] == "Demo One"
    assert me["has_preferences"] is False

    assert ok(api_client.get(f"{V1}/me/preferences"))["interest_tags"] == []
    updated = ok(api_client.put(f"{V1}/me/preferences", json={"interest_tags": ["ai"], "hours_per_week_available": 5}))
    assert updated["user_id"] == "demo-student-1" and updated["interest_tags"] == ["ai"]
    assert ok(api_client.get(f"{V1}/me"))["has_preferences"] is True
    # another demo user does not see them
    assert ok(api_client.get(f"{V1}/me/preferences", headers=OTHER))["interest_tags"] == []


def test_preferences_validation(api_client):
    err(api_client.put(f"{V1}/me/preferences", json={"interest_tags": ["ai"], "role": "admin"}), 422, "VALIDATION_ERROR")
    err(api_client.put(f"{V1}/me/preferences", json={"hours_per_week_available": 500}), 422, "VALIDATION_ERROR")
    err(api_client.put(f"{V1}/me/preferences", json={"user_id": "demo-student-2"}), 422, "VALIDATION_ERROR")


def test_client_cannot_pick_roles(api_client):
    me = ok(api_client.get(f"{V1}/me", headers={"X-Demo-User": "demo-student-2", "X-Role": "admin", "X-Roles": "admin"}))
    assert me["actor"]["roles"] == ["student"] and me["actor"]["organization_ids"] == []


# ---------- recommendations ----------
def test_recommendations_and_feedback(api_client, api_app):
    data = ok(api_client.get(f"{V1}/recommendations?limit=1"))
    assert len(data) == 1 and data[0]["reason_codes"] == ["POPULAR_DEFAULT"]
    err(api_client.get(f"{V1}/recommendations?limit=99"), 422, "VALIDATION_ERROR")

    assert ok(api_client.post(f"{V1}/recommendations/feedback", json={"organization_id": "club-ai", "feedback": "hide"})) == {"recorded": True}
    assert api_app.state.fake_repo.feedback[0][0] == "demo-student-1"
    err(api_client.post(f"{V1}/recommendations/feedback", json={"organization_id": "club-ai", "feedback": "meh"}), 422)
    err(api_client.post(f"{V1}/recommendations/feedback", json={"organization_id": "missing", "feedback": "hide"}), 404)


# ---------- saved clubs ----------
def test_save_and_unsave_club(api_client):
    assert ok(api_client.post(f"{V1}/clubs/club-hike/save"))["saved"] is True
    assert [c["organization_id"] for c in ok(api_client.get(f"{V1}/me/saved-clubs"))] == ["club-hike"]
    assert ok(api_client.get(f"{V1}/me/saved-clubs", headers=OTHER)) == []
    assert ok(api_client.delete(f"{V1}/clubs/club-hike/save"))["saved"] is False
    assert ok(api_client.get(f"{V1}/me/saved-clubs")) == []
    err(api_client.post(f"{V1}/clubs/missing/save"), 404, "NOT_FOUND")


# ---------- interest ----------
def test_interest_requires_confirmation(api_client):
    body = {"idempotency_key": "interest-key-1", "message": "Hi!"}
    err(api_client.post(f"{V1}/clubs/club-ai/interest", json=body), 400, "CONFIRMATION_REQUIRED")
    assert ok(api_client.get(f"{V1}/me/interests")) == []

    data = ok(api_client.post(f"{V1}/clubs/club-ai/interest", json={**body, "user_confirmed": True}))
    assert data["organization_id"] == "club-ai" and data["student_id"] == "demo-student-1"
    assert len(ok(api_client.get(f"{V1}/me/interests"))) == 1
    assert ok(api_client.get(f"{V1}/me/interests", headers=OTHER)) == []


def test_interest_body_validation(api_client):
    # organization_id comes from the path only; body copies are rejected
    err(api_client.post(f"{V1}/clubs/club-ai/interest", json={"idempotency_key": "interest-key-1", "organization_id": "club-hike"}), 422)
    err(api_client.post(f"{V1}/clubs/club-ai/interest", json={"user_confirmed": True}), 422, "VALIDATION_ERROR")
    err(api_client.post(f"{V1}/clubs/missing/interest", json={"idempotency_key": "interest-key-1", "user_confirmed": True}), 404)


# ---------- conversations ----------
def test_conversation_flow(api_client):
    data = ok(api_client.post(f"{V1}/conversations", json={"agent_type": "club", "organization_id": "club-ai", "message": "When do you meet?"}))
    conv, turn = data["conversation"], data["turn"]
    assert conv["owner_user_id"] == "demo-student-1" and conv["agent_id"] == "club_agent:club-ai"
    assert turn["message"]["content"] == "echo: When do you meet?"
    cid = conv["id"]

    turn = ok(api_client.post(f"{V1}/conversations/{cid}/messages", json={"content": "I want to join"}))
    assert turn["pending_confirmation"]["action"] == "submit_club_interest"
    turn = ok(api_client.post(f"{V1}/conversations/{cid}/confirm", json={"confirmed": True}))
    assert turn["message"]["content"] == "Interest submitted." and turn["pending_confirmation"] is None

    loaded = ok(api_client.get(f"{V1}/conversations/{cid}"))
    assert loaded["conversation"]["id"] == cid
    assert [m["sender_type"] for m in loaded["messages"]] == ["user", "agent", "user", "agent", "agent"]
    assert [c["id"] for c in ok(api_client.get(f"{V1}/conversations"))] == [cid]


def test_conversation_without_first_message(api_client):
    data = ok(api_client.post(f"{V1}/conversations", json={"agent_type": "student"}))
    assert data["turn"] is None and data["conversation"]["agent_type"] == "student"


def test_conversation_validation(api_client):
    err(api_client.post(f"{V1}/conversations", json={"agent_type": "club"}), 422, "VALIDATION_ERROR")
    err(api_client.post(f"{V1}/conversations", json={"agent_type": "venue"}), 422, "VALIDATION_ERROR")
    cid = ok(api_client.post(f"{V1}/conversations", json={"agent_type": "student"}))["conversation"]["id"]
    err(api_client.post(f"{V1}/conversations/{cid}/messages", json={"content": ""}), 422, "VALIDATION_ERROR")
    err(api_client.post(f"{V1}/conversations/{cid}/confirm", json={"confirmed": "maybe"}), 422, "VALIDATION_ERROR")
    err(api_client.post(f"{V1}/conversations/{cid}/confirm", json={}), 422, "VALIDATION_ERROR")


def test_conversation_is_private_to_owner(api_client):
    cid = ok(api_client.post(f"{V1}/conversations", json={"agent_type": "student", "message": "hello"}))["conversation"]["id"]
    err(api_client.get(f"{V1}/conversations/{cid}", headers=OTHER), 403, "PERMISSION_DENIED")
    err(api_client.post(f"{V1}/conversations/{cid}/messages", json={"content": "hi"}, headers=OTHER), 403, "PERMISSION_DENIED")
    err(api_client.post(f"{V1}/conversations/{cid}/confirm", json={"confirmed": True}, headers=OTHER), 403, "PERMISSION_DENIED")
    assert ok(api_client.get(f"{V1}/conversations", headers=OTHER)) == []
    err(api_client.get(f"{V1}/conversations/does-not-exist"), 404, "NOT_FOUND")
    err(api_client.post(f"{V1}/conversations/does-not-exist/messages", json={"content": "hi"}), 404, "NOT_FOUND")


# ---------- auth ----------
def _production(api_app, **kw):
    prod = Settings(_env_file=None, environment="production", supabase_jwt_secret=API_JWT_SECRET, **kw)
    api_app.dependency_overrides[get_settings] = lambda: prod


def test_production_requires_bearer(api_app, api_client):
    _production(api_app)
    err(api_client.get(f"{V1}/me"), 401, "UNAUTHENTICATED")
    err(api_client.get(f"{V1}/clubs", headers={"X-Demo-User": "demo-student-1"}), 401, "UNAUTHENTICATED")
    assert api_client.get("/api/health").status_code == 200


def test_demo_auth_can_be_disabled(api_app, api_client):
    off = Settings(_env_file=None, environment="development", allow_demo_auth=False)
    api_app.dependency_overrides[get_settings] = lambda: off
    err(api_client.get(f"{V1}/me", headers={"X-Demo-User": "demo-student-1"}), 401, "UNAUTHENTICATED")


def test_invalid_jwt_rejected(api_client):
    # a bad bearer token never falls back to demo auth, even in development
    for token in ("not-a-jwt", _token(secret="x" * 40), _token(aud="anon"), _token(exp=int(time.time()) - 10)):
        err(api_client.get(f"{V1}/me", headers={"Authorization": f"Bearer {token}", "X-Demo-User": "demo-student-1"}), 401, "UNAUTHENTICATED")
    unsigned = jwt.encode({"sub": "user-123", "aud": "authenticated", "exp": int(time.time()) + 600}, "", algorithm="none")
    err(api_client.get(f"{V1}/me", headers={"Authorization": f"Bearer {unsigned}"}), 401, "UNAUTHENTICATED")


def test_valid_jwt_accepted(api_app, api_client):
    _production(api_app)
    token = _token(role="service_role", app_metadata={"roles": ["admin"]})
    me = ok(api_client.get(f"{V1}/me", headers={"Authorization": f"Bearer {token}", "X-Demo-User": "demo-student-2"}))
    assert me["actor"]["user_id"] == "user-123" and me["actor"]["email"] == "tommy@usc.edu"
    assert me["actor"]["roles"] == ["student"]


def test_bad_demo_user_id_rejected(api_client):
    err(api_client.get(f"{V1}/me", headers={"X-Demo-User": "../../etc/passwd"}), 401, "UNAUTHENTICATED")


def test_browser_routes_need_the_client_header(api_app):
    """CSRF guard: a cross-site form post can't add the header, so it is refused instead of acting as the demo user."""
    from fastapi.testclient import TestClient
    bare = TestClient(api_app)
    assert bare.get(f"{V1}/clubs").status_code == 403
    assert bare.post(f"{V1}/clubs/club-ai/save").status_code == 403
    assert bare.post(f"{V1}/feedback", json={}).status_code == 403
    assert bare.post(f"{V1}/webhooks/slack/commands", content=b"x=1").status_code == 401  # Slack: signature check, not the header
