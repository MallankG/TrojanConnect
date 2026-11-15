"""Turn the scraped EngageSC directory listing into minimal ClubProfile records.

Two tiers make up the "real" dataset:
  seed/real/clubs.json      rich profiles collected page by page (club agents chat as these)
  seed/real/directory.json  every other publicly listed org, from the directory listing only

A directory-tier profile carries just what the listing states: name, category and the org's
own summary. Every other field stays empty, so a club agent asked about history or dues
answers "the public profile doesn't cover that" instead of inventing an answer.

Usage: python scripts/build_real_directory.py [--check]
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas.student import ClubProfile  # noqa: E402

SEED_REAL = Path(__file__).resolve().parents[1] / "app" / "repositories" / "seed" / "real"
COLLECTED_AT = "2026-11-14"
LISTING_URL = "https://engage.usc.edu/club_signup?view=all"

# A tag is added only when the phrase literally appears in the org's own listing text,
# so the label stays traceable to what the page says.
KEYWORD_TAGS: dict[str, tuple[str, ...]] = {
    "artificial_intelligence": ("artificial intelligence", " ai ", "machine learning", "deep learning"),
    "machine_learning": ("machine learning", "neural network"),
    "data_science": ("data science", "data analytics", "statistics"),
    "software_engineering": ("software", "coding", "programming", "web development", "app development"),
    "cybersecurity": ("cybersecurity", "cyber security", "capture the flag"),
    "robotics": ("robotics", "robot"),
    "aerospace": ("aerospace", "rocket", "satellite", "aviation"),
    "entrepreneurship": ("entrepreneur", "startup", "venture", "founder"),
    "consulting": ("consulting", "consultant"),
    "finance": ("finance", "investment", "investing", "trading", "banking", "private equity"),
    "marketing": ("marketing", "advertising", "branding"),
    "pre_med": ("pre-med", "premed", "pre-health", "medical school"),
    "public_health": ("public health", "global health"),
    "research": ("research", "laboratory", "journal"),
    "community_service": ("community service", "volunteer", "service", "philanthropy", "mentorship", "tutoring"),
    "sustainability": ("sustainability", "environmental", "climate", "conservation"),
    "advocacy": ("advocacy", "activism", "policy", "justice", "equity"),
    "dance": ("dance", "dancing", "choreograph"),
    "music": ("music", "a cappella", "orchestra", "band", "singing", "choir"),
    "theatre": ("theatre", "theater", "improv", "sketch comedy", "acting"),
    "film": ("film", "cinema", "filmmaking", "screenwriting"),
    "design": ("design", "ux", "graphic"),
    "photography": ("photography", "photographer"),
    "writing": ("writing", "literary", "poetry", "journalism"),
    "gaming": ("gaming", "esports", "video game", "game development", "board game"),
    "sports": ("sports", "athletic", "soccer", "basketball", "tennis", "volleyball", "running", "swimming"),
    "outdoors": ("hiking", "outdoors", "climbing", "surf", "ski", "camping"),
    "martial_arts": ("martial arts", "taekwondo", "karate", "jiu-jitsu", "boxing", "fencing"),
    "fitness": ("fitness", "workout", "weightlifting", "yoga"),
    "wellness": ("wellness", "mental health", "mindfulness", "self-care"),
    "faith": ("christian", "muslim", "jewish", "hindu", "buddhist", "faith", "bible", "worship"),
    "cultural": ("cultural", "heritage", "diaspora"),
    "language": ("language", "bilingual", "linguistic"),
    "law": ("law", "legal", "mock trial", "pre-law"),
    "education": ("education", "teaching", "k-12", "classroom"),
    "engineering": ("engineering", "engineer"),
    "food": ("food", "cooking", "culinary", "baking"),
    "social": ("social", "networking", "community building", "friendship"),
    "professional_development": ("professional development", "career", "internship", "resume"),
    "greek_life": ("fraternity", "sorority", "greek"),
    "graduate_students": ("graduate student", "phd", "doctoral", "master's"),
}


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return slug or "org"


def snake(value: str) -> str:
    out = re.sub(r"[^a-z0-9]+", "_", (value or "").lower()).strip("_")
    return out


def derive_tags(name: str, category: str, summary: str) -> list[str]:
    tags: list[str] = []
    for part in re.split(r"[,/&]| and ", category or ""):
        tag = snake(part)
        if tag and tag not in tags:
            tags.append(tag)
    haystack = f" {name} {category} {summary} ".lower()
    for tag, phrases in KEYWORD_TAGS.items():
        if tag in tags:
            continue
        if any(p in haystack for p in phrases):
            tags.append(tag)
    return tags[:20]


def directory_profile(entry: dict, used_ids: set[str], used_slugs: set[str]) -> ClubProfile | None:
    name = (entry.get("name") or "").strip()
    url = (entry.get("url") or "").strip()
    if not name:
        return None
    # The listing's URL column is either the group's EngageSC page or the org's own site.
    # Those self-published domains are frequently stale: in a sample of ~25 taken from this
    # listing, 12 were dead and 2 had been re-registered by unrelated third parties (a
    # domain-parking page and a gambling site). So an external URL is recorded nowhere and
    # never shown as the club's website; only an EngageSC page, which is always live, is.
    on_engage = "engage.usc.edu" in url.lower()
    engage_url = url if on_engage else ""
    # EngageSC group URLs end in the group's own key: .../WCCsc/
    key = slugify(url.rstrip("/").rsplit("/", 1)[-1]) if on_engage else slugify(name)
    key = key or slugify(name)
    slug, org_id = key, f"usc-{key}"
    n = 2
    while org_id in used_ids or slug in used_slugs:
        slug, org_id = f"{key}-{n}", f"usc-{key}-{n}"
        n += 1
    category = (entry.get("category") or "").strip() or "Student organization"
    summary = re.sub(r"\s+", " ", (entry.get("summary") or "").strip())[:1900]
    return ClubProfile(
        organization_id=org_id,
        name=name[:120],
        slug=slug[:120],
        category=category[:60],
        tags=derive_tags(name, category, summary),
        public_description=summary,
        # The listing never states recruitment state, so leave it "unknown" (the default)
        # rather than letting an agent tell a student the club is recruiting.
        recruitment_status="unknown",
        verification_status="unverified",
        data_label="public_web",
        website=engage_url[:300],
        source_urls=[u for u in (LISTING_URL, engage_url) if u],
        collected_at=COLLECTED_AT,
    )


def build() -> list[ClubProfile]:
    directory = json.loads((SEED_REAL / "engage_directory.json").read_text("utf-8"))
    rich_path = SEED_REAL / "clubs.json"
    rich = json.loads(rich_path.read_text("utf-8")) if rich_path.is_file() else []
    # Skip orgs that already have a rich profile, matched on name and on EngageSC URL.
    rich_names = {(c.get("name") or "").strip().lower() for c in rich}
    rich_urls = {u.rstrip("/").lower() for c in rich for u in (c.get("source_urls") or []) + [c.get("website") or ""] if u}
    used_ids = {c.get("organization_id") for c in rich}
    used_slugs = {c.get("slug") for c in rich}

    profiles: list[ClubProfile] = []
    for entry in directory:
        name = (entry.get("name") or "").strip().lower()
        url = (entry.get("url") or "").rstrip("/").lower()
        if name in rich_names or (url and url in rich_urls):
            continue
        profile = directory_profile(entry, used_ids, used_slugs)
        if profile is None:
            continue
        used_ids.add(profile.organization_id)
        used_slugs.add(profile.slug)
        profiles.append(profile)
    profiles.sort(key=lambda p: p.name.lower())
    return profiles


def main() -> None:
    profiles = build()
    out = SEED_REAL / "directory.json"
    payload = [p.model_dump(mode="json") for p in profiles]
    if "--check" in sys.argv:
        existing = json.loads(out.read_text("utf-8")) if out.is_file() else None
        print(f"{len(payload)} directory profiles; file {'matches' if existing == payload else 'DIFFERS'}")
        return
    out.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out} with {len(payload)} directory-tier profiles")


if __name__ == "__main__":
    main()
