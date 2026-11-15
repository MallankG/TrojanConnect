#!/usr/bin/env bash
# Replit build / start / dev for TrojanConnect. One public port (Next.js on 3000); FastAPI stays
# private on 127.0.0.1:8000 and is reached through Next.js rewrites (frontend/next.config.ts).
# Configuration comes from Replit Secrets (see README "Deploy on Replit"), not backend/.env.
set -euo pipefail
cd "$(dirname "$0")/.."

# Demo deployment defaults; any Replit Secret with the same name wins. Demo sign-in needs a
# non-production ENVIRONMENT. With no Supabase secrets the backend runs on its seeded demo data.
export ENVIRONMENT="${ENVIRONMENT:-development}" ALLOW_DEMO_AUTH="${ALLOW_DEMO_AUTH:-true}"
export ASSISTANT_MODE="${ASSISTANT_MODE:-rules}" RSO_PORTAL="${RSO_PORTAL:-mock}"

backend() {
  (cd backend && exec python -m uvicorn main:app --host 127.0.0.1 --port 8000 "$@")
}

case "${1:-}" in
  build)
    python -m pip install -q -r backend/requirements.txt
    # Browser for the RSO portal agent (simulated EngageSC). Optional: without it, set RSO_PORTAL=off.
    python -m playwright install chromium || echo "Chromium not installed; the RSO portal agent will be unavailable."
    # Empty API base = same origin; Next.js forwards /api to the backend.
    (cd frontend && npm ci && NEXT_PUBLIC_API_URL="" npm run build)
    ;;
  start)
    backend &
    (cd frontend && exec npx next start -H 0.0.0.0 -p 3000) &
    wait -n  # if either process exits, stop so Replit restarts the deployment
    exit 1
    ;;
  dev)
    python -m pip install -q -r backend/requirements.txt
    (cd frontend && [ -d node_modules ] || npm ci)
    backend --reload &
    (cd frontend && NEXT_PUBLIC_API_URL="" exec npx next dev -H 0.0.0.0 -p 3000) &
    wait -n
    exit 1
    ;;
  *)
    echo "usage: scripts/replit.sh build|start|dev" >&2
    exit 2
    ;;
esac
