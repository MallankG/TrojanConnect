import pytest
from pydantic import ValidationError

from app.config import Settings
from app.integrations.gemini.client import build_embedder
from app.integrations.ollama import OllamaEmbedder


class FakeResponse:
    def __init__(self, vectors):
        self.vectors = vectors

    def raise_for_status(self):
        return None

    def json(self):
        return {"embeddings": self.vectors}


class FakeAsyncClient:
    def __init__(self, **kwargs):
        self.options = kwargs
        self.request = None

    async def post(self, path, *, json):
        self.request = (path, json)
        return FakeResponse([[3.0] + [0.0] * 767 for _ in json["input"]])


@pytest.mark.asyncio
async def test_ollama_embedder_uses_model_and_normalizes_vectors(monkeypatch):
    clients = []

    def create_client(**kwargs):
        client = FakeAsyncClient(**kwargs)
        clients.append(client)
        return client

    monkeypatch.setattr("app.integrations.ollama.httpx.AsyncClient", create_client)
    settings = Settings(
        _env_file=None,
        embedding_provider="ollama",
        ollama_base_url="http://localhost:11434/",
        ollama_embedding_model="nomic-embed-text:latest",
    )
    embedder = OllamaEmbedder(settings)

    vectors = await embedder.embed(["club profile", ""])

    client = clients[0]
    assert client.options["base_url"] == "http://localhost:11434"
    assert client.request == (
        "/api/embed",
        {"model": "nomic-embed-text:latest", "input": ["club profile", " "]},
    )
    assert len(vectors) == 2 and len(vectors[0]) == 768
    assert vectors[0][0] == 1.0
    assert embedder.space == "ollama:nomic-embed-text:latest"
    assert isinstance(build_embedder(settings), OllamaEmbedder)


@pytest.mark.asyncio
async def test_ollama_embedder_rejects_wrong_vector_dimensions(monkeypatch):
    class WrongDimensionsClient(FakeAsyncClient):
        async def post(self, path, *, json):
            return FakeResponse([[1.0, 0.0]])

    monkeypatch.setattr(
        "app.integrations.ollama.httpx.AsyncClient",
        lambda **kwargs: WrongDimensionsClient(**kwargs),
    )
    embedder = OllamaEmbedder(Settings(_env_file=None, embedding_provider="ollama"))

    with pytest.raises(RuntimeError, match="expected 768"):
        await embedder.embed(["club profile"])


def test_embedding_provider_rejects_unknown_values():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, embedding_provider="unknown")
