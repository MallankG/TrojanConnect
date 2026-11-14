"""Recommendations + fit check (PRD 10.3). Transparent weighted score over explicit preferences only.
Scores are relevance in [0, 1] - never a probability of joining."""
from typing import Optional

from app.schemas.common import NOT_FOUND, AppError
from app.schemas.student import (
    ClubEvent, ClubProfile, FitCheckResult, Recommendation, StudentPreferences, StudentPreferencesUpdate,
)
from app.services.clubs import club_similarities, club_text, matched_tags
from app.services.preferences import get_preferences, has_signal, merge_preferences
from app.services.text import clamp01, keywords

WEIGHTS = {"tags": 0.35, "semantic": 0.25, "goal": 0.15, "time": 0.15, "recruiting": 0.05, "event": 0.05}
RECRUITING_SCORE = {"open": 1.0, "application": 0.5, "closed": 0.0}
NOT_PERSONALISED = "Not personalised: you haven't shared interests yet (or personalisation is off)."


def _goal_hits(prefs: StudentPreferences, club: ClubProfile) -> list[str]:
    return sorted(w for w in keywords(prefs.goals) & keywords(club_text(club)) if len(w) > 3)


def _time_fit(prefs: StudentPreferences, club: ClubProfile) -> Optional[float]:
    """1.0 when the club's weekly hours fit the student's availability, <1 when they exceed it, None if unknown."""
    avail, need = prefs.hours_per_week_available, club.time_commitment_hours_per_week
    if avail is None or need is None:
        return None
    if need <= avail:
        return 1.0
    return clamp01(1 - (need - avail) / max(avail, 1.0))


def _h(x: float) -> str:
    return f"{x:g}"


async def _upcoming_by_org(repo) -> dict[str, ClubEvent]:
    first: dict[str, ClubEvent] = {}
    for ev in sorted(await repo.list_events(None, True), key=lambda e: e.start_at):
        if ev.visibility == "public":
            first.setdefault(ev.organization_id, ev)
    return first


async def recommend_clubs(repo, embedder, user_id: str, limit: int = 10) -> list[Recommendation]:
    prefs = await get_preferences(repo, user_id)
    feedback = {f.organization_id: f.feedback for f in await repo.list_recommendation_feedback(user_id)}
    clubs = [c for c in await repo.list_clubs() if feedback.get(c.organization_id) != "hide"]  # hard filter
    events = await _upcoming_by_org(repo)
    limit = max(1, min(int(limit or 10), 50))

    if not (prefs.personalization_enabled and has_signal(prefs)):
        recs = []
        for club in clubs:
            recruiting, event = club.recruitment_status == "open", events.get(club.organization_id)
            codes = ["POPULAR_DEFAULT"] + (["RECRUITING_NOW"] if recruiting else []) + (["UPCOMING_EVENT"] if event else [])
            extra = [s for s in ("recruiting now" if recruiting else "", f"upcoming event: {event.title}" if event else "") if s]
            recs.append(Recommendation(
                organization_id=club.organization_id, club_name=club.name,
                score=round(0.3 + 0.1 * recruiting + 0.1 * bool(event), 3), reason_codes=codes,
                explanation=(f"{NOT_PERSONALISED} Shown as a general suggestion"
                             + (f" ({'; '.join(extra)})" if extra else "") + ".")[:500],
            ))
        recs.sort(key=lambda r: (-r.score, r.club_name))
        return recs[:limit]

    query = " ".join([" ".join(t.replace("_", " ") for t in prefs.interest_tags), prefs.goals]).strip()
    sims = await club_similarities(repo, embedder, query, clubs)
    mean_sim = sum(sims.values()) / len(sims) if sims else 0.0
    recs = []
    for club in clubs:
        tags = matched_tags(club, prefs.interest_tags)
        goal_hits = _goal_hits(prefs, club)
        sim, time_fit = sims[club.organization_id], _time_fit(prefs, club)
        event = events.get(club.organization_id)
        features = {
            "tags": min(1.0, len(tags) / max(1, min(len(prefs.interest_tags), 3))),
            "semantic": sim,
            "goal": min(1.0, len(goal_hits) / 2),
            "time": 0.5 if time_fit is None else time_fit,
            "recruiting": RECRUITING_SCORE[club.recruitment_status],
            "event": 1.0 if event else 0.0,
        }
        score = sum(WEIGHTS[k] * v for k, v in features.items())
        if feedback.get(club.organization_id) == "not_relevant":
            score *= 0.5
        codes, why = [], []
        if tags:
            codes.append("INTEREST_TAG_MATCH")
            why.append(f"matches your interests in {', '.join(tags)}")
        if sim >= 0.3 and sim >= mean_sim:
            codes.append("SEMANTIC_MATCH")
            if not tags:
                why.append("its description is close to what you said you're looking for")
        if goal_hits:
            codes.append("GOAL_MATCH")
            why.append(f"relates to your goals ({', '.join(goal_hits[:4])})")
        if time_fit == 1.0:
            codes.append("TIME_FIT")
            why.append(f"about {_h(club.time_commitment_hours_per_week)} h/week fits your {_h(prefs.hours_per_week_available)} h/week")
        elif time_fit is not None:
            why.append(f"note: about {_h(club.time_commitment_hours_per_week)} h/week is more than your {_h(prefs.hours_per_week_available)} h/week")
        if club.recruitment_status != "closed":
            codes.append("RECRUITING_NOW")
            why.append("recruiting now" if club.recruitment_status == "open" else "accepting applications")
        if event:
            codes.append("UPCOMING_EVENT")
            why.append(f"upcoming event: {event.title}")
        explanation = (f"{club.name}: " + "; ".join(why) + ".") if why else f"{club.name}: weak match with your stated interests."
        recs.append(Recommendation(
            organization_id=club.organization_id, club_name=club.name, score=round(clamp01(score), 4),
            reason_codes=codes or ["SEMANTIC_MATCH"], matched_tags=tags, explanation=explanation[:500],
        ))
    recs.sort(key=lambda r: (-r.score, r.club_name))
    return recs[:limit]


async def fit_check(repo, embedder, user_id: str, organization_id: str,
                    overrides: Optional[StudentPreferencesUpdate] = None) -> FitCheckResult:
    """Deterministic 'is this club a fit for me?'. `overrides` are things the student just said in
    conversation; they are used for this check only and are not saved."""
    club = await repo.get_club(organization_id)
    if club is None:
        raise AppError(NOT_FOUND, "Club not found.", status_code=404)
    prefs = await get_preferences(repo, user_id)
    if overrides is not None:
        prefs = merge_preferences(prefs, overrides)

    questions = []
    if club.time_commitment or club.time_commitment_hours_per_week is not None:
        questions.append("What does a typical week look like for a new member?")
    else:
        questions.append("How much time do members usually spend per week?")
    questions.append("How selective is the application, and what do you look for?" if club.recruitment_status == "application"
                     else "Is the club beginner-friendly, or do I need prior experience?")
    questions.append("What are the best first events or projects to get involved in?")

    if not has_signal(prefs) and prefs.hours_per_week_available is None:
        return FitCheckResult(
            organization_id=organization_id, fit_level="unknown",
            reasons=["You haven't shared interests, goals or available time yet, so fit can't be assessed."],
            questions_to_ask=questions,
        )

    reasons, concerns, points = [], [], 0
    tags, goal_hits, time_fit = matched_tags(club, prefs.interest_tags), _goal_hits(prefs, club), _time_fit(prefs, club)
    if tags:
        points += 2 if len(tags) >= 2 else 1
        reasons.append(f"Your interests match the club's tags: {', '.join(tags)}.")
    elif prefs.interest_tags:
        concerns.append(f"None of your stated interests ({', '.join(prefs.interest_tags[:5])}) appear in the club's tags "
                        f"({', '.join(club.tags[:5]) or 'none listed'}).")
    if goal_hits:
        points += 1
        reasons.append(f"Your goals overlap with what the club does ({', '.join(goal_hits[:4])}).")
    if time_fit == 1.0:
        points += 1
        reasons.append(f"The time commitment (~{_h(club.time_commitment_hours_per_week)} h/week) fits your "
                       f"{_h(prefs.hours_per_week_available)} h/week.")
    elif time_fit is not None:
        points -= 2 if time_fit < 0.5 else 1
        concerns.append(f"The club expects about {_h(club.time_commitment_hours_per_week)} h/week, more than the "
                        f"{_h(prefs.hours_per_week_available)} h/week you have available.")
    elif prefs.hours_per_week_available is not None:
        concerns.append("The club's profile doesn't state weekly hours, so time fit is unknown - ask them.")
    if club.recruitment_status == "closed":
        points -= 1
        concerns.append("Recruitment is currently closed, so you may not be able to join right now.")
    elif club.recruitment_status == "application":
        concerns.append("Joining requires an application; admission is not guaranteed.")
    else:
        reasons.append("The club is open to new members right now.")
    if club.membership_requirements:
        concerns.append(f"Check the membership requirements: {club.membership_requirements[:200]}")

    blocking = time_fit is not None and time_fit < 1.0 or club.recruitment_status == "closed"
    level = "strong" if points >= 3 and not blocking else "possible" if points >= 1 else "weak"
    return FitCheckResult(organization_id=organization_id, fit_level=level, reasons=reasons[:8],
                          concerns=concerns[:8], questions_to_ask=questions[:3])
