"""Public per-club agent (club_agent:{organization_id}): answers only from the club's public profile + events."""
import re

from app.agents.prompts import club_system_prompt
from app.integrations.llm import ToolSpec
from app.schemas.student import ClubProfile
from app.tools.student_tools import club_tool_specs, event_summary


def agent_id(organization_id: str) -> str:
    return f"club_agent:{organization_id}"


async def build_context(repo, club: ClubProfile) -> tuple[str, list[ToolSpec]]:
    events = [event_summary(e, club.name) for e in await repo.list_events(club.organization_id, True) if e.visibility == "public"]
    return club_system_prompt(club.model_dump(mode="json"), events[:10]), club_tool_specs()


def greeting(club: ClubProfile) -> str:
    first = re.split(r"(?<=[.!?])\s+", club.public_description.strip())[0] if club.public_description.strip() else ""
    questions = []
    if club.history or club.founded_year:
        questions.append("How did the club get started?")
    questions.append("What do members actually do week to week?")
    if club.time_commitment or club.time_commitment_hours_per_week is not None:
        questions.append("How much time does it take?")
    questions += ["How do I join?", "Could this club be a good fit for me?"]
    return (f"Hi! I'm the public information assistant for {club.name}. {first}".strip()
            + "\nYou could ask me:\n" + "\n".join(f"- {q}" for q in questions[:3])
            + "\nI only share what's in the club's public profile.")
