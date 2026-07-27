import asyncio

import asterism.core.components
from asterism.core.components.search.base import WebsearchComponent
from asterism.core.registries.component import component_registry
from asterism.core.repositories import settings_repository
from asterism.core.utils.package_walker import walk_modules


async def main():
    walk_modules(asterism.core.components.__name__)

    r = await settings_repository.upsert_app_setting(
        "WebSearch::SEARCHXNG::host",
        "http://127.0.0.1",
    )
    print(r)

    print(component_registry.get_component_types())
    print(component_registry.get_providers("WebSearch"))
    component = await component_registry.get_component(
        component_type=WebsearchComponent,
        component_name="SearchXNG",
    )
    print(component)
    component = await component_registry.get_component(
        component_type=WebsearchComponent,
        component_name="DuckDuckGo",
    )
    print(component)

    print(await settings_repository.get_app_settings_by_prefix("WebSearch::"))


if __name__ == "__main__":
    asyncio.run(main())
