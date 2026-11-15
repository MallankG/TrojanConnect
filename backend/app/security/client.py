"""Request guards shared by the API routers.

Neither is real authentication. They stand in for Supabase Auth + server-side session verification
(PRD §14) and should be replaced by it: add the auth dependency where these are used.
"""

from __future__ import annotations

from fastapi import Header, HTTPException

CLIENT_HEADER = "X-TrojanConnect-Client"
REVIEWER_HEADER = "X-TrojanConnect-Reviewer"


def require_client_header(x_trojanconnect_client: str | None = Header(default=None)) -> None:
    """CSRF guard for every endpoint (any method).

    A custom header turns every cross-origin request into a CORS-preflighted one, and CORS only allows
    the TrojanConnect frontend origin, so another website can't reset the event or act on a booking.
    CORS preflights (OPTIONS) are answered by the middleware before this runs.
    """
    if x_trojanconnect_client != "web":
        raise HTTPException(403, f"Missing {CLIENT_HEADER} header.")


def reviewer_id(x_trojanconnect_reviewer: str | None = Header(default=None)) -> str | None:
    """The demo reviewer identity picked on /pipeline/review. The server checks it against the seeded
    reviewer list and their authority assignments; the model never supplies it."""
    return x_trojanconnect_reviewer
