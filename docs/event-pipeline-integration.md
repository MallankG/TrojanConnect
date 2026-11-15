# Event Pipeline: fit with the TrojanConnect PRD and integration plan

Status: proposal for team review. **Update:** conflicts 1–3 below are resolved: the pre-fillers are gone (venue and permit go through the booking agent workflow with simulated, labelled inventory), the permit no longer guesses answers (the reviewer gets an attention list), and CONFIRMED comes only from the backend after an authorized reviewer's approval · Branch: `feature/event-pipeline` · Reviewed against `TrojanConnect_Final_PRD.md` v1.1

## Summary

The event pipeline (`/pipeline`, see [event-pipeline.md](event-pipeline.md)) solves the PRD's core problem (§1.1, event administration), but it sits **beside** the PRD's architecture rather than inside it. The PRD covers venue booking in depth, and the pipeline treats that as a single step. The pipeline covers the six steps after confirmation (food, permit, funding, EngageSC, accessibility, publicity), which the PRD doesn't model at all. Integration means joining the two at that seam, and first fixing three places where the pipeline breaks PRD rules.

## Where it fits

| PRD concept | What the pipeline already has |
|---|---|
| §1.1 "multiple forms, emails, and manual follow-ups" | The 7-step waterfall with deadlines and blockers |
| §5.1 step 4: "ask only for required missing fields" | `missingFor()` in `frontend/src/lib/pipeline/plan.ts` works out the missing fields per form |
| §3.2 routing by `venue_authority_id` | `venueKind` → TES / Classroom Scheduling / Viterbi / ECE, plus real lead times |
| §21 Q1: "Which venues and venue authorities are in the demo inventory?" | **Answered.** The real authorities, rooms with capacities, lead times and rules collected from the live sites can seed `venue_authorities`, `venues` and `venue_routing_rules` |
| §11.5 booking detail "progress stepper" | The waterfall UI is that stepper, extended past confirmation |

## Where it conflicts with the PRD (fix first)

1. **Pre-filling USC forms** (§7.3 #8–9, §2.2, §8.1, §20 P2). The PRD rules out unauthorized external integration and browser tools that agents can call; live USC integration is P2 and needs authorization. The pre-fillers never submit, but they are still an unofficial integration. The ECE calendar reader returns live data without the source version and timestamp that §7.3 #2 requires.
   - *Fix:* put pre-fill behind an `ENABLE_USC_PREFILL` flag, off by default. Label it "assisted manual submission". Never expose it as an agent tool. Label availability "live public calendar (unofficial)" and include `checked_at`.
   - *Hosting:* visible-browser pre-fill cannot run on Replit (§17), because there's no screen. It is local-only.
2. **The permit pre-filler guesses answers** (§8.2: anything involving security, catering, alcohol or insurance "must be escalated, not guessed"). `backend/app/integrations/usc_forms/forms.mjs` answers "No" to about 25 such questions by default.
   - *Fix:* keep the walkthrough's rules (No to trash/waste, attendance ≤ 60) as club policy with a cited source. Turn every other answer into an explicit profile field, or escalate.
3. **Confirmation is a checkbox** (§3.2 #7, §7.3 #1). `CONFIRMED` must come from the backend after an authorized reviewer approves. Today any user can tick "Reservation confirmed".
   - *Fix:* derive the venue step's status from the booking state machine. The 6-digit USC reservation number becomes `external_confirmation_reference` in `confirm_booking`.

## Gaps against the PRD foundations

- **Auth and scoping** (§14): no users, and a single global event in `backend/data/event_pipeline.json`. Needs Supabase Auth, events tied to a club, and RLS. The `X-TrojanConnect-Client` header is a stopgap CSRF guard, not auth.
- **Contracts** (§9.1): `PUT /api/v1/pipeline/profile` accepts any dict. Needs Pydantic models that reject unknown fields (`extra="forbid"`), idempotency keys, and typed `{ok, data, error}` results.
- **Source of truth** (§7.3 #10, §9): rules and required fields live in TypeScript. Move them to the backend with `source_url` / `verified_at` and serve them to the frontend.
- **Audit** (§14): the activity log is plain strings. Needs actor, role, before/after state and correlation ID, stored in `audit_logs`.
- **Privacy**: the profile stores USC ID and phone numbers. Collect the USC ID at fill time instead of storing it.
- **Tests** (§16): no pytest coverage yet.
- **Naming** (§17): rename `NEXT_PUBLIC_API_URL` to `NEXT_PUBLIC_API_BASE_URL`. Replace the hardcoded CORS origin with a `FRONTEND_ORIGIN` env var.

## Integration roadmap (PRD priority order)

1. **Now (cheap, unblocks everything)**
   - Rename the env vars.
   - Add a Pydantic `EventProfile` under `backend/app/schemas/`.
   - Add the `ENABLE_USC_PREFILL` flag and the simulated/live labels.
   - Replace the guessed permit answers with explicit fields or escalation.
2. **With the P0 booking workflow** (§18 step 4)
   - Seed the venue tables from the pipeline's data.
   - Make step 1 a `booking_request`, with its status read from the state machine.
   - Steps 2–7 unlock at `CONFIRMED`.
3. **Data layer** (§13)
   - Add `event_plans` and `event_plan_steps` tables (not in the PRD yet).
   - Write step changes to `audit_logs`.
   - Scope by club with RLS.
   - Reuse `review_tasks` for the funding approval (a club-internal approver, the VP of Finance).
4. **Agents** (§10, §18 step 5)
   - The Club Agent's `extract_event_requirements` fills the profile.
   - The missing-field list drives its questions.
   - Add a read-only `get_event_plan_status` tool.
   - Emails stay as drafts the user sends.
   - Optional: Gemini Decisions API suggests the venue type, with an `unknown` option.
5. **UI** (§11)
   - Move `/pipeline` into the `(app)` shell as the stepper on `/bookings/[id]`.
   - Show "next action" cards on the club rep dashboard.
6. **P1**: WhatsApp deadline reminders ("Permit due in 3 days").

## Decision for the team

The PRD demo (§19) ends at "booking confirmed". The pipeline adds a strong "…and here's everything after" story, but roadmap items 3–5 compete for time with P0 work (auth, negotiation, reviewer UI).

**Recommendation:** do item 1 now and items 2–3 alongside the booking workflow; hold items 4–6 until P0 is done.
