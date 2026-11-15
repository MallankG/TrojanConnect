# Event planning: what the backend does and how to build a UI on it

This explains the event-planning feature and gives everything needed to build or restyle a UI using only the backend API. No planning rule has to be re-implemented in the client: the backend returns statuses, deadlines, missing fields, form readiness and email drafts ready to render.

- Feature overview and per-step detail: [docs/event-pipeline.md](docs/event-pipeline.md)
- Interactive API reference (generated, always current): http://localhost:8000/docs
- Reference UI built on these APIs: `frontend/src/components/pipeline/`

---

## 1. What is happening

A club officer plans one event and takes it through seven campus steps:

| # | Step id | Step |
|---|---|---|
| 1 | `venue` | Reserve the venue |
| 2 | `food` | Pick an approved food vendor (skipped if no food) |
| 3 | `permit` | Event permit application (needs venue + food) |
| 4 | `funding` | Funding application to the VP of Finance |
| 5 | `engage` | EngageSC event (needs venue + permit) |
| 6 | `access` | Accessibility and non-discrimination statements |
| 7 | `publicity` | Publicize (needs EngageSC + accessibility) |

The backend holds three things for the event:

- **Profile:** every fact about the event, entered once (name, date, times, venue, food, contacts). Each USC form and email is filled from it.
- **Progress:** per step, a checklist of ticks and a few recorded reply details (reservation number, permit code).
- **Activity log:** every change, newest first.

From those it derives everything a screen shows: each step's status, its deadline counted back from the event date, what blocks it, which profile fields a form still needs, and whether a form can be started.

Three kinds of action leave the app, and a human finishes each one:

| Action | What the backend does | What the human does |
|---|---|---|
| **Pre-fill a USC form** | Opens a visible Chrome window on the machine running the backend, fills the form, and stops on the last page | Reviews it, ticks the attestations, presses Submit |
| **Email draft** | Returns the recipient, subject, body and a `mailto:` link | Sends it from their mail app |
| **Manual task** | Returns the link and the rules | Does it on the USC site (needs a USC login) |

**Nothing is ever submitted or sent by the app.**

There are two ways to drive all of this, and a UI can use either or both:

1. **Direct API calls**: forms, buttons and checkboxes that call the endpoints in section 4.
2. **The assistant**: one chat endpoint. The user types; the agent (Gemini) calls the same backend logic through tools and replies with text plus "cards" for the UI to render (section 6).

```
 Browser UI ──HTTP──► FastAPI  /api/v1/pipeline/*
                         │
        ┌────────────────┼──────────────────────────┐
        ▼                ▼                          ▼
   plan.py (rules)   store.py (saved event,     agent (Gemini + tools)
   views.py (JSON     backend/data/              backend/app/agents,
   for the UI)        event_pipeline.json)       backend/app/tools
                         │
                         ▼
                 runs.py ──► Node + Playwright pre-fillers ──► USC web forms (never submitted)
```

---

## 2. Run it

```bash
# one-time
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd app/integrations/usc_forms && npm install        # pre-fillers; use the installed Google Chrome
cp backend/.env.example backend/.env                # set GEMINI_API_KEY for the assistant

# every time
cd backend  && .venv/bin/uvicorn main:app --port 8000 --env-file .env
cd frontend && npm run dev                          # reference UI at http://localhost:3000/pipeline
```

Settings in `backend/.env`:

| Variable | Purpose | Default |
|---|---|---|
| `GEMINI_API_KEY` | Enables the assistant. Everything else works without it | none |
| `GEMINI_CHAT_MODEL` | Model the assistant runs on | `gemini-3.5-flash` |
| `GEMINI_API_VERSION` | Gemini API version, e.g. `v1beta` | SDK default |
| `FRONTEND_ORIGIN` | Browser origins allowed to call the API, comma-separated | `http://localhost:3000` |

If your UI runs on another port or host, add it to `FRONTEND_ORIGIN` and restart the backend.

---

## 3. Conventions for every request

- **Base URL:** `http://localhost:8000/api/v1/pipeline`
- **Required header:** `X-TrojanConnect-Client: web` on every request, any method. Without it the API returns `403`. It is a CSRF guard, not authentication: there are no users yet.
- **Bodies:** JSON, with `Content-Type: application/json`.
- **Errors:** `{"detail": "human-readable message"}` with a 4xx or 5xx status. Show `detail` to the user as it is. For `422` (malformed request), `detail` is a list of validation objects.
- **One event:** the backend stores a single event. There are no event ids yet.
- **Value formats:** dates `YYYY-MM-DD`; times 24-hour `HH:MM`, on the hour or half hour; yes/no fields are JSON booleans; `audience` is a list of strings; everything else is a string, including numbers (`"attendance": "30"`).

A minimal client:

```ts
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function api<T>(path: string, init?: { method?: string; json?: unknown }): Promise<T> {
  const res = await fetch(`${API}/api/v1/pipeline${path}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", "X-TrojanConnect-Client": "web" },
    body: init?.json === undefined ? undefined : JSON.stringify(init.json),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : res.statusText);
  return body as T;
}
```

---

## 4. Endpoints

### Read (render from these)

| Method and path | Returns | Use it for |
|---|---|---|
| `GET /schema` | Static definitions: profile fields, venue kinds, forms, steps, statuses, approved caterers | Building the profile form and labels. Does not change with the event; fetch once per page load |
| `GET /status` | The whole dashboard for the saved event | Header, progress bar, "do now" list, step list, step detail |
| `GET /profile` | Saved values plus per-field problems | Profile form values and inline validation |
| `GET /forms` | Every form, email and manual task with live readiness | A "field map" or a list of all tasks |
| `GET /forms/{form_id}` | One of the above | Refreshing a single form card |
| `GET /emails/{form_id}` | `{to, subject, body, mailto, ready, missing_fields}` | Email preview and the "open draft" link |
| `GET /caterers?q=` | Approved caterers; with `q`, a name search | Food step vendor picker or checker |
| `GET /ee-availability` | EEB/PHE room bookings on the event date | Venue step, only when venue kind is `eeb_phe` |
| `GET /activity?limit=50` | `[{at, msg}]`, newest first | Activity feed |
| `GET /run/{form_id}` | `{running, lines}` | Live log of a pre-fill |
| `GET /agent` | `{configured, model, tools}` | Whether to enable the chat box |
| `GET /state` | Raw `{profile, progress, log}` | Debugging; the reference UI uses it |

### Write (user actions)

| Method and path | Body | Effect |
|---|---|---|
| `PUT /profile` | Any subset of profile fields, e.g. `{"attendance": "45"}` | Merges into the profile. Returns the raw state |
| `PUT /progress` | `{"step", "check", "value"}` | Ticks or unticks a checklist item |
| `PUT /progress` | `{"step", "dataKey", "dataValue"}` | Records a reply detail, e.g. the reservation number |
| `POST /run/{form_id}` | none | Opens Chrome and pre-fills the form. `form_id` is `tcc`, `outdoor`, `classroom`, `eeRoom` or `permit` |
| `POST /agent/chat` | `{"message", "history"}` | One assistant turn (section 6) |
| `POST /reset` | none | Erases the event. Ask the user to confirm first |

After any write, re-fetch `GET /status` (and `GET /profile` if the profile form is on screen). Statuses, blockers and readiness all change together.

Two things to know about writes:

- `PUT /profile` does not reject bad values; it saves what it is given. Problems show up afterwards in `GET /profile` (`problem`) and in each form's `missing_fields`. Validate in the form using the schema, and display `problem` after saving.
- `POST /run/{form_id}` returns `409` if that form is already running, or if it is the permit and no 6-digit reservation number is recorded. It returns `503` if Node or Playwright is not installed.

### Shapes you will use most

`GET /status` (one step shown; all seven are returned):

```jsonc
{
  "today": "2026-11-14",
  "event": {
    "name": "Fall Mixer", "organization": "Robotics Club", "date": "2027-03-04",
    "start": "6:00 PM", "end": "8:00 PM", "venue": "TCC 350",
    "venue_kind": "tcc", "venue_kind_label": "TCC meeting room (Trojan Event Services)",
    "attendance": "30", "serving_food": true
  },
  "days_to_event": 110,
  "steps_done": 2, "steps_total": 7, "percent_done": 29,
  "do_now": ["permit", "funding", "access"],     // step ids the user can act on
  "waiting_on_reply": [],                        // submitted, waiting for an office
  "late": [],                                    // past their deadline and not done
  "missing_field_count": 0,                      // badge for the profile tab
  "steps": [{
    "id": "permit", "n": 3, "title": "Event permit application",
    "owner": "You → DPS + departments",
    "blurb": "Fill in only after the room is confirmed. …",
    "status": "ready", "status_label": "Ready to start",
    "done": false, "skipped": false,
    "blocked_by": [],                            // [{id, title}] of unfinished prerequisites
    "deadline": "2027-02-18", "deadline_official": true,   // false = a suggested date
    "lead_days": 14, "days_left": 96, "late": false,
    "checklist": [{ "key": "submitted", "label": "Permit submitted", "done": false }, …],
    "checklist_done": 0, "checklist_total": 3,
    "data_fields": [{ "key": "permitCode", "label": "Permit number / code", "value": "" }],
    "missing_fields": [],                        // [{key, label}] across this step's forms
    "forms": [{
      "id": "permit", "name": "USC Event Permit (Salesforce, 11 stages)",
      "mode": "prefill", "mode_label": "auto pre-fill",   // prefill | email | manual
      "url": "https://usc-its.my.site.com/eventpermits/s/request-submission",
      "step": "permit",
      "rules": ["Only after the room is CONFIRMED (needs the 6-digit reservation #).", …],
      "required_fields": [{ "key": "orgName", "label": "Organization name" }, …],
      "missing_fields": [],                      // [{key, label, problem}]
      "ready": true, "not_ready_reasons": [],    // show the reasons when ready is false
      "prefillable": true, "run": { "running": false }
    }]
  }]
}
```

Step `status` is one of:

| `status` | `status_label` | Meaning |
|---|---|---|
| `ready` | Ready to start | Nothing blocks it and nothing is ticked yet |
| `active` | In progress | Some checklist items ticked |
| `waiting` | Waiting on reply | Submitted; an outside office has to answer |
| `blocked` | Blocked | A step in `blocked_by` is not done |
| `done` | Done | Finished |
| `skipped` | Not needed | Does not apply (food step when no food is served) |

`GET /schema`, one field:

```jsonc
{
  "key": "venueKind", "label": "Where is the event?", "short_label": "Where is the event?",
  "group": "Venue",                 // section heading; order is in "field_groups"
  "type": "select",                 // text | email | tel | date | time | number | textarea | select | bool | multi
  "options": ["tcc", "outdoor", "classroom", "viterbi", "eeb_phe"],
  "option_labels": { "tcc": "TCC meeting room (Trojan Event Services)", … },   // null for other fields
  "optional": false,
  "only_when_serving_food": false,  // hide when the profile's "food" is false
  "private": false                  // true for uscId: never send it through the assistant
}
```

`GET /profile`, one field:

```jsonc
{ "key": "phone", "value": "213555", "applies": true, "problem": "Needs 10 digits", "used_by_forms": ["tcc", "outdoor", "classroom", "eeRoom", "permit"] }
```

`problem` is `null` when the field is fine, `"missing"` when a required field is empty, or a validation message.

---

## 5. Building the screens

### Dashboard

One call: `GET /status`.

- **Header:** `event.name`, `event.date`, `event.start`–`event.end`, `event.venue`, `event.attendance`, and `days_to_event`.
- **Progress:** `steps_done` / `steps_total`, or `percent_done`.
- **"Do now" strip:** for each id in `do_now`, show the step's `title` and `days_left`. Show `waiting_on_reply` and `late` as separate groups.
- **Step list:** one row per `steps[]` with `n`, `title`, `owner`, `status_label`, `deadline`, and `checklist_done`/`checklist_total`. When `blocked_by` is non-empty, show "Waiting for: " and the titles.
- **Empty event:** `event.date` is `null` and deadlines are `null`. Send the user to the kickoff flow.

Re-fetch on a timer (the reference UI uses 30 seconds) and after every write.

### Kickoff: start planning an event

1. `GET /schema` for the field definitions.
2. Collect the basics (name, date, times, attendance), then venue kind and first choice, then food. Use `fields[].type` and `options` to pick the input, `group` for sections, and hide fields where `only_when_serving_food` is true and food is off.
3. `PUT /profile` with what was entered. It can be called once per screen or once per field.
4. `GET /status`. The venue step now lists the right form for the chosen venue kind, with its deadline. `venue_kinds[].lead_days` in the schema lets you preview that deadline before saving.

Or let the assistant do it: send the user's description to `POST /agent/chat` and it fills the profile and asks for what is missing.

### Step detail

Everything is in the step object from `GET /status`.

- **Checklist:** render `checklist[]` as checkboxes. On change: `PUT /progress {"step": id, "check": key, "value": true|false}`.
- **Reply details:** render `data_fields[]` as text inputs. On blur: `PUT /progress {"step": id, "dataKey": key, "dataValue": text}`. The venue `reservationNumber` must be exactly 6 digits for the permit to unlock.
- **Forms:** one card per `forms[]` entry, by `mode`:

| `mode` | Card shows | Primary button |
|---|---|---|
| `prefill` | `rules`, `missing_fields` or "all fields ready" | "Pre-fill in browser", enabled when `ready` is true |
| `email` | `rules`, `missing_fields` | "Open email draft": `GET /emails/{id}`, then link to `mailto` |
| `manual` | `rules` | "Open": link to `url` |

When `ready` is false, show `not_ready_reasons`. Make each `missing_fields` entry a link that jumps to that field in the profile form.

### Kicking off a booking (pre-fill)

```ts
await api(`/run/${formId}`, { method: "POST" });           // Chrome opens on the backend machine
const timer = setInterval(async () => {
  const run = await api<{ running: boolean; lines: string[] }>(`/run/${formId}`);
  showLog(run.lines);                                       // e.g. "Contact information", "✔ Filled. Review…"
  if (!run.running) clearInterval(timer);
}, 1000);
```

- The browser window opens on the computer running the backend. This is a local-only feature; it cannot work on a hosted server.
- When the log ends, the form is filled but **not submitted**. Tell the user to review it, tick the attestations and press Submit in that window, then tick "Request submitted" on the step.
- The step object's `forms[].run.running` tells you a run is in progress if the page was reloaded.

### Profile form

1. `GET /schema` once for definitions; `GET /profile` for values and problems.
2. Group by `fields[].group` in `field_groups` order.
3. Save with `PUT /profile {key: value}` on blur or change.
4. Show `problem` under the field. Show `used_by_forms` to explain why a field is needed.

### Food step extras

- `GET /caterers` for the 20 caterers the permit accepts; `GET /caterers?q=name` to check one. `accepted_by_permit_lookup` is `true` or `false` when `q` is given.
- For a vendor that is not listed, offer the Hospitality email: `GET /emails/hospitality`.

### Venue step extra: room availability

Only when `event.venue_kind` is `eeb_phe`: `GET /ee-availability` returns `[{room, bookings, free, conflicts}]`. It takes several seconds (it reads public calendars live). Label it as unofficial: a free slot is not a reservation.

### Activity feed

`GET /activity?limit=50`. Entries beginning with `assistant:` were made by the agent.

---

## 6. The assistant

A chat agent that can do everything above on the user's behalf. Check `GET /agent` first: if `configured` is false, disable the chat box and say a Gemini key is needed.

### One turn

```ts
type Msg = { role: "user" | "assistant"; text: string };

const r = await api<AgentReply>("/agent/chat", {
  method: "POST",
  json: { message: "We now expect 45 people. Start the room request.", history },   // history: prior Msg[]
});
history.push({ role: "user", text: message }, { role: "assistant", text: r.reply });
```

Response:

```jsonc
{
  "reply": "Saved 45 people. A browser window is opening and pre-filling the TCC request. It has NOT been submitted…",
  "actions": [{ "type": "form", "formId": "tcc", "step": "venue", "running": true }],
  "tools":   [{ "tool": "update_event_profile", "ok": true, "error": null },
              { "tool": "start_prefill", "ok": true, "error": null }],
  "state":   { "profile": {…}, "progress": {…}, "log": […] },
  "model":   "gemini:gemini-3.5-flash"
}
```

- **`reply`:** plain text with line breaks. Render with `white-space: pre-wrap`; it is not Markdown.
- **`actions`:** cards to render under the reply (below).
- **`tools`:** what the agent did this turn. Optional to show; useful as "Updated profile · Started pre-fill".
- **`state`:** the event after the turn. The agent may have changed it, so refresh the dashboard (re-fetch `GET /status`).
- The backend keeps no chat history. Send the conversation so far in `history` each time (it uses the last 20 messages).
- Limits: `message` up to 4000 characters, `history` up to 60 messages.

### Cards (`actions`)

| `type` | Fields | Render |
|---|---|---|
| `form` | `formId`, `step`, `running` | The same form card as in the step detail (`GET /forms/{formId}`). If `running` is true, the agent already started the pre-fill: start polling `GET /run/{formId}` and show the log |
| `field` | `key` | A button that jumps to that field in the profile form. Used for the USC ID, which the agent will not take in chat |
| `reset` | none | A "Clear this event" button. On click, confirm with the user, then `POST /reset` |

### What the agent can do

`GET /agent` returns this list live in `tools`.

| Tool | Effect |
|---|---|
| `get_event_plan_status` | Reads status, deadlines, blockers, missing fields |
| `update_event_profile` | Saves event facts from the conversation (validated per field) |
| `get_form_details` | Reads a form's rules and missing fields |
| `check_caterer` | Checks a vendor against the approved list |
| `check_room_availability` | Reads EEB/PHE calendars |
| `record_step_progress` | Ticks checklist items; records reservation number, permit code |
| `start_prefill` | Opens the browser and pre-fills a USC form (stops before Submit) |
| `draft_email` | Returns a `form` card for an email draft |
| `offer_reset` | Returns a `reset` card |

### Errors to handle

| Status | `detail` | What to show |
|---|---|---|
| `503` | "The assistant needs a Gemini API key…" | Setup notice; disable the chat box |
| `502` | "Gemini's rate limit for this API key was reached…" | The message, and let the user resend. One turn makes two or three model calls, so free-tier keys hit this quickly |
| `502` | "Gemini is overloaded right now…" | The message, and let the user resend |

A turn usually takes 3–15 seconds. Show a "working" state and disable Send meanwhile.

### Good first prompts to offer

"What should I do next?" · "Help me plan a new event" · "Start my venue request" · "What's blocking the permit?" · "Draft the email to the VP of Finance"

---

## 7. Rules a UI must keep

- **Never present a pre-filled form as submitted, or a submitted request as confirmed.** The checklist is where the user records what actually happened.
- **Do not send the USC ID through the assistant.** Collect it only in the profile form (`private: true` in the schema). The agent refuses it and returns a `field` card instead.
- **Confirm before `POST /reset`.** It erases the profile, progress and log.
- **Show `not_ready_reasons` instead of hiding a disabled button**, so the user knows what to fix.
- **Label EEB/PHE availability as unofficial.**

---

## 8. Current limits

- **One event at a time.** No event ids, no dashboard of several events, no user accounts. `POST /reset` starts a new one.
- **Local only.** Pre-fill opens Chrome on the backend machine, and state is a JSON file (`backend/data/event_pipeline.json`, git-ignored).
- **The permit pre-fill stops at stage 6 (Vendor Details).** The live form requires a "Rentals Vendor Name" there that the filler does not handle; the user finishes from that stage by hand.
- **`PUT /profile` saves without validating** (see section 4).
- **The reference UI still computes status itself.** `frontend/src/lib/pipeline/plan.ts` and `fields.ts` duplicate the rules in `backend/app/workflows/event_pipeline/plan.py`. A new UI should use `GET /status` and `GET /schema` instead. Until the reference UI is switched over, a change to steps, forms or fields must be made in both places.
- **Assistant rate limits** depend on the Gemini key's plan.

---

## 9. Where the code is

| What | Path |
|---|---|
| Endpoints | `backend/app/workflows/event_pipeline/router.py` |
| Rules: fields, forms, steps, deadlines, email templates | `backend/app/workflows/event_pipeline/plan.py` |
| JSON returned to the UI | `backend/app/workflows/event_pipeline/views.py` |
| Saved event | `backend/app/workflows/event_pipeline/store.py` |
| Pre-fill runs | `backend/app/workflows/event_pipeline/runs.py`, `backend/app/integrations/usc_forms/` |
| Assistant: loop, tools, Gemini | `backend/app/agents/`, `backend/app/tools/event_plan.py`, `backend/app/integrations/gemini/` |
| Tests | `backend/tests/` (`cd backend && .venv/bin/python -m pytest`) |
| Reference UI | `frontend/src/components/pipeline/`, `frontend/src/lib/api-client.ts` |
