"""Deterministic input/output guardrails (PRD 8.1). Cheap heuristics, applied on every turn."""
import re
from dataclasses import dataclass, field

from app.agents import prompts

MAX_INPUT_CHARS = 4000
MAX_OUTPUT_CHARS = 6000

_INJECTION_RE = re.compile(
    r"ignore (all |any |the )?(previous|prior|above|earlier) (instructions|rules|prompts?)|disregard (all |your |the )?(previous |prior )?(instructions|rules)|"
    r"forget (all |your )?(previous |prior )?(instructions|rules)|you are now\b|pretend (to be|you are)|\bjailbreak\b|developer mode|"
    r"\bDAN\b|override (your|the) (rules|instructions|system)|^\s*system\s*:|new instructions:", re.I | re.M)
_PROMPT_LEAK_RE = re.compile(
    r"(reveal|show|print|repeat|display|output|share|leak|give me|tell me|what(?:'s| is| are| were))\b.{0,60}"
    r"(system prompt|system message|initial prompt|hidden (prompt|instructions)|developer (message|prompt)|"
    r"your (exact |full |original |initial |secret )?(instructions|prompt|rules|guidelines|configuration))|"
    r"\b(api[ _-]?key|secret key|service role key|access token|password)s?\b", re.I | re.S)
_OTHER_USERS_RE = re.compile(
    r"(other|another|someone else'?s?|all|every|which) (students?|users?|members?|people)('s|')?\b.{0,50}"
    r"(preferences|emails?|data|messages|conversations?|chats?|interests?|contact|profiles?|names?)|"
    r"\b(member|membership) (list|roster)\b|who (else )?(has |have )?(joined|applied|expressed interest|submitted)", re.I | re.S)
_ACTION_CLAIM_RE = re.compile(
    r"\b(i|we)(?:'ve| have)? (?:just |already |now |successfully )*(submitted|sent|shared|registered|enrolled|signed you up|added you|applied)\b|"
    r"\b(interest|application|request|contact details?|email)\b[^.!?\n]{0,30}\b(has|have) been (successfully )?(submitted|sent|shared|received|recorded)|"
    r"\b(was|were|is|are) (successfully |now )(submitted|sent|shared)\b|"
    r"you(?:'re| are) (now )?(a member|signed up|registered|enrolled|in!)|successfully submitted", re.I)

REFUSAL = ("I can't help with that. I can't share my instructions, internal details or anyone else's information - "
           "but I'm happy to help with clubs: finding them, what they do, time commitment, or how to join.")
NOT_SUBMITTED_NOTE = "To be clear: nothing has been submitted or shared yet - that only happens after you confirm."


def refusal_message() -> str:
    return REFUSAL


@dataclass
class InputCheck:
    text: str                      # sanitised (length-capped) user text
    flagged: bool = False          # looks like prompt injection: still answered, with extra caution
    refuse: bool = False           # asks for system prompt / secrets / other users' data: fixed refusal
    reasons: list[str] = field(default_factory=list)


def check_input(text: str) -> InputCheck:
    clean = "".join(ch for ch in (text or "") if ch in "\n\t" or ord(ch) >= 32).strip()
    check = InputCheck(text=clean[:MAX_INPUT_CHARS])
    if len(clean) > MAX_INPUT_CHARS:
        check.reasons.append("truncated")
    if _INJECTION_RE.search(clean):
        check.flagged = True
        check.reasons.append("prompt_injection")
    if _PROMPT_LEAK_RE.search(clean):
        check.refuse = True
        check.reasons.append("prompt_or_secret_request")
    if _OTHER_USERS_RE.search(clean):
        check.refuse = True
        check.reasons.append("other_users_data")
    return check


def _leaks_prompt(text: str) -> bool:
    low = " ".join(text.lower().split())
    for rules in (prompts.GLOBAL_RULES, prompts.STUDENT_RULES, prompts.CLUB_RULES):
        for line in rules.splitlines():
            line = " ".join(line.lower().strip("- ").split())
            if len(line) >= 50 and line[:80] in low:
                return True
    return "_data>" in low


def check_output(text: str, *, action_succeeded: bool = False) -> str:
    """Block prompt leaks and remove claims of a completed write that no successful tool result backs."""
    text = (text or "").strip()
    if _leaks_prompt(text):
        return REFUSAL
    if not action_succeeded and _ACTION_CLAIM_RE.search(text):
        kept = [s for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s and not _ACTION_CLAIM_RE.search(s)]
        text = " ".join(kept + [NOT_SUBMITTED_NOTE]).strip()
    return text[:MAX_OUTPUT_CHARS]
