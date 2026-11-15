"""Server-side roles for the dev demo identities (stands in for Supabase memberships, PRD 3, 14).

The client only names *who* it is (X-Demo-User); what that identity may do is decided here, never by a
header, body or model. Production uses a verified JWT and gets the default student actor.
"""
import os
from typing import Any

DEMO_ROLES: dict[str, dict[str, Any]] = {
    # The demo student the web app signs in as (shown there as Priya Shah).
    "demo-student-1": {"roles": ["student"], "organization_ids": [], "display_name": "Priya Shah (demo)",
                       "email": "priya.shah@students.example.edu"},
    "demo-student-3": {"roles": ["student"], "organization_ids": [], "display_name": "Marcus Bell (demo)",
                       "email": "marcus.bell@students.example.edu"},
    "demo-student-4": {"roles": ["student"], "organization_ids": [], "display_name": "Sofia Ramirez (demo)",
                       "email": "sofia.ramirez@students.example.edu"},
    # Demo club representative for HackSC (a real club from the public directory). The person is a demo
    # identity: posts and edits are labelled as coming from a demo account.
    "demo-rep-1": {"roles": ["club_rep"], "organization_ids": [os.environ.get("DEMO_CLUB_ID", "usc-hacksc")],
                   "display_name": "Maya Okafor (demo rep)"},
    # Student-government representatives: they manage only their own body's content and queue.
    "demo-usg-rep": {"roles": ["gov_rep:USG"], "organization_ids": [], "display_name": "Jordan Lee (demo)"},
    "demo-gsg-rep": {"roles": ["gov_rep:GSG"], "organization_ids": [], "display_name": "GSG representative (demo)"},
}


def apply_demo_roles(actor) -> None:
    entry = DEMO_ROLES.get(actor.user_id)
    if not entry:
        return
    actor.roles = list(entry["roles"])
    actor.organization_ids = list(entry["organization_ids"])
    # The repository's demo profile wins when it has one; the registry fills the gaps (e.g. on Supabase).
    actor.display_name = actor.display_name or entry["display_name"]
    actor.email = actor.email or entry.get("email", "")


def gov_scope(actor) -> str | None:
    """'USG' / 'GSG' for a government representative, else None."""
    for role in actor.roles:
        if role.startswith("gov_rep:"):
            return role.split(":", 1)[1]
    return None
