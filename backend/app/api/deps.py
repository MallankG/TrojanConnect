"""FastAPI-facing wrappers around app.deps providers.
Tests replace them through `app.dependency_overrides[repo_dep] = ...`."""
from app import deps


def repo_dep():
    return deps.get_repository()


def embedder_dep():
    return deps.get_embedder()


def orchestrator_dep():
    return deps.get_orchestrator()
