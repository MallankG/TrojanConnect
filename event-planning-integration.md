# Event planning assistant: integration guide

The main way to use event planning is the **Assistant**. A club officer types something like *"Book a 35 person event for December 20th 2026 from 7pm - 8pm"* and gets back the free rooms. After they pick one, the assistant takes them through the rest of the campus process: the venue request, food, the event permit and the emails.

This guide is for embedding that Assistant in a larger app with your own styling. All the logic is in the backend. Your UI only shows the reply text and the **cards** that come with it, and calls a few endpoints when a card's button is pressed. You don't re-implement any planning rule.

- Feature overview and the booking workflow: [docs/event-pipeline.md](docs/event-pipeline.md)
- Interactive API reference (generated, always current): http://localhost:8000/docs
- Reference UI: `frontend/src/components/pipeline/AssistantPanel.tsx` (it renders every card type)

---

## 1. How it works

```
 Your app's Assistant UI
   │  POST /api/v1/pipeline/agent/chat   {message, history}
   ▼
 Club Agent  ── Gemini (ASSISTANT_MODE=gemini)  or  built-in rules agent (ASSISTANT_MODE=rules / no key / Gemini fails)
   │  calls validated tools only (backend/app/tools/event_plan.py)
   ▼
 Event plan (profile, 7 steps, deadlines)        Booking workflow (venue + permit)
 backend/app/workflows/event_pipeline            backend/app/workflows/booking
                                                  Club Agent ⇄ Venue Scheduling Agent → reviewer → CONFIRMED
   │
   ▼
 {reply, actions[], tools[], state}  →  your UI renders the text and the cards
```

Each turn returns plain text plus a list of cards. The cards are how the user acts:
- pick a room or a caterer (`options`)
- fill in missing details (`fields`)
- confirm and accept a booking (`booking`)
- open an email draft (`form`)
- jump to the next step (`suggestions`)

**The agent never submits, accepts, approves or confirms anything.** Those happen only when the user presses a card button, or when a reviewer decides. The seven steps are the same whichever way the user works:

| # | Step id | Step | Handled by |
|---|---|---|---|
| 1 | `venue` | Reserve the venue | Booking workflow: rooms → confirm → proposal → accept → review |
| 2 | `food` | Pick an approved food vendor (skipped if no food) | Caterer picker + quote form |
| 3 | `permit` | Event permit (needs venue + food) | Booking workflow → Event Permits review |
| 4 | `funding` | Funding application to the VP of Finance | Email draft |
| 5 | `engage` | EngageSC event (needs venue + permit) | Manual (needs a USC login) |
| 6 | `access` | Accessibility and non-discrimination statements | Email draft |
| 7 | `publicity` | Publicize (needs EngageSC + accessibility) | Email drafts |

**Nothing is sent to a USC system or by email.** Room availability comes from a seeded demo inventory and must be shown as *simulated* (see section 7).

---

## 2. Run it

```bash
# one-time
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp backend/.env.example backend/.env

# every time
cd backend  && .venv/bin/uvicorn main:app --port 8000 --env-file .env
cd frontend && npm run dev            # reference UI: http://localhost:3000/pipeline → Assistant tab
```

Settings in `backend/.env`:

| Variable | Purpose | Default |
|---|---|---|
| `ASSISTANT_MODE` | `rules`: the built-in agent answers, with no model calls and no API cost. `gemini`: Gemini answers, and the built-in agent takes over automatically if Gemini fails (quota, outage). | `gemini` if a key is set, else `rules` |
| `GEMINI_API_KEY`, `GEMINI_CHAT_MODEL`, `GEMINI_API_VERSION` | Gemini settings (only for `gemini` mode) | none, `gemini-3.5-flash`, SDK default |
| `DEMO_AUTO_REVIEW` | `true`: a **simulated** venue or permits office approves accepted requests, so the waterfall continues without a person. `false`: a reviewer approves on `/pipeline/review`. | `false` |
| `BOOKING_STORE` | Where booking requests are kept: `auto` uses Supabase when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are set and `supabase/migrations/0004_venue_booking.sql` has been applied, otherwise `backend/data/bookings.json`. `supabase` or `json` forces one. `GET /api/v1/bookings/storage` shows which is in use and why. | `auto` |
| `BOOKING_ADAPTER` | Who supplies availability and places confirmed bookings (`backend/app/workflows/booking/adapters.py`). Only `simulated` exists today; an admin-agent adapter that books through the real venue systems can be registered later without changing the workflow. | `simulated` |
| `FRONTEND_ORIGIN` | Browser origins allowed to call the API, comma-separated. **Add your host app's origin here.** | `http://localhost:3000` |

---

## 3. Conventions for every request

- **Base URLs:** chat and event plan `http://localhost:8000/api/v1/pipeline`; bookings `http://localhost:8000/api/v1`.
- **Required header:** `X-TrojanConnect-Client: web` on every request. Without it you get `403`. It is a CSRF guard (it forces a CORS check), not authentication.
- **Bodies:** JSON with `Content-Type: application/json`.
- **Errors:** `{"detail": "message"}`. Booking endpoints send `{"detail": {"code", "message", "retryable"}}`, and `422` sends a list of validation objects. Show the message as it is.
- **One event:** the backend stores a single event. There are no event ids or user accounts yet.

A minimal client:

```ts
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function api<T>(path: string, init?: { method?: string; json?: unknown; headers?: Record<string, string> }): Promise<T> {
  const res = await fetch(`${API}/api/v1${path}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", "X-TrojanConnect-Client": "web", ...init?.headers },
    body: init?.json === undefined ? undefined : JSON.stringify(init.json),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : body.detail?.message ?? res.statusText);
  return body as T;
}
```

The reference client with all types is `frontend/src/lib/api-client.ts` (`pipelineApi`, `bookingApi`, `AgentAction`, `Booking`).

---

## 4. The chat contract

### Status: `GET /pipeline/agent`

```jsonc
{ "configured": true, "mode": "rules",     // "rules" | "gemini"
  "model": "rules",                         // or e.g. "gemini-3.5-flash"
  "tools": [{ "name": "prepare_booking_request", "description": "…" }, …] }
```

`configured` is always `true`, because the built-in agent needs no key. Use `mode` to choose any explanatory text, e.g. "Built-in booking assistant".

### One turn: `POST /pipeline/agent/chat`

```ts
type Msg = { role: "user" | "assistant"; text: string };
const r = await api<AgentReply>("/pipeline/agent/chat", { method: "POST", json: { message, history } });
history.push({ role: "user", text: message }, { role: "assistant", text: r.reply });
```

```jsonc
{
  "reply":   "Saved: Expected attendance 35, Event date 2026-12-20 …\nRooms for 35 people on Sun Dec 20 2026, 7:00 PM–8:00 PM: …",
  "actions": [{ "type": "options", "title": "Pick a room", "options": [ … ] }],
  "tools":   [{ "tool": "update_event_profile", "ok": true, "error": null }],
  "state":   { "profile": {…}, "progress": {…}, "log": […] },
  "model":   "rules"                       // or "gemini:<model>"
}
```

- **`reply`:** plain text with line breaks. Render it with `white-space: pre-wrap`; it is not Markdown. If Gemini failed and the built-in agent answered instead, the reply starts with a note in parentheses.
- **`actions`:** the cards to render under this reply (section 5), in order.
- **`state`:** the event after the turn. If your app also shows the event (header, step list), refresh it from this.
- **`history`:** the backend keeps no chat history, so send the conversation so far each time (it uses the last 20 messages). Limits: `message` ≤ 4000 characters, `history` ≤ 60 messages, no extra keys.
- A turn takes under a second with the built-in agent and 3–15 seconds with Gemini. Show a working state and allow only one turn in flight at a time.

### What the user can say

The built-in agent understands these; Gemini understands them too, plus free-form questions.

| The user says | The agent does |
|---|---|
| "Book a 35 person event for December 20th 2026 from 7pm - 8pm" (also "12/20 7-8pm", "for 40 people in TCC", "called Robotics Mixer") | Saves attendance, date, times, venue type and event name, then returns an `options` card of free rooms |
| "Book TCC 350 from 7:00 PM to 8:00 PM" (what a room option sends) | Saves the room, drafts the venue request, returns a `booking` card (plus a `fields` card if details are missing) |
| "Book my venue" | Drafts the request for the room already chosen, or shows room options |
| "Which rooms are free?" | `options` card |
| "Where is my booking?" | Booking status, the `booking` card, and `suggestions` once confirmed |
| "Give me another option" | Asks the Venue Agent for a different option within the user's constraints |
| "Pick a caterer" / "Use caterer City Tacos" / "No food" / "I have the quote" | Caterer `options`, saves the vendor, `fields` for the quote, marks the food step done |
| "Apply for the permit" | Drafts the permit request (`fields` for the USC ID and on-site contact if missing) |
| "Draft the budget / accessibility / Instagram / advisor email" | `form` card for the email draft (`fields` first if details are missing) |
| "What should I do next?" | Steps to do now, waiting and late, plus `suggestions` |
| "Start over" | `reset` card |

---

## 5. Cards (`actions`)

Every card is plain JSON, so you can style it any way you like. Where a card has a button, the table says what the button must do.

| `type` | Shape | Render | When the user acts |
|---|---|---|---|
| `options` | `{title, options: [{label, detail, message}]}` | A list of choices (rooms, caterers) | Send `message` as the next chat turn |
| `fields` | `{title, keys: string[], then}` | An inline form for those profile fields. Get each field's label, type and options from `GET /pipeline/schema` | Save each field with `PUT /pipeline/profile {key: value}`; on "Continue", send `then` as the next chat turn |
| `suggestions` | `{items: [{label, message}]}` | Quick-reply chips. Show them only under the latest message | Send `message` |
| `booking` | `{kind: "venue_booking" \| "event_permit"}` | The booking card (section 6) | Booking endpoints (section 6). After submit, accept or alternatives, send "Where is my booking?" so the agent narrates what happened |
| `form` | `{formId, step}` | An email draft card: `GET /pipeline/emails/{formId}` returns `{to, subject, body, mailto, ready, missing_fields}` | Link to `mailto`; nothing is sent by the app |
| `field` | `{key}` | A button that opens your profile form at that field (used for the USC ID if someone types it into chat) | Your navigation |
| `reset` | `{}` | A "Clear this event" button | Ask the user to confirm, then `POST /pipeline/reset` |

Rules for cards:
- **Only the newest `booking` card per `kind` needs to be live.** Older ones can collapse to a line like "see the latest card below", because every booking card shows the same request.
- **`options` and `fields` from older messages should be disabled.** Their choices may be out of date.
- **Unknown `type`s should be ignored**, so the backend can add cards later.

A field definition from `GET /pipeline/schema`, for rendering `fields` cards:

```jsonc
{ "key": "eboardPosition", "label": "E-board position", "short_label": "E-board position", "group": "You (requester)",
  "type": "select",                // text | email | tel | date | time | number | textarea | select | bool | multi
  "options": ["President", …], "option_labels": null, "optional": false,
  "only_when_serving_food": false, "private": false }   // private: uscId — fine in a form, never typed into chat
```

Values are strings, except yes/no fields (JSON booleans) and `multi` fields (lists). Dates are `YYYY-MM-DD`; times are 24-hour `HH:MM` on the hour or half hour. `PUT /pipeline/profile` saves what it is given, and `GET /pipeline/profile` returns a `problem` per field (`null`, `"missing"`, or a validation message) to show under the input.

---

## 6. The booking card

Used for `booking` cards, both the venue booking and the event permit. Load the request with `GET /bookings?kind=<kind>` and take the first item, which is the latest (none if there's no request yet). Then render by `state`:

| `state` | Show | Buttons |
|---|---|---|
| none / `NEEDS_INFORMATION` / `CHANGES_REQUESTED` | `missing_fields`, `blockers`, `next_action` | "Prepare request" → `POST /bookings/drafts {kind}` |
| `READY_FOR_SUBMISSION` | `summary` (lines) and `warnings` | "Confirm & send" → `POST /bookings/{id}/submit {summary_hash, user_confirmed_summary: true, idempotency_key}` |
| `NEGOTIATING` | `active_proposal`: venue, time, capacity, **`differences`**, `expires_at`; `rounds`/`max_rounds` | "Accept & send for review" → `POST /bookings/{id}/proposals/{proposal_id}/accept {proposal_version, user_confirmed: true, idempotency_key}`; "Ask for another option" → `POST /bookings/{id}/alternatives {reason, idempotency_key}` |
| `PENDING_HUMAN_REVIEW`, `APPROVED` | "Not confirmed yet" and `next_action`. Poll every few seconds | none |
| `CONFIRMED` | `confirmation.reference` (reservation # or permit code) and `confirmation.contact_name` | "Request cancellation" |
| `FAILED_REQUIRES_HUMAN`, `REJECTED`, `CANCELLED` | `next_action` (it includes the reason) and `escalation.details` | "Prepare request" to start again |

Use the `can` flags (`prepare`, `submit`, `accept`, `alternatives`, `cancel`) to enable buttons, and `stage`/`stages` for a progress stepper. `messages` (the Club Agent ⇄ Venue Agent conversation) and `timeline` (the audit trail) are optional extras. "Withdraw request" / "Request cancellation" → `POST /bookings/{id}/cancel {reason, idempotency_key}`.

Generate a fresh `idempotency_key` per click (`crypto.randomUUID()`). Errors you'll see:
- `409 SUMMARY_CHANGED`: the profile changed after the summary was shown. Prepare again and show the new summary.
- `409 PROPOSAL_EXPIRED` / `PROPOSAL_STALE`: ask for another option.
- `409 ROUND_LIMIT`: no more alternatives; accept the current proposal or cancel.

With `DEMO_AUTO_REVIEW=false`, a person approves on `/pipeline/review` (reference: `frontend/src/components/review/VenueReviewApp.tsx`; endpoints `GET /venue-review/queue`, `POST /reviews/{task}/decision`, `POST /reviews/{task}/confirm`, all with the header `X-TrojanConnect-Reviewer: <id>`).

### A full conversation

What the reference UI does from a blank event (checked in a browser):

1. **User:** "Book a 35 person event for December 20th 2026 from 7pm - 8pm"
   **Reply:** saved facts, plus which venue types aren't possible and why. **Card:** `options` with 6 rooms.
2. **User clicks "TCC 350 · 7:00 PM–8:00 PM"** (sends "Book TCC 350 from 7:00 PM to 8:00 PM")
   **Cards:** `booking` (needs information) and `fields` for 8 missing details.
3. **User fills the form → Continue** (sends "Book my venue")
   **Card:** `booking` in `READY_FOR_SUBMISSION`.
4. **Confirm & send** (UI then sends "Where is my booking?")
   **Reply:** "Proposal ready… exactly as requested".
5. **Accept & send for review** (UI sends "Where is my booking?")
   **Reply:** "Confirmed. Reference 685595". **Card:** `suggestions` ("Pick a caterer", …).
6. **Pick a caterer → City Tacos → `fields` (menu, cost) → Continue**
   **Reply:** "Food step done".
7. **Apply for the permit → `fields` (USC ID, on-site contact) → Continue → Confirm & send**
   **Reply:** permit confirmed with a code.
8. **Draft the budget email → `fields` → Continue**
   **Card:** `form` with the draft.

---

## 7. Embedding and custom styling

You have two options. Both use the same backend, so the flow above stays the same whichever you pick.

### A. Reuse the reference components and restyle them

`AssistantPanel` renders the chat and every card. It needs the event state, which you load from `GET /pipeline/state`:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { AssistantPanel } from "@/components/pipeline/AssistantPanel";
import { pipelineApi } from "@/lib/api-client";
import { deriveState, type PipelineState } from "@/lib/pipeline/plan";

export function EventAssistant() {
  const [state, setState] = useState<PipelineState | null>(null);
  const reload = useCallback(() => { pipelineApi.state().then(setState); }, []);
  useEffect(reload, [reload]);
  if (!state) return null;
  return (
    <div className="tc-assistant">   {/* scope your theme overrides here */}
      <AssistantPanel d={deriveState(state, new Date())} profile={state.profile} onState={setState} onReload={reload}
        onJumpToField={key => { /* open your profile form at `key`, or do nothing */ }} />
    </div>
  );
}
```

Files to copy:
- `components/pipeline/AssistantPanel.tsx`, `BookingCard.tsx`, `StepDetail.tsx` (email and form cards), `ProfileForm.tsx` (inputs for `fields` cards), `ui.tsx`
- `lib/api-client.ts`, `lib/pipeline/{plan,fields}.ts`

They need Tailwind v4.

**Theming.** Every colour comes from CSS variables, which Tailwind exposes as utility classes (`bg-paper`, `text-cardinal`, …) in `frontend/src/app/globals.css`. Redefine them, globally or under a wrapper class, to restyle without touching the components:

```css
.tc-assistant {
  --tc-paper: #f7f7fb;      /* page and chat bubble background   → bg-paper   */
  --tc-surface: #ffffff;    /* cards and panels                  → bg-surface */
  --tc-ink: #111827;        /* main text                         → text-ink   */
  --tc-muted: #6b7280;      /* secondary text                    → text-muted */
  --tc-line: #e5e7eb;       /* borders                           → border-line */
  --tc-cardinal: #4f46e5;   /* primary buttons, user bubbles     → bg-cardinal */
  --tc-on-cardinal: #ffffff;/* text on primary                   → text-on-cardinal */
  --tc-ok: #15803d;  --tc-ok-bg: #dcfce7;      /* done / confirmed */
  --tc-wait: #a16207; --tc-wait-bg: #fef9c3;   /* waiting / simulated labels */
  --tc-late: #b91c1c; --tc-late-bg: #fee2e2;   /* errors, missing fields */
  --tc-ready: #1d4ed8; --tc-ready-bg: #dbeafe; /* ready / Club Agent messages */
  --tc-block: #6b7280; --tc-block-bg: #f3f4f6; /* blocked / neutral pills */
}
```

`globals.css` also redefines these for dark mode under `prefers-color-scheme: dark`; override those too if you support dark mode. The shared button styles (`btn`, `btnPrimary`) and status pills are in `components/pipeline/ui.tsx`, so restyling them there changes every card. If your app doesn't use Tailwind, use option B.

### B. Build your own UI from the contract

Use sections 4–6 as the spec. A complete Assistant needs:
1. a message list (`reply` with `pre-wrap`)
2. an input (one turn at a time)
3. renderers for the seven card types
4. the booking card's six states.

The backend validates everything, so a mistake in the UI can't skip a rule. A wrong call gets a `409` or `422` with a message to show.

---

## 8. Rules any UI must keep

These come from the PRD and are not optional styling choices:

- **Keep "proposal", "pending human review", "approved" and "confirmed" visibly different.** Only `state: CONFIRMED` is a booking.
- **Label venue availability as simulated** (`simulated: true`, `source_label`). Label simulated reviewer decisions as simulated: their names say "(demo)" and the reference card shows them.
- **Only the user submits, accepts or cancels, by pressing a button.** Don't auto-press booking buttons on their behalf.
- **Show a proposal's `differences`** before the user accepts it.
- **Don't send the USC ID as a chat message.** Collect it in a form (`fields` card or profile form) that calls `PUT /pipeline/profile`.
- **Confirm before `POST /pipeline/reset`.** It erases the event and withdraws open bookings.

---

## 9. Other endpoints

The cards above use these. You only need them directly for screens beyond the Assistant, such as a dashboard or a full profile form.

**Event plan** (base `/api/v1/pipeline`):

| Method and path | Purpose |
|---|---|
| `GET /schema` | Field, step, form and venue-type definitions (fetch once) |
| `GET /status` | Dashboard: event header, `do_now`, `waiting_on_reply`, `late`, each step's status, deadline, checklist and forms (each form has `booking: {id, state, state_label, next_action}` for agent-handled ones) |
| `GET /profile` | Saved values and per-field problems |
| `PUT /profile` | Merge profile fields |
| `PUT /progress` | Tick a checklist item `{step, check, value}` or record `{step, dataKey, dataValue}`. The venue and permit outcomes return `409`: only the booking workflow sets them |
| `GET /forms`, `/forms/{id}`, `/emails/{id}`, `/caterers?q=`, `/activity`, `/state` | Read models |
| `POST /reset` | Clear the event |

**Bookings** (base `/api/v1`):

| Method and path | Purpose |
|---|---|
| `GET /bookings?kind=` | Requests for the current event, newest first |
| `GET /bookings/{id}` | One request |
| `POST /bookings/drafts` | Prepare or refresh a draft |
| `POST /bookings/{id}/submit` | Confirm and send |
| `POST /bookings/{id}/proposals/{pid}/accept` | Accept the active proposal |
| `POST /bookings/{id}/alternatives` | Ask for another option |
| `POST /bookings/{id}/cancel` | Withdraw or request cancellation |
| `GET /venue-review/reviewers` | Demo reviewer identities |
| `GET /venue-review/queue` | A reviewer's queue |
| `POST /reviews/{task}/decision` | Approve, reject or request changes |
| `POST /reviews/{task}/confirm` | Record the reference and confirm |

---

## 10. Current limits

- **One event, no user accounts.** The club rep is a single local user, and reviewers are demo identities. Add Supabase Auth to the router dependencies before multi-user use.
- **Storage.** Booking requests go to Supabase (`booking_requests`, `booking_idempotency`) once migration `0004_venue_booking.sql` is applied, and to `backend/data/bookings.json` until then. The event profile and step progress are still `backend/data/event_pipeline.json`.
- **Simulated inventory.** Rooms, most capacities and all availability are seeded demo data.
- **The built-in agent understands booking-style phrasing** (section 4), not open questions. Use `gemini` mode for free-form chat; it falls back to the built-in agent when Gemini fails.
- **The reference UI computes step status itself** (`lib/pipeline/plan.ts` mirrors `backend/app/workflows/event_pipeline/plan.py`). A new UI should read `GET /status` instead.

---

## 11. Where the code is

| What | Path |
|---|---|
| Chat endpoint and mode switch | `backend/app/workflows/event_pipeline/router.py` (`/agent`, `/agent/chat`) |
| Built-in Club Agent (parsing, room options, waterfall) | `backend/app/agents/rules_agent.py` |
| Gemini Club Agent | `backend/app/agents/event_agent.py`, `backend/app/integrations/gemini/` |
| Agent tools (shared by both agents) | `backend/app/tools/event_plan.py` |
| Booking workflow, Venue Agent, inventory, policy | `backend/app/workflows/booking/` |
| Booking storage (Supabase / JSON) and the venue adapter hook | `backend/app/workflows/booking/store.py`, `adapters.py`, `supabase/migrations/0004_venue_booking.sql` |
| Event plan rules and read models | `backend/app/workflows/event_pipeline/{plan,views,store}.py` |
| Reference Assistant UI | `frontend/src/components/pipeline/AssistantPanel.tsx`, `BookingCard.tsx` |
| Theme tokens | `frontend/src/app/globals.css` |
| Tests | `backend/tests/` (`cd backend && .venv/bin/python -m pytest`) |
