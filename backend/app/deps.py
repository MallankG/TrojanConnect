"""Dependency providers. Singletons are built lazily so the app boots with empty keys."""
from functools import lru_cache

from app.config import get_settings


@lru_cache
def get_repository():
    from app.repositories.factory import build_repository
    return build_repository(get_settings())


@lru_cache
def get_llm():
    from app.integrations.gemini.client import build_llm
    return build_llm(get_settings())


@lru_cache
def get_embedder():
    from app.integrations.gemini.client import build_embedder
    return build_embedder(get_settings())


@lru_cache
def get_orchestrator():
    from app.agents.orchestrator import AgentOrchestrator
    return AgentOrchestrator(repo=get_repository(), llm=get_llm(), embedder=get_embedder())
