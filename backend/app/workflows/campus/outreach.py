"""Club outreach (PRD 4 P1, 5.2 step 7, 11.5): a verified club representative posts events, recruitment
calls and updates; students who saved the club or expressed interest get a notification. The
representative also sees the club's interest inbox and edits the public profile.

Every write checks that the actor represents that club (server-side role, never a client claim) and is
audit-logged. Contact details in the inbox appear only when the student consented to share them.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from app.schemas.common import NOT_FOUND, PERMISSION_DENIED, VALIDATION_ERROR, AppError
from app.schemas.student import AuditLog, ClubEvent
from app.security.demo_roles import gov_scope

from . import government, store

EDITABLE = {"public_description", "meeting_schedule", "recruitment_status", "how_to_join", "time_commitment"}


def require_rep(actor, organization_id: str) -> None:
    if "club_rep" not in actor.roles or organization_id not in actor.organization_ids:
        raise AppError(PERMISSION_DENIED, "Only a verified representative of this club can do this.", status_code=403)


async def _audit(repo, actor, action: str, resource_type: str, resource_id: str, **meta: Any) -> None:
    await repo.add_audit_log(AuditLog(actor_id=actor.user_id, action=action, resource_type=resource_type,
                                      resource_id=resource_id, metadata=meta))


async def _club(repo, organization_id: str):
    club = await repo.get_club(organization_id)
    if club is None:
        raise AppError(NOT_FOUND, "Club not found.", status_code=404)
    return club


async def create_post(repo, actor, organization_id: str, body: dict[str, Any]) -> dict[str, Any]:
    require_rep(actor, organization_id)
    club = await _club(repo, organization_id)
    kind, title, text = body.get("kind"), (body.get("title") or "").strip(), (body.get("body") or "").strip()
    if kind not in {"event", "recruitment", "update"} or not title or not text:
        raise AppError(VALIDATION_ERROR, "A post needs a kind (event, recruitment or update), a title and a message.", status_code=422)
    event_id: Optional[str] = None
    if kind == "event" or body.get("event"):
        ev = body.get("event") or {}
        try:
            start, end = datetime.fromisoformat(ev["start_at"]), datetime.fromisoformat(ev["end_at"])
        except (KeyError, ValueError):
            raise AppError(VALIDATION_ERROR, "An event needs a start and end time.", status_code=422)
        if end <= start:
            raise AppError(VALIDATION_ERROR, "The event must end after it starts.", status_code=422)
        event = await repo.create_event(ClubEvent(organization_id=organization_id, title=title, description=text,
                                                  start_at=start, end_at=end, location=(ev.get("location") or "").strip()))
        event_id = event.id
    if kind == "recruitment" and body.get("recruitment_status") in {"open", "application", "closed"}:
        await repo.update_club(organization_id, {"recruitment_status": body["recruitment_status"]})
    post = store.add("club_post", organization_id, {
        "organization_id": organization_id, "club_name": club.name, "kind": kind, "title": title, "body": text,
        "event_id": event_id, "author": actor.display_name or actor.user_id,
    })
    await _audit(repo, actor, "club_post.create", "club_post", post["id"], organization_id=organization_id, kind=kind)
    return post


def posts(organization_id: str) -> list[dict[str, Any]]:
    return store.list_records("club_post", [organization_id])


async def update_profile(repo, actor, organization_id: str, patch: dict[str, Any]) -> Any:
    require_rep(actor, organization_id)
    clean = {k: v for k, v in patch.items() if k in EDITABLE}
    if not clean:
        raise AppError(VALIDATION_ERROR, f"Editable fields: {', '.join(sorted(EDITABLE))}.", status_code=422)
    club = await repo.update_club(organization_id, clean)
    if club is None:
        raise AppError(NOT_FOUND, "Club not found.", status_code=404)
    await _audit(repo, actor, "club_profile.update", "club", organization_id, fields=sorted(clean))
    return club


async def interest_inbox(repo, actor, organization_id: str) -> list[dict[str, Any]]:
    require_rep(actor, organization_id)
    out = []
    for i in await repo.list_interests_for_org(organization_id):
        who = None
        if i.share_contact:  # only what the student consented to share, as captured at that moment
            snap = i.consent_snapshot or {}
            who = {"name": snap.get("display_name") or "A student", "email": snap.get("email") or ""}
        out.append({"id": i.id, "interest_type": i.interest_type, "message": i.message, "created_at": i.created_at,
                    "shared_contact": i.share_contact, "from": who})
    out.sort(key=lambda x: x["created_at"], reverse=True)
    return out


async def notifications(repo, actor) -> list[dict[str, Any]]:
    """What changed for this person: club posts from clubs they follow, government announcements,
    and for representatives, their inbox."""
    items: list[dict[str, Any]] = []
    scope = gov_scope(actor)
    if "club_rep" in actor.roles:
        for oid in actor.organization_ids:
            for i in (await repo.list_interests_for_org(oid))[:10]:
                items.append({"id": f"interest-{i.id}", "text": f"A student expressed {i.interest_type} interest in your club",
                              "href": "/recruitment", "at": i.created_at.isoformat()})
    elif scope:
        for f in store.list_records("feedback", [scope], limit=10):
            if f.get("status") == "new":
                items.append({"id": f"feedback-{f['id']}", "text": f"New {scope} feedback: {f['category']}",
                              "href": "/government/feedback", "at": f["created_at"]})
    else:
        followed = set(await repo.list_saved_clubs(actor.user_id))
        followed |= {i.organization_id for i in await repo.list_interests_for_student(actor.user_id)}
        for p in store.list_records("club_post", sorted(followed), limit=20):
            label = {"event": "New event", "recruitment": "Recruiting", "update": "Update"}[p["kind"]]
            href = f"/events/{p['event_id']}" if p.get("event_id") else f"/clubs/{p['organization_id']}"
            items.append({"id": f"post-{p['id']}", "text": f"{p['club_name']} · {label}: {p['title']}", "href": href, "at": p["created_at"]})
        for a in government.announcements()[:5]:
            items.append({"id": f"gov-{a['id']}", "text": f"{a['scope']}: {a['title']}", "href": "/government", "at": a["created_at"]})
    items.sort(key=lambda x: x["at"], reverse=True)
    return items[:20]
