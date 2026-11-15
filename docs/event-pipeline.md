# Event Pipeline

Tracks the club event walkthrough (venue → food → permit → funding → EngageSC → accessibility → publicity) and the separate annual RSO recognition process. A club rep enters the event **once**. The `/pipeline` page shows the event waterfall and a parallel RSO recognition checklist, with each workflow's own progress. Event USC web forms can be pre-filled in a visible browser window.

**Nothing is submitted automatically.** Every pre-filler stops on the final page so a human reviews the form and presses Submit. This is in line with the PRD's non-goals: no live integration claims, no automatic confirmation.

## Where things live

| Layer | Path |
|---|---|
| UI (Next.js route `/pipeline`) | `frontend/src/app/pipeline/page.tsx`, `frontend/src/components/pipeline/*` |
| Steps, deadlines, the fields each form needs, email templates | `frontend/src/lib/pipeline/plan.ts`, `fields.ts` |
| API client | `frontend/src/lib/api-client.ts` (`NEXT_PUBLIC_API_URL`, default `http://localhost:8000`) |
| API + state (FastAPI, `/api/v1/pipeline/*`) | `backend/app/workflows/event_pipeline/` |
| Browser pre-fillers (Node + Playwright) | `backend/app/integrations/usc_forms/` |
| Local state (git-ignored) | `backend/data/event_pipeline.json`, `backend/data/browser-profile/` |

Storage is a JSON file for the hackathon. `store.py` is the only module to replace when Supabase lands.

## Setup

```bash
cd backend/app/integrations/usc_forms && npm run setup   # Playwright + Chromium, needed for "Pre-fill in browser"
```
Then run the frontend and backend as described in the root README, and open http://localhost:3000/pipeline.

## API

Full reference and a guide to building a UI on these endpoints: [event-planning-integration.md](../event-planning-integration.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/pipeline/state` | profile, event and recognition progress, and activity log |
| PUT | `/api/v1/pipeline/profile` | merge profile fields |
| PUT | `/api/v1/pipeline/progress` | `{step, check, value}` or `{step, dataKey, dataValue}` |
| PUT | `/api/v1/pipeline/recognition/setup` | update application pathway, EngageSC group URL, and roster counts |
| PUT | `/api/v1/pipeline/recognition/progress` | `{check, value}` for a known recognition checklist item |
| PUT | `/api/v1/pipeline/recognition/officer-progress` | update a requirement receipt for one of the five officer roles |
| PUT | `/api/v1/pipeline/recognition/status` | save the user-reported EngageSC application status |
| POST | `/api/v1/pipeline/run/{tcc\|outdoor\|classroom\|eeRoom\|permit}` | open a browser and pre-fill (the permit returns 409 until a 6-digit reservation # is recorded) |
| GET | `/api/v1/pipeline/run/{form}` | live log of a pre-fill run |
| GET | `/api/v1/pipeline/ee-availability` | read the public EEB/PHE calendars for the event date |
| POST | `/api/v1/pipeline/reset` | clear the event |
| GET | `/api/v1/pipeline/schema`, `/status`, `/profile`, `/forms`, `/forms/{id}`, `/emails/{id}`, `/caterers`, `/activity` | read models for a UI: definitions, derived status, form readiness, email drafts |
| GET | `/api/v1/pipeline/agent` | whether the assistant is configured, and the model id |
| POST | `/api/v1/pipeline/agent/chat` | `{message, history}` → `{reply, actions, tools, state}` |

All pipeline requests (any method) must send `X-TrojanConnect-Client: web`. This custom header makes browsers run a CORS check first, and CORS only allows the frontend origin, so other websites can't trigger resets or pre-fill runs. It is not real auth; add Supabase Auth to the router dependencies when it lands.

## Event agent (Assistant tab)

A chat agent that does everything on this page: you describe the event, and it fills the profile, reports status and deadlines, starts the form pre-fills, lines up the email drafts and records replies. It runs in the backend on Gemini and acts only through the tools below.

Setup: copy `backend/.env.example` to `backend/.env`, set `GEMINI_API_KEY`, and start the backend with `--env-file .env`. Without a key the rest of the pipeline still works and the tab says the assistant is not set up.

| Tool | What it does |
|---|---|
| `get_event_plan_status` | Step status, deadlines, blockers, missing fields, recent activity |
| `update_event_profile` | Saves event facts from the conversation into the profile (validated per field) |
| `get_form_details` | Rules, required and missing fields for a form, email or manual step |
| `check_caterer` | Looks a vendor up in the permit's approved-caterer list |
| `check_room_availability` | Reads the public EEB/PHE calendars for the event date |
| `record_step_progress` | Ticks checklist items and stores reply details (reservation #, venue manager, permit code) |
| `start_prefill` | Opens a visible browser and pre-fills the TCC, Outdoor, Classroom, EEB/PHE or Permit form; the live log shows in the chat |
| `draft_email` | Shows a card that opens the email draft (Kevin Giang, VP Finance, VP Comms, advisor, Hospitality) |
| `offer_reset` | Shows a "Clear this event" button to start a new event |

Limits enforced in code:
- **Nothing is submitted or sent.** Pre-fills stop on the final page, as everywhere else; email drafts open in your mail app.
- `start_prefill` refuses when required fields are missing, the step is blocked, or (permit) no 6-digit reservation # is recorded.
- Clearing the event needs your click and a confirmation.
- The USC ID is not sent to the model and cannot be saved through chat; type it in the Event profile tab.
- Unknown fields and invalid values are rejected; agent writes are logged with an `assistant:` prefix.

Code: `backend/app/agents/` (loop, model interface), `backend/app/tools/event_plan.py` (tools), `backend/app/integrations/gemini/` (provider), `backend/app/workflows/event_pipeline/plan.py` (status logic), `frontend/src/components/pipeline/AssistantPanel.tsx`. Tests: `cd backend && .venv/bin/python -m pytest`.

`plan.py` mirrors `frontend/src/lib/pipeline/{fields,plan}.ts`. Until the frontend reads status from the API, a change to steps, forms or fields must be made in both.

## RSO recognition workflow

The **RSO recognition** tab is a parallel checklist. It has pathway selection, live deadline countdowns, a "Next up" action, roster counts, and a per-officer document matrix with copyable reminders. It also has a separate advisor lane with a copyable instruction packet, an EngageSC portal handoff, and a manually reported application status. That status also shows on the event pipeline's EngageSC event step. It does not submit materials or read portal status. Sign-in, document upload, and application submission stay in EngageSC. The app does not collect USC passwords or certificates.

The checklist reflects the 2026–27 cycle published on USC's [live recognition page](https://campusactivities.usc.edu/programs/recognized-student-organizations/rso-recognition-process/): application deadline November 22 at 11:59 PM and separate advisor deadline December 1. This is cycle-specific guidance, not a live deadline feed. Verify current requirements with USC.

The full UI/data contract, manual handoff boundary, authorized-integration prerequisites, and verification plan are in [event-pipeline-integration.md](event-pipeline-integration.md).

## How each step is automated

| # | Step | Automated | Still manual |
|---|------|-----------|--------------|
| 1 | Venue | Picks the channel from the venue type. Pre-fills the TCC, Outdoor and Classroom forms (all 8 pages) and the EEB/PHE form. Drafts the email to Kevin Giang (Viterbi). Checks the EEB/PHE calendars. | Submit, then record the 6-digit reservation # and the venue manager |
| 2 | Food | Lists the 20 caterers accepted by the permit lookup. Drafts an email to Hospitality for vendors that aren't approved. | The approved vendor sheet needs a USC login |
| 3 | Permit | Locked until the venue is confirmed. Pre-fills 8 of the 11 Salesforce stages (No to trash/waste, attendance ≤ 60). | ADA / Smoke-Free / Plastic acknowledgements, then Submit |
| 4 | Funding | Drafts the budget email to the VP of Finance | Fill the budget; order in person at OHE and be there for delivery |
| 5 | EngageSC | Locked until venue + permit are done; checklist | Manual: needs a USC login, and the walkthrough video is private |
| 6 | Accessibility | Drafts the request to the VP of Communications. Comes before publicity. | Add the statements |
| 7 | Publicity | Drafts the emails to the VP of Communications and the advisor; tracks the day-of re-post | Make the Canva graphic |

## Rules found on the live forms (Nov 2026)
- **Outdoor (TES):** 6 weeks notice (the walkthrough says 3+; the tracker uses 6). 8:00 AM–11:30 PM. No amplified sound after 8 PM.
- **TCC:** 3 weeks.
- **Classroom:** weeks 4 through the last day of instruction. Mon–Thu events start at 6:00 PM or later, Fri at 3:00 PM or later, all end by 11:00 PM. Nothing within 48 hours. Fri–Sun requests are due by Thursday noon. A permit is required if 25+ people or food.
- **EEB/PHE:** at least 3 days ahead; non-EE departments can book at most 1 month out.
- **Permit:** reservation # exactly 6 digits, USC ID exactly 10 digits. Caterers that aren't approved need a one-time approval (health permit + insurance) 2 weeks before the event. Parking requests are due 14 business days ahead.

## Known gaps
- The budget template link in the walkthrough returns **410 Gone**. The vendor sheet and the EngageSC video are USC-login only.
- If a USC form changes its wording, the pre-filler logs `not shown: …` and keeps going. Update the label in `usc_forms/forms.mjs`.
