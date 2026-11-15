# Event Pipeline

Automates the club event walkthrough (venue → food → permit → funding → EngageSC → accessibility → publicity). A club rep enters the event **once**. The `/pipeline` page then shows where they are in the waterfall, what each step is waiting on, and the deadlines counted back from the event date.

The venue booking and the event permit are handled by **agents**, not USC web portals. The rep confirms a summary. The **Club Agent** and a **Venue Scheduling Agent** then negotiate a room and time, the rep accepts one proposal, and a **human reviewer** on `/pipeline/review` approves it. Only the backend marks a request confirmed, and only once it has that approval and a reference number. This follows the PRD's booking workflow (§5.1, §6–§9).

**Nothing is sent to a USC system.** Availability comes from a seeded, clearly labelled **simulated** inventory. No form is submitted automatically and no email is sent. In line with the PRD's non-goals (§2.2, §7.3 #8–9), there is no live integration and no automatic approval.

## Where things live

| Layer | Path |
|---|---|
| UI: pipeline (`/pipeline`) | `frontend/src/app/pipeline/page.tsx`, `frontend/src/components/pipeline/*` (booking card: `BookingCard.tsx`) |
| UI: human review (`/pipeline/review`) | `frontend/src/app/pipeline/review/page.tsx`, `frontend/src/components/review/VenueReviewApp.tsx` |
| Steps, deadlines, the fields each form needs, email templates | `frontend/src/lib/pipeline/plan.ts`, `fields.ts` (mirrored in `backend/app/workflows/event_pipeline/plan.py`) |
| API client | `frontend/src/lib/api-client.ts` (`NEXT_PUBLIC_API_URL`, default `http://localhost:8000`) |
| Pipeline API + state | `backend/app/workflows/event_pipeline/` (`/api/v1/pipeline/*`) |
| Booking workflow and agents | `backend/app/workflows/booking/` (`/api/v1/bookings/*`, `/api/v1/venue-review/*`, `/api/v1/reviews/*`) |
| Local state (git-ignored) | `backend/data/event_pipeline.json`, `backend/data/bookings.json` |

Storage is JSON files for the hackathon. Replace `event_pipeline/store.py` and `booking/store.py` when Supabase lands; `booking/inventory.py` maps onto the PRD §13 venue tables.

## Setup

Run the frontend and backend as described in the root README, and open http://localhost:3000/pipeline (club rep) and http://localhost:3000/pipeline/review (reviewer). No browser automation or Node setup is needed on the backend any more.

## The booking workflow

```
club rep presses "Confirm & send"  (summary_hash must match what they saw)
  → ROUTING           venue type → authority, from config (unknown → needs a human)
  → AVAILABILITY_CHECK lead time and booking window (fail → needs a human), then simulated inventory
  → NEGOTIATING       Club Agent ⇄ Venue Scheduling Agent, ≤ 5 rounds, one active proposal
  → club rep presses "Accept & send for review"  (expiry and availability rechecked)
  → PENDING_HUMAN_REVIEW  review packet in the authority's queue
  → reviewer: APPROVE / REJECT / REQUEST_CHANGES (a reason is required for the last two)
  → APPROVED          not yet confirmed
  → CONFIRMED         backend only: valid approval from this authority + reference (6-digit reservation #)
```

The event permit uses the same path without availability or negotiation. It opens only once the venue booking is CONFIRMED and the food step is done, and goes to the Event Permits reviewer, who issues the permit code.

**How the agents negotiate.** Both sides are deterministic code; availability and acceptance are never decided by a language model (PRD §7.3 #2, §10.1).
- **Venue Scheduling Agent** (`negotiation.py`). It acts for one authority and only offers options that pass every check: capacity, equipment, opening hours, the venue's rules (e.g. classroom start times, no amplified sound outdoors after 8 PM) and existing bookings, including slots held by other requests. If the first choice is taken, it suggests the room that best fits the group at the requested time.
- **Club Agent's negotiator.** It works only within what the rep confirmed: their room ranking, whether other rooms are OK, and how far the time may move (the `timeFlexMinutes` profile field). It re-checks every offer, declines anything outside those limits, and counters toward options the rep would prefer (e.g. "our first choice, 30 minutes earlier"). Then it takes the best one to the rep, listing exactly how it differs from the request.
- Every exchange is a validated PRD §6.2 envelope with allowlisted message types. The card's "Agent conversation" shows them, and the "Audit trail" lists every state change with actor, role, reason and correlation ID.

**Who can do what** (`states.py`, PRD §7.2):

| Action | Who |
|---|---|
| Prepare / refresh a draft | Club rep or the Club Agent (assistant) |
| Submit, accept a proposal, cancel | Club rep only (buttons) |
| Route, check availability, negotiate, open review | Backend / Venue Agent |
| Approve, reject, request changes, confirm a cancellation | A reviewer assigned to that authority |
| Mark CONFIRMED | Backend, after checking the approval and the reference |

The venue step's "submitted / confirmed" checks, reservation #, and venue contact are set by the workflow, as are the permit's "submitted / approved" and permit code. The API refuses manual changes to them (409). When a booking is confirmed for a shifted time or another room, the profile follows it, because the rep explicitly accepted that change.

**Reviewer identities.** `/pipeline/review` has a demo "Signed in as" picker: TES, Classroom Scheduling, Viterbi, ECE rooms, Event Permits, and a USG representative with no venue authority. The server checks each action against the reviewer's assigned authorities. A USG rep or the wrong office gets 403, and the attempt is logged. This stands in for Supabase Auth.

## API

Full reference and a guide to building a UI on these endpoints: [event-planning-integration.md](../event-planning-integration.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/pipeline/state` | profile, step progress and activity log |
| PUT | `/api/v1/pipeline/profile` | merge profile fields |
| PUT | `/api/v1/pipeline/progress` | `{step, check, value}` or `{step, dataKey, dataValue}`; 409 for workflow-owned keys |
| POST | `/api/v1/pipeline/reset` | clear the event (open bookings are withdrawn; held ones go to the reviewer as cancellation requests) |
| GET | `/api/v1/pipeline/schema`, `/status`, `/profile`, `/forms`, `/forms/{id}`, `/emails/{id}`, `/caterers`, `/activity` | read models for a UI |
| GET | `/api/v1/pipeline/agent` · POST `/agent/chat` | assistant status · `{message, history}` → `{reply, actions, tools, state}` |
| GET | `/api/v1/bookings?kind=venue_booking\|event_permit` | requests for the current event, newest first |
| POST | `/api/v1/bookings/drafts` | `{kind}` → draft with `summary` and `summary_hash` |
| POST | `/api/v1/bookings/{id}/submit` | `{summary_hash, user_confirmed_summary: true, idempotency_key}` |
| POST | `/api/v1/bookings/{id}/proposals/{pid}/accept` | `{proposal_version, user_confirmed: true, idempotency_key}` → PENDING_HUMAN_REVIEW |
| POST | `/api/v1/bookings/{id}/alternatives` · `/cancel` | `{reason, idempotency_key}` |
| GET | `/api/v1/venue-review/reviewers` · `/queue` | demo identities · the queue for `X-TrojanConnect-Reviewer` |
| POST | `/api/v1/reviews/{task}/decision` | `{decision, reason, external_confirmation_reference?, idempotency_key}` |
| POST | `/api/v1/reviews/{task}/confirm` | `{external_confirmation_reference, idempotency_key}` → CONFIRMED |

Every request must send `X-TrojanConnect-Client: web`. This custom header makes browsers run a CORS check first, and CORS only allows the frontend origin. It is not real auth. Booking errors come back as `detail: {code, message, retryable}`, and every write takes an idempotency key.

## Event agent (Assistant tab) = the Club Agent

Chat agent on Gemini. You describe the event, and it fills the profile, reports status and deadlines, prepares the venue booking and permit, asks the venue agent for alternatives, lines up email drafts, and records progress on the manual steps. It acts only through these tools:

| Tool | What it does |
|---|---|
| `get_event_plan_status` | Step status, deadlines, blockers, missing fields, booking states, recent activity |
| `update_event_profile` | Saves event facts into the profile (validated per field) |
| `get_form_details` | Rules, required and missing fields for a form, email or manual step |
| `check_caterer` | Looks a vendor up in the permit's approved-caterer list |
| `check_venue_availability` | Read-only: what the venue agent could offer from the simulated inventory, plus lead-time problems |
| `prepare_booking_request` | Builds the venue or permit draft and shows the booking card with **Confirm & send**. Does not submit |
| `get_booking_status` | State, active proposal and how it differs from the request, review status, reference, or why it needs a human |
| `request_alternatives` | Asks the venue agent for another option; every confirmed constraint still applies |
| `record_step_progress` | Ticks checklist items on manual steps; refuses workflow-owned keys |
| `draft_email` | Shows a card that opens an email draft |
| `offer_reset` | Shows a "Clear this event" button |

Limits enforced in code:
- The agent cannot submit, accept a proposal, approve, confirm or cancel; there are no tools for these. The rep presses buttons and the reviewer decides.
- The USC ID is never sent to the model and is not stored in any booking request.
- Unknown fields and invalid values are rejected. Agent writes are logged with an `assistant:` / `club_agent` actor.

Setup: copy `backend/.env.example` to `backend/.env` and start the backend with `--env-file .env`.

- `ASSISTANT_MODE=rules` (or no `GEMINI_API_KEY`): the **built-in Club Agent** (`backend/app/agents/rules_agent.py`) answers with no model calls. It reads sentences like "Book a 35 person event for December 20th 2026 from 7pm - 8pm", saves the facts, lists the free rooms across every venue office as clickable options, and after you pick one walks the waterfall: an inline form for missing details, the Confirm card, then caterer, quote, permit and email suggestions. With Gemini configured, the chat falls back to it whenever Gemini fails (e.g. quota).
- `DEMO_AUTO_REVIEW=true` (demo only, off by default): a **simulated** venue or permits office approves accepted requests through the same authorization checks, so the waterfall continues without opening `/pipeline/review`. Its name, decision and reference are labelled simulated. Set it to `false` to have a person approve.

Code: `backend/app/agents/` (loop, model interface), `backend/app/tools/event_plan.py` (tools), `backend/app/workflows/booking/` (workflow, both negotiating agents, inventory, policy), `frontend/src/components/pipeline/AssistantPanel.tsx`. Tests: `cd backend && .venv/bin/python -m pytest` (`tests/test_booking.py` covers the PRD §16 booking cases).

`plan.py` mirrors `frontend/src/lib/pipeline/{fields,plan}.ts`. Until the frontend reads status from the API, a change to steps, forms or fields must be made in both.

## How each step is handled

| # | Step | Automated | Still manual |
|---|------|-----------|--------------|
| 1 | Venue | Routed by venue type to TES / Classroom Scheduling / Viterbi / ECE. Policy checks, simulated availability, Club ⇄ Venue agent negotiation, review packet. Reservation # and venue contact come from the confirmation. Viterbi also keeps an optional email draft to the events office. | The rep confirms the summary and accepts a proposal; a reviewer approves |
| 2 | Food | Lists the 20 caterers accepted by the permit lookup. Drafts an email to Hospitality for vendors that aren't approved. | The approved vendor sheet needs a USC login |
| 3 | Permit | Opens once the venue is CONFIRMED and food is done. The packet flags non-approved caterers, amplified sound, filming, public events. Security, alcohol, insurance and trash questions are never answered for you. | The Event Permits reviewer decides and issues the code |
| 4 | Funding | Drafts the budget email to the VP of Finance | Fill the budget; order in person at OHE and be there for delivery |
| 5 | EngageSC | Locked until venue + permit are done; checklist | Manual: needs a USC login, and the walkthrough video is private |
| 6 | Accessibility | Drafts the request to the VP of Communications. Comes before publicity. | Add the statements |
| 7 | Publicity | Drafts the emails to the VP of Communications and the advisor; tracks the day-of re-post | Make the Canva graphic |

## Rules the venue agent enforces (`booking/policy.py`)
Collected from the public forms (Nov 2026). Each issue cites its source: `live form`, `walkthrough` or `simulated`.
- **Outdoor (TES):** 6 weeks notice. 8:00 AM–11:30 PM. No amplified sound after 8 PM.
- **TCC:** 3 weeks. Capacities: TCC 221 = 10 and the 350/351/352 combo = 126 are from the form; other capacities are simulated.
- **Classroom:** Mon–Thu events start at 6:00 PM or later, Fri at 3:00 PM or later, all end by 11:00 PM. Nothing within 48 hours. Fri–Sun requests are due by Thursday noon the week before. The "weeks 4 through last day of instruction" rule is flagged for the reviewer.
- **EEB/PHE:** at least 3 days ahead; non-EE groups can book at most 1 month out.
- **Permit:** attendance ≤ 60 (walkthrough). Caterers that aren't approved need a one-time approval (health permit + insurance) 2 weeks before the event.

A lead-time or booking-window problem can't be negotiated away. The request goes to FAILED_REQUIRES_HUMAN with the reason, and the agent doesn't work around it.

## Known gaps
- Availability, most capacities and features, and all busy blocks are **simulated** demo data (labelled in the UI). Connecting real USC scheduling systems needs authorization (PRD P2).
- No real auth yet: the club rep is one local user and reviewers are demo identities. Add Supabase Auth to the router dependencies.
- The budget template link in the walkthrough returns **410 Gone**. The vendor sheet and the EngageSC video are USC-login only.
