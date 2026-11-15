from types import SimpleNamespace

import pytest

from scripts.backfill_embeddings import PAGE_SIZE, _embed_batch, _fetch_embedding_rows


class FakeQuery:
    def __init__(self, client):
        self.client = client
        self.start = 0
        self.end = 0

    def select(self, _columns):
        return self

    def order(self, _column):
        return self

    def range(self, start, end):
        self.start = start
        self.end = end
        self.client.ranges.append((start, end))
        return self

    def execute(self):
        return SimpleNamespace(data=self.client.rows[self.start:self.end + 1])


class FakeClient:
    def __init__(self, rows):
        self.rows = rows
        self.ranges = []

    def table(self, _name):
        return FakeQuery(self)


def test_fetch_embedding_rows_reads_every_page():
    rows = [{"organization_id": str(index), "embedding": None}
            for index in range(PAGE_SIZE + 1)]
    client = FakeClient(rows)

    assert _fetch_embedding_rows(client) == rows
    assert client.ranges == [(0, PAGE_SIZE - 1), (PAGE_SIZE, 2 * PAGE_SIZE - 1)]


async def test_embed_batch_refuses_fallback_vectors():
    class FallbackEmbedder:
        is_fallback = True

        async def embed(self, texts):
            return [[0.0] for _ in texts]

    with pytest.raises(RuntimeError, match="refusing to store fallback vectors"):
        await _embed_batch(FallbackEmbedder(), ["club profile"])
