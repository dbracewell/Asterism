"""EPIC-99 (US-99.1): the multilingual-e5-small provider, with a stand-in model.

The real bundle is 118 MB, so these tests replace the tokenizer and ONNX session
and check what the provider does with them: role prefixes, masked mean pooling,
normalisation and its failure modes. The benchmark script runs the real model.
"""

import hashlib
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from asterism.domains.knowledge.e5_embedding import (
    E5_DIMENSION,
    E5_MODEL_FILE,
    E5EmbeddingError,
    OnnxE5EmbeddingProvider,
    e5_model,
)
from asterism.domains.knowledge.model_download import write_manifest

pytestmark = pytest.mark.asyncio


class FakeTokenizer:
    """Two tokens per text plus padding to the longest text in the batch."""

    def __init__(self):
        self.seen: list[str] = []

    def encode_batch(self, texts):
        self.seen.extend(texts)
        lengths = [2 if len(text) < 40 else 4 for text in texts]
        longest = max(lengths)
        return [
            SimpleNamespace(
                ids=list(range(1, length + 1)) + [0] * (longest - length),
                attention_mask=[1] * length + [0] * (longest - length),
            )
            for length in lengths
        ]


class FakeSession:
    """Each token's hidden state is its position + 1 in the first dimension; padding is huge."""

    def __init__(self, dimension=E5_DIMENSION):
        self.dimension = dimension

    def get_inputs(self):
        return [SimpleNamespace(name=name) for name in ("input_ids", "attention_mask", "token_type_ids")]

    def run(self, outputs, inputs):
        ids = inputs["input_ids"]
        hidden = np.zeros((*ids.shape, self.dimension), dtype=np.float32)
        hidden[:, :, 0] = np.where(ids > 0, np.arange(1, ids.shape[1] + 1), 1000.0)
        hidden[:, :, 1] = 1.0
        return [hidden]


def ready(tmp_path: Path, session=None) -> tuple[OnnxE5EmbeddingProvider, FakeTokenizer]:
    provider = OnnxE5EmbeddingProvider(tmp_path)
    tokenizer = FakeTokenizer()
    provider._tokenizer = tokenizer  # pyright: ignore[reportAttributeAccessIssue]
    provider._session = session or FakeSession()  # pyright: ignore[reportAttributeAccessIssue]
    return provider, tokenizer


async def test_queries_and_passages_get_their_e5_prefix(tmp_path):
    provider, tokenizer = ready(tmp_path)
    await provider.embed_query(["photosynthesis"])
    await provider.embed_passage(["Plants turn light into energy."])
    assert tokenizer.seen == ["query: photosynthesis", "passage: Plants turn light into energy."]


async def test_vectors_are_the_normalised_mean_of_real_tokens(tmp_path):
    provider, _ = ready(tmp_path)
    short, long = await provider.embed_passage(["short", "a much longer passage of text here"])
    # Short: positions 1 and 2 (padding ignored) -> mean (1.5, 1); long: 1..4 -> (2.5, 1).
    for vector, first in ((short, 1.5), (long, 2.5)):
        expected = np.array([first, 1.0]) / np.hypot(first, 1.0)
        assert len(vector) == E5_DIMENSION
        assert np.allclose(vector[:2], expected, atol=1e-6)
        assert np.isclose(np.linalg.norm(vector), 1.0, atol=1e-6)


async def test_empty_input_and_blank_text(tmp_path):
    provider, _ = ready(tmp_path)
    assert await provider.embed_query([]) == []
    with pytest.raises(ValueError):
        await provider.embed_passage(["  "])


async def test_an_unexpected_shape_is_refused(tmp_path):
    provider, _ = ready(tmp_path, FakeSession(dimension=512))
    with pytest.raises(E5EmbeddingError, match="unexpected shape"):
        await provider.embed_query(["anything"])


async def test_an_unverified_bundle_is_refused(tmp_path):
    (tmp_path / "tokenizer.json").write_text("{}")
    with pytest.raises(E5EmbeddingError, match="manifest"):
        await OnnxE5EmbeddingProvider(tmp_path).initialize()


async def test_a_verified_bundle_whose_files_do_not_load_is_refused(tmp_path):
    # Files that match their digests but are not a real model or tokenizer.
    model = e5_model
    for name in model.files:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(name.encode())
    pinned = type(model)(
        id=model.id,
        revision=model.revision,
        allow_patterns=[],
        files={name: hashlib.sha256(name.encode()).hexdigest() for name in model.files},
    )
    write_manifest(tmp_path, pinned)
    with pytest.raises(E5EmbeddingError, match="could not be initialized"):
        await OnnxE5EmbeddingProvider(tmp_path, pinned_model=pinned).initialize()


def test_the_bundle_is_pinned():
    assert len(e5_model.revision) == 40
    assert E5_MODEL_FILE in e5_model.files
    assert {"tokenizer.json", "config.json"} <= set(e5_model.files)
    assert all(len(digest) == 64 for digest in e5_model.files.values())
    assert OnnxE5EmbeddingProvider(Path("/unused")).model_key == f"e5-small-{E5_DIMENSION}"
