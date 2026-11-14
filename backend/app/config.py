"""Central settings. Every key is optional so the backend boots with an empty .env:
no Supabase keys -> in-memory seeded repository; no Gemini key -> rule-based fallback LLM."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = "development"
    frontend_origin: str = "http://localhost:3000"

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""

    gemini_api_key: str = ""
    gemini_chat_model: str = "gemini-3.5-flash"
    gemini_embedding_model: str = "gemini-embedding-001"
    gemini_decision_model: str = "gemini-decision-1"
    gemini_api_version: str = "v1beta"

    # Messaging channel (WhatsApp alternative TBD) - unused by the student agent for now.
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_app_secret: str = ""
    whatsapp_verify_token: str = ""
    telegram_bot_token: str = ""

    # Dev-only: allow `X-Demo-User: <user_id>` instead of a Supabase JWT when not in production.
    allow_demo_auth: bool = True

    @property
    def use_supabase(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def use_gemini(self) -> bool:
        return bool(self.gemini_api_key)

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
