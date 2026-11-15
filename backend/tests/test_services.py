"""Service + tool tests. No network or API keys: HashEmbedder + an in-test fake repository."""
import pytest

from app.integrations.gemini.client import HashEmbedder, build_embedder, build_llm
from app.repositories.base import StudentRepository
from app.schemas.common import CONFIRMATION_REQUIRED, NOT_FOUND, VALIDATION_ERROR, AppError
from app.schemas.student import ClubInterestCreate, RecommendationFeedback, StudentPreferencesUpdate
from app.security.actor import Actor
from app.services.clubs import search_clubs
from app.services.interests import submit_club_interest
from app.services.preferences import get_preferences, update_preferences
from app.services.recommendations import fit_check, recommend_clubs
from app.tools.student_tools import club_tool_specs, execute_tool, student_tool_specs, summarize_activity
from tests._fakes import FakeRepo

ALICE = Actor(user_id="alice", display_name="Alice Tran", email="alice@example.edu")


@pytest.fixture
def repo():
    return FakeRepo()


@pytest.fixture
def embedder():
    return HashEmbedder()


async def _set_prefs(repo, user_id="alice", **fields):
    return await update_preferences(repo, user_id, StudentPreferencesUpdate(**fields))


def test_fake_repo_satisfies_protocol(repo):
    assert isinstance(repo, StudentRepository)


async def test_hash_embedder_is_deterministic_and_normalised(embedder):
    a, b = await embedder.embed(["machine learning projects", "machine learning projects"])
    assert a == b and len(a) == 768
    assert abs(sum(x * x for x in a) - 1.0) < 1e-6


def test_factories_fall_back_without_key():
    from app.config import Settings
    settings = Settings(_env_file=None, gemini_api_key="")
    assert build_llm(settings).is_fallback and build_embedder(settings).is_fallback


async def test_preferences_default_and_partial_update(repo):
    assert (await get_preferences(repo, "alice")).interest_tags == []
    await _set_prefs(repo, interest_tags=["Machine Learning", "machine-learning", "Startups"], hours_per_week_available=5)
    prefs = await _set_prefs(repo, goals="build things")
    assert prefs.interest_tags == ["machine_learning", "startups"]
    assert prefs.hours_per_week_available == 5 and prefs.goals == "build things"


async def test_search_blends_tags_and_text(repo, embedder):
    hits = await search_clubs(repo, embedder, "machine learning projects", ["startups"], limit=3)
    assert hits[0].club.organization_id == "org-ai"
    assert "startups" in hits[0].matched_tags
    assert all(0 <= h.score <= 1 for h in hits)
    assert "org-hike" not in [h.club.organization_id for h in hits]


async def test_search_uses_pgvector_when_repo_supports_it(repo):
    class RemoteEmbedder(HashEmbedder):
        is_fallback = False
        space = "remote-test"
    repo.match_result = [("org-hike", 0.99)]
    hits = await search_clubs(repo, RemoteEmbedder(), "something unrelated entirely", [], limit=3)
    assert hits[0].club.organization_id == "org-hike"


async def test_recommendation_ordering_and_reason_codes(repo, embedder):
    await _set_prefs(repo, interest_tags=["artificial_intelligence", "startups"], goals="build machine learning projects",
                     hours_per_week_available=5)
    recs = await recommend_clubs(repo, embedder, "alice")
    assert [r.organization_id for r in recs][0] == "org-ai"
    assert [r.score for r in recs] == sorted((r.score for r in recs), reverse=True)
    top = recs[0]
    assert {"INTEREST_TAG_MATCH", "GOAL_MATCH", "TIME_FIT", "RECRUITING_NOW", "UPCOMING_EVENT"} <= set(top.reason_codes)
    assert top.matched_tags == ["artificial_intelligence", "startups"]
    assert "artificial_intelligence" in top.explanation and "Intro to LLMs workshop" in top.explanation
    assert all(0 <= r.score <= 1 for r in recs)
    assert "probab" not in " ".join(r.explanation.lower() for r in recs)
    consult = next(r for r in recs if r.organization_id == "org-consult")
    assert "TIME_FIT" not in consult.reason_codes and "RECRUITING_NOW" not in consult.reason_codes


async def test_recommendation_default_without_preferences(repo, embedder):
    recs = await recommend_clubs(repo, embedder, "nobody")
    assert len(recs) == 3
    assert all(r.reason_codes[0] == "POPULAR_DEFAULT" and "not personalised" in r.explanation.lower() for r in recs)
    await _set_prefs(repo, interest_tags=["hiking"], personalization_enabled=False)
    assert all("POPULAR_DEFAULT" in r.reason_codes for r in await recommend_clubs(repo, embedder, "alice"))


async def test_recommendation_hides_clubs_marked_hide(repo, embedder):
    await _set_prefs(repo, interest_tags=["artificial_intelligence"])
    await repo.add_recommendation_feedback("alice", RecommendationFeedback(organization_id="org-ai", feedback="hide"))
    assert "org-ai" not in [r.organization_id for r in await recommend_clubs(repo, embedder, "alice")]


async def test_fit_check_unknown_without_preferences(repo, embedder):
    fit = await fit_check(repo, embedder, "nobody", "org-ai")
    assert fit.fit_level == "unknown" and 2 <= len(fit.questions_to_ask) <= 3


async def test_fit_check_strong_and_concerns(repo, embedder):
    await _set_prefs(repo, interest_tags=["startups", "artificial_intelligence"], hours_per_week_available=5)
    good = await fit_check(repo, embedder, "alice", "org-ai")
    assert good.fit_level == "strong" and any("startups" in r for r in good.reasons)

    bad = await fit_check(repo, embedder, "alice", "org-consult")
    assert bad.fit_level in ("weak", "possible") and bad.fit_level != "strong"
    joined = " ".join(bad.concerns)
    assert "12 h/week" in joined and "5 h/week" in joined           # time commitment exceeds availability
    assert "closed" in joined.lower()                                # closed recruitment
    assert 2 <= len(bad.questions_to_ask) <= 3

    with pytest.raises(AppError) as err:
        await fit_check(repo, embedder, "alice", "org-missing")
    assert err.value.code == NOT_FOUND and err.value.status_code == 404


def _interest(**over):
    base = dict(organization_id="org-ai", message="I'd love to join.", idempotency_key="key-12345678", user_confirmed=True)
    return ClubInterestCreate(**{**base, **over})


async def test_interest_requires_confirmation(repo):
    with pytest.raises(AppError) as err:
        await submit_club_interest(repo, ALICE, _interest(user_confirmed=False))
    assert err.value.code == CONFIRMATION_REQUIRED
    assert repo.interests == [] and repo.audit == []


async def test_interest_unknown_club_is_404(repo):
    with pytest.raises(AppError) as err:
        await submit_club_interest(repo, ALICE, _interest(organization_id="org-missing"))
    assert err.value.code == NOT_FOUND and err.value.status_code == 404


async def test_interest_is_idempotent_and_audited(repo):
    first = await submit_club_interest(repo, ALICE, _interest())
    again = await submit_club_interest(repo, ALICE, _interest())
    assert first.id == again.id and len(repo.interests) == 1 and len(repo.audit) == 1
    assert repo.audit[0].actor_id == "alice" and repo.audit[0].resource_id == first.id


async def test_interest_retry_repairs_a_failed_audit_write(repo):
    add_audit_log = repo.add_audit_log
    failed = False

    async def fail_once(entry):
        nonlocal failed
        if not failed:
            failed = True
            raise RuntimeError("temporary audit write failure")
        await add_audit_log(entry)

    repo.add_audit_log = fail_once
    with pytest.raises(RuntimeError, match="temporary audit write failure"):
        await submit_club_interest(repo, ALICE, _interest())
    assert len(repo.interests) == 1 and repo.audit == []

    retried = await submit_club_interest(repo, ALICE, _interest())
    assert retried.id == repo.interests[0].id
    assert len(repo.interests) == 1 and len(repo.audit) == 1
    assert repo.audit[0].resource_id == retried.id


async def test_interest_without_share_contact_shares_no_contact(repo):
    private = await submit_club_interest(repo, ALICE, _interest())
    assert private.share_contact is False
    assert "alice@example.edu" not in str(private.consent_snapshot) and "Alice Tran" not in str(private.consent_snapshot)
    assert private.consent_snapshot["shared_fields"] == ["interest_type", "message"]
    assert "alice@example.edu" not in str(repo.audit[0].metadata)

    shared = await submit_club_interest(repo, ALICE, _interest(share_contact=True, idempotency_key="key-abcdefgh"))
    assert shared.consent_snapshot["email"] == "alice@example.edu" and shared.consent_snapshot["display_name"] == "Alice Tran"
    assert shared.consent_snapshot["shared_fields"] == ["interest_type", "message", "display_name", "email"]


# ---------------------------------------------------------------- tools
def test_tool_specs_expose_no_identity_fields():
    for spec in student_tool_specs() + club_tool_specs():
        assert not {"user_id", "role", "user_confirmed"} & set(spec.parameters.get("properties", {}))
    assert all("organization_id" not in s.parameters["properties"] for s in club_tool_specs())


async def test_tool_executor_ignores_model_supplied_user_id(repo, embedder):
    await _set_prefs(repo, user_id="bob", interest_tags=["consulting"])
    res = await execute_tool("get_student_preferences", {"user_id": "bob", "role": "admin"}, actor=ALICE, repo=repo, embedder=embedder)
    assert res.ok and res.data["interest_tags"] == []
    res = await execute_tool("update_student_preferences", {"user_id": "bob", "interest_tags": ["hiking"]},
                             actor=ALICE, repo=repo, embedder=embedder)
    assert res.ok
    assert repo.prefs["alice"].interest_tags == ["hiking"] and repo.prefs["bob"].interest_tags == ["consulting"]


async def test_tool_executor_validation_and_unknown_tool(repo, embedder):
    res = await execute_tool("drop_tables", {}, actor=ALICE, repo=repo, embedder=embedder)
    assert not res.ok and res.error.code == VALIDATION_ERROR
    res = await execute_tool("search_clubs", {"query": "ai", "sql": "select 1"}, actor=ALICE, repo=repo, embedder=embedder)
    assert not res.ok and res.error.code == VALIDATION_ERROR
    res = await execute_tool("get_club_profile", {"organization_id": "org-missing"}, actor=ALICE, repo=repo, embedder=embedder)
    assert not res.ok and res.error.code == NOT_FOUND
    assert summarize_activity("get_club_profile", {}, res).ok is False


async def test_club_scoped_tools_are_pinned_to_that_club(repo, embedder):
    res = await execute_tool("get_club_profile", {"organization_id": "org-consult"}, actor=ALICE, repo=repo, embedder=embedder,
                             scope_org_id="org-ai")
    assert res.ok and res.data["organization_id"] == "org-ai"
    res = await execute_tool("search_clubs", {"query": "x"}, actor=ALICE, repo=repo, embedder=embedder, scope_org_id="org-ai")
    assert not res.ok


async def test_submit_tool_only_returns_pending_confirmation(repo, embedder):
    args = {"organization_id": "org-ai", "message": "hi", "user_confirmed": True}
    res = await execute_tool("submit_club_interest", args, actor=ALICE, repo=repo, embedder=embedder)
    assert res.ok and res.data["submitted"] is False
    assert res.data["pending_confirmation"]["payload"]["share_contact"] is False
    assert repo.interests == []
    assert "confirmation" in summarize_activity("submit_club_interest", args, res).summary


async def test_search_tool_activity_summary(repo, embedder):
    args = {"query": "AI, startups", "interest_tags": []}
    res = await execute_tool("search_clubs", args, actor=ALICE, repo=repo, embedder=embedder)
    assert res.ok and summarize_activity("search_clubs", args, res).summary.startswith("Searched clubs for 'AI, startups'")


async def test_search_ranks_by_words_when_embeddings_are_unavailable(repo):
    """Gemini rate-limited / Ollama down: the embedder is on its placeholder, so ranking must come from
    the club's name, tags and description, not from meaningless placeholder vectors or alphabetical ties."""
    class Degraded(HashEmbedder):
        is_fallback = True
    hits = await search_clubs(repo, Degraded(), "consulting", [], limit=3)
    assert hits[0].club.organization_id == "org-consult"   # name + tag beat a mere mention
    hits = await search_clubs(repo, Degraded(), "hikes outdoors", [], limit=3)
    assert hits[0].club.organization_id == "org-hike"      # "hikes" finds "hiking" by its stem
    hits = await search_clubs(repo, Degraded(), "clubs about startups", [], limit=3)
    assert {h.club.organization_id for h in hits[:2]} == {"org-ai", "org-consult"}  # "clubs" doesn't match everything
