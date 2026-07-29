import asyncio
import inspect
from typing import get_args

from pydantic import BaseModel

from asterism.common import ToolContext


class Args(BaseModel):
    name: str


async def f(ctx: ToolContext[Args]):
    pass


async def main():
    sig = inspect.signature(f)
    annotation = next(iter(sig.parameters.values())).annotation
    type_arguments = get_args(annotation)
    if not type_arguments:
        raise ValueError("Context is missing the generic Args type")
    args_class = type_arguments[0]

    print(f"Extracted Class: {args_class.__name__}")

 
    openai_tool = {
        "type": "function",
        "function": {
            "name": f.__name__,
            "description": "Tool description here",
            "parameters": args_class.model_json_schema(),
        },
    }
    print(f"OpenAI Tool Representation: {openai_tool}")


if __name__ == "__main__":
    asyncio.run(main())
