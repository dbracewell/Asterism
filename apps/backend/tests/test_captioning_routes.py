from starlette.routing import Match

from asterism.domains.settings.settings_router import (
    settings_router,
    update_captioning_configuration,
)


def test_captioning_update_route_precedes_the_generic_app_setting_route():
    scope = {
        "type": "http",
        "path": "/settings/app/captioning",
        "method": "PUT",
    }

    matching_routes = [route for route in settings_router.routes if route.matches(scope)[0] is Match.FULL]

    assert matching_routes[0].endpoint is update_captioning_configuration
