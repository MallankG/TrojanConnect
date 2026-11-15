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

# RSO portal agent: run Playwright on Replit's Node (its bundled Node needs libatomic, which Replit lacks)
# and on the Nix Chromium from .replit.
if command -v node >/dev/null; then export PLAYWRIGHT_NODEJS_PATH="${PLAYWRIGHT_NODEJS_PATH:-$(command -v node)}"; fi
CHROMIUM="$(command -v chromium || command -v chromium-browser || true)"
if [ -n "$CHROMIUM" ]; then export CHROMIUM_PATH="${CHROMIUM_PATH:-$CHROMIUM}"; fi

# Install Python packages only when requirements.txt changed. Reinstalling on every Run rewrote files in
# .pythonlibs, and a Run during Publish then broke the deploy ("archive/tar: write too long").
python_deps() {
  python - <<'PY'
import fcntl
import subprocess
import sys
from pathlib import Path

root = Path.cwd()
libs = root / ".pythonlibs"
libs.mkdir(exist_ok=True)
requirements = (root / "backend/requirements.txt").read_bytes()
stamp = libs / ".requirements-installed"
with (libs / ".requirements.lock").open("a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    if not stamp.exists() or stamp.read_bytes() != requirements:
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", "backend/requirements.txt"], check=True)
        stamp.write_bytes(requirements)
PY
}

backend() {
  (cd backend && exec python -m uvicorn main:app --host 127.0.0.1 --port 8000 "$@")
}

case "${1:-}" in
  build)
    python_deps
    # Browser for the RSO portal agent (simulated EngageSC): the Nix Chromium when present, otherwise a download.
    if [ -n "${CHROMIUM_PATH:-}" ]; then
      echo "RSO portal agent: using Chromium at $CHROMIUM_PATH"
    else
      python -m playwright install chromium || echo "Chromium not installed; the RSO portal agent will be unavailable."
    fi
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
    python_deps
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
