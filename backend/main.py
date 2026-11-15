import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.workflows.event_pipeline import router as event_pipeline_router

app = FastAPI(
    title="TrojanConnect event pipeline",
    description="Plan a club event and track it through the USC process. See event-planning-integration.md. "
                "Every /api/v1/pipeline request must send the header `X-TrojanConnect-Client: web`.",
)
# Browser origins allowed to call the API: comma-separated FRONTEND_ORIGIN (default: the Next.js dev server).
ORIGINS = [o.strip() for o in os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(event_pipeline_router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
