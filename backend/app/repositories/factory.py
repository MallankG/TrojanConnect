"""Chooses the repository backend from settings."""
import logging

from app.config import Settings
from app.repositories.base import StudentRepository
from app.repositories.memory import InMemoryRepository

logger = logging.getLogger(__name__)


def build_repository(settings: Settings) -> StudentRepository:
    if settings.use_supabase:
        try:
            from app.repositories.supabase_repo import SupabaseRepository

            return SupabaseRepository(settings)
        except Exception as exc:  # bad keys, missing package, network at init...
            logger.warning(
                "Supabase repository unavailable (%s: %s); falling back to in-memory seeded data.",
                type(exc).__name__, exc,
            )
    return InMemoryRepository()
