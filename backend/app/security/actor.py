from pydantic import BaseModel


class Actor(BaseModel):
    """Server-derived identity. Never built from model output or client-supplied role fields."""
    user_id: str
    roles: list[str] = ["student"]
    organization_ids: list[str] = []
    display_name: str = ""
    email: str = ""  # shared with a club only on explicit, confirmed consent
