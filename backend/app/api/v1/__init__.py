"""Student-side API (v1). Mounted under /api/v1 by app.main."""
from fastapi import APIRouter

from . import campus, clubs, conversations, slack, students

router = APIRouter()
router.include_router(students.router, tags=["student"])
router.include_router(clubs.router, tags=["clubs"])
router.include_router(conversations.router, tags=["conversations"])
router.include_router(campus.router, tags=["government", "outreach"])
router.include_router(slack.router, tags=["slack"])

__all__ = ["router"]
