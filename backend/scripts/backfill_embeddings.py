"""Compute club embeddings and store them in Supabase so search runs as a pgvector query.

Why this exists: without stored vectors the backend has to embed every club in-process on
each search, which is fine for the offline fallback embedder but slow and costly against a
paid embedding API once the directory is ~2,000 clubs. With vectors in the database a search
embeds only the query and `match_clubs` does the rest.

Usage (from backend/, with SUPABASE_* and the selected embedding provider configured in .env):
    python scripts/backfill_embeddings.py              # embed clubs missing a vector
    python scripts/backfill_embeddings.py --all        # re-embed every club
    python scripts/backfill_embeddings.py --limit 50   # stop after N clubs (cost control)
    python scripts/backfill_embeddings.py --dry-run    # report what would happen

Re-run after changing club data. The embedding model must match the vector(768) column and
the model the backend queries with, or `match_clubs` returns nothing useful.
"""
from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.config import get_settings  # noqa: E402
from app.integrations.gemini.client import build_embedder  # noqa: E402
from app.repositories.memory import load_seed_clubs, resolve_dataset  # noqa: E402
from app.services.clubs import club_text  # noqa: E402

BATCH = 25  # small enough for the free tier's per-minute quota
PACE = 20  # seconds between calls
RATE_LIMIT_WAIT = 65  # seconds; free-tier quotas are per minute
PAGE_SIZE = 1000


def _fetch_embedding_rows(client: Any) -> list[dict[str, Any]]:
    rows = []
    offset = 0
    while True:
        page = client.table("club_profiles").select("organization_id, embedding") \
            .order("organization_id").range(offset, offset + PAGE_SIZE - 1).execute().data or []
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += len(page)


async def _embed_batch(embedder: Any, texts: list[str], attempts: int = 8) -> list[list[float]]:
    """Embed one batch, waiting out per-minute rate limits. Never returns fallback (placeholder) vectors."""
    for attempt in range(attempts):
        try:
            vectors = await embedder.embed(texts)
        except Exception as e:  # show which quota was hit (per minute or per day)
            detail = re.sub(r"\s+", " ", str(e))
            print("  quota:", detail[detail.find("Quota exceeded"):][:300] if "Quota exceeded" in detail else detail[:200], flush=True)
            if "per day" in detail:  # waiting won't help until the daily reset (midnight Pacific)
                raise RuntimeError("Daily embedding quota used up; resume tomorrow or with another key.") from e
        else:
            if getattr(embedder, "is_fallback", False):
                raise RuntimeError("Embedding provider fell back; refusing to store fallback vectors.")
            return vectors
        print(f"  rate-limited; waiting {RATE_LIMIT_WAIT} s (attempt {attempt + 1}/{attempts})", flush=True)
        await asyncio.sleep(RATE_LIMIT_WAIT)
    raise RuntimeError("Embedding provider kept failing; refusing to store fallback vectors.")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="re-embed clubs that already have a vector")
    parser.add_argument("--limit", type=int, default=0, help="stop after this many clubs")
    parser.add_argument("--dataset", default="auto", choices=["auto", "demo", "real"])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--start", type=int, default=0, help="skip the first N clubs (resume a stopped run)")
    args = parser.parse_args()

    settings = get_settings()
    if not settings.use_supabase:
        print("No Supabase credentials in .env - nothing to back fill. "
              "The in-memory repository embeds on demand instead.")
        return 1

    embedder = build_embedder(settings)
    if getattr(embedder, "is_fallback", False):
        print("WARNING: no GEMINI_API_KEY, so this would store offline placeholder vectors.\n"
              "Set GEMINI_API_KEY (the backend must query with the same model) and re-run.")
        return 1

    # The provider itself, not the app's wrapper: the wrapper would quietly switch to placeholder vectors
    # on a rate limit, while the provider raises and _embed_batch waits and retries.
    embedder = getattr(embedder, "primary", embedder)

    from supabase import create_client
    client = create_client(settings.supabase_url, settings.supabase_service_role_key)

    dataset = resolve_dataset(args.dataset)
    clubs = load_seed_clubs(dataset)
    rows = _fetch_embedding_rows(client)
    present = {r["organization_id"] for r in rows}
    have_vector = {r["organization_id"] for r in rows if r.get("embedding") is not None}

    todo = [c for c in clubs
            if c.organization_id in present and (args.all or c.organization_id not in have_vector)]
    missing_rows = [c.organization_id for c in clubs if c.organization_id not in present]
    if missing_rows:
        print(f"{len(missing_rows)} clubs have no club_profiles row yet "
              f"(apply supabase/seed.sql for the {dataset} dataset first); skipping them.")
    todo = todo[args.start:]
    if args.limit:
        todo = todo[:args.limit]
    print(f"dataset={dataset} clubs={len(clubs)} with_vector={len(have_vector)} to_embed={len(todo)}")
    if args.dry_run or not todo:
        return 0

    done = 0
    for start in range(0, len(todo), BATCH):
        batch = todo[start:start + BATCH]
        try:
            vectors = await _embed_batch(embedder, [club_text(c) for c in batch])
        except RuntimeError:
            print(f"stopped: clubs {args.start + 1}-{args.start + done} stored; resume with --start {args.start + done}", flush=True)
            raise
        for club, vector in zip(batch, vectors):
            client.table("club_profiles").update({"embedding": [float(x) for x in vector]}) \
                  .eq("organization_id", club.organization_id).execute()
        done += len(batch)
        print(f"  {args.start + done}/{args.start + len(todo)} embedded", flush=True)
        await asyncio.sleep(PACE)
    print(f"done: {done} club embeddings stored ({getattr(embedder, 'dimensions', '?')} dims)")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
