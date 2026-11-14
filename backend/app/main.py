"""FastAPI entrypoint: CORS, health, /api/v1 routers, standard error envelope."""
import logging

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import Settings, get_settings
from app.schemas.common import NOT_FOUND, VALIDATION_ERROR, AppError, ToolResult

log = logging.getLogger("trojanconnect.api")

_HTTP_CODES = {401: "UNAUTHENTICATED", 403: "PERMISSION_DENIED", 404: NOT_FOUND, 405: "METHOD_NOT_ALLOWED"}


def _fail(status_code: int, code: str, message: str, retryable: bool = False, headers=None) -> JSONResponse:
    body = ToolResult.failure(code, message, retryable).model_dump(mode="json")
    return JSONResponse(status_code=status_code, content=body, headers=headers)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="TrojanConnect API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted({settings.frontend_origin.rstrip("/"), "http://localhost:3000"}),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):
        headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None
        return _fail(exc.status_code, exc.code, exc.message, exc.retryable, headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        parts = [f"{'.'.join(str(p) for p in e.get('loc', ()))}: {e.get('msg', '')}" for e in exc.errors()[:5]]
        return _fail(422, VALIDATION_ERROR, "; ".join(parts) or "Invalid request")

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException):
        code = _HTTP_CODES.get(exc.status_code, "HTTP_ERROR")
        return _fail(exc.status_code, code, str(exc.detail), headers=getattr(exc, "headers", None))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return _fail(500, "INTERNAL_ERROR", "Something went wrong. Please try again.", retryable=True)

    @app.get("/api/health")
    def health(s: Settings = Depends(get_settings)):
        return {
            "status": "ok",
            "environment": s.environment,
            "mode": {
                "repository": "supabase" if s.use_supabase else "memory",
                "llm": "gemini" if s.use_gemini else "fallback",
            },
        }

    from app.api.v1 import router as student_router

    app.include_router(student_router, prefix="/api/v1")

    # === ADDITIONAL ROUTERS GO HERE (booking, venue review, USG/GSG, webhooks) ===
    # from app.api.v1.bookings import router as bookings_router
    # app.include_router(bookings_router, prefix="/api/v1")
    # =============================================================================

    return app


app = create_app()
