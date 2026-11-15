# TrojanConnect UI styling guide

Use this file as the practical UI reference when adding or updating a feature. It extends the existing [`CONTEXT.md`](CONTEXT.md); that handoff remains the source of truth for the project’s architecture, design rules, status, and known constraints. If this guide and `CONTEXT.md` ever differ, follow `CONTEXT.md` and update this guide to match. Read the relevant section of `TrojanConnect_Final_PRD.md` for product behavior and access rules.

## Product and design direction

TrojanConnect is a USC-inspired campus coordination product, not an official USC product. The home page tells the story of a club request moving through agents and people. The role-based app is a clear, calm workspace for students, club representatives, venue reviewers, and student government representatives.

- Keep the interface warm, direct, editorial, and human. Use generous whitespace and strong typography.
- The landing page is expressive and cinematic; the product app is quieter and task-focused. Reuse the brand system, but do not force the landing page's full-screen choreography onto app screens.
- Use the established Luma-like patterns: centered top bar, focused content column, wide grids when needed, grouped rounded rows, tabs, side sheets, and a floating pill navigation on phones.
- Avoid generic chatbot styling, excessive gradients, glows, ornamental decoration, and unnecessary card-on-card surfaces.
- Do not use USC seals, official marks, or real USC club, person, or room names in simulated content. Do not imply university endorsement.

## Color

The canonical tokens live in `frontend/src/app/globals.css`. Use the tokens in Tailwind classes rather than inventing one-off hex values.

| Token | Value | Use |
| --- | --- | --- |
| `cardinal` | `#990000` | Primary action, brand emphasis, active workflow marks |
| `cardinal-10/20/30` | `#8A0000` / `#7A0000` / `#6B0000` | Deeper cardinal states only; cardinal has no tint tokens |
| `gold` | `#FFCC00` | Selective accent, focus on dark/cardinal surfaces |
| `gold-75/50/25` | `#FFD940` / `#FFE680` / `#FFF2BF` | Gold surface tints; gold has no shade tokens |
| `ink` / `paper` | `#000000` / `#FFFFFF` | Main text and primary surfaces |
| `gray-30` / `gray-70` | `#CCCCCC` / `#767676` | Borders and secondary text |
| `wash` / `line` | `#F5F5F5` / `#E2E2E2` | Quiet panels and hairline borders |

Tertiary `mark-*` colors are status or illustration markers, never text colors. Status must always include a readable word as well as a color marker. Preserve accessible contrast and these pairings: do not use gold text on white, white text on gold, cardinal on black, or black on cardinal.

## Typography

- **Bricolage Grotesque** is the UI and display face. It is loaded in `frontend/src/app/layout.tsx` as `--font-bricolage` and assigned to `--font-sans` globally.
- **Libre Caslon Text** (`font-serif`) is reserved for human-authored words such as quotes, a reviewer’s reason, or personal feedback. Do not use it for general interface text.
- Use sentence case, concise labels, and plain verbs. Avoid all-caps tracked labels except where an existing landing scene intentionally uses them.
- Headlines use tight line-height and tracking, with a responsive `clamp()` size when they need to scale. The landing page may adjust Bricolage’s `wdth` axis for expressive display text; ordinary screens should not introduce font-axis treatments casually.
- Use `tabular-nums` (or the shared `.tabular` class) for times, dates, counts, and other values that should align.

## Layout and responsive behavior

`frontend/src/components/layout/AppShell.tsx` defines the product shell and the shared `Page` wrapper:

- Use `<Page>` for a focused content column (`max-w-3xl`) and `<Page wide>` for listings or dashboards (`max-w-6xl`). Both supply responsive horizontal padding and vertical spacing.
- Keep the role-aware desktop navigation in the top bar. On phones, use the shared floating bottom tab bar; leave enough bottom padding so it never covers page content.
- Use `min-w-0` on flex/grid children that contain long text. Allow headings and actions to wrap. Keep icons and action buttons from shrinking unexpectedly.
- For dense lists and grids, start with one column, add columns at the existing Tailwind breakpoints, and use horizontal scrolling only for compact controls such as category chips or tabs.
- Avoid fixed page widths and viewport assumptions. Check long labels, empty states, and action rows on narrow screens as well as desktop.
- `frontend/src/components/screens/student.tsx` contains the existing Discover experience: search, interest filters, saved filter, recommendation reasons, generated posters, and responsive club cards. Use it as the closest reference for new browse/search experiences.

## Surfaces and shared UI patterns

Prefer the reusable pieces in `frontend/src/components/ui/kit.tsx` and `frontend/src/components/booking/parts.tsx` before writing a new variant.

- **Buttons:** use `Button` or `buttonClass()`. Primary is a cardinal pill; secondary is white with a fine border; ghost is quiet and uses a wash hover. Keep disabled states visible and non-interactive.
- **Inputs:** use `Field`, `inputClass`, and the global focus style. Inputs are white, rounded, bordered, and use gray placeholder text.
- **Status:** use `StatusPill` for text plus marker. `SimulatedTag` labels seeded inventory or simulated availability wherever that content appears.
- **Tabs:** use `Tabs` for tab semantics, with an accessible label, selected state, optional count, and horizontal overflow where needed.
- **Rows:** use `Rows` and `Row` for grouped summaries and form-like detail blocks. Use `EmptyState`, `ListSkeleton`, and `ErrorNote` for the corresponding UI states.
- **Cards:** use restrained white or wash surfaces, thin `line` borders, and existing rounded corners (`rounded-2xl` or `rounded-3xl`). Do not add shadows by default.
- **Icons:** use `lucide-react` at the shared sizes in nearby components. Icons supplement text; they should not be the only indication of meaning or status.
- **Posters:** use `frontend/src/components/ui/Poster.tsx` for generated, seeded visuals. Do not add photos to simulated clubs or event inventories unless the product direction changes.
- **Sheets and toasts:** follow the Radix-backed sheet/dialog and toast patterns in `kit.tsx`; on mobile, sheets should behave as bottom sheets where the shared pattern supports it.

## Landing page and motion

The home page is built from scenes under `frontend/src/components/landing/`, composed in `Landing.tsx`:

- `Header.tsx` changes contrast by scene (`dark`, `cardinal`, or `light`). Scene sections declare `data-header` so the fixed header stays legible.
- `Hero.tsx`, `ChaosStage.tsx`, `Solution.tsx`, and `Closing.tsx` provide the staged story, motion, and calls to action. Read the closest scene before changing the choreography.
- GSAP, ScrollTrigger, and Lenis are used for the landing narrative. Keep them scoped to that experience; product screens should favor short, subtle CSS transitions such as `transition-colors`.
- Respect `prefers-reduced-motion`. The shared reduced-motion rule is in `globals.css`; landing choreography also branches through `frontend/src/lib/motion/use-reduced-motion.ts`. Any new essential information must remain available without animation.
- Do not animate layout for decoration. Avoid movement that causes text shifts or makes controls hard to use.

## Sound

Sound is synthesized by Web Audio in `frontend/src/lib/sound/engine.ts`, and preferences are managed by `frontend/src/lib/sound/SoundProvider.tsx`.

- Use the shared `sound.play()` or `useSound()` interface and existing cues (`tick`, `send`, `receive`, `ping`, `buzz`, `whoosh`, `resolve`, `stamp`, `decline`, `type`). Do not add unrelated sound files or create a second sound system.
- Keep product UI cues quiet. The app shell intentionally lowers the sound level relative to the landing page.
- Browsers require a user gesture to unlock audio. Sound starts muted unless the person has explicitly enabled it. Never make audio necessary to understand a state or complete a task.
- Match a cue to a meaningful action or result; avoid playing sounds on render or repeatedly during incidental re-renders.

## Interaction, accessibility, and rendering

- Use semantic buttons and links, visible keyboard focus, accessible names for icon-only buttons, correct `aria-pressed`/tab state, and live announcements for changing result counts where appropriate.
- Keep focus visible. The global `:focus-visible` outline is cardinal on light surfaces and gold inside `.on-dark` or `.on-cardinal` regions.
- Keep server and first client renders deterministic. Do not render `Date.now()`, `Math.random()`, browser locale output, or `window`-dependent markup as initial content. Read browser-only state in effects or through the project’s external-store patterns to avoid hydration mismatches.
- Do not mutate seeded data during render. Writes belong in event handlers or effects and should go through the API client, not directly from a component into storage.
- Every loading, empty, and error state should have a useful visible treatment. Do not communicate state by color alone.
- For dynamic routes with `useParams()`, follow the existing `<Suspense>` pattern required by Next.js Cache Components. Read `frontend/AGENTS.md` and the installed Next documentation before changing routing APIs.

## Existing feature and source map

| Feature | Main files |
| --- | --- |
| Home story and scenes | `frontend/src/components/landing/`, `frontend/src/app/(marketing)/page.tsx` |
| Role picker and demo entry | `frontend/src/components/screens/common.tsx`, `frontend/src/app/demo/page.tsx` |
| Role-aware shell and navigation | `frontend/src/components/layout/AppShell.tsx`, `frontend/src/app/(product)/layout.tsx` |
| Shared UI primitives | `frontend/src/components/ui/kit.tsx` |
| Student dashboard, Discover, club detail, events, interest sheet | `frontend/src/components/screens/student.tsx` |
| Club dashboards, profiles, recruitment | `frontend/src/components/screens/club.tsx` |
| Venue review queue and decisions | `frontend/src/components/screens/review.tsx` |
| Student government, knowledge, feedback | `frontend/src/components/screens/government.tsx` |
| Booking summary, timeline, stepper, proposals | `frontend/src/components/booking/parts.tsx` |
| Agent chat surfaces | `frontend/src/components/chat/Chat.tsx` |
| Event, alumni, sign-in, and other supporting views | `frontend/src/components/screens/extras.tsx` |
| Shared tokens and responsive utilities | `frontend/src/app/globals.css` |
| Sound and reduced-motion behavior | `frontend/src/lib/sound/`, `frontend/src/lib/motion/` |
| Brand mark exports and editable sources | `frontend/public/brand/` |

Product routes are under `frontend/src/app/(product)/`; their pages should remain thin wrappers around the shared screen components and shell.

## New-feature checklist

Before calling a UI feature complete, confirm that it:

1. Uses the correct `Page` width and shared components for its screen type.
2. Uses the existing palette and typography tokens without introducing one-off brand colors.
3. Works at phone, tablet, and desktop widths, including long text and narrow actions.
4. Includes loading, empty, error, and disabled states relevant to the flow.
5. Preserves keyboard access, focus visibility, readable status text, and reduced-motion behavior.
6. Uses sound only for intentional interactions, and remains understandable when muted.
7. Keeps client-only state and data writes out of render and avoids hydration-sensitive values.
8. Labels simulated data accurately and follows role/permission rules from the PRD.
9. Reuses the existing page/component architecture instead of cloning a parallel design system.
