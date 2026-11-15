"""Actor resolution. Identity comes from a verified Supabase JWT, or (dev only) the
X-Demo-User header. Roles are never read from client-supplied headers or bodies."""
import re

import jwt
from fastapi import Depends, Request

from app.api.deps import repo_dep
from app.config import Settings, get_settings
from app.schemas.common import AppError
from app.security.actor import Actor
from app.security.demo_roles import apply_demo_roles

UNAUTHENTICATED = "UNAUTHENTICATED"
DEFAULT_DEMO_USER = "demo-student-1"
_DEMO_ID = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")


def _unauthenticated(message: str) -> AppError:
    return AppError(UNAUTHENTICATED, message, status_code=401)


def _actor_from_jwt(token: str, settings: Settings) -> Actor:
    if not settings.supabase_jwt_secret:
        raise _unauthenticated("Token sign-in is not configured on this server.")
    try:
        claims = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            options={"require": ["sub", "exp"]},
        )
    except jwt.PyJWTError:
        raise _unauthenticated("Invalid or expired session token.")
    meta = claims.get("user_metadata")
    meta = meta if isinstance(meta, dict) else {}
    name = meta.get("full_name") or meta.get("name") or ""
    return Actor(user_id=str(claims["sub"]), email=str(claims.get("email") or ""), display_name=str(name))


async def get_actor(
    request: Request,
    settings: Settings = Depends(get_settings),
    repo=Depends(repo_dep),
) -> Actor:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() == "bearer" and token.strip():
        return _actor_from_jwt(token.strip(), settings)

    if settings.allow_demo_auth and not settings.is_production:
        user_id = (request.headers.get("x-demo-user") or DEFAULT_DEMO_USER).strip()
        if not _DEMO_ID.match(user_id):
            raise _unauthenticated("Invalid demo user id.")
        actor = Actor(user_id=user_id)
        lookup = getattr(repo, "get_demo_user", None)
        if callable(lookup):
            try:
                demo = lookup(user_id)
                if hasattr(demo, "__await__"):
                    demo = await demo
            except Exception:
                demo = None
            if demo is not None:
                get = demo.get if isinstance(demo, dict) else lambda k, d="": getattr(demo, k, d)
                actor.display_name = str(get("display_name", "") or "")
                actor.email = str(get("email", "") or "")
        apply_demo_roles(actor)
        return actor

    raise _unauthenticated("Sign in required.")


async def require_club_rep(actor: Actor = Depends(get_actor)) -> Actor:
    """Event planning, bookings and RSO recognition act for a club: only a club representative may use them."""
    if "club_rep" not in actor.roles:
        raise AppError("PERMISSION_DENIED", "Only a verified club representative can do this.", status_code=403)
    return actor
