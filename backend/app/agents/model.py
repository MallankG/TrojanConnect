"""Provider-neutral model interface, so the model provider can be swapped.

The agent loop only knows these types. A provider keeps its own native conversation inside
the session it returns, so provider-specific details never leak into the agent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class ToolCall:
    name: str
    args: dict[str, Any]
    id: str | None = None


@dataclass
class ModelTurn:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)


class ModelError(Exception):
    """The provider could not produce a turn (network, quota, bad key, blocked response)."""


class ChatSession(Protocol):
    def send(self, *, user_text: str | None = None, tool_results: list[tuple[ToolCall, dict[str, Any]]] | None = None) -> ModelTurn:
        """Add the user's message or the results of the previous turn's tool calls, and get the next turn."""
        ...


class ModelProvider(Protocol):
    label: str

    def start(self, system: str, tools: list[Any], history: list[dict[str, str]]) -> ChatSession:
        """`tools` are app.tools Tool objects; `history` is prior [{role: user|assistant, text}] turns."""
        ...
