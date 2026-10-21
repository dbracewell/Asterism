from asterism.domains.knowledge.router import update_captioning_configuration
from asterism.main import app
from fastapi.routing import iter_route_contexts
from starlette.routing import Match


def test_captioning_update_route_precedes_the_generic_app_setting_route():
    """The knowledge captioning path must win over the generic app-setting path.

    Both routers serve ``/settings/app/...``. The knowledge router is
    registered on the application first, so its more specific captioning route
    is matched before the settings router's generic ``/app/{key}`` route.
    """
    scope = {
        "type": "http",
        "path": "/settings/app/captioning",
        "method": "PUT",
    }

    matching_routes = [
        context.original_route
        for context in iter_route_contexts(app.routes)
        if context.original_route.matches(scope)[0] is Match.FULL
    ]

    assert matching_routes[0].endpoint is update_captioning_configuration  # pyright: ignore[reportAttributeAccessIssue]
