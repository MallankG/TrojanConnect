# USCHack

- `frontend/` — Next.js (TypeScript, Tailwind, App Router)
- `backend/` — FastAPI

## Run
```bash
cd frontend && npm install && npm run dev
cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && uvicorn main:app --reload
```

## Event Pipeline
Open http://localhost:3000/pipeline to track a club event from venue to publicity from a single event profile. The venue booking and event permit are negotiated by the Club Agent and a Venue Scheduling Agent (simulated inventory) and decided by a human reviewer at http://localhost:3000/venue-review. Nothing is sent to a USC system.
See [docs/event-pipeline.md](docs/event-pipeline.md).
