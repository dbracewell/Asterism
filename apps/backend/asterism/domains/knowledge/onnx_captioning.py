"""SmolVLM2 image captioning on ONNX Runtime, without PyTorch (ADR-0077).

The pinned SmolVLM2 export is three graphs: a vision encoder (image tiles to
image features), a token embedding, and a decoder with a key/value cache. The
tokenizer and the PIL image processor come from ``transformers``, which needs no
torch for them. The prompt is built here: ``SmolVLMProcessor`` itself cannot be
constructed without torch, because its video processor requires it.
"""

from __future__ import annotations

import io
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np
from PIL import Image

from .caption_schemas import CaptionErrorCode, CaptioningError

CAPTION_PROMPT = "Describe this image concisely."
IMAGE_TOKEN = "<image>"
FAKE_IMAGE_TOKEN = "<fake_token_around_image>"
GLOBAL_IMAGE_TOKEN = "<global-img>"
END_OF_UTTERANCE_TOKEN = "<end_of_utterance>"


class OrtSession(Protocol):
    """The part of ``onnxruntime.InferenceSession`` the caption decoder uses."""

    def get_inputs(self) -> list[Any]: ...
    def get_outputs(self) -> list[Any]: ...
    def run(self, output_names: list[str] | None, input_feed: dict[str, np.ndarray]) -> list[np.ndarray]: ...


def _numpy_dtype(onnx_type: str) -> type[np.floating[Any]]:
    return np.float16 if "float16" in onnx_type else np.float32


def image_prompt(rows: int, cols: int, image_seq_len: int) -> str:
    """Expand one image into SmolVLM's tile tokens, as ``SmolVLMProcessor`` does.

    A split image is ``rows`` x ``cols`` tiles followed by a global view; an
    unsplit one is only the global view. Each view is ``image_seq_len`` image tokens.
    """
    global_view = f"{FAKE_IMAGE_TOKEN}{GLOBAL_IMAGE_TOKEN}{IMAGE_TOKEN * image_seq_len}{FAKE_IMAGE_TOKEN}"
    if rows == 0 and cols == 0:
        return global_view
    tiles = "".join(
        "".join(f"{FAKE_IMAGE_TOKEN}<row_{row + 1}_col_{col + 1}>{IMAGE_TOKEN * image_seq_len}" for col in range(cols))
        + "\n"
        for row in range(rows)
    )
    return f"{tiles}\n{global_view}"


def caption_prompt(rows: int, cols: int, image_seq_len: int) -> str:
    """The SmolVLM2 chat template for one user turn of an image then the caption request."""
    return (
        f"<|im_start|>User:{image_prompt(rows, cols, image_seq_len)}{CAPTION_PROMPT}"
        f"{END_OF_UTTERANCE_TOKEN}\nAssistant:"
    )


def greedy_decode(
    decoder: OrtSession,
    embed: Callable[[np.ndarray], np.ndarray],
    inputs_embeds: np.ndarray,
    *,
    end_token_ids: frozenset[int],
    max_new_tokens: int,
    deadline: float,
    clock: Callable[[], float] = time.monotonic,
) -> list[int]:
    """Greedily decode from prompt embeddings with the decoder's key/value cache.

    The first step feeds the whole prompt with an empty cache; each later step
    feeds only the new token and the cache the previous step returned.

    Args:
        decoder: The ``decoder_model_merged`` session.
        embed: Turns a ``[1, n]`` token-id array into ``[1, n, hidden]`` embeddings.
        inputs_embeds: The prompt embeddings, ``[1, prompt_length, hidden]``.
        end_token_ids: Tokens that end the caption; they are not returned.
        max_new_tokens: The most tokens generated.
        deadline: A ``clock()`` value after which decoding stops with a timeout.
        clock: The monotonic clock ``deadline`` is measured on.

    Returns:
        The generated token ids, without the end token.

    Raises:
        CaptioningError: ``TIMEOUT`` when the deadline passes.
    """
    inputs = {item.name: item for item in decoder.get_inputs()}
    output_names = [item.name for item in decoder.get_outputs()]
    cache_names = [name for name in inputs if name.startswith("past_key_values.")]
    embeds_dtype = _numpy_dtype(inputs["inputs_embeds"].type)
    cache: dict[str, np.ndarray] = {}
    for name in cache_names:
        _, heads, _, head_dim = inputs[name].shape
        cache[name] = np.zeros((1, heads, 0, head_dim), dtype=_numpy_dtype(inputs[name].type))

    length = inputs_embeds.shape[1]
    step_embeds = inputs_embeds.astype(embeds_dtype)
    position_ids = np.arange(length, dtype=np.int64)[None, :]
    generated: list[int] = []
    for _ in range(max_new_tokens):
        if clock() > deadline:
            raise CaptioningError(CaptionErrorCode.TIMEOUT, "Local captioning took too long")
        outputs = decoder.run(
            None,
            {
                "inputs_embeds": step_embeds,
                "attention_mask": np.ones((1, length), dtype=np.int64),
                "position_ids": position_ids,
                **cache,
            },
        )
        by_name = dict(zip(output_names, outputs, strict=True))
        token = int(np.argmax(by_name["logits"][0, -1]))
        if token in end_token_ids:
            break
        generated.append(token)
        cache = {name: by_name[name.replace("past_key_values.", "present.", 1)] for name in cache_names}
        step_embeds = embed(np.asarray([[token]], dtype=np.int64)).astype(embeds_dtype)
        position_ids = np.asarray([[length]], dtype=np.int64)
        length += 1
    return generated


@dataclass(frozen=True)
class SmolVlm2OnnxFiles:
    """The three graphs of one precision, relative to the bundle root."""

    vision_encoder: str
    embed_tokens: str
    decoder: str


class SmolVlm2OnnxCaptioner:
    """Loaded SmolVLM2 graphs, tokenizer and image processor. Not thread-safe; callers serialize."""

    def __init__(self, root: Path, files: SmolVlm2OnnxFiles) -> None:
        import onnxruntime as ort
        from transformers import AutoTokenizer
        from transformers.models.smolvlm.image_processing_pil_smolvlm import SmolVLMImageProcessorPil

        self._tokenizer: Any = AutoTokenizer.from_pretrained(root, local_files_only=True, trust_remote_code=False)
        self._image_processor: Any = SmolVLMImageProcessorPil.from_pretrained(root, local_files_only=True)
        processor_config = json.loads((root / "processor_config.json").read_text(encoding="utf-8"))
        self._image_seq_len = int(processor_config["image_seq_len"])
        self._image_token_id = int(self._tokenizer.convert_tokens_to_ids(IMAGE_TOKEN))
        self._end_token_ids = frozenset(
            {int(self._tokenizer.convert_tokens_to_ids(END_OF_UTTERANCE_TOKEN)), int(self._tokenizer.eos_token_id)},
        )

        def session(relative_path: str) -> Any:
            return ort.InferenceSession(str(root / relative_path), providers=["CPUExecutionProvider"])

        self._vision = session(files.vision_encoder)
        self._embed_tokens = session(files.embed_tokens)
        self._decoder = session(files.decoder)
        self._pixel_dtype = _numpy_dtype(self._vision.get_inputs()[0].type)

    def _encode_tiles(self, pixel_values: np.ndarray, pixel_attention_mask: np.ndarray) -> np.ndarray:
        """Run the vision encoder one tile at a time.

        A large image is up to 17 tiles of 512 px, and encoding them as one batch
        peaks at about 3.4 GB; one tile at a time peaks under 1 GB with the same
        features (ADR-0077).
        """
        return np.concatenate(
            [
                self._vision.run(
                    None,
                    {
                        "pixel_values": pixel_values[:, tile : tile + 1],
                        "pixel_attention_mask": pixel_attention_mask[:, tile : tile + 1],
                    },
                )[0]
                for tile in range(pixel_values.shape[1])
            ],
        )

    def _embed(self, input_ids: np.ndarray) -> np.ndarray:
        return self._embed_tokens.run(None, {"input_ids": input_ids})[0]

    def caption(self, image: bytes, *, max_new_tokens: int, deadline: float) -> str:
        """Caption one image's bytes. Raises ``CaptioningError`` on a bad image or a timeout."""
        try:
            with Image.open(io.BytesIO(image)) as opened:
                opened.verify()
            with Image.open(io.BytesIO(image)) as opened:
                rgb = opened.convert("RGB")
            pixels = self._image_processor(images=[[rgb]], return_tensors="np", return_row_col_info=True)
        except Exception as error:
            raise CaptioningError(CaptionErrorCode.IMAGE_INVALID, "Image could not be read for captioning") from error

        prompt = caption_prompt(int(pixels["rows"][0][0]), int(pixels["cols"][0][0]), self._image_seq_len)
        input_ids = np.asarray([self._tokenizer(prompt, add_special_tokens=False)["input_ids"]], dtype=np.int64)
        features = self._encode_tiles(
            np.asarray(pixels["pixel_values"]).astype(self._pixel_dtype),
            np.asarray(pixels["pixel_attention_mask"]).astype(bool),
        )
        embeds = self._embed(input_ids)
        image_positions = input_ids[0] == self._image_token_id
        features = features.reshape(-1, features.shape[-1])
        if int(image_positions.sum()) != features.shape[0]:
            raise CaptioningError(CaptionErrorCode.IMAGE_INVALID, "Image features do not match the prompt")
        embeds[0, image_positions] = features.astype(embeds.dtype)

        generated = greedy_decode(
            self._decoder,
            self._embed,
            embeds,
            end_token_ids=self._end_token_ids,
            max_new_tokens=max_new_tokens,
            deadline=deadline,
        )
        return self._tokenizer.decode(generated, skip_special_tokens=True)
