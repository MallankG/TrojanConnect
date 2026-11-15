"""Slack bot: the `/trojan` slash command (free Slack workspaces support it). Same backend, identities and
rules as the web app; Slack is only another channel (PRD 15, with Slack in place of WhatsApp).

    /trojan help
    /trojan ask <question>                 Student Agent: find clubs
    /trojan club <club>: <question>        that club's public Club Agent
    /trojan usg <question> | gsg <question>  student-government assistant (sourced answers)
    /trojan notifications                  club posts and announcements for you
    /trojan status                         booking requests (club reps)
    /trojan post <event|recruitment|update> <title> | <message> [| 2026-11-20 18:00-19:30 | location]
    /trojan confirm <code>                 publish a post you previewed

Submitting, accepting or cancelling a booking and sending interest are not possible from Slack: those need
the signed-in web app (step-up confirmation, PRD 8.5).
"""
from __future__ import annotations

import secrets
import time
from datetime import datetime
from typing import Any
from urllib.parse import parse_qs

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse

from app.api.deps import embedder_dep, orchestrator_dep, repo_dep
from app.config import Settings, get_settings
from app.integrations import slack
from app.schemas.common import AppError
from app.schemas.student import ConversationCreate
from app.security.actor import Actor
from app.security.demo_roles import apply_demo_roles
from app.workflows.booking import service as booking_service
from app.workflows.campus import government, outreach

router = APIRouter()
_pending_posts: dict[str, dict[str, Any]] = {}  # ponytail: in-process previews, 10 min; persist if multi-worker
PREVIEW_TTL = 600


def _actor(user_id: str) -> Actor:
    actor = Actor(user_id=user_id)
    apply_demo_roles(actor)
    return actor


def _club_line(card: dict[str, Any]) -> str:
    d = card.get("data") or {}
    club = d.get("club") or d
    name = club.get("name") or d.get("club_name") or club.get("organization_id")
    return f"• {name}"


async def _agent_reply(orchestrator, actor: Actor, req: ConversationCreate, question: str) -> str:
    conv, _ = await orchestrator.start_conversation(actor, req)
    turn = await orchestrator.send_message(actor, conv.id, question)
    lines = [turn.message.content]
    clubs = [_club_line(c.model_dump()) for c in turn.cards if c.type in ("club", "recommendation")]
    if clubs:
        lines += [""] + clubs[:5]
    if turn.pending_confirmation:
        lines.append("\nTo send this, confirm it in the web app (Slack can't confirm writes for you).")
    return "\n".join(lines)


async def _handle(text: str, actor: Actor, repo, orchestrator, embedder, settings: Settings) -> str:
    cmd, _, rest = text.strip().partition(" ")
    cmd, rest = cmd.lower(), rest.strip()
    web = settings.app_base_url.rstrip("/")

    if cmd in ("", "help"):
        return __doc__.split("\n\n")[1].replace("    ", "")
    if cmd == "ask" and rest:
        return await _agent_reply(orchestrator, actor, ConversationCreate(agent_type="student", channel="slack"), rest)
    if cmd == "club" and ":" in rest:
        name, _, question = rest.partition(":")
        club = await repo.get_club(name.strip())
        if club is None:
            from app.services.clubs import search_clubs
            hits = await search_clubs(repo, embedder, name.strip(), [], 1)
            club = hits[0].club if hits else None
        if club is None:
            return f"I couldn't find a club called “{name.strip()}”."
        reply = await _agent_reply(orchestrator, actor, ConversationCreate(agent_type="club", organization_id=club.organization_id, channel="slack"), question.strip())
        return f"*{club.name}*\n{reply}"
    if cmd in ("usg", "gsg") and rest:
        a = government.ask(actor, cmd.upper(), rest)
        links = "\n".join(f"<{s['url']}|{s['title']}> ({'news report' if s['kind'] == 'news' else s['owner']})" for s in a["sources"])
        extra = f"\n\nWant {cmd.upper()} to see this? Send it as feedback at {web}/government" if a["feedback_offer"] else ""
        return f"{a['answer']}\n\n{links}{extra}\n_{a['disclaimer']}_".strip()
    if cmd == "notifications":
        items = await outreach.notifications(repo, actor)
        return "\n".join(f"• {n['text']}  <{web}{n['href']}|open>" for n in items[:10]) or "Nothing new."
    if cmd == "status":
        if "club_rep" not in actor.roles:
            return "Booking status is for club representatives."
        bookings = booking_service.list_for_event()
        if not bookings:
            return f"No booking requests yet. Start one with the assistant: {web}/plan"
        return "\n".join(f"• {b['kind_label']}: *{b['state_label']}*. {b['next_action']}" for b in bookings) + \
            f"\nSubmitting, accepting or cancelling happens in the web app: {web}/bookings"
    if cmd == "post":
        return _preview_post(actor, rest)
    if cmd == "confirm" and rest:
        return await _publish(actor, rest.strip(), repo, settings)
    if cmd in ("submit", "accept", "cancel", "book", "interest"):
        return f"For your protection that needs the signed-in web app: {web}"
    return "I didn't understand that. Try `/trojan help`."


def _preview_post(actor: Actor, rest: str) -> str:
    if "club_rep" not in actor.roles or not actor.organization_ids:
        return "Only a verified club representative can post."
    kind, _, body = rest.partition(" ")
    parts = [p.strip() for p in body.split("|")]
    if kind not in ("event", "recruitment", "update") or len(parts) < 2 or not parts[0] or not parts[1]:
        return "Usage: `/trojan post event Title | Message | 2026-11-20 18:00-19:30 | Location`"
    post: dict[str, Any] = {"kind": kind, "title": parts[0], "body": parts[1]}
    if kind == "event":
        try:
            day, times = parts[2].split(" ", 1)
            start, end = (t.strip() for t in times.split("-"))
            post["event"] = {"start_at": datetime.fromisoformat(f"{day}T{start}").astimezone().isoformat(),
                             "end_at": datetime.fromisoformat(f"{day}T{end}").astimezone().isoformat(),
                             "location": parts[3] if len(parts) > 3 else ""}
        except (IndexError, ValueError):
            return "An event needs a date and time: `| 2026-11-20 18:00-19:30 |`"
    code = secrets.token_hex(3)
    _pending_posts[code] = {"user_id": actor.user_id, "org": actor.organization_ids[0], "post": post, "at": time.time()}
    when = f"\nWhen: {parts[2]}" + (f" · {post['event']['location']}" if post.get("event", {}).get("location") else "") if kind == "event" else ""
    return f"*Preview ({kind})*\n*{post['title']}*\n{post['body']}{when}\n\nNothing is published yet. Send `/trojan confirm {code}` to post it."


async def _publish(actor: Actor, code: str, repo, settings: Settings) -> str:
    pending = _pending_posts.get(code)
    if not pending or pending["user_id"] != actor.user_id or time.time() - pending["at"] > PREVIEW_TTL:
        return "That preview has expired or isn't yours. Create the post again."
    _pending_posts.pop(code, None)
    try:
        post = await outreach.create_post(repo, actor, pending["org"], pending["post"])
    except AppError as e:
        return e.message
    shared = await slack.post_to_channel(settings, f"*{post['club_name']}* · {post['title']}\n{post['body']}")
    return f"Posted “{post['title']}”. Followers are notified in TrojanConnect" + (" and in the club channel." if shared else ".")


@router.post("/webhooks/slack/commands", include_in_schema=False)
async def slash_command(request: Request, background: BackgroundTasks, settings: Settings = Depends(get_settings),
                        repo=Depends(repo_dep), orchestrator=Depends(orchestrator_dep), embedder=Depends(embedder_dep)):
    body = await request.body()
    if not slack.verify(settings, request.headers.get("x-slack-request-timestamp", ""), request.headers.get("x-slack-signature", ""), body):
        return JSONResponse({"ok": False, "error": "invalid signature"}, status_code=401)
    form = {k: v[0] for k, v in parse_qs(body.decode()).items()}
    if not slack.first_delivery(form.get("trigger_id", "")):
        return JSONResponse({"response_type": "ephemeral", "text": ""})
    user_id = slack.linked_user(settings, form.get("user_id", ""))
    if not user_id:
        return JSONResponse({"response_type": "ephemeral",
                             "text": "Your Slack account isn't linked to TrojanConnect yet, so I can't act for you. Ask an admin to link it."})
    actor = _actor(user_id)

    async def work() -> None:
        try:
            text = await _handle(form.get("text", ""), actor, repo, orchestrator, embedder, settings)
        except AppError as e:
            text = e.message
        await slack.respond(form.get("response_url", ""), text)

    background.add_task(work)  # Slack needs an answer within 3 seconds; the result follows via response_url
    return JSONResponse({"response_type": "ephemeral", "text": "Working on it…"})


@router.post("/webhooks/slack/events", include_in_schema=False)
async def events(request: Request, settings: Settings = Depends(get_settings)):
    """Events API endpoint. Only answers Slack's URL verification; the bot works through `/trojan`."""
    body = await request.body()
    if not slack.verify(settings, request.headers.get("x-slack-request-timestamp", ""), request.headers.get("x-slack-signature", ""), body):
        return JSONResponse({"ok": False, "error": "invalid signature"}, status_code=401)
    payload = await request.json()
    if payload.get("type") == "url_verification":
        return JSONResponse({"challenge": payload.get("challenge", "")})
    return JSONResponse({"ok": True})
