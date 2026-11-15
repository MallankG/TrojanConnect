"""Shared conventions from PRD section 9.1."""
from typing import Any, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ErrorInfo(StrictModel):
    code: str
    message: str
    retryable: bool = False


class ToolResult(StrictModel):
    ok: bool
    data: Optional[Any] = None
    error: Optional[ErrorInfo] = None
    request_id: str = Field(default_factory=lambda: str(uuid4()))

    @classmethod
    def success(cls, data: Any) -> "ToolResult":
        return cls(ok=True, data=data)

    @classmethod
    def failure(cls, code: str, message: str, retryable: bool = False) -> "ToolResult":
        return cls(ok=False, error=ErrorInfo(code=code, message=message, retryable=retryable))


class AppError(Exception):
    """Raise from services; API layer maps to HTTP, tools map to ToolResult.failure."""

    def __init__(self, code: str, message: str, status_code: int = 400, retryable: bool = False):
        super().__init__(message)
        self.code, self.message, self.status_code, self.retryable = code, message, status_code, retryable


# Canonical error codes
PERMISSION_DENIED = "PERMISSION_DENIED"
NOT_FOUND = "NOT_FOUND"
VALIDATION_ERROR = "VALIDATION_ERROR"
CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED"
UPSTREAM_ERROR = "UPSTREAM_ERROR"
