"""Central settings. Every key is optional so the backend boots with an empty .env:
no Supabase keys -> in-memory seeded repository; no Gemini key -> rule-based fallback LLM."""
from functools import lru_cache
from typing import ClassVar, Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # str_strip_whitespace: a pasted secret with a stray space (" https://…") must not break the connection.
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore", str_strip_whitespace=True)

    # Defaults are the safe ones: a deployment that sets nothing is treated as production,
    # where the X-Demo-User header is refused. Local dev opts in via .env (see .env.example).
    environment: str = "production"
    frontend_origin: str = "http://localhost:3000"

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""

    gemini_api_key: str = ""
    gemini_chat_model: str = "gemini-3.5-flash"
    gemini_embedding_model: str = "gemini-embedding-001"
    gemini_decision_model: str = "gemini-decision-1"
    gemini_api_version: str = "v1beta"
    # Requests per minute we allow ourselves (0 = no limit). Match https://aistudio.google.com/rate-limit for the project.
    gemini_chat_rpm: int = 10
    gemini_embedding_rpm: int = 100
    embedding_provider: Literal["gemini", "ollama"] = "gemini"
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_embedding_model: str = "nomic-embed-text:latest"

    # Slack bot (replaces WhatsApp as the messaging channel; works on a free Slack workspace).
    slack_signing_secret: str = ""      # verifies that requests really come from Slack
    slack_bot_token: str = ""           # xoxb-... for chat.postMessage (club posts to a channel)
    slack_outreach_channel: str = ""    # channel id that receives club posts, e.g. C0123456789
    slack_user_map: str = ""            # verified links: "U012ABC:demo-student-1,U034DEF:demo-rep-1"
    app_base_url: str = "http://localhost:3000"  # web app link for actions that need a step-up confirmation

    # Which in-memory seed dataset to serve: "auto" | "real" | "demo" (see repositories/memory.py)
    seed_dataset: str = "auto"

    # Dev-only: allow `X-Demo-User: <user_id>` instead of a Supabase JWT when not in production.
    allow_demo_auth: bool = False

    @property
    def use_supabase(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def use_gemini(self) -> bool:
        return bool(self.gemini_api_key)

    # Anything that isn't an explicitly recognised local/dev/test environment counts as
    # production, so "prod", "staging" or a typo cannot unlock demo auth.
    DEV_ENVIRONMENTS: ClassVar[frozenset[str]] = frozenset({"development", "dev", "local", "test", "testing"})

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() not in self.DEV_ENVIRONMENTS


@lru_cache
def get_settings() -> Settings:
    return Settings()
