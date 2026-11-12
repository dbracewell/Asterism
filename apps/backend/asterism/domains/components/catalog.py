"""Registers every component, for code that may run outside the app (settings validation, scripts).

The app registers them at startup; this module composes the domains that
provide components, so the registry itself depends on none of them.
"""


def ensure_loaded() -> None:
    """Register the built-in search providers and the image generators."""
    from asterism.domains.image_generation import generators  # noqa: F401 - registers image generators

    from .builtin import load_builtin_components

    load_builtin_components()
