# TrojanConnect frontend: handoff context

Written 14 November 2026. Read this before touching `frontend/`. The product spec is
`TrojanConnect_Final_PRD.md`; section numbers below refer to it.

## What exists

Branch `feat/landing-and-app-ui`. Commit `e875586` holds the landing page and the first
lib files. Everything else listed here is **uncommitted** in the working tree.

- **Landing page** (`/`): nine scroll scenes with synthesized sound. Verified in Chrome.
- **Full app UI** on an in-browser mock backend: 21 routes, four roles.
- `npm run lint` and `npm run build` pass. Nothing in `backend/` was changed.

The backend is still the empty FastAPI scaffold. There is no auth, database, Gemini or
WhatsApp integration. The UI runs entirely on seeded data in `localStorage`.

## Run it

```bash
cd frontend && npm install && npm run dev
```

Open `/` for the story, `/demo` to pick a role. For the PRD section 19 demo, open `/demo`
in two windows (club representative and venue reviewer); they sync live.

## Stack and rules that will bite you

- **Next.js 16.4.6**, React 19.3, Tailwind 4.3, TypeScript. `frontend/AGENTS.md` says this
  Next version differs from older ones: read `node_modules/next/dist/docs/` before writing
  routing or data code.
- `cacheComponents: true` is on. A component that reads `useParams()` on a dynamic route
  must sit inside `<Suspense>`. See any `[id]/page.tsx` under `src/app/(product)/`.
- `LayoutProps<"/">` is a generated global type. Run `npx next typegen` (or `next dev`)
  before `tsc` or it reports the type as missing.
- Anything that writes to the mock store must run in an effect or event handler, never
  during render. `components/chat/useOpenChat.ts` is the pattern.
- Libraries: `gsap` + `@gsap/react` + `lenis` (landing only), `radix-ui` (dialog, popover,
  dropdown), `lucide-react`. `motion` is installed but unused; remove it or use it.

## Design system (do not drift from this)

- **Colour** comes from identity.usc.edu and is tokenised in `src/app/globals.css`:
  cardinal `#990000` (shades `-10/-20/-30` only, no tints), gold `#FFCC00` (tints
  `-75/-50/-25` only, no shades), black, white, gray `#CCCCCC` and `#767676`.
  Forbidden pairs: gold text on white, white on gold, cardinal on black, black on cardinal.
  Tertiary colours (`mark-blue`, `mark-olive`, `mark-orange`, `mark-red`) are status
  markers only, never text.
- **Type**: Bricolage Grotesque for everything; Libre Caslon Text (`font-serif`) only where
  a person speaks or decides (quotes, a reviewer's reason, feedback text).
- **Layout**: Luma-style. Top bar with centred sections, narrow centred column
  (`<Page>`), wide column for grids (`<Page wide>`), floating pill tab bar on phones.
  The user explicitly chose this over the PRD's left sidebar.
- **Luma patterns in use**: poster with status pill on its edge, date-grouped lists on a
  dotted rail, grouped rounded rows (`Rows`/`Row`), tabs with counts, side sheet, pill toast.
- **Posters** (`components/ui/Poster.tsx`) are generated SVGs seeded by id. No photos.
- **Copy**: sentence case, plain verbs, no uppercase tracked labels, no invented statistics.
  Clubs, people and rooms are invented; never use real USC organisation or room names.
  Every screen that shows inventory carries a "Simulated" tag (PRD 11.5).
- **Status always reads as words plus a marker**, never colour alone (PRD 11.9).
- Sound: `lib/sound/engine.ts` synthesizes every cue with Web Audio. Call `sound.play(cue)`.

## Architecture

```
frontend/src/
├── app/
│   ├── (marketing)/page.tsx     landing
│   ├── demo/page.tsx            role picker (outside the app shell)
│   └── (product)/               every app route, wrapped by AppShell
├── components/
│   ├── landing/                 Hero, ChaosStage, Solution, Closing, Header, content.ts
│   ├── layout/AppShell.tsx      top bar, nav per role, notifications, Page, Only (role gate)
│   ├── ui/kit.tsx               Button, StatusPill, Tabs, Rows, Sheet, Toast, EmptyState…
│   ├── booking/parts.tsx        BookingRow, Stepper, RequestSummary, ProposalCard, Timeline
│   ├── chat/Chat.tsx            one chat surface for all four agent kinds, with cards
│   └── screens/                 club.tsx, review.tsx, student.tsx, government.tsx, common.tsx
└── lib/
    ├── api/types.ts             TS mirror of PRD data contracts
    ├── api/client.ts            THE ONLY module the UI calls; one function per PRD 12 endpoint
    ├── api/mock/                seed, store (localStorage + BroadcastChannel), inventory,
    │                            extract (rule parser), booking (workflow), agents
    ├── booking/state-machine.ts PRD 7.1 states, 7.2 actor permissions, labels
    ├── sound/ motion/ time.ts
```

Key behaviours:

- **Mock behind a real interface.** To connect FastAPI, replace function bodies in
  `lib/api/client.ts` one at a time. Components do not change.
- **Invariants hold in the mock.** Every state change goes through `move()` in
  `mock/booking.ts`, which calls `assertTransition`. Only the reviewer role can reach
  `APPROVED`; only the "backend" actor can reach `CONFIRMED`, and only after re-validating
  the room. No agent path exists to either.
- **Roles** live in `sessionStorage` (per tab) so two windows can hold two roles. Data
  lives in `localStorage` key `tc-db` and is shared.
- **The scripted counteroffer is rule-based, not hard-coded.** Demo Meeting Room A is busy
  until 5:30 PM on Wednesdays, so a Wednesday 5 to 8 PM request for 100 gets a shifted
  first offer, the Club Agent counters, and Demo Hall B comes back as an exact match.

## Routes

| Role | Routes |
|---|---|
| All | `/`, `/demo`, `/dashboard`, `/settings`, `/clubs/[clubId]` |
| Club rep | `/bookings`, `/bookings/[bookingId]`, `/club-profile`, `/recruitment`, `/conversations`, `/conversations/[conversationId]` |
| Venue reviewer | `/venue-review`, `/venue-review/[reviewId]`, `/bookings/[bookingId]` (own authority) |
| Student | `/discover`, `/events`, `/government`, `/conversations…` |
| USG rep | `/government`, `/government/knowledge`, `/government/feedback` |

## Verified in Chrome

- Landing: gate, typing, chaos pile, people, collapse, cardinal turn, solution demo.
- Booking end to end in two windows: sample request → title asked → summary → send →
  routing → inventory → offer → counteroffer → accept → reviewer approves → club window
  shows Confirmed live with the reviewer's reason and an audit trail.
- Student: discover with match reasons, club page. Government: sourced answer and the
  feedback consent card.

## Not verified, or known gaps

- **Phone-width layouts were not checked** (the browser window would not resize). Check the
  floating tab bar, booking detail and chat at 390px.
- **Reduced-motion landing layout** is implemented but was not viewed.
- Not clicked through: request alternatives, reject, request changes and resubmit,
  cancellation, express-interest sheet, knowledge editor, announcement composer, settings.
- The landing page's pinned scenes overlap if JavaScript is disabled.
- Inputs show the global cardinal focus outline even inside the chat pill; it is
  accessible but heavy.
- "Report a problem" in chat only shows a toast.
- A booking interrupted mid-workflow (tab closed while routing) stays in that state; use
  "Reset demo data".
- PRD items deliberately out of scope this round: backend, Supabase auth and Realtime,
  Gemini, WhatsApp webhook, alumni, streaming responses.

## History worth knowing

- Codex added `/demo` and `/discover` pages with hardcoded data, a left sidebar, real
  organisation and room names, and a cardinal tint. They were replaced by the versions
  above; the card grid, search, chips and saved filter ideas were kept.
- The user's Chrome has a stale service worker on `localhost:3000` from another project,
  which serves old JS and causes false hydration errors. Test on another port, or
  unregister it in DevTools > Application > Service workers.
- No commits or pushes have been made by the assistant. The repo belongs to a teammate
  (`MallankG/USCHack`).

## Open questions for the team

- Real quotes or numbers for the landing "chaos" scene. It currently ships as a labelled
  illustrative scenario with composite voices.
- Team names for the footer.
- Which approved USG/GSG sources replace the sample knowledge base.
