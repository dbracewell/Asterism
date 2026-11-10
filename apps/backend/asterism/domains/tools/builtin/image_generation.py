"""generate_image for the main agent (ADR-0064).

Context-managed: offered when the admin policy is on, the user's group may
use it, the provider is ready and the chat model supports tools. Every call
rechecks that live. Results carry saved file ids, never pixels. Failures are
returned as errors, not raised, so the registry never retries a generation.
"""

from typing import Literal

from pydantic import BaseModel, Field

from asterism.core.exceptions import BadDataException
from asterism.domains.agent.schemas import ToolProgress
from asterism.domains.tools.registry import ToolContext, tool_registry

SIZES: dict[str, tuple[int, int]] = {
    "square": (1024, 1024),
    "portrait": (832, 1216),
    "landscape": (1216, 832),
    "wide": (1344, 768),
}


class GenerateImageArgs(BaseModel):
    prompt: str = Field(
        min_length=1,
        max_length=4000,
        description="A detailed description of the image: subject, setting, style, lighting, composition",
    )
    negative_prompt: str = Field(default="", max_length=2000, description="What to avoid, if anything")
    size: Literal["square", "portrait", "landscape", "wide"] = "square"
    count: int = Field(default=1, ge=1, le=4, description="How many variations")
    seed: int | None = Field(default=None, ge=0, le=2**32 - 1, description="Reuse a seed to vary one image")


IMAGE_TOOL_DESCRIPTION = (
    "Create images from a text description. The images are saved to the user's files "
    "and shown in the chat. Write a detailed prompt."
)


@tool_registry.tool(name="generate_image", description=IMAGE_TOOL_DESCRIPTION)
async def generate_image(ctx: ToolContext[GenerateImageArgs]) -> dict[str, object]:
    from asterism.domains.image_generation.schemas import ImageProgress, ImageRequest
    from asterism.domains.image_generation.service import generate_images

    scope = ctx.execution_scope
    if scope is None or scope.is_sub_agent or scope.user_id != ctx.user.id or scope.chat_id != ctx.session.info.id:
        return {"error": "Image generation is unavailable outside a main-agent run"}

    async def progress(update: ImageProgress) -> None:
        if ctx.progress_sink is not None and ctx.tool_call_id is not None:
            await ctx.progress_sink(
                ToolProgress(tool_call_id=ctx.tool_call_id, name="generate_image", **update.model_dump())
            )

    width, height = SIZES[ctx.args.size]
    try:
        images = await generate_images(
            user_id=ctx.user.id,
            chat_id=scope.chat_id,
            request=ImageRequest(
                prompt=ctx.args.prompt,
                negative_prompt=ctx.args.negative_prompt,
                width=width,
                height=height,
                count=ctx.args.count,
                seed=ctx.args.seed,
            ),
            progress=progress,
            scope=scope,
        )
    except BadDataException as exc:
        return {"error": str(exc)}
    embeds = " ".join(image.embed for image in images)
    return {
        "images": [image.model_dump(mode="json") for image in images],
        "show_in_reply": f"The images are saved. To show them in your reply, include exactly: {embeds}",
    }
