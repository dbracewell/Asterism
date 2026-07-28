import asyncio

from asterism.core.llm.draft import get_draft_model


async def main():
    draft_model = get_draft_model()
    print(await draft_model.label_chat("Why is the sky blue?"))


if __name__ == "__main__":
    asyncio.run(main())
