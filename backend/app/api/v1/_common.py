from importlib import import_module

from app.schemas.common import NOT_FOUND, AppError


def svc(name: str):
    """Late-bound service module (app.services.<name>) so the app imports cleanly and tests can swap it."""
    return import_module(f"app.services.{name}")


async def require_club(repo, organization_id: str):
    club = await repo.get_club(organization_id)
    if club is None:
        raise AppError(NOT_FOUND, "Club not found.", status_code=404)
    return club
