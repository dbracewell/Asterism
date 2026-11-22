"""The torch-free SmolVLM2 decode loop and prompt (ADR-0077), with ONNX sessions doubled."""

from dataclasses import dataclass

import numpy as np
import pytest
from asterism.domains.knowledge.caption_schemas import CaptionErrorCode, CaptioningError
from asterism.domains.knowledge.onnx_captioning import (
    CAPTION_PROMPT,
    GLOBAL_IMAGE_TOKEN,
    IMAGE_TOKEN,
    caption_prompt,
    greedy_decode,
    image_prompt,
)

HIDDEN = 4
VOCAB = 10
END = 9


@dataclass
class Node:
    name: str
    type: str = "tensor(float)"
    shape: tuple = ()


class FakeDecoder:
    """Emits a scripted token per step and records what each step was fed."""

    def __init__(self, tokens: list[int]) -> None:
        self._tokens = tokens
        self.feeds: list[dict[str, np.ndarray]] = []

    def get_inputs(self) -> list[Node]:
        return [
            Node("inputs_embeds", shape=("batch_size", "sequence_length", HIDDEN)),
            Node("attention_mask", "tensor(int64)"),
            Node("position_ids", "tensor(int64)"),
            Node("past_key_values.0.key", shape=("batch_size", 3, "past_sequence_length", 64)),
            Node("past_key_values.0.value", shape=("batch_size", 3, "past_sequence_length", 64)),
        ]

    def get_outputs(self) -> list[Node]:
        return [Node("logits"), Node("present.0.key"), Node("present.0.value")]

    def run(self, _names: None, feed: dict[str, np.ndarray]) -> list[np.ndarray]:
        self.feeds.append(feed)
        step = len(self.feeds) - 1
        sequence = feed["inputs_embeds"].shape[1]
        logits = np.zeros((1, sequence, VOCAB), dtype=np.float32)
        logits[0, -1, self._tokens[step]] = 1.0
        total = feed["attention_mask"].shape[1]
        present = np.full((1, 3, total, 64), step, dtype=np.float32)
        return [logits, present, present + 0.5]


def embed(ids: np.ndarray) -> np.ndarray:
    return np.ones((*ids.shape, HIDDEN), dtype=np.float32)


def prompt(length: int = 5) -> np.ndarray:
    return np.zeros((1, length, HIDDEN), dtype=np.float32)


def decode(decoder: FakeDecoder, *, max_new_tokens: int = 20, deadline: float = 1e9, clock=lambda: 0.0) -> list[int]:
    return greedy_decode(
        decoder,
        embed,
        prompt(),
        end_token_ids=frozenset({END}),
        max_new_tokens=max_new_tokens,
        deadline=deadline,
        clock=clock,
    )


def test_decoding_stops_at_the_end_token_and_leaves_it_out():
    decoder = FakeDecoder([3, 4, 5, END, 6, 7])

    assert decode(decoder) == [3, 4, 5]
    assert len(decoder.feeds) == 4


def test_decoding_stops_at_the_length_bound():
    decoder = FakeDecoder([1] * 50)

    assert decode(decoder, max_new_tokens=7) == [1] * 7
    assert len(decoder.feeds) == 7


def test_the_first_step_feeds_the_prompt_with_an_empty_cache_and_later_steps_reuse_the_cache():
    decoder = FakeDecoder([3, 4, END])
    decode(decoder)

    first, second, third = decoder.feeds
    assert first["inputs_embeds"].shape == (1, 5, HIDDEN)
    assert first["past_key_values.0.key"].shape == (1, 3, 0, 64)
    assert first["position_ids"].tolist() == [[0, 1, 2, 3, 4]]
    assert first["attention_mask"].shape == (1, 5)

    assert second["inputs_embeds"].shape == (1, 1, HIDDEN)
    assert second["position_ids"].tolist() == [[5]]
    assert second["attention_mask"].shape == (1, 6)
    assert second["past_key_values.0.key"].shape == (1, 3, 5, 64)
    assert np.all(second["past_key_values.0.key"] == 0)
    assert np.all(second["past_key_values.0.value"] == 0.5)

    assert third["position_ids"].tolist() == [[6]]
    assert third["past_key_values.0.key"].shape == (1, 3, 6, 64)
    assert np.all(third["past_key_values.0.key"] == 1)


def test_decoding_past_the_deadline_is_a_timeout():
    ticks = iter([0.0, 1.0, 2.0, 3.0])
    decoder = FakeDecoder([1] * 10)

    with pytest.raises(CaptioningError) as error:
        decode(decoder, deadline=1.5, clock=lambda: next(ticks))

    assert error.value.code is CaptionErrorCode.TIMEOUT
    assert len(decoder.feeds) == 2


def test_an_unsplit_image_is_only_the_global_view():
    expanded = image_prompt(0, 0, 64)

    assert expanded.count(IMAGE_TOKEN) == 64
    assert expanded.count(GLOBAL_IMAGE_TOKEN) == 1
    assert "<row_" not in expanded


def test_a_split_image_has_every_tile_then_the_global_view():
    expanded = image_prompt(2, 3, 64)

    assert expanded.count(IMAGE_TOKEN) == (2 * 3 + 1) * 64
    assert expanded.index("<row_1_col_1>") < expanded.index("<row_2_col_3>") < expanded.index(GLOBAL_IMAGE_TOKEN)
    assert expanded.count("\n") == 3


def test_the_caption_prompt_follows_the_chat_template():
    text = caption_prompt(0, 0, 2)

    assert text.startswith("<|im_start|>User:<fake_token_around_image>")
    assert text.endswith(f"{CAPTION_PROMPT}<end_of_utterance>\nAssistant:")
