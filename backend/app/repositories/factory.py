"""Chooses the repository backend from settings."""

from app.config import Settings
from app.repositories.base import StudentRepository
from app.repositories.memory import InMemoryRepository

def build_repository(settings: Settings) -> StudentRepository:
    if settings.use_supabase:
        from app.repositories.supabase_repo import SupabaseRepository

        return SupabaseRepository(settings)
    return InMemoryRepository()
