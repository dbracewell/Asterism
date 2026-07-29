# pip install transformers
import threading
from typing import Any, cast

from huggingface_hub import hf_hub_download
from llama_cpp import CreateChatCompletionResponse, Llama

from asterism.events import Event, EventType, event_bus
from asterism.repositories import settings_repository


class DraftModel:
    def __init__(self):
        self.llm: Llama | None = None
        self.lock = threading.Lock()

    async def get_model(self) -> Llama:
        with self.lock:
            if self.llm:
                return self.llm
            draft_model = (
                await settings_repository.get_app_settings()
            ).draft_model
            model_path = hf_hub_download(
                repo_id=draft_model.repo_id,
                filename=draft_model.filename,
            )
            llm = Llama(
                model_path=model_path,  # type:ignore
                n_gpu_layers=0,
                n_ctx=512,
                verbose=False,
            )
            self.llm = llm
            return llm

    async def invoke(self, messages: list[dict[str, Any]], **kwargs) -> str:
        llm = await self.get_model()
        response = cast(
            CreateChatCompletionResponse,
            llm.create_chat_completion(
                messages=messages,  # type:ignore
                **kwargs,
            ),
        )
        return response["choices"][0]["message"]["content"] or ""

    async def label_chat(self, user_prompt) -> str:
        messages = [
            {
                "role": "system",
                "content": "You are a title generation assistant. Generate a short, descriptive chat title (3 to 6 words) based on the user's text. Output strictly the title itself with no quotes, no prefixes, and no trailing punctuation. Do not repeat the user's text.",  # noqa: E501
            },
            {
                "role": "user",
                "content": "How do I fix a leaky faucet in my kitchen?",
            },
            {"role": "assistant", "content": "Fixing a Leaky Kitchen Faucet"},
            {"role": "user", "content": "Why is water wet?"},
            {"role": "assistant", "content": "Questioning on Why Water is Wet"},
            {"role": "user", "content": user_prompt},
        ]
        return await self.invoke(
            messages,
            max_tokens=25,
            temperature=0.3,
            top_p=0.9,
        )


_draft_model: DraftModel | None = None
_lock = threading.Lock()


def get_draft_model() -> DraftModel:
    global _draft_model
    with _lock:
        if _draft_model is None:
            _draft_model = DraftModel()
        return _draft_model  # type:ignore


async def _on_model_update(_: Event) -> None:
    global _draft_model
    global _lock
    print("Draft Model Update")
    with _lock:
        if _draft_model is not None:
            _draft_model = None


event_bus.on(EventType.DRAFT_MODEL_UPDATED, _on_model_update)
