"""Dependency providers. Singletons are built lazily so the app boots with empty keys.

These run in FastAPI's threadpool, and lru_cache alone can build twice when two first
requests race - two repositories would mean a conversation created by one request missing
from the other. The lock makes construction happen once.
"""
import threading
from functools import lru_cache

from app.config import get_settings

_BUILD_LOCK = threading.Lock()


@lru_cache
def _build_repository():
    from app.repositories.factory import build_repository
    return build_repository(get_settings())


@lru_cache
def _build_llm():
    from app.integrations.gemini.client import build_llm
    return build_llm(get_settings())


@lru_cache
def _build_embedder():
    from app.integrations.gemini.client import build_embedder
    return build_embedder(get_settings())


@lru_cache
def _build_orchestrator():
    from app.agents.orchestrator import AgentOrchestrator
    return AgentOrchestrator(repo=_build_repository(), llm=_build_llm(), embedder=_build_embedder())


def get_repository():
    with _BUILD_LOCK:
        return _build_repository()


def get_llm():
    with _BUILD_LOCK:
        return _build_llm()


def get_embedder():
    with _BUILD_LOCK:
        return _build_embedder()


def get_orchestrator():
    with _BUILD_LOCK:
        return _build_orchestrator()
