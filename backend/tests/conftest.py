"""Shared fixtures. Opt-in only (no autouse) so other test modules are unaffected."""
import sys

import pytest

API_JWT_SECRET = "test-jwt-secret-with-at-least-32-bytes!!"


@pytest.fixture
def api_settings():
    from app.config import Settings

    return Settings(_env_file=None, environment="development", allow_demo_auth=True,
                    supabase_url="", supabase_service_role_key="", gemini_api_key="",
                    supabase_jwt_secret=API_JWT_SECRET)


@pytest.fixture
def api_app(api_settings, monkeypatch):
    """Fresh FastAPI app wired to fakes (repo, embedder, orchestrator, services)."""
    from app.api.deps import embedder_dep, orchestrator_dep, repo_dep
    from app.config import get_settings
    from app.main import create_app
    from tests._api_fakes import FakeOrchestrator, FakeRepo, build_service_modules

    for name, module in build_service_modules().items():
        monkeypatch.setitem(sys.modules, name, module)
    repo = FakeRepo()
    orchestrator = FakeOrchestrator(repo)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: api_settings
    app.dependency_overrides[repo_dep] = lambda: repo
    app.dependency_overrides[embedder_dep] = lambda: object()
    app.dependency_overrides[orchestrator_dep] = lambda: orchestrator
    app.state.fake_repo = repo
    return app


@pytest.fixture
def api_client(api_app):
    from fastapi.testclient import TestClient

    with TestClient(api_app) as client:
        yield client


@pytest.fixture
def demo_rep_auth(api_settings):
    """Planning, RSO and booking routes need a signed-in club rep: demo sign-in, no .env, no database lookup."""
    import main
    from app.api.deps import repo_dep
    from app.config import get_settings

    main.app.dependency_overrides[get_settings] = lambda: api_settings
    main.app.dependency_overrides[repo_dep] = lambda: None
    yield
    main.app.dependency_overrides.pop(get_settings, None)
    main.app.dependency_overrides.pop(repo_dep, None)
