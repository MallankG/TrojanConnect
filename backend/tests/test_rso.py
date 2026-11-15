"""RSO recognition: process data, the tracker's rules, the RSO agent and the API. No network; temp storage."""

from __future__ import annotations

from datetime import datetime

import pytest
from fastapi.testclient import TestClient

import main
from app.agents import rso_agent
from app.workflows.event_pipeline import store
from app.workflows.rso import process as P
from app.workflows.rso import service as rso

NOW = datetime.fromisoformat("2026-11-14T10:00:00-08:00")
H = {"X-TrojanConnect-Client": "web"}
ROSTER = {**{f"{r}Name": f"Test {r}" for r, _ in P.OFFICER_ROLES}, **{f"{r}Email": f"{r.lower()}@usc.edu" for r, _ in P.OFFICER_ROLES},
          "facultyAdvisorName": "Test Advisor", "facultyAdvisorEmail": "advisor@usc.edu", "facultyAdvisorFullTime": True, "memberCount": "6"}


@pytest.fixture(autouse=True)
def temp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    monkeypatch.setattr(store, "STATE_PATH", tmp_path / "event_pipeline.json")
    monkeypatch.setenv("BOOKING_STORE", "json")
    store.reset()
    rso.reset()


def say(message: str, now: datetime = NOW) -> dict:
    return rso_agent.run_turn(message, now=now)


def complete_preparation() -> None:
    rso.set_fields({"organizationName": "Demo Robotics Society", "submitterRole": "president", "submitterName": "Test president", **ROSTER})
    for k in ("check_directory", "start_application", "group_details", "constitution", "accountability", "questions"):
        rso.set_check(f"step.{k}", True)
    for r, _ in P.OFFICER_ROLES:
        for d, _, _ in P.OFFICER_DOCS:
            rso.set_check(f"{r}.{d}", True)


def test_process_data_links_are_usc_or_engage_and_dates_are_right():
    assert P.DATE_BY_ID["application_deadline"]["at"].isoformat() == "2026-11-22T23:59:00-08:00"
    assert P.DATE_BY_ID["advisor_deadline"]["at"].isoformat() == "2026-12-01T23:59:00-08:00"
    assert P.L["engage_directory"]["url"] == "https://engage.usc.edu/club_signup"
    assert all(v["url"].startswith("https://") for v in P.L.values())
    assert [s["id"] for s in P.steps_for("new")][:3] == ["check_directory", "submitter", "start_application"]
    assert [s["id"] for s in P.steps_for("renew", listed_officer=False)][0] == "officer_access"
    assert P.steps_for("fsl") == [] and P.steps_for("fall_applicant") == []
    religious = next(s for s in P.steps_for("religious") if s["id"] == "start_application")
    assert "Office of Religious and Spiritual Life" in religious["detail"]


def test_new_rso_readiness_follows_the_rules():
    rso.set_pathway("new")
    v = rso.view(now=NOW)
    assert v["status"] == "in_progress" and not v["ready_to_submit"] and v["next_step"]["id"] == "check_directory"
    assert len(v["roster_gaps"]) == 8  # 5 officers, advisor, full-time confirmation, members
    saved, rejected = rso.set_fields({"presidentEmail": "someone@gmail.com", "memberCount": "four", "bogus": 1})
    assert saved == {} and set(rejected) == {"presidentEmail", "memberCount", "bogus"}
    rso.set_fields({**ROSTER, "memberCount": "4"})
    assert rso.view()["roster_gaps"] == ["At least 5 additional student members (now 4)"]  # main page's minimum
    complete_preparation()
    v = rso.view(now=NOW)
    assert v["ready_to_submit"] and v["submit_blockers"] == []  # acceptances and advisor items don't block submitting
    assert v["next_step"]["id"] == "acceptances"
    assert not rso.view(now=datetime.fromisoformat("2026-11-23T00:01:00-08:00"))["ready_to_submit"]  # closed after Nov 22, 11:59 PM


def test_only_a_person_or_the_portal_records_the_engagesc_status():
    with pytest.raises(rso.RsoError):
        rso.record_status("recognized", actor="rso_agent")
    with pytest.raises(rso.RsoError):
        rso.record_status("submitted")
    with pytest.raises(rso.RsoError):
        rso.set_check("president.unknown", True)
    rso.set_pathway("new")
    assert rso.record_status("pending_approval")["status"] == "pending_approval"


def test_agent_walks_a_new_rso_and_hands_off_to_engagesc():
    out = say("Help me with RSO recognition")
    assert out["actions"][0]["type"] == "options" and len(out["actions"][0]["options"]) == 6
    out = say("Start a new RSO")
    assert rso.load()["pathway"] == "new" and "8 days left" in out["reply"]
    fields = next(a for a in out["actions"] if a["type"] == "fields")
    assert fields["scope"] == "rso" and fields["then"] == "RSO next step"

    rso.set_fields({"organizationName": "Demo Robotics Society", "submitterRole": "president", "submitterName": "Test"})
    rso.set_check("step.check_directory", True)
    out = say("RSO next step")
    handoff = next(a for a in out["actions"] if a["type"] == "handoff")
    assert handoff["url"] == "https://engage.usc.edu/club_signup" and "+Register a new Recognized Student Organization" in handoff["steps"][0]

    out = say("RSO officer documents")
    assert [a["target"] for a in out["actions"] if a["type"] == "rso_email"] == [r for r, _ in P.OFFICER_ROLES]
    out = say("Submit our RSO on EngageSC")
    assert "Not ready to submit" in out["reply"]
    complete_preparation()
    out = say("Submit our RSO on EngageSC")
    assert any(a["type"] == "handoff" for a in out["actions"]) and any(a["type"] == "rso_portal" for a in out["actions"])
    assert rso.load()["status"] == "in_progress"  # the agent never marks it submitted
    import os
    os.environ["RSO_PORTAL"] = "off"
    try:
        out = say("Submit our RSO on EngageSC")
        assert any(a["type"] == "rso_status" for a in out["actions"]) and not any(a["type"] == "rso_portal" for a in out["actions"])
    finally:
        del os.environ["RSO_PORTAL"]

    rso.record_status("recognized")
    out = say("What's next for our RSO?")
    assert "recognized through June 30, 2027" in out["reply"]
    assert any(i["label"] == "Plan an event" for a in out["actions"] if a["type"] == "suggestions" for i in a["items"])


def test_agent_renewal_paths():
    out = say("Renew our existing RSO")
    assert [o["message"] for o in out["actions"][0]["options"]] == ["Renew our RSO: I'm a listed officer", "Renew our RSO: I'm not listed as an officer"]
    say("Renew our RSO: I'm not listed as an officer")
    v = rso.view(now=NOW)
    access = v["steps"][0]
    assert access["id"] == "officer_access" and not access["done"]
    assert {l["key"] for l in access["links"]} >= {"officer_access_form", "reestablish_form"}
    say("Renew our RSO: I'm a listed officer")
    assert rso.view(now=NOW)["steps"][0]["done"]
    assert "fraternity" in say("RSO for a social fraternity or sorority")["reply"].lower()
    assert "Don't submit a new application" in say("RSO: we applied in fall")["reply"]


def test_officer_and_advisor_emails_list_what_is_still_owed():
    rso.set_fields({"organizationName": "Demo Robotics Society", "submitterName": "Test", **ROSTER})
    rso.set_check("treasurer.hazing", True)
    e = rso.email("treasurer")
    assert e["to"] == "treasurer@usc.edu" and "Hazing" not in e["body"] and "Learning Path" in e["body"] and e["mailto"].startswith("mailto:")
    a = rso.email("advisor")
    assert "Advisor Training" in a["body"] and "December 1" in a["body"]
    with pytest.raises(rso.RsoError):
        rso.email("nobody")


def test_assistant_routes_rso_messages_and_engagesc_step_mentions_recognition():
    c = TestClient(main.app)
    r = c.post("/api/v1/pipeline/agent/chat", json={"message": "Start a new RSO"}, headers=H).json()
    assert r["model"] == "rso-rules" and "state" in r and any(a["type"] == "fields" for a in r["actions"])
    r = c.post("/api/v1/pipeline/agent/chat", json={"message": "What do I do on EngageSC?"}, headers=H).json()
    assert "Only recognized RSOs can create EngageSC events" in r["reply"]
    assert c.get("/api/v1/pipeline/status", headers=H).json()["rso"]["recognized"] is False


def test_rso_api_and_error_envelope():
    c = TestClient(main.app)
    assert c.get("/api/v1/rso/state").status_code == 403
    s = c.get("/api/v1/rso/schema", headers=H).json()
    assert len(s["pathways"]) == 6 and s["contact"]["email"] == "stuacts@usc.edu" and any("ten" in d for d in s["discrepancies"])
    assert c.put("/api/v1/rso/pathway", json={"pathway": "new"}, headers=H).json()["pathway"] == "new"
    r = c.put("/api/v1/rso/fields", json={"organizationName": "Demo", "facultyAdvisorEmail": "x@gmail.com"}, headers=H).json()
    assert r["saved"] == {"organizationName": "Demo"} and "facultyAdvisorEmail" in r["rejected"]
    bad = c.put("/api/v1/rso/checks", json={"key": "nope", "done": True}, headers=H)
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "UNKNOWN_CHECK"
    assert c.put("/api/v1/rso/status", json={"status": "recognized"}, headers=H).json()["status"] == "recognized"
    assert c.get("/api/v1/rso/emails/advisor", headers=H).json()["subject"].startswith("Demo")
    assert c.post("/api/v1/rso/agent/chat", json={"message": "RSO deadlines"}, headers=H).json()["model"] == "rso-rules"
    assert c.post("/api/v1/rso/reset", headers=H).json()["status"] == "not_started"


def test_routing_uses_whole_words_and_topics_in_the_right_order():
    # Regressions found in end-to-end testing.
    assert not rso_agent.handles("Book a 35 person event for December 20th 2026 from 7pm - 8pm")  # "pe-rso-n"
    assert not rso_agent.handles("Draft the advisor email") and not rso_agent.handles("What do I do on EngageSC?")
    for m in ("Start a new RSO", "renew our club", "RSO next step", "help with recognition", "we're a club sport", "RSOs"):
        assert rso_agent.handles(m), m
    rso.set_pathway("new")
    out = say("RSO advisor requirements")
    assert out["reply"].startswith("Advisor requirements are separate") and any(a["type"] == "rso_checklist" for a in out["actions"])
    c = TestClient(main.app)
    r = c.post("/api/v1/pipeline/agent/chat", json={"message": "Book a 35 person event for December 20th 2026 from 7pm - 8pm"}, headers=H).json()
    assert r["model"] == "rules" and any(a["type"] == "options" for a in r["actions"])  # event booking, not the RSO agent



# ---- simulated EngageSC portal and the portal agent ------------------------------------------------
def test_simulated_portal_flow_over_http():
    from app.workflows.rso import mock_portal
    c = TestClient(main.app)
    assert c.get("/mock-engagesc/directory", follow_redirects=False).headers["location"] == "/mock-engagesc/login"
    c.post("/mock-engagesc/login", data={"username": "demo.officer", "password": "demo"})
    assert "Demo Chess Collective" in c.get("/mock-engagesc/directory?q=chess").text
    assert "Simulated EngageSC (demo)" in c.get("/mock-engagesc/register").text
    form = {"org_name": "Demo Robotics Society", "purpose": "x", "submitter_role": "president", "submitter_name": "T", "member_count": "6",
            "advisor_name": "A", "advisor_email": "a@usc.edu", "certify": "yes", "group": "",
            **{f"{r}_{k}": f"{r}@usc.edu" for r, _ in P.OFFICER_ROLES for k in ("name", "email")},
            **{f"q{i}": "demo" for i in range(len(P.APPLICATION_QUESTIONS))}}
    pdf = ("doc.pdf", b"%PDF-1.4 demo", "application/pdf")
    short = c.post("/mock-engagesc/register", data=form, files=[("constitution", pdf), ("accountability", pdf), ("officer_docs", pdf)])
    assert "Upload all 15 officer documents" in short.text
    ok = c.post("/mock-engagesc/register", data=form, files=[("constitution", pdf), ("accountability", pdf)] + [("officer_docs", pdf)] * 15)
    app_id = ok.text.split('id="application-id">')[1].split("<")[0]
    assert app_id.startswith("APP-") and "Pending Approval" in c.get("/mock-engagesc/my-activity").text
    mock_portal.set_status(app_id, "Approved", "Welcome!")
    assert 'data-status="Approved"' in c.get("/mock-engagesc/my-activity").text
    assert "Demo Robotics Society" in c.get("/mock-engagesc/directory?q=robotics").text  # approved groups join the Directory


class FakePortal:
    name, integration_mode = "fake", "simulated"

    def __init__(self):
        self.status = "Pending Approval"

    def submit(self, view, log):
        log("submitting")
        return {"application_id": "APP-123456", "portal_status": "Pending Approval"}

    def fetch_status(self, app_id, log):
        return {"application_id": app_id, "portal_status": self.status, "note": "ok"}


def test_portal_agent_submits_only_when_ready_and_syncs_status(monkeypatch):
    import time
    from app.workflows.rso import portal_agent
    fake = FakePortal()
    monkeypatch.setattr(portal_agent, "get_adapter", lambda: fake)

    def wait():
        for _ in range(200):
            if not portal_agent.run_status()["running"]:
                return portal_agent.run_status()
            time.sleep(0.01)
        raise AssertionError("portal run did not finish")

    rso.set_pathway("new")
    with pytest.raises(rso.RsoError) as e:
        portal_agent.start_submit()
    assert e.value.code == "NOT_READY"
    complete_preparation()
    portal_agent.start_submit()
    st = wait()
    assert st["error"] is None and st["application"]["application_id"] == "APP-123456"
    assert rso.load()["status"] == "pending_approval"  # read from the portal, not assumed
    assert rso.load()["log"][0]["actor"] == "portal:simulated-engagesc"
    with pytest.raises(rso.RsoError) as e:
        portal_agent.start_submit()
    assert e.value.code == "ALREADY_SUBMITTED"
    fake.status = "Approved"
    portal_agent.start_sync()
    wait()
    assert rso.load()["status"] == "recognized"


def test_review_fixes_hold():
    # A pathway with no steps survives "Requires Modifications" (was StopIteration -> every view() 500).
    rso.set_pathway("fall_applicant", None)
    rso.record_status("requires_modifications")
    assert rso.view(now=NOW)["next_step"] is None
    # An empty organization name blocks submitting.
    rso.reset(); rso.set_pathway("new", None); complete_preparation(); rso.set_fields({"organizationName": ""})
    assert "Organization name" in rso.view(now=NOW)["submit_blockers"]
    # Once recognized, the application can't be submitted again.
    rso.set_fields({"organizationName": "Demo Robotics Society"}); rso.record_status("recognized")
    assert not rso.view(now=NOW)["ready_to_submit"]
    # A question that mentions a topic doesn't switch the saved pathway.
    say("Can religious students be excluded under open membership?")
    assert rso.view(now=NOW)["pathway"] == "new"
    # Event-planning phrases stay with the event assistant; RSO phrases still route.
    for m in ("Do I need Campus Activities approval for the classroom?", "we want to recognize volunteers at the event", "renew the room hold"):
        assert not rso_agent.handles(m), m
    for m in ("start a new RSO", "Renew our existing RSO", "how do we get recognized", "renew our club"):
        assert rso_agent.handles(m), m
