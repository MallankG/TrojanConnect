# USCHack

- `frontend/` — Next.js (TypeScript, Tailwind, App Router)
- `backend/` — FastAPI

## Run
```bash
cd frontend && npm install && npm run dev
cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && uvicorn main:app --reload
```

## Event Pipeline
Open http://localhost:3000/pipeline to track a club event from venue to publicity, with USC forms pre-filled from a single event profile. Nothing is ever auto-submitted. For browser pre-fill, run this once:
```bash
cd backend/app/integrations/usc_forms && npm run setup
```
See [docs/event-pipeline.md](docs/event-pipeline.md).
