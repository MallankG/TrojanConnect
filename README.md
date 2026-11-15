# TrojanConnect

TrojanConnect is a campus agent network for USC. Club officers plan events with an assistant that
books rooms through a venue agent, students find clubs and question each club's agent, and student
government answers questions only from its own published pages. Built for a hackathon; it is not an
official USC product and makes no real reservations. The spec is
[`TrojanConnect_Final_PRD.md`](TrojanConnect_Final_PRD.md).

> **The rule the whole system follows:** agents understand, prepare, negotiate and recommend.
> Deterministic backend code enforces policy and permissions. Only an authorised person makes a decision
> that needs institutional authority.

## The problem, in real numbers

All figures below come from the linked public pages (collected 14 Nov 2026).

| Fact | Number | Source |
|---|---|---|
| Undergraduates USG represents | 20,000+ | [usg.usc.edu](https://usg.usc.edu/branches/about-2-0/) |
| Graduate and professional students GSG represents | 27,500+ | [gsg.usc.edu](https://gsg.usc.edu/) |
| Turnout in the 2025 USG general election | about 17% of undergraduates | [Daily Trojan, 13 Feb 2026](https://dailytrojan.com/2026/02/13/students-reflect-on-usg-amid-election/) |
| USG funding available per year | up to $356,100 | [USG Funding](https://usg.usc.edu/branches/funding/) |
| USG funding cap per student organisation | $8,000 a year, up to 4 events a semester | [USG Funding](https://usg.usc.edu/branches/funding/) |
| How early a USG funding application is due | 6 academic weeks before the event (9 for USC vendors), Wednesdays 11:59 PM | [USG Funding](https://usg.usc.edu/branches/funding/) |
| Student programming fee that pays for USG | $64 a semester | [Annenberg Media](https://www.uscannenbergmedia.com/2025/03/05/what-is-usg-an-inside-look-at-how-student-government-works/) |
| Notice needed to book a venue | outdoor 6 weeks, Tutor Campus Center 3 weeks, classrooms by Thursday noon the week before, EEB/PHE 3 days | [`docs/event-pipeline.md`](docs/event-pipeline.md) (from the venues' request forms) |
| Notice for a non-approved caterer | 2 weeks (health permit and insurance) | same |
| Club directory | 1,998 student organisations | collected from EngageSC public pages |

A club officer planning one event deals with up to seven separate offices and forms (venue, food,
event permit, funding, EngageSC, accessibility statement, publicity), each with its own deadline.
Missing the earliest one, the 6-week funding deadline or outdoor-venue notice, can sink the event.

## What it does, measured

Measured on 15 Nov 2026 against the running system (FastAPI backend on Supabase; the built-in rules
agent, because the Gemini key was over quota that day). The script is reproducible; see "How these numbers were measured".

| What | Result |
|---|---|
| Club request → **confirmed** booking, end to end | **4.5 s** of system time, **9** API calls (4 chat turns, 1 form save, submit, accept, reviewer approval, reviewer confirmation). |
| Rooms offered for the sample request (35 people, 20 Dec, 7–8 PM) | 7 rooms from the simulated inventory, plus the venue types ruled out and why |
| Club Agent ⇄ Venue Agent messages per booking | 9 structured messages; audit trail of 11 entries, each with actor, role, time and reason |
| Event details understood from one sentence | 40 of 40 fields (attendance, date, start, end) across 10 hand-written requests. 4 attendances over 60 were understood but **not saved**: the walkthrough permit rule caps attendance at 60, and the agent says so |
| Unauthorised confirmations | **0**. A reviewer from the wrong venue gets 403; no agent tool can submit, accept, approve or confirm (backend tests) |
| Government questions answered from an approved source | 17 of 20 (85%). The other 3 were correctly refused ("Can USG approve my room booking?", parking prices, GSG travel grants): no approved page covers them, so the assistant says it can't verify and offers to route the question |
| Club directory | 1,999 clubs (1,998 public + 1 sample) and the clubs' published events |
| Latency | search 0.8 s, recommendations 1.2 s, full directory 1.5 s, assistant turn 1.5 s median |
| Backend tests | 149 passing, no network or keys needed |

## How the agents work

There is **one backend and one agent loop**, not a separate running process per student or per club.
"Agent" here means a conversation with a fixed identity, system prompt and tool list; every tool is a
validated backend function.

```
 Student / club officer / reviewer / USG rep  (web app, or Slack /trojan)
          │
          ▼
 FastAPI ── Actor from the session (role and club come from the server, never the client or model)
          │
          ├─ AgentOrchestrator (app/agents/orchestrator.py)
          │     conversation.agent_id = student_agent:{user}  or  club_agent:{club}
          │     model (Gemini, or the rule-based fallback) proposes tool calls
          │     → execute_tool() checks the tool is allowed for that agent and validates arguments
          │     → writes (send interest) come back as a pending confirmation the user must accept
          │
          ├─ Event planning Club Agent (app/agents/rules_agent.py, event_agent.py)
          │     → booking workflow: Club Agent ⇄ Venue Scheduling Agent → human reviewer → CONFIRMED
          │
          └─ Student-government assistant (app/workflows/campus/government.py): retrieval only, no model
```

**Student Agent.** One per student (`student_agent:{user_id}`). Tools: search clubs, recommend clubs,
check fit, open a club profile, list events, prepare an interest (which the student must confirm). It
uses only the interests the student chose; scores are relevance, not a probability of joining.

**Club Agents.** Each club has its own identity (`club_agent:{organization_id}`), but they share one
code path. When a conversation opens, the orchestrator loads *that* club's public profile, FAQ and
upcoming events into the system prompt and gives it the club tools. The backend overwrites every tool's
`organization_id` with the conversation's club, so a club agent can only ever read or act on its own
club. If the profile doesn't say something, the agent says so instead of guessing.

**Does a student search load every club's embedding?** No.
1. Only the **query** is embedded on each search.
2. With a vector index (Supabase `pgvector`, `match_clubs`), that one vector returns ranked matches
   from the database; club vectors were computed once (`scripts/backfill_embeddings.py`) and are never
   sent to the app.
3. Without an index or embedding provider, a cheap keyword/tag prefilter picks at most **150** of the
   ~2,000 clubs, only those are embedded, and the vectors are cached per process.
4. The final score blends similarity with tag and keyword overlap, so results stay explainable
   ("matches your interest in robotics").

Recommendations run the same way, with the student's chosen interests and goals as the query, plus
hard filters (clubs the student hid) and feedback ("not relevant" ranks a club lower).

**Event planning.** The Club Agent turns "Book a 35 person event for December 20th 2026 from 7pm to
8pm" into profile fields, lists free rooms, and prepares the venue request. The **Venue Scheduling
Agent** answers from the venue's inventory and rules, proposes or counter-proposes, and shows every
difference from what was asked. The officer confirms the summary, accepts one proposal, and an
authorised reviewer for that venue approves. Only then, and only with a confirmation reference, does
the backend mark it `CONFIRMED`. Then the same assistant walks through food, the event permit,
funding, EngageSC, accessibility and publicity, with each office's deadline counted back from the
event date.

**Student-government assistant.** No language model. It ranks 13 approved sources (11 official USG/GSG
pages and 2 news reports labelled as news) by keyword overlap and answers with the excerpt and its
link, or says it can't verify. Concerns can be routed as feedback, with identity shared only on a
separate tick. Analytics count topics, never who asked.

**When the model is unavailable.** Gemini is optional. If the key is missing or over quota, a
rule-based agent answers through the same tools, so every flow keeps working.

## Features by role

| Role (demo account) | What they do |
|---|---|
| **Student** (Priya) | Student Agent chat; Discover across 1,999 clubs with search, interest chips and reasons; club pages with each Club Agent, FAQ, events and source links; save clubs; express interest (name shared only if ticked); rate recommendations (helpful, not relevant, hide); notifications from followed clubs and student government; USG/GSG assistant; feedback |
| **Club representative** (Maya, for **HackSC**) | Event planning assistant (`/plan`): rooms, venue request, permit, food, funding, emails, 7-step plan with deadlines; bookings with status and audit trail; **outreach**: post events, recruitment calls and updates, which notify followers (and the club's Slack channel); edit the public profile; recruitment inbox |
| **Venue reviewer** (Daniel) | Queue of agent-prepared requests for their venue only; approve, reject or request changes; confirm with a reservation number |
| **USG representative** (Jordan) | Same assistant students see; manage approved sources (versioned); feedback inbox with acknowledgement; announcements; analytics of what students ask about |

Live vs simulated: clubs, club events, government sources and everything students, officers and
representatives write are stored in Supabase. **Venue inventory and availability are simulated** and
labelled so everywhere. Nothing is sent to a USC system.

## Slack bot

Clubs mostly talk in Slack, so Slack replaces WhatsApp as the second channel. It runs on a free Slack
workspace and uses the same backend, identities and rules as the web app.

```
/trojan ask <question>               Student Agent: find clubs
/trojan club <club>: <question>      that club's public Club Agent
/trojan usg <question>               USG/GSG assistant with source links (or: gsg)
/trojan notifications                club posts and announcements for you
/trojan status                       booking requests (club representatives)
/trojan post event Title | Message | 2026-11-20 18:00-19:30 | Location
/trojan confirm <code>               publish the post you previewed
```

Safety: every request must carry a valid Slack signature, and requests older than 5 minutes are
rejected (replay protection). Retries are de-duplicated. Only Slack users linked to an account
(`SLACK_USER_MAP`) are served, and their role still comes from the server. Posts need a preview and a
confirm. Submitting, accepting or cancelling a booking and sending interest are refused in Slack and
point to the web app. Club posts made on the web are mirrored to `SLACK_OUTREACH_CHANNEL`.

Setup (free Slack workspace):
1. Create an app at api.slack.com/apps → **Slash Commands** → `/trojan`, request URL
   `https://<your-backend>/api/v1/webhooks/slack/commands`.
2. **OAuth & Permissions** → bot scopes `commands` and `chat:write`; install to the workspace; invite the
   bot to your club channel.
3. Put the signing secret, bot token (`xoxb-…`), channel id and user links in `backend/.env`
   (`SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_OUTREACH_CHANNEL`, `SLACK_USER_MAP`). For local
   testing expose port 8000 with a tunnel such as `cloudflared` or `ngrok`.

## Run it

```bash
# backend (http://localhost:8000/docs)
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env               # every key is optional
.venv/bin/uvicorn main:app --reload --env-file .env

# frontend (http://localhost:3000)
cd frontend && npm install && npm run dev
```

Open `/demo` and pick a role. Open two windows (club representative and venue reviewer) to watch a
booking go from request to confirmed.

Tests: `cd backend && .venv/bin/python -m pytest -q`; `cd frontend && npx tsc --noEmit && npm run lint`.

Sign-in uses demo identities (`X-Demo-User`, enabled with `ALLOW_DEMO_AUTH`). Their roles are defined
server-side in `backend/app/security/demo_roles.py`. Supabase Auth sign-in is supported by the backend
but not wired into the UI.

## Configuration (`backend/.env`)

| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | Database (backend only). Empty = in-memory seed data |
| `ALLOW_DEMO_AUTH`, `DEMO_CLUB_ID` | Demo sign-in; the club the demo representative runs (default `usc-hacksc`) |
| `GEMINI_*` | Optional model. Empty or over quota = rule-based agents |
| `EMBEDDING_PROVIDER`, `OLLAMA_*` | Embeddings for search (Gemini or a local Ollama) |
| `ASSISTANT_MODE` | Event planning assistant: `rules` or `gemini` |
| `DEMO_AUTO_REVIEW` | `true` lets a simulated reviewer approve; `false` needs a person |
| `BOOKING_STORE`, `CAMPUS_STORE` | `auto` / `supabase` / `json` storage for bookings and for government and outreach records |
| `SLACK_*`, `APP_BASE_URL` | Slack bot (above) |
| `FRONTEND_ORIGIN` | Allowed browser origins |

Database: apply `supabase/migrations/0001`–`0006` in order.

## How these numbers were measured

The table in "What it does" comes from a script that runs these steps against the live API:
- 10 hand-written booking sentences, each compared field by field with the stored profile;
- one full booking from first message to `CONFIRMED`, timed;
- 20 realistic USG/GSG questions, counting those answered with a source;
- timed calls to directory, search and recommendations.

Human think-time is not included in the 4.5 s. It measures the system's part of a chain that today runs
over email.

## Not built

- Alumni (P2).
- Streaming replies.
- Realtime push: screens poll every 8–30 seconds.
- Supabase Auth sign-in in the UI.
- A real USC venue-system integration (the adapter is a stub by design).

## Docs

- [`CONTEXT.md`](CONTEXT.md), [`use-ui-styling.md`](use-ui-styling.md): frontend architecture and design system
- [`event-planning-integration.md`](event-planning-integration.md), [`docs/event-pipeline.md`](docs/event-pipeline.md): the planning workflow
- [`docs/student-agent-contract.md`](docs/student-agent-contract.md): student and club agent contract
