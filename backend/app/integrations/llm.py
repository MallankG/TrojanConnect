"""Provider-agnostic LLM + embedding interfaces. Gemini implements these in
app/integrations/gemini/client.py; RuleBasedLLM/HashEmbedder are the no-key fallbacks."""
from typing import Any, Literal, Optional, Protocol

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "tool"]
    content: str = ""
    tool_calls: list["ToolCall"] = Field(default_factory=list)  # on assistant turns
    tool_name: Optional[str] = None                              # on tool turns
    tool_call_id: Optional[str] = None


class ToolSpec(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema (object)


class ToolCall(BaseModel):
    id: str
    name: str
    args: dict[str, Any] = Field(default_factory=dict)


class LLMResponse(BaseModel):
    text: str = ""
    tool_calls: list[ToolCall] = Field(default_factory=list)
    model: str = ""
    is_fallback: bool = False
    usage: dict[str, Any] = Field(default_factory=dict)


ChatMessage.model_rebuild()


class LLMClient(Protocol):
    async def generate(
        self,
        *,
        system: str,
        messages: list[ChatMessage],
        tools: Optional[list[ToolSpec]] = None,
        response_schema: Optional[dict[str, Any]] = None,
        temperature: float = 0.4,
    ) -> LLMResponse: ...


class Embedder(Protocol):
    dimensions: int

    async def embed(self, texts: list[str]) -> list[list[float]]: ...
