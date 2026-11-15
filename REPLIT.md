# Deploying Trojan Connect on Replit

How Replit runs this repo, which secrets to add, and how to fix Replit's Git panel.

## 1. Fix Replit's Git panel first

Replit's first import turned the repo into its own Node template. It kept that as local commits and moved
the real code into `.migration-backup/`. Those local commits are why the Git panel says *"pulling will
start a merge with conflicts"* and *"Can't push"*. Nothing in them needs keeping: all the real code is on
GitHub.

Open the **Shell** tab in Replit and run:

```bash
git fetch origin
git checkout -B main origin/main
git reset --hard origin/main
git clean -fd          # removes the template leftovers (artifacts/, lib/, .migration-backup/, pnpm files)
git status             # should say: nothing to commit, working tree clean
```

`git clean -fd` deletes untracked files, but not the ignored ones (`node_modules`, `.pythonlibs`).
Afterwards the Git panel tracks `main` with nothing to pull or push. Replit deploys from `main`.

If Replit's Agent is still waiting on the earlier "replace this workspace" request, you can cancel it:
the commands above do the same thing.

## 2. Add these secrets

In Replit, open **Tools → Secrets** and add each row. Secrets apply to the workspace and to the published
app.

### Required

| Secret | Value | Notes |
|---|---|---|
| `ENVIRONMENT` | `development` | Must not be `production`, or the demo sign-in turns off |
| `ALLOW_DEMO_AUTH` | `true` | The demo role picker (`/demo`). Anyone with the link can act as any demo user |
| `SUPABASE_URL` | copy from `backend/.env` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | copy from `backend/.env` | Supabase → Project Settings → API → `service_role` key. Server only, never in the frontend |
| `SUPABASE_JWT_SECRET` | copy from `backend/.env` | Supabase → Project Settings → API → JWT Secret |
| `BOOKING_STORE` | `supabase` | Bookings are kept in the database, so they survive redeploys |
| `CAMPUS_STORE` | `supabase` | Feedback, announcements and club posts, same reason |
| `APP_BASE_URL` | `https://trojan-connect.replit.app` | The published URL; links sent from Slack point here |
| `FRONTEND_ORIGIN` | `https://trojan-connect.replit.app` | Same URL |

Without the three Supabase secrets the app still runs, on its small built-in demo dataset instead of the
1,998 live clubs.

### Recommended

| Secret | Value | Notes |
|---|---|---|
| `ASSISTANT_MODE` | `rules` | The built-in assistant, with no model calls. `gemini` needs `GEMINI_API_KEY` |
| `DEMO_CLUB_ID` | `usc-hacksc` | The club the demo representative (Maya) runs |
| `DEMO_AUTO_REVIEW` | `false` | A person approves bookings at `/venue-review`. `true` lets a simulated reviewer approve |
| `RSO_PORTAL` | `mock` | The simulated EngageSC used by the RSO portal agent. Set `off` if Chromium won't start on Replit |
| `EMBEDDING_PROVIDER` | `gemini` | Only used when `GEMINI_API_KEY` is set; otherwise search uses keywords |

### Optional

| Secret | Value | Notes |
|---|---|---|
| `GEMINI_API_KEY` | your key | https://aistudio.google.com/apikey. Empty means the rule-based assistant |

### Slack (dummy values for now)

Placeholders so the configuration is complete. With these the bot is effectively off: Slack itself can't
sign requests with a dummy secret, so `/api/v1/webhooks/slack/*` rejects everything with 401.

| Secret | Dummy value | Real value later |
|---|---|---|
| `SLACK_SIGNING_SECRET` | `dummy-signing-secret` | Slack app → Basic Information → Signing Secret |
| `SLACK_BOT_TOKEN` | *(leave empty)* | `xoxb-…` from OAuth & Permissions. Left empty, club posts simply aren't mirrored to Slack; a fake `xoxb-` token would make every post try, and fail, to reach Slack |
| `SLACK_OUTREACH_CHANNEL` | `C00000000` | The club channel's ID (channel details, bottom) |
| `SLACK_USER_MAP` | `U00000000:demo-rep-1` | `SlackMemberID:demo-identity` pairs, comma-separated (`demo-rep-1` is Maya, `demo-student-1` Priya) |

When you set up the real bot, the slash command's Request URL is
`https://trojan-connect.replit.app/api/v1/webhooks/slack/commands`. See "Slack bot" in [README.md](README.md).

## 3. Run and publish

- **Run** (workspace): `scripts/replit.sh dev` starts FastAPI and the Next.js dev server; open port 3000.
- **Publish**: **Reserved VM**. Some state lives in the running process (the planning assistant's
  current event, the RSO tracker, Slack post previews), so one always-on machine keeps it consistent. The
  build command (`scripts/replit.sh build`)
  installs Python and Node dependencies, tries to install Chromium for the RSO portal agent, and builds the
  frontend. The run command (`scripts/replit.sh start`) starts both servers.

How the pieces connect: Replit exposes one port, served by Next.js. It forwards `/api/*` and
`/mock-engagesc/*` to FastAPI on `127.0.0.1:8000` (`frontend/next.config.ts`), so the whole app has one
URL and needs no CORS.

## 4. Check it works

Published at **https://trojan-connect.replit.app**:

| Open | Expect |
|---|---|
| `https://trojan-connect.replit.app/demo` | The demo role picker (Priya, Marcus, Sofia, Maya, Daniel, Jordan) |
| `https://trojan-connect.replit.app/discover` as Priya | Clubs: 1,998 with Supabase, the demo set without |
| `https://trojan-connect.replit.app/government` | "What is USG" answered with a usg.usc.edu link |
| `https://trojan-connect.replit.app/plan` as Maya | The planning assistant and the RSO recognition tab |
| `https://trojan-connect.replit.app/mock-engagesc/login` | The simulated EngageSC sign-in, labelled "not a USC system" |

## What resets on redeploy

The event-planning assistant's current event and the RSO tracker are stored in `backend/data/*.json` on
the VM's disk, which is wiped on each redeploy. Clubs, bookings, feedback, posts and student preferences
are in Supabase and stay.
