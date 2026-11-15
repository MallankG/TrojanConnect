"""Club search: embedding similarity blended with tag/keyword overlap (PRD 9.4 search_clubs)."""
import hashlib
import logging

from app.schemas.student import ClubProfile, ClubSearchHit
from app.services.text import clamp01, cosine, keywords, normalize_tags

log = logging.getLogger(__name__)

# Per-process cache: {embedding space: {(organization_id, text hash): vector}}
_EMBED_CACHE: dict[str, dict[tuple[str, str], list[float]]] = {}

# How many clubs may be embedded in-process for one search when no vector index is available.
PREFILTER_LIMIT = 150


def _text_hash(club: ClubProfile) -> str:
    return hashlib.sha1(club_text(club).encode()).hexdigest()


def _prefilter(query: str, clubs: list[ClubProfile], cache: dict) -> list[ClubProfile]:
    """Cheap keyword/tag overlap to choose which clubs are worth embedding. Clubs already in
    the cache cost nothing, so they stay in. Returns at most PREFILTER_LIMIT clubs."""
    if len(clubs) <= PREFILTER_LIMIT:
        return clubs
    q = keywords(query)
    scored = []
    for club in clubs:
        if (club.organization_id, _text_hash(club)) in cache:
            scored.append((2.0, club))
            continue
        overlap = len(q & keywords(club_text(club)))
        if overlap:
            scored.append((overlap / max(len(q), 1), club))
    scored.sort(key=lambda pair: (-pair[0], pair[1].name))
    return [club for _, club in scored[:PREFILTER_LIMIT]]


def club_text(club: ClubProfile) -> str:
    """Public text that represents a club for retrieval."""
    return " ".join(
        [club.name, club.category, " ".join(club.tags), club.public_description,
         " ".join(club.activities), club.who_thrives_here]
    ).strip()


def _space(embedder) -> str:
    return getattr(embedder, "space", type(embedder).__name__)


async def club_similarities(repo, embedder, query: str, clubs: list[ClubProfile]) -> dict[str, float]:
    """organization_id -> cosine similarity with `query` (0 for everything if the query is empty).

    Order matters for cost. The query is embedded first; if the repository has a vector index
    (pgvector via repo.match_clubs) that one vector answers the whole search. Only when there
    is no index do club vectors get embedded in-process, and then only for PREFILTER_LIMIT
    candidates picked by cheap keyword/tag overlap - embedding a 2,000-club directory on every
    search would be slow and, on a paid embedding API, expensive.
    """
    if not query.strip() or not clubs:
        return {c.organization_id: 0.0 for c in clubs}
    zero = {c.organization_id: 0.0 for c in clubs}
    try:
        for _ in range(2):  # retry once if the embedder switched to its fallback mid-call
            space = _space(embedder)
            query_vec = (await embedder.embed([query]))[0]
            if _space(embedder) != space:
                continue

            if not getattr(embedder, "is_fallback", False):
                matched = await repo.match_clubs(query_vec, len(clubs))
                if matched is not None:
                    found = {org_id: clamp01(sim) for org_id, sim in matched}
                    return {c.organization_id: found.get(c.organization_id, 0.0) for c in clubs}

            cache = _EMBED_CACHE.setdefault(space, {})
            candidates = _prefilter(query, clubs, cache)
            keyed = [((c.organization_id, _text_hash(c)), c) for c in candidates]
            missing = [(k, c) for k, c in keyed if k not in cache]
            if missing:
                vectors = await embedder.embed([club_text(c) for _, c in missing])
                if _space(embedder) != space:
                    continue
                for (key, _), vec in zip(missing, vectors):
                    cache[key] = vec
            return {**zero, **{c.organization_id: clamp01(cosine(query_vec, cache[k])) for k, c in keyed}}
    except Exception:  # never let retrieval break search; tag/keyword overlap still works
        log.exception("club similarity failed; continuing with tag/keyword overlap only")
    return zero


def matched_tags(club: ClubProfile, interest_tags: list[str]) -> list[str]:
    club_tags = set(normalize_tags(club.tags + [club.category]))
    return [t for t in normalize_tags(interest_tags) if t in club_tags]


async def search_clubs(repo, embedder, query: str, interest_tags: list[str], limit: int = 10) -> list[ClubSearchHit]:
    clubs = await repo.list_clubs()
    tags = normalize_tags(interest_tags or [])
    query = (query or "").strip()
    limit = max(1, min(int(limit or 10), 50))
    if not query and not tags:
        return [ClubSearchHit(club=c, score=0.0) for c in sorted(clubs, key=lambda c: c.name)[:limit]]

    sims = await club_similarities(repo, embedder, " ".join([query, " ".join(t.replace("_", " ") for t in tags)]), clubs)
    q_words = keywords(query) | {w for t in tags for w in t.split("_")}
    hits: list[ClubSearchHit] = []
    for club in clubs:
        matched = matched_tags(club, tags)
        # query words that literally appear in the club's tags also count as matched tags
        for tag in normalize_tags(club.tags):
            if tag not in matched and set(tag.split("_")) <= q_words:
                matched.append(tag)
        tag_score = min(1.0, len(matched) / max(1, min(len(tags) or 1, 3)))
        kw_score = len(q_words & keywords(club_text(club))) / len(q_words) if q_words else 0.0
        score = clamp01(0.45 * sims[club.organization_id] + 0.35 * tag_score + 0.20 * kw_score)
        if score > 0.05:
            hits.append(ClubSearchHit(club=club, score=round(score, 4), matched_tags=matched))
    hits.sort(key=lambda h: (-h.score, h.club.name))
    return hits[:limit]
