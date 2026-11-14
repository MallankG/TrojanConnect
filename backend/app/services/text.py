"""Small text helpers shared by the student-side services (no ML, deterministic)."""
import math
import re

STOPWORDS = frozenset(
    "a an and are as at be but by can club clubs do does for from get have how i if in into is it its like me my of on "
    "or our so that the their them there they this to up us usc want was we what when where which who why will with "
    "would you your about any tell more some am im also just really very much many should could".split()
)


def normalize_tag(tag: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", tag.strip().lower()).strip("_")


def normalize_tags(tags: list[str]) -> list[str]:
    out: list[str] = []
    for tag in tags or []:
        norm = normalize_tag(str(tag))
        if norm and norm not in out:
            out.append(norm)
    return out


def _stem(word: str) -> str:
    return word[:-1] if len(word) > 3 and word.endswith("s") and not word.endswith("ss") else word


def tokens(text: str) -> list[str]:
    return [_stem(w) for w in re.findall(r"[a-z0-9]+", (text or "").lower())]


def keywords(text: str) -> set[str]:
    return {t for t in tokens(text) if t not in STOPWORDS and len(t) > 1}


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na, nb = math.sqrt(sum(x * x for x in a)), math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))
