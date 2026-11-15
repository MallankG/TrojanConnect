"""Personal Student Agent: club discovery, recommendations, fit checks, interest preparation."""
from app.agents.prompts import student_system_prompt
from app.integrations.llm import ToolSpec
from app.security.actor import Actor
from app.services.preferences import get_preferences, has_signal
from app.tools.student_tools import student_tool_specs


def agent_id(user_id: str) -> str:
    return f"student_agent:{user_id}"


async def build_context(repo, actor: Actor) -> tuple[str, list[ToolSpec]]:
    prefs = await get_preferences(repo, actor.user_id)
    return student_system_prompt(prefs.model_dump(mode="json", exclude={"user_id", "updated_at"})), student_tool_specs()


async def greeting(repo, actor: Actor) -> str:
    name = f" {actor.display_name.split()[0]}" if actor.display_name.strip() else ""
    prefs = await get_preferences(repo, actor.user_id)
    if has_signal(prefs):
        return (f"Hi{name}! I'm your Trojan Connect student agent. I have your interests saved "
                f"({', '.join(prefs.interest_tags[:5]) or 'your goals'}). Want club recommendations, a fit check on a "
                "specific club, or to compare two clubs?")
    return (f"Hi{name}! I'm your Trojan Connect student agent - I help you find USC clubs that suit you. "
            "A few quick questions: What are you interested in? Roughly how many hours a week can you give a club? "
            "And what do you hope to get out of it?")
