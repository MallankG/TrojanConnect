"""Expressions of interest: explicit confirmation, minimal sharing, audit log, idempotent (PRD 8.3, 9.4)."""
from datetime import datetime, timezone

from app.schemas.common import CONFIRMATION_REQUIRED, NOT_FOUND, AppError
from app.schemas.student import AuditLog, ClubInterest, ClubInterestCreate
from app.security.actor import Actor


def shared_fields(share_contact: bool) -> list[str]:
    """Exactly what the club receives."""
    return ["interest_type", "message"] + (["display_name", "email"] if share_contact else [])


async def submit_club_interest(repo, actor: Actor, req: ClubInterestCreate) -> ClubInterest:
    club = await repo.get_club(req.organization_id)
    if club is None:
        raise AppError(NOT_FOUND, "Club not found.", status_code=404)
    if not req.user_confirmed:
        raise AppError(CONFIRMATION_REQUIRED, "Submitting interest requires explicit user confirmation.")

    for existing in await repo.list_interests_for_student(actor.user_id):  # idempotent replay
        if existing.idempotency_key == req.idempotency_key:
            return existing

    fields = shared_fields(req.share_contact)
    snapshot = {
        "shared_with_organization_id": club.organization_id,
        "shared_with_club_name": club.name,
        "shared_fields": fields,
        "share_contact": req.share_contact,
        "confirmed_at": datetime.now(timezone.utc).isoformat(),
    }
    if req.share_contact:
        snapshot["display_name"], snapshot["email"] = actor.display_name, actor.email
    interest = await repo.create_interest(ClubInterest(
        student_id=actor.user_id, organization_id=club.organization_id, interest_type=req.interest_type,
        message=req.message, share_contact=req.share_contact, consent_snapshot=snapshot,
        idempotency_key=req.idempotency_key,
    ))
    await repo.add_audit_log(AuditLog(
        actor_id=actor.user_id, action="club_interest.submitted", resource_type="club_interest",
        resource_id=interest.id,
        metadata={"organization_id": club.organization_id, "interest_type": req.interest_type,
                  "share_contact": req.share_contact, "shared_fields": fields},
    ))
    return interest
