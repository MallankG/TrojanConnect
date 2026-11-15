"""Local Ollama embedding provider."""
from __future__ import annotations

import math

import httpx


class OllamaEmbedder:
    dimensions = 768
    is_fallback = False

    def __init__(self, settings):
        self.model = settings.ollama_embedding_model
        self.space = f"ollama:{self.model}"
        self._client = httpx.AsyncClient(
            base_url=settings.ollama_base_url.rstrip("/"),
            timeout=120.0,
        )

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        response = await self._client.post(
            "/api/embed",
            json={"model": self.model, "input": [text or " " for text in texts]},
        )
        response.raise_for_status()
        payload = response.json()
        vectors = payload.get("embeddings") if isinstance(payload, dict) else None
        if not isinstance(vectors, list) or len(vectors) != len(texts):
            raise RuntimeError("Ollama returned an unexpected number of embeddings")

        normalized = []
        for vector in vectors:
            if not isinstance(vector, list) or len(vector) != self.dimensions:
                actual = len(vector) if isinstance(vector, list) else "invalid"
                raise RuntimeError(
                    f"Ollama returned {actual} dimensions; expected {self.dimensions}"
                )
            values = [float(value) for value in vector]
            norm = math.sqrt(sum(value * value for value in values))
            normalized.append([value / norm for value in values] if norm else values)
        return normalized
