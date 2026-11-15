"""Streamed replies: the text arrives in pieces, and the final event is the normal response."""
import json

import pytest
from fastapi.testclient import TestClient

V1 = "/api/v1"


def read_sse(resp):
    assert resp.status_code == 200 and resp.headers["content-type"].startswith("text/event-stream")
    events = []
    for block in resp.text.strip().split("\n\n"):
        name = block.split("\n")[0].removeprefix("event: ")
        events.append((name, json.loads(block.split("\n")[1].removeprefix("data: "))))
    text = "".join(d["text"] for n, d in events if n == "delta")
    assert events[-1][0] == "done" and sum(n == "done" for n, _ in events) == 1
    return text, events[-1][1], sum(n == "delta" for n, _ in events)


def test_helper_splits_words_and_keeps_spacing(monkeypatch):
    from fastapi import FastAPI

    from app.api import streaming
    monkeypatch.setattr(streaming, "WORD_DELAY", 0)
    app = FastAPI()
    app.post("/s")(lambda: streaming.stream_reply("Spark SC builds\nstartups.", {"ok": True}))
    text, done, deltas = read_sse(TestClient(app).post("/s"))
    assert text == "Spark SC builds\nstartups." and deltas == 4 and done == {"ok": True}


def test_conversation_stream_matches_the_normal_turn(api_client, monkeypatch):
    from app.api import streaming
    monkeypatch.setattr(streaming, "WORD_DELAY", 0)
    cid = api_client.post(f"{V1}/conversations", json={"agent_type": "club", "organization_id": "club-ai"}).json()["data"]["conversation"]["id"]
    text, done, deltas = read_sse(api_client.post(f"{V1}/conversations/{cid}/messages/stream", json={"content": "When do you meet?"}))
    assert done["ok"] and done["data"]["message"]["content"] == text == "echo: When do you meet?" and deltas == 5
    # errors are ordinary JSON envelopes, not a stream
    bad = api_client.post(f"{V1}/conversations/{cid}/messages/stream", json={"content": ""})
    assert bad.status_code == 422 and bad.json()["ok"] is False


def test_government_stream(api_settings, monkeypatch, tmp_path):
    from app.api import streaming
    from app.api.deps import embedder_dep, repo_dep
    from app.config import get_settings
    from app.main import create_app
    from app.repositories.memory import InMemoryRepository
    from app.workflows.campus import store
    monkeypatch.setattr(streaming, "WORD_DELAY", 0)
    monkeypatch.setenv("CAMPUS_STORE", "json")
    monkeypatch.setattr(store, "DATA_DIR", tmp_path, raising=False)
    store.reset_backend_cache()
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: api_settings
    app.dependency_overrides[repo_dep] = lambda: InMemoryRepository(dataset="demo")
    app.dependency_overrides[embedder_dep] = lambda: object()
    h = {"X-TrojanConnect-Client": "web", "X-Demo-User": "demo-student-1"}
    text, done, _ = read_sse(TestClient(app).post(f"{V1}/government/ask/stream", json={"scope": "USG", "question": "what is USG"}, headers=h))
    assert done["data"]["answer"] == text and done["data"]["verified"]


@pytest.mark.usefixtures("demo_rep_auth")
def test_planning_assistant_stream(tmp_path, monkeypatch):
    import main
    from app.api import streaming
    from app.workflows.event_pipeline import store
    monkeypatch.setattr(streaming, "WORD_DELAY", 0)
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    monkeypatch.setattr(store, "STATE_PATH", tmp_path / "event_pipeline.json")
    monkeypatch.setenv("BOOKING_STORE", "json")
    monkeypatch.setenv("ASSISTANT_MODE", "rules")
    h = {"X-TrojanConnect-Client": "web", "X-Demo-User": "demo-rep-1"}
    text, done, _ = read_sse(TestClient(main.app).post(f"{V1}/pipeline/agent/chat/stream", json={"message": "start a new RSO"}, headers=h))
    assert done["reply"] == text and done["model"] == "rso-rules" and done["actions"]
    student = {**h, "X-Demo-User": "demo-student-1"}
    assert TestClient(main.app).post(f"{V1}/pipeline/agent/chat/stream", json={"message": "hi"}, headers=student).status_code == 403
