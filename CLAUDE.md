# TrojanConnect (USCHack)

Multi-agent campus coordination platform for USC. Full spec: `TrojanConnect_Final_PRD.md`. Hackathon project.

## Layout
- `frontend/` — Next.js 16 (TypeScript, Tailwind 4, App Router, `src/`). Owned by UI teammates. Read `frontend/AGENTS.md` before touching it: this Next.js version has breaking changes.
- `backend/` — FastAPI (Python 3.10+). `backend/main.py` is a shim for `app.main:app`.
- `supabase/` — SQL migrations and seed.
- `docs/student-agent-contract.md` — binding contract for the student-agent backend (ownership, interfaces, rules).

## Team split
- Teammates: UI and the booking system (Club Agent <-> Venue workflow).
- This workstream: **student agents backend** — Student Agent (discovery, recommendations, fit check) and public Club Agents students chat with. Do not edit `frontend/` or add booking modules unless asked.

## Backend map (`backend/app/`)
- `config.py` settings · `deps.py` singletons · `schemas/` Pydantic models (source of truth, `extra="forbid"`)
- `repositories/` `StudentRepository` protocol; in-memory seeded repo (default) or Supabase
- `integrations/llm.py` provider-agnostic `LLMClient`/`Embedder`; `integrations/gemini/` Gemini + no-key fallbacks
- `services/` deterministic logic (search, recommendations, fit check, interests)
- `tools/` LLM-callable tools · `agents/` prompts, guardrails, orchestrator
- `api/v1/` REST routes · `security/` auth -> `Actor`

## Commands
```bash
cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
cp .env.example .env          # all keys optional: empty = in-memory data + rule-based fallback agent
uvicorn main:app --reload     # http://localhost:8000/docs
python -m pytest -q
cd frontend && npm install && npm run dev
```
Dev auth: send `X-Demo-User: demo-student-1` (or `demo-student-2`); production requires a Supabase JWT.

## Non-negotiable rules (PRD 7.3, 8)
- LLM output never changes state directly. Models request tools; backend validates actor, args, permissions.
- Identity comes from the authenticated session (`Actor`), never from model- or client-supplied `user_id`/`role`.
- No invented facts: club agents answer only from the club's public profile, FAQ and events.
- Writes (interest submission, sharing contact info) need explicit user confirmation.
- Recommendations use only explicitly supplied preferences; no sensitive-trait inference; scores are relevance, not probability.
- Seeded data is demo data and must be labelled as such. Never commit `.env` or real keys.
- All responses use the envelope `{ok, data, error, request_id}`.

## Conventions
- Keep it hackathon-simple: small modules, no speculative abstraction.
- New backend features: schema -> service (deterministic) -> tool -> agent -> route -> test.
- Tests must pass without network or API keys.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. Route only to skills in the session's available-skills list; answer directly for quick questions or small scoped edits.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /autoplan
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → fix them directly: one read-only check of the cause, or a focused failing test first when the cause is unclear; then fix it and run that test
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Building UI → once it renders, invoke /design-review --build <preview url> (opt-in)
- Ship/deploy/PR → invoke /ship (merge + deploy: the user types /land-and-deploy)
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
