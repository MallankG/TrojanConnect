"""Gemini implementations of LLMClient/Embedder plus deterministic no-key fallbacks.

build_llm / build_embedder return Gemini wrapped in a Resilient* layer when a key is configured
(any provider error falls back to the deterministic versions), else the fallbacks directly."""
import hashlib
import json
import logging
import math
import re
import time
from typing import Any, Optional
from uuid import uuid4

from app.integrations.llm import ChatMessage, Embedder, LLMClient, LLMResponse, ToolCall, ToolSpec

log = logging.getLogger(__name__)
EMBED_DIMS = 768


def _l2(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec))
    return [v / norm for v in vec] if norm else vec


# ------------------------------------------------------------------ Gemini
class GeminiLLM:
    is_fallback = False

    def __init__(self, settings):
        from google import genai
        from google.genai import types

        self._types = types
        self.model = settings.gemini_chat_model
        self._client = genai.Client(
            api_key=settings.gemini_api_key,
            http_options=types.HttpOptions(api_version=settings.gemini_api_version, timeout=45_000),
        )
        self._signatures: dict[str, bytes] = {}  # tool_call id -> thought signature (must be replayed)

    def _contents(self, messages: list[ChatMessage]) -> list[Any]:
        t = self._types
        contents: list[Any] = []

        def add(role: str, parts: list[Any]) -> None:
            if not parts:
                return
            if contents and contents[-1].role == role:  # Gemini wants alternating turns
                contents[-1].parts.extend(parts)
            else:
                contents.append(t.Content(role=role, parts=parts))

        for m in messages:
            if m.role == "user":
                add("user", [t.Part(text=m.content)] if m.content else [])
            elif m.role == "assistant":
                parts = [t.Part(text=m.content)] if m.content else []
                for call in m.tool_calls:
                    remote_id = None if call.id.startswith("local-") else call.id
                    parts.append(t.Part(function_call=t.FunctionCall(name=call.name, args=call.args, id=remote_id),
                                        thought_signature=self._signatures.get(call.id)))
                add("model", parts)
            else:  # tool result
                try:
                    payload = json.loads(m.content)
                except ValueError:
                    payload = m.content
                remote_id = None if (m.tool_call_id or "local-").startswith("local-") else m.tool_call_id
                add("user", [t.Part(function_response=t.FunctionResponse(
                    name=m.tool_name or "tool", id=remote_id, response={"result": payload}))])
        return contents

    async def generate(self, *, system: str, messages: list[ChatMessage], tools: Optional[list[ToolSpec]] = None,
                       response_schema: Optional[dict[str, Any]] = None, temperature: float = 0.4) -> LLMResponse:
        t = self._types
        config = t.GenerateContentConfig(system_instruction=system, temperature=temperature)
        if tools:
            config.tools = [t.Tool(function_declarations=[
                t.FunctionDeclaration(name=s.name, description=s.description, parameters_json_schema=s.parameters)
                for s in tools
            ])]
            config.automatic_function_calling = t.AutomaticFunctionCallingConfig(disable=True)
        if response_schema is not None:
            config.response_mime_type = "application/json"
            config.response_json_schema = response_schema
        resp = await self._client.aio.models.generate_content(
            model=self.model, contents=self._contents(messages), config=config)

        text_parts, calls = [], []
        candidates = resp.candidates or []
        for part in (candidates[0].content.parts if candidates and candidates[0].content else None) or []:
            if part.function_call is not None:
                call_id = part.function_call.id or f"local-{uuid4().hex[:12]}"
                if part.thought_signature:
                    if len(self._signatures) > 2000:
                        self._signatures.clear()
                    self._signatures[call_id] = part.thought_signature
                calls.append(ToolCall(id=call_id, name=part.function_call.name or "", args=dict(part.function_call.args or {})))
            elif part.text and not part.thought:
                text_parts.append(part.text)
        usage = resp.usage_metadata
        return LLMResponse(
            text="".join(text_parts).strip(), tool_calls=calls, model=self.model, is_fallback=False,
            usage={"prompt_tokens": getattr(usage, "prompt_token_count", None),
                   "output_tokens": getattr(usage, "candidates_token_count", None)} if usage else {},
        )


class GeminiEmbedder:
    dimensions = EMBED_DIMS
    is_fallback = False

    def __init__(self, settings):
        from google import genai
        from google.genai import types

        self._types = types
        self.model = settings.gemini_embedding_model
        self.space = f"gemini:{self.model}"
        self._client = genai.Client(
            api_key=settings.gemini_api_key,
            http_options=types.HttpOptions(api_version=settings.gemini_api_version, timeout=30_000),
        )

    async def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        config = self._types.EmbedContentConfig(output_dimensionality=self.dimensions)
        for i in range(0, len(texts), 100):
            resp = await self._client.aio.models.embed_content(
                model=self.model, contents=[t or " " for t in texts[i:i + 100]], config=config)
            out.extend(_l2(list(e.values or [])) for e in resp.embeddings or [])
        if len(out) != len(texts):
            raise RuntimeError("Gemini returned an unexpected number of embeddings")
        return out


# ------------------------------------------------------------------ Hash embedder
class HashEmbedder:
    """Deterministic bag-of-words hashing embedder (unigrams + bigrams), L2-normalised."""
    dimensions = EMBED_DIMS
    is_fallback = True
    space = "hash-bow-v1"

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]

    def _one(self, text: str) -> list[float]:
        vec = [0.0] * self.dimensions
        words = [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in re.findall(r"[a-z0-9]+", (text or "").lower())]
        for feature in words + [f"{a}_{b}" for a, b in zip(words, words[1:])]:
            digest = hashlib.md5(feature.encode()).digest()
            vec[int.from_bytes(digest[:4], "big") % self.dimensions] += 1.0 if digest[4] & 1 else -1.0
        return _l2(vec)


# ------------------------------------------------------------------ Rule-based LLM
_SUBMIT_RE = re.compile(
    r"(submit|express|register|send|share)\b.{0,30}\binterest|sign me up|count me in|"
    r"\bi(?:'d| would)? (?:like|love|want) to (?:join|apply)|interested in joining|\bi want in\b", re.I)
_FIT_RE = re.compile(r"\bfit\b|right for me|good match|should i join|suit me|for someone like me", re.I)
_EVENT_RE = re.compile(r"\bevents?\b|what'?s happening|coming up|upcoming", re.I)
_PROFILE_RE = re.compile(r"tell me about|what does|describe|how do i join|how can i join", re.I)
_RECOMMEND_RE = re.compile(r"recommend|suggest|for me\b|which clubs? should|what clubs? should|match me", re.I)
_SEARCH_RE = re.compile(r"\bfind\b|search|looking for|any clubs?|what clubs?\b|which clubs?\b|clubs? (about|for|related|on|work|do|have)\b|show me", re.I)
_COMPARE_RE = re.compile(r"compare|\bvs\.?\b|versus|difference between", re.I)
_PREFS_GET_RE = re.compile(r"my (preferences|profile|interests)\b|what do you know about me", re.I)
_INTEREST_PHRASE_RE = re.compile(
    r"(?:interested in|i like|i love|i enjoy|i'm into|i am into|my interests (?:are|include)|passionate about)\s+([^.!?\n]+)", re.I)
_GOAL_RE = re.compile(r"[^.!?\n]*\b(?:my goal|i want to (?:learn|build|meet|get|become|grow|make|find a)|hoping to|i'd like to (?:learn|build|meet))\b[^.!?\n]*", re.I)
_HOURS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:-\s*\d+\s*)?(?:hours?|hrs?|h)\b", re.I)
_FIRST_PERSON_RE = re.compile(r"\b(i'm|i am|i like|i love|i enjoy|i have|i can|my interests?|looking for|i want)\b", re.I)
_YEARS = ("freshman", "sophomore", "junior", "senior", "graduate")
_ALIASES = {"ai": "artificial_intelligence", "ml": "machine_learning", "cs": "computer_science", "swe": "software_engineering"}
_STOP = set("a an and are as at be but by can club clubs do does for from have how i if in is it me my of on or that the "
            "their there they this to us usc was we what when where which who why will with would you your about any tell "
            "more some they're its".split())
_SECTION_KEYWORDS = {
    "history": "history founded found start started began origin old story background year since",
    "activities": "activity activitie do does project work build workshop typical involve",
    "notable_events": "notable famous biggest flagship past highlight hackathon competition known",
    "meeting_schedule": "meet meeting schedule often weekly day where location",
    "time_commitment": "time commitment hour busy workload week demanding",
    "membership_requirements": "requirement require eligible eligibility prerequisite experience need major beginner",
    "how_to_join": "join apply application signup sign become member recruit recruitment recruiting open",
    "who_thrives_here": "thrive kind type culture people vibe community",
    "public_description": "about describe description overview mission purpose focus",
    "public_contact": "contact email reach instagram website",
}
_OVERVIEW_WORDS = {"club", "group", "organization", "org", "do", "doe", "does", "mean", "purpose", "mission", "focus",
                   "work", "about", "overview", "you", "they", "exactly", "actually", "usc"}
_OVERVIEW_RE = re.compile(
    r"\bwhat\s+(does|do|is|are)\b(?!.*\b(time|commitment|join|meet|meeting|cost|dues|require|event|contact|history|founded)\b)"
    r"|\btell me (more )?about\b|\bwho are (you|they)\b|\bwhat.*\babout\b|\boverview\b|\bwhat do you do\b", re.I)
_SECTION_LABELS = {
    "history": "History", "activities": "Activities", "notable_events": "Notable events",
    "meeting_schedule": "Meeting schedule", "time_commitment": "Time commitment",
    "membership_requirements": "Membership requirements", "how_to_join": "How to join",
    "who_thrives_here": "Who thrives here", "public_description": "About", "public_contact": "Contact",
}


def _words(text: str) -> set[str]:
    out = set()
    for w in re.findall(r"[a-z0-9]+", (text or "").lower()):
        w = w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w
        if w not in _STOP and len(w) > 1:
            out.add(w)
    return out


def _block(system: str, name: str) -> Any:
    """Parse a `<name>json</name>` data block the agents put in the system prompt."""
    m = re.search(rf"<{name}>\s*(.*?)\s*</{name}>", system or "", re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except ValueError:
        return None


def _norm_tag(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.strip().lower()).strip("_")


class RuleBasedLLM:
    """Deterministic keyword-intent stand-in for a real model so the demo works with no API key.
    Round 1 (last message from the user): pick a tool call or answer from the club profile in the prompt.
    Round 2 (tool results present): compose a short reply strictly from those results."""
    is_fallback = True
    model = "rule-based-fallback"

    async def generate(self, *, system: str, messages: list[ChatMessage], tools: Optional[list[ToolSpec]] = None,
                       response_schema: Optional[dict[str, Any]] = None, temperature: float = 0.4) -> LLMResponse:
        tool_names = {t.name for t in tools or []}
        last_user = max((i for i, m in enumerate(messages) if m.role == "user"), default=-1)
        user_text = messages[last_user].content if last_user >= 0 else ""
        results = [(m.tool_name or "", self._load(m.content)) for m in messages[last_user + 1:] if m.role == "tool"]
        if response_schema is not None:
            return self._reply("{}")
        club = _block(system, "club_profile_data")
        if results:
            done = {name for name, _ in results}
            if (results[-1][0] == "update_student_preferences" and results[-1][1].get("ok")
                    and "recommend_clubs" in tool_names and "recommend_clubs" not in done):
                return self._call("recommend_clubs", {"limit": 5})
            if results[-1][0] == "search_clubs" and results[-1][1].get("ok"):
                hits = (results[-1][1].get("data") or {}).get("hits", [])
                words = _words(user_text)
                generic = {"trojan", "society", "association", "group", "team", "student", "students"}
                named = [h for h in hits if h.get("name") and (
                    h["name"].lower() in user_text.lower() or
                    (_words(h["name"]) - generic and (_words(h["name"]) - generic) <= words)
                )]
                if _COMPARE_RE.search(user_text) and len(named) >= 2 and "get_club_profile" in tool_names:
                    calls = [("get_club_profile", {"organization_id": h["organization_id"]}) for h in named[:3]]
                    return self._call(*calls[0], *calls[1:])
                if len(named) == 1:
                    organization_id = named[0]["organization_id"]
                    if _SUBMIT_RE.search(user_text) and "submit_club_interest" in tool_names:
                        share = bool(re.search(r"share my (contact|email|name)|with my (contact|email)|include my (contact|email)", user_text, re.I))
                        return self._call("submit_club_interest", {"organization_id": organization_id,
                                          "interest_type": "membership", "message": user_text[:500], "share_contact": share})
                    if _FIT_RE.search(user_text) and "check_club_fit" in tool_names:
                        return self._call("check_club_fit", {"organization_id": organization_id})
                    if _EVENT_RE.search(user_text) and "list_club_events" in tool_names:
                        return self._call("list_club_events", {"organization_id": organization_id})
                    if (_PROFILE_RE.search(user_text) or not (_SEARCH_RE.search(user_text) or _RECOMMEND_RE.search(user_text))) \
                            and "get_club_profile" in tool_names:
                        return self._call("get_club_profile", {"organization_id": organization_id})
                if not named and _EVENT_RE.search(user_text) and "list_club_events" in tool_names:
                    return self._call("list_club_events", {})
            return self._reply(self._compose(results, club))
        if club is not None:
            return self._club_turn(user_text, club, tool_names)
        return self._student_turn(user_text, system, tool_names)

    # ---- helpers
    @staticmethod
    def _load(content: str) -> dict:
        try:
            data = json.loads(content)
            return data if isinstance(data, dict) else {"ok": True, "data": data}
        except ValueError:
            return {"ok": False, "error": {"message": "unreadable tool result"}}

    def _reply(self, text: str) -> LLMResponse:
        return LLMResponse(text=text, model=self.model, is_fallback=True)

    def _call(self, name: str, args: dict, *more: tuple[str, dict]) -> LLMResponse:
        calls = [ToolCall(id=f"local-{uuid4().hex[:12]}", name=n, args=a) for n, a in ((name, args),) + more]
        return LLMResponse(tool_calls=calls, model=self.model, is_fallback=True)

    @staticmethod
    def _stated(text: str, known_tags: list[str]) -> dict:
        """Preferences the student explicitly stated in this message (nothing inferred)."""
        low, tags = text.lower(), []
        for tag in known_tags:
            if re.search(rf"\b{re.escape(tag.replace('_', ' '))}\b", low) and tag not in tags:
                tags.append(tag)
        def canon(tag: str) -> str:  # "ai" -> "artificial_intelligence" only when that is the tag clubs use
            full = _ALIASES.get(tag, tag)
            return full if full in known_tags or tag not in _ALIASES else tag

        for short in _ALIASES:
            if re.search(rf"\b{short}\b", low) and canon(short) not in tags:
                tags.append(canon(short))
        for m in _INTEREST_PHRASE_RE.finditer(text):
            for piece in re.split(r",|/|\band\b|&|\bbut\b|\bwith\b", m.group(1)):
                tag = _norm_tag(re.sub(r"\b(the|a|an|some|really|also|clubs?|stuff|things?|joining)\b", " ", piece, flags=re.I))
                if tag and len(tag.split("_")) <= 3 and not re.search(r"\d", tag):
                    tag = canon(tag)
                    if tag not in tags and not any(tag in t.split("_") for t in tags):
                        tags.append(tag)
        out: dict[str, Any] = {}
        if tags:
            out["interest_tags"] = tags[:10]
        hours = _HOURS_RE.search(text)
        if hours and 0 <= float(hours.group(1)) <= 60:
            out["hours_per_week_available"] = float(hours.group(1))
        goal = _GOAL_RE.search(text)
        if goal:
            out["goals"] = goal.group(0).strip()[:300]
        year = next((y for y in _YEARS if re.search(rf"\b{y}\b", low)), None)
        if year or re.search(r"\b(grad student|master'?s|phd|ms student)\b", low):
            out["year_level"] = year or "graduate"
        return out

    # ---- club agent (answers only from the profile in the prompt)
    def _club_turn(self, text: str, club: dict, tool_names: set[str]) -> LLMResponse:
        stated = self._stated(text, [_norm_tag(t) for t in club.get("tags", [])])
        if _SUBMIT_RE.search(text) and "submit_club_interest" in tool_names:
            share = bool(re.search(r"share my (contact|email|name)|with my (contact|email)|include my (contact|email)", text, re.I))
            return self._call("submit_club_interest", {"interest_type": "membership", "message": text[:500], "share_contact": share})
        wants_fit = _FIT_RE.search(text) or (_FIRST_PERSON_RE.search(text) and stated and "?" not in text)
        if wants_fit and "check_club_fit" in tool_names:
            args = {k: v for k, v in stated.items() if k in ("interest_tags", "hours_per_week_available", "goals")}
            return self._call("check_club_fit", args)
        if _EVENT_RE.search(text) and not re.search(r"notable|past|famous|biggest", text, re.I) and "list_club_events" in tool_names:
            return self._call("list_club_events", {})
        return self._reply(self._answer_from_profile(text, club))

    def _answer_from_profile(self, question: str, club: dict) -> str:
        name = club.get("name", "this club")
        q = _words(question) - _words(name)
        if not (q - _OVERVIEW_WORDS) and (_OVERVIEW_RE.search(question) or _words(question) & _words(name)):
            # "What does X do?" / "Tell me about X": the description, plus activities when the profile lists them.
            parts = [club.get("public_description", "").strip()]
            if club.get("activities"):
                parts.append("Activities: " + "; ".join(club["activities"]))
            parts = [p for p in parts if p]
            if parts:
                return f"From {name}'s public profile:\n" + "\n".join(f"- {p}" for p in parts)
        candidates: list[tuple[float, str]] = []
        for field, kw in _SECTION_KEYWORDS.items():
            value = club.get(field)
            if not value:
                continue
            body = "; ".join(value) if isinstance(value, list) else str(value)
            if field == "history" and club.get("founded_year"):
                body = f"Founded in {club['founded_year']}. {body}"
            score = 3 * len(q & set(kw.split())) + len(q & _words(body))
            candidates.append((score, f"{_SECTION_LABELS[field]}: {body}"))
        for item in club.get("faq") or []:
            score = 2 * len(q & _words(item.get("question", ""))) + len(q & _words(item.get("answer", "")))
            candidates.append((score, f"{item.get('question', '').strip()} {item.get('answer', '').strip()}"))
        candidates.sort(key=lambda c: -c[0])
        best = [c for c in candidates if c[0] >= 2][:2]
        if best and len(best) > 1 and best[1][0] < best[0][0] * 0.6:
            best = best[:1]
        if not best:
            if not q or re.fullmatch(r"\W*(hi|hello|hey|yo|thanks|thank you)\W*", question.strip(), re.I):
                return (f"Hi! I'm the public information assistant for {name}. Ask me about its history, activities, "
                        f"time commitment or how to join - or ask whether it could be a fit for you.")
            contact = club.get("public_contact")
            return (f"{name}'s public profile doesn't cover that, so I can't say. "
                    + (f"You can ask the club directly at {contact}." if contact
                       else "The profile doesn't list a public contact either."))
        return f"From {name}'s public profile:\n" + "\n".join(f"- {text}" for _, text in best)

    # ---- student agent
    def _student_turn(self, text: str, system: str, tool_names: set[str]) -> LLMResponse:
        known_tags = list(_ALIASES.values())
        stated = self._stated(text, known_tags)
        prefs = {k: v for k, v in stated.items() if k != "interest_tags" or _INTEREST_PHRASE_RE.search(text)}
        if prefs and _FIRST_PERSON_RE.search(text) and "update_student_preferences" in tool_names \
                and not (_SEARCH_RE.search(text) and not _INTEREST_PHRASE_RE.search(text)):
            return self._call("update_student_preferences", prefs)
        if (_SUBMIT_RE.search(text) or _FIT_RE.search(text) or _EVENT_RE.search(text) or _COMPARE_RE.search(text)
                or _PROFILE_RE.search(text)) and "search_clubs" in tool_names:
            return self._call("search_clubs", {"query": text[:200], "interest_tags": stated.get("interest_tags", []), "limit": 5})
        if _RECOMMEND_RE.search(text) and "recommend_clubs" in tool_names:
            return self._call("recommend_clubs", {"limit": 5})
        if (_SEARCH_RE.search(text) or stated.get("interest_tags")) and "search_clubs" in tool_names:
            return self._call("search_clubs", {"query": text[:200], "interest_tags": stated.get("interest_tags", []), "limit": 5})
        if _PREFS_GET_RE.search(text) and "get_student_preferences" in tool_names:
            return self._call("get_student_preferences", {})
        prefs_block = _block(system, "student_preferences_data") or {}
        if not prefs_block.get("interest_tags") and not prefs_block.get("goals"):
            return self._reply("I can help you find USC clubs. To start: what are you interested in, about how many hours a "
                               "week can you give, and what do you hope to get out of a club?")
        return self._reply("I can recommend clubs for you, search by topic, compare two clubs, check whether a club fits you, "
                           "or prepare an expression of interest. What would you like to do?")

    # ---- composing replies from tool results only
    def _compose(self, results: list[tuple[str, dict]], club: Optional[dict]) -> str:
        parts: list[str] = []
        profiles = [r.get("data") or {} for n, r in results if n == "get_club_profile" and r.get("ok")]
        for name, res in results:
            data = res.get("data") or {}
            if not res.get("ok"):
                parts.append(f"I couldn't complete that: {(res.get('error') or {}).get('message', 'something went wrong')}")
            elif name == "update_student_preferences":
                parts.append("Saved what you told me: " + self._prefs_line(data) + ".")
            elif name == "get_student_preferences":
                line = self._prefs_line(data)
                parts.append(f"Here's what you've told me: {line}." if line else
                             "I don't have any preferences saved for you yet. What are you interested in, and how many hours a week do you have?")
            elif name == "recommend_clubs":
                recs = data.get("recommendations", [])
                if not recs:
                    parts.append("I don't have any clubs to recommend right now.")
                    continue
                head = ("Here are clubs that match what you've told me:" if data.get("personalized") else
                        "These aren't personalised yet - tell me your interests and weekly availability for tailored picks. Some clubs to start with:")
                lines = [f"{i}. {r['club_name']} - {r['explanation'].split(': ', 1)[-1] if data.get('personalized') else ', '.join(r['reason_codes'][1:]).replace('_', ' ').lower() or 'general suggestion'}"
                         for i, r in enumerate(recs[:5], 1)]
                parts.append(head + "\n" + "\n".join(lines) + "\nScores are relevance, not a prediction. Want a fit check on one, or to ask a club directly?")
            elif name == "search_clubs":
                hits = data.get("hits", [])
                if not hits:
                    parts.append("I couldn't find clubs matching that. Try different keywords or tell me your interests.")
                else:
                    parts.append("Here's what I found:\n" + "\n".join(
                        f"- {h['name']} ({h['category']})" + (f" - matches {', '.join(h['matched_tags'])}" if h.get("matched_tags") else "")
                        + f": {h.get('description', '')}" for h in hits[:5]) + "\nWant details on one, or to ask them directly?")
            elif name == "get_club_profile":
                if len(profiles) >= 2:
                    if data is profiles[0]:
                        parts.append("Side by side, from their public profiles:\n" + "\n".join(
                            f"- {p['name']} ({p['category']}): time - {p.get('time_commitment') or 'not stated'}; recruitment - "
                            f"{p.get('recruitment_status')}; focus - {', '.join(p.get('tags', [])[:4]) or 'not stated'}" for p in profiles))
                else:
                    parts.append(f"{data.get('name')} ({data.get('category')}): {data.get('public_description', '')}\n"
                                 f"Time commitment: {data.get('time_commitment') or 'not stated'}. Recruitment: {data.get('recruitment_status')}."
                                 + (f" How to join: {data['how_to_join']}" if data.get("how_to_join") else "")
                                 + "\nWant to ask them directly? You can open a chat with this club's agent, or I can run a fit check.")
            elif name == "list_club_events":
                events = data.get("events", [])
                parts.append("No upcoming public events are listed right now." if not events else "Upcoming public events:\n" + "\n".join(
                    f"- {e['title']} - {e['start_at'][:16].replace('T', ' ')}" + (f" at {e['location']}" if e.get("location") else "")
                    for e in events[:6]))
            elif name == "check_club_fit":
                who = data.get("club_name") or (club or {}).get("name") or "this club"
                if data.get("fit_level") == "unknown":
                    parts.append(f"To give you an honest read on {who}, I need a bit more: what are you looking for in a club, "
                                 "and roughly how many hours a week can you commit?")
                    continue
                text = f"Fit with {who}: {data.get('fit_level')}."
                if data.get("reasons"):
                    text += "\nWhy it could work:\n" + "\n".join(f"- {r}" for r in data["reasons"])
                if data.get("concerns"):
                    text += "\nThings to weigh honestly:\n" + "\n".join(f"- {c}" for c in data["concerns"])
                if data.get("questions_to_ask"):
                    text += "\nQuestions you could ask them:\n" + "\n".join(f"- {q}" for q in data["questions_to_ask"])
                parts.append(text + "\nThis is based only on what you told me and the club's public profile - it's not a decision on membership.")
            elif name == "submit_club_interest":
                pending = data.get("pending_confirmation") or {}
                parts.append(f"I've prepared this for you, but nothing is sent yet. {pending.get('summary', '')} Please confirm to send it, or cancel.")
            else:
                parts.append("Done.")
        return "\n\n".join(p for p in parts if p)

    @staticmethod
    def _prefs_line(data: dict) -> str:
        bits = []
        if data.get("interest_tags"):
            bits.append("interests - " + ", ".join(data["interest_tags"]))
        if data.get("goals"):
            bits.append(f"goals - {data['goals']}")
        if data.get("hours_per_week_available") is not None:
            bits.append(f"{data['hours_per_week_available']:g} h/week available")
        if data.get("year_level"):
            bits.append(data["year_level"])
        return "; ".join(bits)


# ------------------------------------------------------------------ resilience + factories
class ResilientLLM:
    """Primary provider with a deterministic fallback on any provider exception."""

    def __init__(self, primary: LLMClient, fallback: LLMClient):
        self.primary, self.fallback = primary, fallback

    async def generate(self, **kwargs) -> LLMResponse:
        try:
            return await self.primary.generate(**kwargs)
        except Exception as exc:
            log.warning("LLM provider failed (%s: %s); using rule-based fallback", type(exc).__name__, str(exc)[:300])
            resp = await self.fallback.generate(**kwargs)
            resp.is_fallback = True
            return resp


class ResilientEmbedder:
    """Primary embedder; on failure switches to the fallback for a cool-down so vectors stay in one space."""
    dimensions = EMBED_DIMS
    COOLDOWN_SECONDS = 300

    def __init__(self, primary: Embedder, fallback: Embedder):
        self.primary, self.fallback = primary, fallback
        self._degraded_until = 0.0

    @property
    def is_fallback(self) -> bool:
        return time.monotonic() < self._degraded_until

    @property
    def space(self) -> str:
        active = self.fallback if self.is_fallback else self.primary
        return getattr(active, "space", type(active).__name__)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not self.is_fallback:
            try:
                return await self.primary.embed(texts)
            except Exception as exc:
                log.warning("Embedding provider failed (%s: %s); using hash embedder", type(exc).__name__, str(exc)[:300])
                self._degraded_until = time.monotonic() + self.COOLDOWN_SECONDS
        return await self.fallback.embed(texts)


def build_llm(settings) -> LLMClient:
    if settings.use_gemini:
        try:
            return ResilientLLM(GeminiLLM(settings), RuleBasedLLM())
        except Exception:
            log.exception("Could not initialise Gemini; using rule-based fallback")
    return RuleBasedLLM()


def build_embedder(settings) -> Embedder:
    if settings.embedding_provider == "ollama":
        from app.integrations.ollama import OllamaEmbedder

        return OllamaEmbedder(settings)
    if settings.use_gemini:
        try:
            return ResilientEmbedder(GeminiEmbedder(settings), HashEmbedder())
        except Exception:
            log.exception("Could not initialise Gemini embeddings; using hash embedder")
    return HashEmbedder()
