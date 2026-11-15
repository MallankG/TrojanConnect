"""Student-side API (v1). Mounted under /api/v1 by app.main."""
from fastapi import APIRouter, Depends

from app.security.client import require_client_header

from . import campus, clubs, conversations, slack, students

# CSRF guard on every browser-facing route, as on planning, bookings and RSO. Without it, a plain form post
# from another site would act as the default demo user. Slack can't send the header; its webhooks verify
# Slack's signature instead.
guarded = [Depends(require_client_header)]
router = APIRouter()
router.include_router(students.router, tags=["student"], dependencies=guarded)
router.include_router(clubs.router, tags=["clubs"], dependencies=guarded)
router.include_router(conversations.router, tags=["conversations"], dependencies=guarded)
router.include_router(campus.router, tags=["government", "outreach"], dependencies=guarded)
router.include_router(slack.router, tags=["slack"])

__all__ = ["router"]
