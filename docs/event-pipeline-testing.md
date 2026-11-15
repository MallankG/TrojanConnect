# Event Pipeline: running it, inputs, and dry-run test log

Status: **testing paused** on 2026-11-14 at Event Permit stage 6 (Vendor Details). See [Where testing stopped](#where-testing-stopped).
Related: [event-pipeline.md](event-pipeline.md) (feature overview) · [event-pipeline-integration.md](event-pipeline-integration.md) (PRD fit)

**No real request was submitted during testing.** Every run used fake data ("TEST DO NOT PROCESS"), and no code path clicks a Submit button. See [Safety](#safety-how-we-test-without-submitting).

---

## 1. How to run it

One-time setup:

```bash
# Backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# Form pre-fillers (Node + Playwright)
cd app/integrations/usc_forms
npm install
# Browser: pre-fillers use your installed Google Chrome automatically.
# Optional: `npx playwright install chromium` for a bundled browser (stalled on this network).
# Force a specific browser with PLAYWRIGHT_CHANNEL=chrome|msedge|chromium.

# Frontend
cd ../../../../frontend && npm install
```

Run (two terminals):

```bash
cd backend  && .venv/bin/uvicorn main:app --port 8000
cd frontend && npm run dev
```

Open **http://localhost:3000/pipeline**.

Use it:
1. **Event profile** tab: fill in the event. Every form reads from this.
2. **Pipeline** tab: the step marked "▶ You are here" is what to do next. Each form card lists the fields it still **Needs**; click one to jump to it.
3. **Pre-fill in browser** opens a visible Chrome window and fills the USC form. **You** review it, tick the attestations ("I agree" / acknowledgements) and press Submit.
4. Record replies on the step. For example, enter the **6-digit reservation #** on Venue once it's confirmed; that unlocks the Permit pre-fill.

The event is saved locally in `backend/data/event_pipeline.json` (git-ignored). Clear it with `POST /api/v1/pipeline/reset` (send the header `X-TrojanConnect-Client: web`).

---

## 2. Inputs required

Each fact is entered once in the Event profile.

| Group | Fields | Notes / validation |
|---|---|---|
| Organization | Org name | Exactly as on EngageSC, no acronyms |
| You (requester) | First/last name, USC email, cell phone, **10-digit USC ID**, initials, e-board position | Phone must be 10 digits; USC ID exactly 10 digits (permit only) |
| Day-of contacts | On-site contact name + phone; secondary contact (optional) | Permit |
| Event | Name, description, type, **date**, setup / start / end / tear-down times, attendance, audience, amplified sound?, filmed?, marketing platform (optional), backup dates (optional) | **Attendance ≤ 60** (walkthrough rule). Times on the hour or half hour |
| Venue | Venue type, first choice (e.g. `TCC 350`, `THH 102`, `EEB 248`, `McCarthy Quad`), second choice (optional), accept alternate? | Venue type picks the form |
| Food (if serving) | Caterer type, caterer name, menu, cost (USD), payment type, vendor serves? | The permit only accepts approved caterers by name |
| Funding | Budget total, link to budget proposal | |
| Contacts | VP Finance email, VP Comms email, advisor name + email, Hospitality email (optional) | Used for email drafts |
| Recorded later (step data) | Venue: **reservation # (6 digits)**, venue manager name + email · Permit: permit code | Reservation # gates the permit |

Which form needs what: see the **Field map** tab, or `FORMS[...].requires` in `frontend/src/lib/pipeline/plan.ts`.

---

## 3. Safety: how we test without submitting

- **Fake data only:** org and event are named "TEST DO NOT PROCESS", with phone `213-555-0100`, USC ID `1234567890` and reservation # `123456`.
- **Never clicks Submit:** every click in `forms.mjs` / `wufoo.mjs` was audited. The pre-fillers only click Wufoo **"Next Page"**, Salesforce stage **"Next"**, dropdowns and checkboxes, and the ECE "request a room" link. Moving between pages of a multi-page form does not create an entry.
- **Attestations left to you:** "I agree" and the permit acknowledgements are left unchecked. One exception: the ECE form hides all its fields until its policy checkbox is ticked, so the filler ticks it and logs that it did.
- **Headless runs that close themselves:** the dry-run harness (see the Appendix) runs headless and closes the browser at the end.

---

## 4. Results

### Backend API (local only, no USC contact): ✅ pass
| Check | Result |
|---|---|
| Request without `X-TrojanConnect-Client` header | 403 (CSRF guard) |
| Save profile (38 fields) | 200 |
| Start permit pre-fill before reservation # | 409 "Record the 6-digit venue reservation number…" |
| Mark venue submitted/confirmed, record reservation # and contact | 200 ×5 |
| Mark food picked/quote | 200 ×2 |
| Activity log | All 7 changes recorded |

### Dashboard UI (`/pipeline`): ✅ pass (one bug fixed)
- Status gating is correct. After venue and food: Permit, Funding and Accessibility are "You are here"; EngageSC is blocked on Permit; Publicize is blocked on EngageSC and Accessibility.
- Deadlines are counted back from the event date (e.g. permit due Thu 18 Feb, 14 days before 4 Mar). The countdown and progress bar (2/7) are correct.
- The permit card shows "✓ All 26 required fields ready".
- No console errors or warnings.
- **Fixed:** finished steps showed empty circles instead of a green ✓ (Tailwind background classes clashed) → `StepList.tsx`.

### ECE (EEB/PHE) availability (read-only public calendars): ✅ pass (two bugs fixed)
- 2027-03-04, 18:00–20:00: all 9 rooms free. EEB 539's 1:30–3:30 PM booking correctly isn't a conflict.
- Sanity check, 2026-11-17, 16:00–17:00: correctly flags the real "EE Coffee Mixer" (EEB 248) and a "Busy" block in EEB 110.
- **Fixed:** changing month submits a JS form, which crashed the script (awaited the navigation now). The calendar for other months renders as `div`s, not a `<table>`, so the parser now reads the page text instead.

### Form pre-fillers (headless, real USC forms, never submitted)

| Form | Result | Left for you (by design) | Fixes made |
|---|---|---|---|
| **TCC room request** (Wufoo) | ✅ 37/39 required fields filled | Room set-up type (Franklin/Forum layout is your call); "I agree" | Label lookup took about 12 s per unlabeled item, now one in-page query; hidden "seconds" box in time fields is skipped; conditional E-board/recurring fields made optional; trash-box answer set from the walkthrough ("No additional trash boxes needed") |
| **Outdoor venue request** (Wufoo) | ✅ 35/36 filled | "I agree" | "First Contact Name" is a First/Last field |
| **EEB/PHE room request** | ✅ all fields filled (attendees 30, 03/04/2027, 6:00–8:00 PM, name, email, phone, dept, title, description) | Final review + Submit | Await the JS navigation to the request page; tick the policy box in-page (it's outside `<form>` and reveals the fields); attendance capped at 50 (form maximum) |
| **Classroom request** (Wufoo, 8 pages) | ✅ reached page 8 on the first run | Two "I agree" attestations | none needed |
| **USC Event Permit** (Salesforce, 11 stages) | ⏸ stages 1–5 pass; **stuck at stage 6** | — | Click through the intro screen first; pick the TCC room in the new "Campus Venue TCC" sub-dropdown (lists "Tutor Campus Center 221 … 450"); stuck stages now log the invalid fields and messages |

---

## Where testing stopped

**Event Permit, stage 6 "Vendor Details"** blocks "Next" with:

> Please enter some valid input. Input is not optional.

A required text or number field appeared that the filler doesn't set. On the earlier manual walk-through, this stage showed conditional text boxes ("Rentals Vendor Name", "Audio/Visual Vendor Name", "Generator Vendor Name"), so it is most likely one of those. Its condition changed because the filler now answers the dropdowns differently.

**Next steps to resume:**
1. Re-run the permit dry run with the snapshot dump to see which field is flagged:
   `SNAP="Please enter some valid input" node dryrun.mjs permit`
2. In `forms.mjs` → `permit()` → "Stage 6", either answer the dropdown that reveals that field so it stays hidden, or fill it. Don't make up a vendor name: if it's genuinely needed, add a profile field.
3. Continue to stages 7 (Food & Beverage: caterer lookup "City Tacos") and 8 (Media). The filler should stop at **stage 9, Acknowledgements**. Check that `FINAL STAGE Acknowldgements | submit button visible: false` (USC's own misspelling).

**Not tested yet:**
- Pre-fill through the UI button: the visible-window path, `run.mjs` launched by FastAPI.
- The weekend branch of the Classroom form.
- Email-draft (`mailto:`) buttons.
- Outdoor venues other than McCarthy Quad.

---

## State of the code

The fixes above are **uncommitted** on `feature/event-pipeline`:

```
M backend/app/integrations/usc_forms/ee-availability.mjs   month navigation + text-based parsing
M backend/app/integrations/usc_forms/forms.mjs             TCC/outdoor/EE/permit fixes, stuck-stage diagnostics
M backend/app/integrations/usc_forms/run.mjs               use installed Chrome when bundled Chromium is missing
M backend/app/integrations/usc_forms/shared.mjs            browserOptions() helper
M backend/app/integrations/usc_forms/wufoo.mjs             fast label lookup, hidden time-box skip
M frontend/src/components/pipeline/StepList.tsx            ✓ dot colour
```

Local test data is in `backend/data/event_pipeline.json` (git-ignored). Reset it before real use.

---

## Appendix: dry-run harness

Save as `dryrun.mjs` anywhere and run with `node dryrun.mjs <tcc|outdoor|classroom|eeRoom|permit>`. Set `U` to the absolute path of `backend/app/integrations/usc_forms`. Optional env: `SNAP="<text>"` prints the page structure around that text; `DUMP="<dropdown name>"` lists a permit dropdown's options.

```js
// Headless dry run of a pre-filler with fake data. Never clicks Submit; closes the browser at the end.
const U = '/ABSOLUTE/PATH/TO/backend/app/integrations/usc_forms';
const { chromium } = await import(`${U}/node_modules/playwright/index.mjs`);
const { FILLERS } = await import(`${U}/forms.mjs`);
const { browserOptions } = await import(`${U}/shared.mjs`);

const id = process.argv[2];
const P = {
  orgName: 'TEST DO NOT PROCESS', firstName: 'Test', lastName: 'Only', email: 'test@usc.edu', phone: '2135550100', uscId: '1234567890',
  initials: 'TT', eboardPosition: 'President', onsiteName: 'Test Onsite', onsitePhone: '2135550101',
  eventName: 'TEST DO NOT PROCESS', description: 'Automated dry run - not a real request', eventType: 'Meeting',
  date: '2027-03-04', setupTime: '17:30', startTime: '18:00', endTime: '20:00', teardownTime: '20:30', attendance: '30', audience: ['Students'],
  amplifiedSound: false, filmed: false,
  venueKind: { outdoor: 'outdoor', classroom: 'classroom', eeRoom: 'eeb_phe' }[id] ?? 'tcc',
  venueChoice1: { tcc: 'TCC 350', outdoor: 'McCarthy Quad', classroom: 'THH 102', eeRoom: 'EEB 248', permit: 'TCC 350' }[id], acceptAlternate: true,
  food: true, catererType: 'Outside Caterer', catererName: 'City Tacos', menu: 'Tacos', foodValue: '300', paymentType: 'PO', vendorServes: true,
};
const D = { reservationNumber: '123456', venueContactName: 'Test Manager', venueContactEmail: 'test@usc.edu' };

const browser = await chromium.launch(browserOptions(chromium));
const page = await browser.newPage();
page.setDefaultTimeout(12000);
const lines = [];
try { await FILLERS[id](page, P, D, m => lines.push(m)); } catch (e) { lines.push('EXCEPTION: ' + e.message.split('\n')[0]); }
console.log(lines.join('\n'));

// Wufoo forms: list required, visible fields that are still empty on the final page.
console.log('CHECK', JSON.stringify(await page.evaluate(() => {
  const lis = [...document.querySelectorAll('form li[id*="li"]')].filter(li => li.offsetParent && li.querySelector('.req'));
  const empty = lis.filter(li => {
    const ins = [...li.querySelectorAll('input,select,textarea')].filter(i => i.type !== 'hidden' && i.offsetParent !== null);
    if (!ins.length) return false;
    if (ins.some(i => i.type === 'radio' || i.type === 'checkbox')) return !ins.some(i => i.checked);
    return ins.some(i => !i.value || /Please select/i.test(i.selectedOptions?.[0]?.text || ''));
  }).map(li => (li.querySelector('label.desc,legend')?.innerText || '').replace(/\s+/g, ' ').slice(0, 70));
  return { requiredVisible: lis.length, emptyRequired: empty };
}).catch(() => null)));

if (id === 'permit') {
  const snap = await page.locator('body').ariaSnapshot();
  console.log('FINAL STAGE', (snap.match(/listitem: (.*?) - Current Stage/) || [])[1],
    '| submit button visible:', await page.getByRole('button', { name: /^Submit$/ }).isVisible().catch(() => false));
  if (process.env.DUMP) console.log('DUMP', JSON.stringify(await page.getByRole('combobox', { name: new RegExp(process.env.DUMP) }).first().evaluate(e => [...e.options].map(o => o.text)).catch(String)));
}
if (process.env.SNAP) { const sn = await page.locator('body').ariaSnapshot(); const i = sn.indexOf(process.env.SNAP); console.log('SNAP\n' + sn.slice(Math.max(0, i - 900), i + 200)); }
if (id === 'eeRoom') console.log('VALUES', JSON.stringify(await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('form [name]')].filter(i => i.type !== 'hidden').map(i => [i.name, i.type === 'checkbox' ? i.checked : (i.tagName === 'SELECT' ? i.selectedOptions[0]?.text : i.value)])))));
await browser.close();
```
