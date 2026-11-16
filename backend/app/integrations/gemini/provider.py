"""Gemini implementation of the model interface (google-genai SDK).

Configuration: GEMINI_API_KEY, GEMINI_CHAT_MODEL, GEMINI_API_VERSION. The SDK's automatic function
calling is turned off: the agent loop runs every tool itself so each call is validated and traced.
"""

from __future__ import annotations

import os
import time
from typing import Any

from app.agents.model import ModelError, ModelTurn, ToolCall
from app.integrations.gemini.ratelimit import chat_limiter

DEFAULT_MODEL = "gemini-3.5-flash"
# (HTTP status, seconds to wait before each retry). One agent turn is several model calls, so a
# short per-minute limit or a busy model is common; anything longer is reported to the user.
RETRIES = {503: (2, 5), 429: (6,)}
FRIENDLY = {
    429: "Gemini's rate limit for this API key was reached. Wait about a minute and send your message again.",
    503: "Gemini is overloaded right now. Try again in a moment.",
    404: "The Gemini model in GEMINI_CHAT_MODEL was not found for this API key.",
    400: "Gemini rejected the request. Check GEMINI_API_KEY and GEMINI_CHAT_MODEL.",
    403: "Gemini refused this API key. Check GEMINI_API_KEY.",
}


def configured() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


def model_id() -> str:
    return os.environ.get("GEMINI_CHAT_MODEL") or DEFAULT_MODEL


class GeminiProvider:
    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        from google import genai  # imported lazily so the app starts without the SDK configured

        key = api_key or os.environ.get("GEMINI_API_KEY")
        if not key:
            raise ModelError("GEMINI_API_KEY is not set.")
        version = os.environ.get("GEMINI_API_VERSION")
        self._client = genai.Client(api_key=key, http_options={"api_version": version} if version else None)
        self._model = model or model_id()
        self.label = f"gemini:{self._model}"

    def start(self, system: str, tools: list[Any], history: list[dict[str, str]]) -> "_Session":
        from google.genai import types

        config = types.GenerateContentConfig(
            system_instruction=system,
            temperature=0.2,
            tools=[types.Tool(function_declarations=[
                types.FunctionDeclaration(name=t.name, description=t.description, parameters_json_schema=t.parameters) for t in tools
            ])],
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        contents = [
            types.Content(role="model" if m["role"] == "assistant" else "user", parts=[types.Part(text=m["text"])])
            for m in history if m.get("text")
        ]
        return _Session(self._client, self._model, config, contents)


class _Session:
    def __init__(self, client: Any, model: str, config: Any, contents: list[Any]) -> None:
        self._client, self._model, self._config, self._contents = client, model, config, contents

    def _generate(self) -> Any:
        attempt = 0
        while True:
            try:
                chat_limiter().wait()  # raises a 429-coded error when the wait is too long: handled below
                return self._client.models.generate_content(model=self._model, contents=self._contents, config=self._config)
            except Exception as e:  # SDK raises several error types; the agent only needs "it failed"
                code = getattr(e, "code", None)
                chat_limiter().penalize(e)
                waits = RETRIES.get(code, ())
                if attempt < len(waits):
                    time.sleep(waits[attempt])
                    attempt += 1
                    continue
                raise ModelError(FRIENDLY.get(code) or f"Gemini request failed: {str(e)[:300]}") from e

    def send(self, *, user_text: str | None = None, tool_results: list[tuple[ToolCall, dict[str, Any]]] | None = None) -> ModelTurn:
        from google.genai import types

        if user_text:
            self._contents.append(types.Content(role="user", parts=[types.Part(text=user_text)]))
        if tool_results:
            self._contents.append(types.Content(role="user", parts=[
                types.Part(function_response=types.FunctionResponse(name=call.name, id=call.id, response=result))
                for call, result in tool_results
            ]))
        resp = self._generate()

        content = resp.candidates[0].content if resp.candidates else None
        if content is None or not content.parts:
            raise ModelError("Gemini returned no content (the response may have been blocked).")
        # Keep the model's own turn verbatim: it carries the thought signatures needed for the next call.
        self._contents.append(content)
        text = "".join(p.text for p in content.parts if p.text and not p.thought)
        calls = [ToolCall(name=p.function_call.name, args=dict(p.function_call.args or {}), id=p.function_call.id)
                 for p in content.parts if p.function_call]
        return ModelTurn(text=text.strip(), tool_calls=calls)
