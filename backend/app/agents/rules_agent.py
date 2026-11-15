"""Built-in Club Agent that needs no language model.

Used when ASSISTANT_MODE=rules, when no Gemini key is set, or when Gemini fails (quota, outage).

It reads plain requests such as "Book a 35 person event for december 20th 2026 from 7pm - 8pm",
saves the facts it finds (attendance, date, times, venue type or room, event name) through the same
validated profile tool as the Gemini agent, offers the rooms that are free in the simulated inventory,
and after the rep picks one walks them through the rest of the waterfall: the venue request, the food
vendor, the permit, then the emails. It acts only through app.tools.event_plan, so the same limits hold:
it prepares requests, and the rep confirms, accepts and cancels with the card buttons.

Cards it returns (in `actions`), besides the shared ones:
- {"type": "options", "title", "options": [{label, detail, message}]}: clicking sends `message` back.
- {"type": "fields", "keys", "title", "then"}: an inline form for missing profile fields; "Continue" sends `then`.
- {"type": "suggestions", "items": [{label, message}]}: quick replies for the next step.
"""

from __future__ import annotations

import difflib
import re
from datetime import date, timedelta
from typing import Any

from app.tools import event_plan as tools
from app.workflows.booking import inventory
from app.workflows.event_pipeline import plan, store

LABEL = "rules"
HELP = ("Tell me about the event in one sentence, for example:\n"
        "\"Book a 35 person event for December 20th 2026 from 7pm - 8pm\"\n"
        "I'll show the rooms that are free, and once you pick one I'll take you through the venue request, food, permit and emails.\n"
        "You can also ask \"where is my booking?\", \"another option\" or \"what's next?\".")

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
KIND_WORDS = [("tcc", ("tcc", "tutor campus", "tutor center")), ("outdoor", ("outdoor", "outside venue", "quad", "alumni park", "plaza")),
              ("classroom", ("classroom", "lecture hall")), ("viterbi", ("viterbi",)), ("eeb_phe", ("eeb", "phe", "ece room", "ece conference"))]
EMAILS = [("budgetEmail", ("budget", "finance", "funding")), ("accessEmail", ("accessib", "non-discrim", "statement")),
          ("commsEmail", ("instagram", "comms", "graphic")), ("advisorEmail", ("advisor",)), ("hospitality", ("hospitality",)),
          ("viterbiEmail", ("kevin", "viterbi email"))]
NEXT_FOR_STEP = {
    "venue": ("Book my venue", "Book my venue"),
    "food": ("Pick a caterer", "Pick a caterer"),
    "permit": ("Apply for the permit", "Apply for the permit"),
    "funding": ("Draft the budget email", "Draft the budget email"),
    "engage": ("EngageSC steps", "What do I do on EngageSC?"),
    "access": ("Draft the accessibility email", "Draft the accessibility email"),
    "publicity": ("Draft the Instagram email", "Draft the Instagram email"),
}
BOOK_VERBS = ("book", "reserve", "schedule", "need a room", "need a venue", "find a room", "find me a room", "host", "plan an event", "set up an event")


# ---- parsing ------------------------------------------------------------------------------------
def _month(word: str) -> int | None:
    w = word.lower().rstrip(".")
    for i, m in enumerate(MONTHS):
        if w == m or (len(w) >= 3 and m.startswith(w)) or w == "sept" and i == 8:
            return i + 1
    best = difflib.get_close_matches(w, MONTHS, n=1, cutoff=0.75)  # "decemeber", "feburary"
    return MONTHS.index(best[0]) + 1 if best and len(w) >= 4 else None


def _date(text: str, today: date) -> tuple[date | None, str]:
    """(date, matched text). Without a year, the next occurrence of that day."""
    t = text.lower()
    candidates: list[tuple[int, int, int | None, str]] = []
    if m := re.search(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b", t):
        candidates.append((int(m[2]), int(m[3]), int(m[1]), m[0]))
    if m := re.search(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b", t):
        y = int(m[3]) + (2000 if m[3] and len(m[3]) == 2 else 0) if m[3] else None
        candidates.append((int(m[1]), int(m[2]), y, m[0]))
    for m in re.finditer(r"\b([a-z]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?", t):
        if (mo := _month(m[1])) and not (m[1] == "may" and not m[3] and "may " not in t[:m.start() + 4]):
            candidates.append((mo, int(m[2]), int(m[3]) if m[3] else None, m[0]))
    for m in re.finditer(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,10})\b(?:,?\s*(\d{4}))?", t):
        if mo := _month(m[2]):
            candidates.append((mo, int(m[1]), int(m[3]) if m[3] else None, m[0]))
    for mo, day, year, raw in candidates:
        try:
            d = date(year or today.year, mo, day)
        except ValueError:
            continue
        if not year and d < today:
            d = date(today.year + 1, mo, day)
        return d, raw
    if "tomorrow" in t:
        return today + timedelta(days=1), "tomorrow"
    return None, ""


_T = r"(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?"


def _hhmm(h: str, mi: str | None, mer: str | None, fallback_mer: str | None) -> tuple[int, int] | None:
    hour, minute = int(h), int(mi or 0)
    mer = (mer or fallback_mer or "").replace(".", "")
    if hour > 23 or minute > 59:
        return None
    if mer == "pm" and hour < 12:
        hour += 12
    elif mer == "am" and hour == 12:
        hour = 0
    elif not mer and 1 <= hour <= 11:
        hour += 12  # club events are usually afternoon or evening: "7-9" means 7–9 PM
    return hour, minute


def _times(text: str) -> tuple[str | None, str | None, list[str]]:
    """(start "HH:MM", end "HH:MM", notes). Minutes are rounded to the half hour the USC forms accept."""
    t = re.sub(r"\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b", " ", text.lower())
    t = re.sub(r"\b(\d{1,2})(?:st|nd|rd|th)\b", " ", t)  # "20th" is a day, not a time
    t = re.sub(r"\b\d{4}\b", " ", t)  # years
    notes: list[str] = []
    m = re.search(_T + r"\s*(?:-|–|—|to|until|till)\s*" + _T, t)
    if not m:
        single = re.search(r"\bat\s+" + _T, t)
        if single and (s := _hhmm(single[1], single[2], single[3], None)):
            return f"{s[0]:02d}:{s[1]:02d}", None, ["What time does it end?"]
        return None, None, notes
    end = _hhmm(m[4], m[5], m[6], None)
    start = _hhmm(m[1], m[2], m[3], m[6] if not m[3] and int(m[1]) <= int(m[4]) else None)
    if not start or not end:
        return None, None, notes
    out = []
    for h, mi in (start, end):
        r = 0 if mi < 15 else 30 if mi < 45 else 60
        if r != mi:
            notes.append("Times were rounded to the half hour, which the USC forms require.")
        h, mi = (h + 1, 0) if r == 60 else (h, r)
        out.append(f"{min(h, 23):02d}:{mi:02d}")
    return out[0], out[1], list(dict.fromkeys(notes))


def _room(text: str) -> inventory.Venue | None:
    t = text.upper()
    for m in re.finditer(r"\b([A-Z]{2,4})\s?(\d{3})\b", t):
        for a in inventory.AUTHORITIES:
            if v := inventory.find_venue(f"{m[1]} {m[2]}", a):
                return v
    for v in inventory.VENUES:  # named spaces: "McCarthy Quad", "TCC 450 (Forum)"
        if len(v.name) > 7 and v.name.split(" (")[0].upper() in t:
            return v
    return None


def parse_event(text: str, today: date) -> dict[str, Any]:
    """Profile facts found in a sentence. Keys starting with "_" are hints, not profile fields."""
    facts: dict[str, Any] = {}
    t = text.lower()
    if m := re.search(r"\b(\d{1,4})\s*-?\s*(?:person|people|ppl|attendees|guests|students|members|pax)\b", t):
        facts["attendance"] = m[1]
    elif m := re.search(r"\bfor\s+(\d{1,4})\b(?!\s*(?::|am|pm|a\.m|p\.m|th|st|nd|rd|/))", t):
        facts["attendance"] = m[1]
    d, _raw = _date(text, today)
    if d:
        facts["date"] = d.isoformat()
    start, end, notes = _times(text)
    if start:
        facts["startTime"] = start
    if end:
        facts["endTime"] = end
    facts["_notes"] = notes
    room = _room(text)
    if room:
        facts["_room"] = room
        facts["venueKind"] = room.venue_kind
    else:
        kind = next((k for k, words in KIND_WORDS if any(w in t for w in words)), None)
        if kind:
            facts["venueKind"] = kind
    if m := re.search(r"\b(?:called|named|titled)\s+[\"“']?([^\"”',.]{3,60})", text, re.I):
        facts["eventName"] = m[1].strip()
    return facts


# ---- helpers ------------------------------------------------------------------------------------
def _has(text: str, *words: str) -> bool:
    return any(w in text for w in words)


def _lines(items: list[str]) -> str:
    return "\n".join(f"- {x}" for x in items)


def _profile() -> plan.Profile:
    return store.load().get("profile") or {}


def _save(ctx: tools.ToolContext, fields: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    if not fields:
        return {}, {}
    r = tools.execute(ctx, "update_event_profile", {"fields": fields})
    data = r["data"] or {}
    return data.get("saved", {}), data.get("rejected", {})


def _suggest(ctx: tools.ToolContext, today: date | None, extra: list[tuple[str, str]] | None = None) -> None:
    s = tools.status_summary(store.load(), today)
    items = list(extra or [])
    for sid in s["do_now"]:
        if sid in NEXT_FOR_STEP and NEXT_FOR_STEP[sid] not in items:
            items.append(NEXT_FOR_STEP[sid])
    items.append(("What's next?", "What should I do next?"))
    ctx.add_action({"type": "suggestions", "items": [{"label": a, "message": b} for a, b in items[:5]]})


def _ask_fields(ctx: tools.ToolContext, keys: list[str], title: str, then: str) -> None:
    keys = [k for k in dict.fromkeys(keys) if k in plan.FIELD_BY_KEY]
    if keys:
        ctx.add_action({"type": "fields", "keys": keys, "title": title, "then": then})


def _fmt_day(iso: str) -> str:
    return date.fromisoformat(iso).strftime("%a %b %-d %Y")


# ---- the venue: options, then the chosen room ---------------------------------------------------
def _options_reply(ctx: tools.ToolContext, kinds: list[str] | None, preface: str = "") -> str:
    p = _profile()
    missing = [plan.short_label(k) for k in ("date", "startTime", "endTime", "attendance") if not plan.is_filled(p, k)]
    if missing:
        return (preface + "To find rooms I still need: " + ", ".join(missing) + ".\n"
                "For example: \"35 people on December 20th from 7pm to 8pm\".").strip()
    res = tools.find_venue_options(p, kinds)
    if not res["ok"]:
        return preface + " ".join(res["reasons"])
    head = f"{preface}Rooms for {p['attendance']} people on {_fmt_day(p['date'])}, {plan.to12h(p['startTime'])}–{plan.to12h(p['endTime'])}:"
    excluded = ("\nNot offered:\n" + _lines(res["excluded"])) if res["excluded"] else ""
    if not res["options"]:
        return f"{head}\nNothing is free that fits.{excluded}\nTry another time or date, or a different number of people."
    ctx.add_action({"type": "options", "title": "Pick a room", "options": [{
        "label": f"{o['venue']} · {o['start_label']}–{o['end_label']}",
        "detail": f"{o['authority']} · seats {o['capacity']} · {', '.join(o['features']) or 'no listed equipment'}"
                  + ("" if o["shift"] == 0 else f" · {o['time']}"),
        "message": f"Book {o['venue']} from {o['start_label']} to {o['end_label']}",
    } for o in res["options"]]})
    return (f"{head}\nPick one below. These come from the simulated inventory (checked {res['checked_at'][11:16]} UTC); "
            f"a free slot is not a reservation until a reviewer confirms it.{excluded}")


def _choose_room(ctx: tools.ToolContext, room: inventory.Venue, today: date | None, preface: str = "") -> str:
    p = _profile()
    if not all(plan.is_filled(p, k) for k in ("date", "startTime", "endTime", "attendance")):
        return _options_reply(ctx, [room.venue_kind], preface)
    res = tools.find_venue_options(p, [room.venue_kind], limit=50)
    exact = next((o for o in res.get("options", []) if o["venue_id"] == room.id and o["shift"] == 0), None)
    if not exact:
        return _options_reply(ctx, None, f"{preface}{room.name} isn't available for that time. ")
    updates: dict[str, Any] = {"venueKind": room.venue_kind, "venueChoice1": room.name}
    if not plan.is_filled(p, "setupTime"):
        updates["setupTime"] = p["startTime"]
    if not plan.is_filled(p, "teardownTime"):
        updates["teardownTime"] = p["endTime"]
    _save(ctx, updates)
    note = " Setup and tear-down are set to the event time; change them in the form if you need extra time." if "setupTime" in updates else ""
    return preface + f"{room.name} it is.{note}\n" + _prepare(ctx, "venue_booking", today)


def _prepare(ctx: tools.ToolContext, kind: str, today: date | None) -> str:
    r = tools.execute(ctx, "prepare_booking_request", {"kind": kind})
    again = "Book my venue" if kind == "venue_booking" else "Apply for the permit"
    if r["ok"]:
        d = r["data"]
        warn = ("\nHeads up: " + " ".join(d["policy_warnings"]) + " A human will need to step in.") if d["policy_warnings"] else ""
        return ("Here's the request. Check it, then press \"Confirm & send\" on the card. Nothing is sent until you do.\n"
                + _lines(d["summary_for_user"]) + warn)
    if r["error"]["code"] == "already_submitted":
        return _brief_reply(ctx, (r["data"] or {}).get("current"), kind, today)
    d = r["data"] or {}
    out = [r["error"]["message"]]
    if d.get("missing_keys"):
        _ask_fields(ctx, d["missing_keys"], "A few details for the " + ("venue request" if kind == "venue_booking" else "permit"), again)
        out.append("Fill these in below and press Continue.")
    out += d.get("blockers") or []
    if d.get("blockers"):
        _suggest(ctx, today)
    return "\n".join(out)


def _brief_reply(ctx: tools.ToolContext, b: dict[str, Any] | None, kind: str, today: date | None) -> str:
    label = "venue booking" if kind == "venue_booking" else "permit"
    if not b or not b.get("state"):
        return f"There is no {label} request yet. Say \"{'book my venue' if kind == 'venue_booking' else 'apply for the permit'}\" to start."
    out = [f"Your {label} is: {b['state_label']}." + (f" ({b['authority']})" if b.get("authority") else "")]
    p = b.get("active_proposal")
    if p:
        out.append(f"Proposal: {p['venue']}, seats {p['capacity']}. Differences: {'; '.join(p['differences_from_request'])}.")
        out.append("It is not a booking yet. Accept it on the card to send it for review, or ask me for another option.")
    elif b["state"] == "CONFIRMED":
        out.append(f"Reference {b['confirmation_reference']}. Next steps are below.")
        _suggest(ctx, today)
    else:
        if b.get("missing_keys"):
            _ask_fields(ctx, b["missing_keys"], "Details still needed", "Book my venue" if kind == "venue_booking" else "Apply for the permit")
        out += b.get("blockers") or []
        out.append(b["next_action"])
        if b["state"] in ("PENDING_HUMAN_REVIEW", "APPROVED"):
            out.append("A reviewer decides on the Venue review page; meanwhile you can work on other steps.")
            _suggest(ctx, today)
    return "\n".join(out)


# ---- food ---------------------------------------------------------------------------------------
FOOD_FIELDS = ["catererType", "menu", "foodValue", "paymentType", "vendorServes"]


def _caterer_in(text: str) -> str | None:
    t = text.lower()
    for c in plan.PERMIT_APPROVED_CATERERS:
        if c.lower() in t or c.split(" (")[0].lower() in t:
            return c
    if m := re.search(r"\b(?:use caterer|caterer is|caterer:|vendor is|order from|go with caterer)\s+(.{3,60})$", text.strip(), re.I):
        return m[1].strip(" .\"'")
    return None


def _food_pick(ctx: tools.ToolContext, name: str, today: date | None) -> str:
    approved = name in plan.PERMIT_APPROVED_CATERERS
    fields: dict[str, Any] = {"food": True, "catererName": name}
    if approved and not plan.is_filled(_profile(), "catererType"):
        fields["catererType"] = "Outside Caterer"
    _save(ctx, fields)
    tools.execute(ctx, "record_step_progress", {"step": "food", "check": "picked", "done": True})
    out = [f"{name} is saved as your food vendor."]
    if not approved:
        out.append("It isn't in the permit's approved-caterer lookup, so USC Hospitality must approve it (health permit + insurance), "
                   "due 2 weeks before the event.")
        tools.execute(ctx, "draft_email", {"form_id": "hospitality"})
    return "\n".join(out) + "\n" + _food_quote(ctx, today)


def _food_quote(ctx: tools.ToolContext, today: date | None) -> str:
    p = _profile()
    missing = [k for k in FOOD_FIELDS if plan.field_applies(p, k) and plan.field_problem(p, k)]
    if missing:
        _ask_fields(ctx, missing, "Your quote from the caterer", "I have the quote")
        return "Add the details from the caterer's quote below and press Continue."
    tools.execute(ctx, "record_step_progress", {"step": "food", "check": "quote", "done": True})
    _suggest(ctx, today)
    return "Food step done: vendor picked and quote recorded."


# ---- main ---------------------------------------------------------------------------------------
def respond(ctx: tools.ToolContext, message: str, today: date | None) -> str:
    today_ = today or date.today()
    t = message.lower().strip()

    if _has(t, "start over", "reset", "clear this event", "new event"):
        tools.execute(ctx, "offer_reset", {})
        return "Press \"Clear this event\" below if you want to start over. Nothing has been cleared yet."
    if t in ("help", "hi", "hello", "hey") or _has(t, "what can you do", "how does this work"):
        return HELP

    # Food (checked before booking words: "use City Tacos" is not a room booking).
    if _has(t, "no food", "not serving food", "without food", "no catering"):
        _save(ctx, {"food": False})
        _suggest(ctx, today)
        return "Got it: no food, so the food step is skipped and the permit only needs the venue."
    if _has(t, "have the quote", "got the quote", "quote is in", "quote"):
        return _food_quote(ctx, today)
    if (caterer := _caterer_in(message)) and not _room(message):
        return _food_pick(ctx, caterer, today)

    if _has(t, "another", "alternative", "different option", "other option", "something else"):
        r = tools.execute(ctx, "request_alternatives", {"kind": "venue_booking", "reason": message[:200]})
        if not r["ok"]:
            return r["error"]["message"]
        return "I asked the venue agent for another option within your constraints.\n" + _brief_reply(ctx, r["data"], "venue_booking", today)

    if _has(t, "email", "draft") and any(_has(t, *keys) for _, keys in EMAILS):
        form_id = next(fid for fid, keys in EMAILS if _has(t, *keys))
        r = tools.execute(ctx, "draft_email", {"form_id": form_id})
        if r["ok"]:
            _suggest(ctx, today)
            return f"The draft to {r['data']['to']} is on the card below. It opens in your mail app; nothing is sent. Tick it off on the Pipeline tab once sent."
        _ask_fields(ctx, [m["key"] for m in plan.missing_for(form_id, _profile())], "Needed for this email", message)
        return "This email needs a few details first. Fill them in below and press Continue."

    if "engage" in t:
        from app.workflows.rso.service import summary_for_pipeline
        rso = summary_for_pipeline()
        _suggest(ctx, today, [] if rso["recognized"] else [("RSO recognition", "What's next for our RSO?")])
        note = ("" if rso["recognized"] else f"\nYour RSO recognition is: {rso['status_label']}. Only recognized RSOs can create EngageSC events, "
                "so finish recognition first.")
        return ("EngageSC needs a USC login, so it stays manual: create the event on engage.usc.edu, enter your permit code, sign and submit for "
                "approval. Then tick the EngageSC checklist on the Pipeline tab." + note)

    if "permit" in t and not _has(t, "status", "where", "blocking", "blocked"):
        return _prepare(ctx, "event_permit", today)

    # Venue: a sentence with event facts, a chosen room, or "book my venue".
    facts = parse_event(message, today_)
    room: inventory.Venue | None = facts.pop("_room", None)
    notes: list[str] = facts.pop("_notes", [])
    has_facts = any(k in facts for k in ("attendance", "date", "startTime", "endTime"))
    status_q = _has(t, "status", "where is", "where's", "how is", "update on", "progress", "blocking", "blocked", "proposal", "my booking")
    wants_booking = (_has(t, *BOOK_VERBS) or "select" in t) and not status_q
    if has_facts or room or wants_booking:
        saved, rejected = _save(ctx, facts)
        pre = ""
        if saved:
            shown = {k: v for k, v in saved.items() if k != "venueKind"}
            if shown:
                pre += "Saved: " + ", ".join(f"{plan.short_label(k)} {plan.to12h(v) or v if k.endswith('Time') else v}" for k, v in shown.items()) + ".\n"
        if rejected:
            pre += "Not saved: " + "; ".join(f"{plan.short_label(k)} ({v})" for k, v in rejected.items()) + ".\n"
        if notes:
            pre += " ".join(notes) + "\n"
        if room:
            return _choose_room(ctx, room, today, pre)
        p = _profile()
        mentioned_kind = facts.get("venueKind")
        if not has_facts and plan.is_filled(p, "venueChoice1") and plan.is_filled(p, "venueKind"):
            return pre + _prepare(ctx, "venue_booking", today)  # "book my venue" with the room already chosen
        return _options_reply(ctx, [mentioned_kind] if mentioned_kind else None, pre)

    if _has(t, "free", "availab", "which room", "what rooms", "show rooms", "open slot"):
        return _options_reply(ctx, None)

    if _has(t, "pick a caterer", "choose a caterer", "food vendor", "caterer", "catering", "food"):
        ctx.add_action({"type": "options", "title": "Caterers the permit accepts", "options": [
            *({"label": c, "detail": "Approved in the permit lookup", "message": f"Use caterer {c}"} for c in plan.PERMIT_APPROVED_CATERERS),
            {"label": "We're not serving food", "detail": "Skips the food step", "message": "No food"}]})
        return ("Pick a caterer the Event Permit already accepts, or name another one (\"use caterer Joe's Pizza\"); "
                "a non-approved vendor needs USC Hospitality approval.")

    if status_q:
        kinds = ["event_permit"] if "permit" in t else ["venue_booking", "event_permit"]
        replies = []
        for kind in kinds:
            r = tools.execute(ctx, "get_booking_status", {"kind": kind})
            if kind == "event_permit" and len(kinds) > 1 and not (r["data"] or {}).get("state"):
                continue
            replies.append(_brief_reply(ctx, r["data"], kind, today))
        return "\n\n".join(replies)

    return _next_reply(ctx, today)


def _next_reply(ctx: tools.ToolContext, today: date | None) -> str:
    s = tools.status_summary(store.load(), today)
    by_id = {x["id"]: x for x in s["steps"]}
    out = []
    if s["event_date"]:
        out.append(f"{s['steps_done']} steps done, {s['days_to_event']} days to the event.")
    else:
        out.append("No event yet. " + HELP.split("\n")[0])
    for sid in s["do_now"][:3]:
        st = by_id[sid]
        due = f" (due {st['deadline']})" if st["deadline"] else ""
        out.append(f"Do now: {st['title']}{due}.")
    for sid in s["waiting_on_reply"]:
        out.append(f"Waiting on: {by_id[sid]['title']}.")
    if s["late"]:
        out.append("Late: " + ", ".join(by_id[x]["title"] for x in s["late"]) + ".")
    _suggest(ctx, today)
    return "\n".join(out)


def run_turn(message: str, history: list[dict[str, Any]] | None = None, today: date | None = None, note: str = "") -> dict[str, Any]:
    ctx = tools.ToolContext(today=today)
    reply = respond(ctx, message[:4000], today)
    if note:
        reply = f"({note})\n{reply}"
    return {"reply": reply, "actions": ctx.actions, "tools": ctx.trace, "state": store.load(), "model": LABEL}
