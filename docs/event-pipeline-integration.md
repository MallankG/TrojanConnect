# Event pipeline and RSO recognition integration design

Status: implementation contract for the hackathon/local prototype · Current branch: `rso-process`

## Goal

The `/pipeline` experience has two related but independent workflows:

1. **Event planning:** venue → food → permit → funding → EngageSC event → accessibility → publicity.
2. **Annual RSO recognition:** determine the right application path, prepare the roster and documents, coordinate five student officers and the advisor, then hand off to EngageSC and track follow-up.

Recognition is not a prerequisite for planning an event in this prototype, and event planning must not imply that an RSO is recognized. USC controls recognition, eligibility, application review, and portal status.

The current recognition experience is a **coordination and handoff layer**, not a direct EngageSC integration. USC's process page documents an application in the EngageSC portal but this repository has no authorized EngageSC API, OAuth client, or service credentials. Do not scrape authenticated pages, embed EngageSC in an iframe, request/store USC passwords, or submit the application automatically. This follows the PRD's no-unauthorized-integration and no-automatic-submission rules (§7.3).

## Source of truth and cycle facts

Use the [USC RSO Recognition Process](https://campusactivities.usc.edu/programs/recognized-student-organizations/rso-recognition-process/) as the authority. The implementation was checked against the page last updated November 12, 2026:

- The Spring 2027 process is for new RSOs and RSOs re-establishing after a lapse. A fall applicant must not submit another application.
- Social fraternities and sororities follow the Office of Fraternity & Sorority Life process. Religious/spiritual groups use the Office of Religious & Spiritual Life option in EngageSC.
- The application deadline is November 22, 2026 at 11:59 PM. Advisor requirements have a separate December 1 deadline. Late applications are not accepted.
- Five officers are required (president, vice president, secretary, treasurer, programming chair), along with one full-time USC faculty/staff advisor not on leave/sabbatical, and at least five additional student members.
- Officers, advisor, and members accept their EngageSC positions by email. The applicant can proceed after entering the roster without waiting for all acceptances.
- Each of the five officers provides three items: Commitment to Community form, Hazing Prevention 101 certificate, and RSO Officer Learning Path certificate. The designated submitter uploads the 15 officer documents and the Accountability Document to the recognition application.
- The advisor completes separate annual requirements. USC distinguishes an Advisor Requirements form from the Google Form used to submit the advisor Commitment form and RSO Advisor Training certificate. Clery training completion is verified by USC and is not submitted as a certificate.
- The 2026–27 Constitution and Accountability Document must remain fillable PDFs; do not flatten them.
- Only the designated submitter can view/edit the application. USC documents statuses Draft, Pending Approval, Requires Modifications, and Denied; edits are allowed only while Requires Modifications.
- Recognition for the 2026–27 academic year ends June 30, 2027.

Dates and links are cycle-specific. Verify the official USC page before acting and refresh these constants for every cycle; do not present this prototype's checklist as USC approval or eligibility advice.

## Where the official process creates friction, and what the app does about it

USC's process is sound but puts the coordination load on one student: the designated submitter must chase 15 officer documents from five people, make sure the advisor finishes a separate packet by a later deadline, and remember portal-only rules (fillable PDFs, no mobile acceptance, only the submitter can edit). TrojanConnect doesn't change USC's requirements. It cuts that coordination work:

| Friction in the USC process | TrojanConnect response |
|---|---|
| Five possible paths (new, re-establishing, fall applicant, religious/spiritual, FSL) described in one long page | **Pathway picker** with path-specific links and stop/reroute messages |
| Deadlines are static text; the advisor deadline is easy to miss | **Live countdowns** for Nov 22 and Dec 1, highlighted at ≤3 days, and a closed state with a no-late-applications warning |
| No single "what do I do next" | **Next up card** derived from saved state, with a "Go to step" jump |
| Submitter chases 15 documents (5 officers × 3) | **Officer matrix**, per-row status, and **Copy reminder** / bulk **Copy reminders** that list only each officer's missing items, with links and the deadline |
| Advisor requirements live in a different form with a different deadline | Separate **advisor lane** and a **Copy advisor instructions** packet (EngageSC acceptance, Reach360 training, DocuSign, submission form, Clery note) |
| Students wait on position acceptances unnecessarily | Readiness explicitly **does not** depend on acceptances (USC says not to wait) |
| Events planned on EngageSC assume an active RSO | Event pipeline **EngageSC event step shows recognition status** with a link into the recognition tab. The tab shows a badge for Pending / Requires Modifications / Recognized |

## UI flow and behavior

Component: `frontend/src/components/pipeline/RecognitionWorkflow.tsx`. Pure logic (cycle constants, countdowns, next action, reminder text) lives in `frontend/src/lib/pipeline/recognition.ts` so the event pipeline can reuse it.

Top to bottom, the recognition tab shows:

0. **Header.** Cycle, tracked-requirement count, both deadlines with a live countdown ("8 days left" / "due today" / "closed"), and a link to verify the USC page.
1. **Next up.** One action, in priority order:
   1. Choose a pathway.
   2. Reroute fall/FSL organizations.
   3. Follow application status (Requires Modifications → Pending → Recognized/Denied).
   4. Show the deadline-passed message.
   5. Add members (<5).
   6. The first unchecked preparation item.
   7. Outstanding officer documents (with count).
   8. Submit in EngageSC.

   "Go to step" scrolls to, and focuses, the target section or checkbox.
2. **Choose pathway** (section 1). `New RSO`, `Re-establishing`, `Already applied in fall`, `Religious/spiritual`, `Social fraternity/sorority`.
   - New and religious/spiritual groups link to the EngageSC directory.
   - Re-establishing groups link to the officer-access and re-establishment forms.
   - Fall applicants and FSL organizations get a stop/reroute message.
3. **EngageSC handoff card.** Accepts only an `https://engage.usc.edu` group URL and turns it into the primary "Open your EngageSC group page" button (new tab, `noopener`). The card is hidden for FSL organizations.
4. **Roster and submitter** (section 2). Additional-member count (whole number 0–1000, validated in the client and the server) and accepted-position count (informational only).
5. **Organization preparation** (section 3). Six readiness items: group details, roster entered, submitter designated, Constitution, Accountability Document, application info. Two coordination items that don't affect readiness: share the officer guide and ask for position acceptances. Template links included.
6. **Officer evidence matrix** (section 4). 5 roles × 3 items, with an "N/5 officers complete" summary. Each row has a Copy reminder button, or "All received". The bulk copy covers only officers with gaps. Receipts only: no names or files are stored. Clipboard failures fall back to a read-only textarea.
7. **Advisor lane** (section 5). Eligibility, position, training, Commitment, and Clery. Includes a Copy advisor instructions button. Does not affect application readiness.
8. **Submit and follow up** (section 6).
   - Portal button and readiness panel: either "Still to prepare" or "Local preparation requirements are checked off".
   - A deadline-passed warning while status is Not started/Draft.
   - The manual status select.
   - A pointer to My Activity → My Surveys/Forms.
   - The follow-up checkbox.

**Readiness rule:**

```
eligible pathway ∧ ≥5 additional members ∧ 6 preparation checks ∧ all 15 officer receipts
```

Position acceptances and advisor items are excluded, per USC. "Ready" means only that the local checklist is complete. It does not validate the portal.

**Saving:**
- Checkboxes and officer receipts update immediately (optimistically) and roll back with a visible error banner if the save fails.
- Setup fields and status save on change/blur and show server validation messages.
- Copy buttons announce "Copied ✓" to assistive technology.

**Event pipeline link:** step 5 ("EngageSC event") in `StepDetail.tsx` shows the recorded recognition status.
- Green when Recognized, with a reminder that it was entered manually.
- Amber otherwise, citing USC's "lose all benefits" rule.
- An "Open RSO recognition" button switches tabs.

**Layout:** works at 390px phone width. The officer table scrolls inside its own container and the page has no horizontal scroll.

## Current API and persisted state

All `/api/v1/pipeline/*` endpoints require `X-TrojanConnect-Client: web`. That header is a CORS/CSRF guard, **not authentication**.

| Endpoint | Responsibility |
|---|---|
| `GET /api/v1/pipeline/state` | Read event and recognition state |
| `PUT /api/v1/pipeline/recognition/setup` | Save pathway, EngageSC group URL, roster counts |
| `PUT /api/v1/pipeline/recognition/progress` | Save a known organization/advisor/follow-up checklist item |
| `PUT /api/v1/pipeline/recognition/officer-progress` | Save one of the three receipts for one of the five officer roles |
| `PUT /api/v1/pipeline/recognition/status` | Save a user-reported portal application status |
| `POST /api/v1/pipeline/reset` | Clear event state while preserving recognition progress |

The hackathon implementation stores state in `backend/data/event_pipeline.json`. Recognition state has `cycle`, `pathway`, `engageGroupUrl`, member/acceptance counts, `applicationStatus`, general `checks`, and per-role `officers` receipt flags. Existing JSON state is migrated with defaults when read. Resetting an event does not clear recognition state.

This global JSON file is not appropriate for deployment or multiple RSOs/users. Before production, add authentication, club-scoped records, authorization checks, RLS or equivalent, structured audit events, retention controls, and safe handling of documents. The client header alone must never be treated as identity.

## EngageSC integration boundary and roadmap

### Now: explicit, human-controlled handoff

- Launch the official EngageSC directory or the user-supplied group page in a separate tab.
- Keep SSO credentials, role acceptance, document upload, application submission, and review status inside EngageSC.
- Record only checklist receipts and a **manually reported** status in TrojanConnect.
- Do not infer completion from a link click, scrape the private portal, or claim a status is live.

### Future: authenticated connector only after authorization

Before any in-app data sync, Campus Activities/USC and EngageSC/CampusGroups must provide written authorization and a documented supported API/authentication method. Then:

1. Confirm permitted scopes and user/club mapping with USC. Use supported OAuth or service credentials; never ask for or store student passwords.
2. Start read-only: fetch only the approved group's roster/application status, with user consent and source timestamp.
3. Map external data to a club-scoped integration record. Handle expired access, revoked consent, duplicate updates, and API errors visibly; retain a manual fallback.
4. Add audit records and least-privilege access; avoid ingesting certificates or unnecessary member PII.
5. Test against a sandbox/test organization. Require an explicit user review and confirmation before any future write operation; no silent or automatic submission.

Until these prerequisites exist, the app provides an outbound portal handoff, not an authenticated EngageSC connection. This limitation must remain visible in the UI and user-facing documentation.

## Verification plan

For each release, verify the integrated local flow with disposable state:

1. Start FastAPI and Next.js; open `/pipeline`; confirm event and recognition tabs both load.
2. Choose each pathway and verify new/re-establish links, and the fall/FSL stop guidance.
3. Save a valid EngageSC group URL, reject a non-EngageSC URL, and verify the link opens the saved URL in a new tab.
4. Save roster counts and general checks; refresh and verify persistence.
5. Mark each of the 15 officer requirement cells; verify counts and readiness change only when every required officer receipt is checked.
6. Mark advisor items separately; verify advisor requirements do not masquerade as officer documents.
7. Set each portal status, including Requires Modifications; refresh and verify it persists with the appropriate follow-up guidance.
8. Verify invalid checklist IDs, roles, requirement keys, and status values fail with a client-visible error and do not alter state.
9. Reset event state and verify recognition state remains.
10. Use fake data and a mock/test environment. Do not sign documents, accept USC position invitations, submit forms, upload real certificates, or change live EngageSC data in automated tests.

This is a local integration test, not a live EngageSC test. Live portal behavior can only be verified with USC's approved test account/environment and explicit authorization.

### Latest local verification (2026-11-14)

Re-run the browser suite with FastAPI on :8000 and `npm run build && npm start` on :3000, then `cd frontend && npm run test:e2e` (script: `frontend/e2e/rso-recognition.e2e.mjs`). It backs up and restores `backend/data/event_pipeline.json`. It uses installed Chrome by default; set `PW_CHANNEL=""` after `npx playwright install chromium` to use bundled Chromium.

- Frontend `tsc`, `eslint` and `next build` passed.
- 8/8 backend unit tests passed (`backend/tests/test_recognition.py`).
- 17/17 HTTP checks against a running FastAPI passed:
  - CSRF header required.
  - Non-EngageSC, `http`, userinfo-trick and `javascript:` URLs rejected.
  - Unknown fields, pathways, checks, roles, requirements and statuses rejected.
  - Recognition survives an event reset.
- 59/59 Playwright browser checks passed against `next start` + FastAPI, with clean disposable state and the clock frozen at Nov 14, 2026. They cover all 12 plan items above, plus:
  - countdowns, including the post-deadline "closed" state and late warning
  - Next up progression
  - per-officer and bulk reminder clipboard content
  - advisor packet content
  - tab badges
  - the event-pipeline EngageSC recognition note and tab jump
  - optimistic rollback on a simulated 500
  - 390px mobile layout
  - no console errors
- Not tested or performed: USC sign-in, invitation acceptance, uploads, submission, live portal status, and the event form pre-fillers.
