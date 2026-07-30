import asyncio
from pathlib import Path

from asterism.registries import component_registry
from asterism.utils.package_walker import load_decorators


async def main() -> None:
    load_decorators(
        str(Path(__file__).parent),
        target_decorators=(
            "tool_registry.tool",
            "component_registry.register",
        ),
    )
    print(component_registry.get_component_types())


if __name__ == "__main__":
    asyncio.run(main())
