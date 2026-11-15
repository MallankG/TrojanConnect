"""Student preferences: only what the student explicitly supplied (PRD 8.3)."""
from datetime import datetime, timezone

from app.schemas.student import StudentPreferences, StudentPreferencesUpdate
from app.services.text import normalize_tags


async def get_preferences(repo, user_id: str) -> StudentPreferences:
    return await repo.get_preferences(user_id) or StudentPreferences(user_id=user_id)


def merge_preferences(prefs: StudentPreferences, update: StudentPreferencesUpdate) -> StudentPreferences:
    """Apply only the fields the caller actually set; tags are normalised and de-duplicated."""
    data = prefs.model_dump()
    for field in update.model_fields_set:
        value = getattr(update, field)
        if field == "interest_tags":
            value = normalize_tags(value or [])[:30]
        elif field in ("goals",):
            value = (value or "").strip()
        elif field == "personalization_enabled" and value is None:
            continue
        data[field] = value
    data["updated_at"] = datetime.now(timezone.utc)
    return StudentPreferences(**data)


async def update_preferences(repo, user_id: str, update: StudentPreferencesUpdate) -> StudentPreferences:
    current = await get_preferences(repo, user_id)
    return await repo.upsert_preferences(merge_preferences(current, update))


def has_signal(prefs: StudentPreferences) -> bool:
    """True when there is something explicit to personalise on."""
    return bool(prefs.interest_tags or prefs.goals.strip())
