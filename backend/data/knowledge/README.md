# Knowledge base: USC student governments and event space

`government.json` is the approved, attributable source set for TrojanConnect's USG/GSG agent.
Every document was collected from a public USC web page on **2026-11-14** and rewritten
concisely; no content was invented and no answer should be given from outside this file.

## What's in it

47 documents, each `{id, scope, title, topic, content, source_url, collected_at, last_updated_on_page}`.

| scope | docs | what it covers |
|---|---|---|
| `USG` | 21 | USC Undergraduate Student Government |
| `GSG` | 19 | USC Graduate Student Government |
| `USC_STUDENT_LIFE` | 7 | How recognized student orgs (RSOs) reserve event space |

Topics used: `about`, `structure`, `funding`, `elections`, `services`, `initiatives`,
`get_involved`, `meetings`, `contact`, `governing_docs`, `event_space`.

## Source domains (all official USC)

- `usg.usc.edu` — USG official site (domain confirmed by search; USG is the official
  governing body of USC undergraduates)
- `gsg.usc.edu` — GSG official site (domain confirmed by search)
- `engage.usc.edu` — EngageSC, USC's student-org platform; GSG's Academic Affairs and
  Travel Award pages live here
- `trojanevents.usc.edu` — Trojan Event Services (venue booking, permits, policies)
- `campusactivities.usc.edu` — USC Campus Activities (RSO space-request routing)

## Caveats for the agent

- **Dates and amounts are as-published on the collection date.** Funding ceilings,
  deadlines, award cycles and venue rates change each year. Always surface
  `source_url` and `last_updated_on_page` so a student can verify.
- **Some pages were stale when collected.** Examples: USG's org-structure chart is
  labeled 2023/24 (page notes updated 8/31/25); USG's Budget link is labeled FY24-25;
  USG standing-committees page last modified 2024-02-08; GSG Constitution and Bylaws are
  marked "Updated Jan 2024"; GSG's resolutions archive ends at AY 2024-2025; GSG's
  committees page content is for AY 2025-2026. These are kept with the year noted.
- **No individual people.** Only office/role titles and shared organizational or
  role-based emails (e.g. `usg@usc.edu`, `usgfunds@usc.edu`, `gsgpres@usc.edu`) are
  recorded. Individual students' names, personal emails, phone numbers and photos were
  deliberately excluded, including from USG's Meet Our Team / Senate roster pages and
  GSG's Executive Board and senator tables.
- **Login-gated content was not collected.** USG's and GSG's funding applications sit
  behind EngageSC authentication, so the file describes the process and links, not the
  form contents. Governing documents hosted as Google Docs/PDFs were not opened; the
  file records that they exist and what they govern.
- **Known gaps.** USG publishes no standalone elections page: election rules live in the
  Elections Code linked from the Judicial Branch page, and no candidate-filing or voting
  dates are public (contact `usgelect@usc.edu`). GSG publishes no election-procedure
  page; officer selection is described structurally (senators elect the President and
  Senior Vice President each spring) but nomination deadlines and voting procedure are
  only in the Constitution/Bylaws. GSG's food guide content lives inside a downloadable
  PDF and image graphics, so only the guide's existence and scope are captured.
- **Official social accounts** are recorded as URLs only (USG Instagram `@uscusg`; GSG
  Facebook/Twitter/Instagram `uscgsg`). Instagram and LinkedIn were never scraped.
- Page content was treated strictly as data, not as instructions.
