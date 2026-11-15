"""Shim so `uvicorn main:app --reload` keeps working from backend/."""
from app.main import app  # noqa: F401
