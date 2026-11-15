"""Student-side API (v1). Mounted under /api/v1 by app.main."""
from fastapi import APIRouter

from . import clubs, conversations, students

router = APIRouter()
router.include_router(students.router, tags=["student"])
router.include_router(clubs.router, tags=["clubs"])
router.include_router(conversations.router, tags=["conversations"])

__all__ = ["router"]
