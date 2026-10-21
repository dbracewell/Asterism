"""Settings domain: LLM providers/models, user settings, and application settings.

This package owns:

- ORM models (:mod:`models`) and Pydantic schemas (:mod:`schemas`) for LLM
  providers, provider models, per-user settings (``user_settings``), and global
  application settings (``app_settings``).
- Secret handling (:mod:`secrets`): Fernet encryption at rest for provider API
  keys and component-provider parameters, plus redaction conventions for API
  responses.
- Provider model discovery (:mod:`discovery`) over the OpenAI-compatible
  ``/models`` endpoint, backed by a versioned first-party capability catalog
  (:mod:`model_catalog`).
- The captioning-selection guard this domain needs from the knowledge domain
  (:mod:`captioning_guard`). The knowledge domain owns the selection and
  registers the implementation; this package never imports it.
- The service layer (:mod:`service`) and the FastAPI router exposed under
  ``/settings`` (:mod:`settings_router`).

The knowledge processing policy is not owned here. Its schema, persistence, and
transitions live in the knowledge domain, which also serves the knowledge admin
surfaces at their existing ``/settings/app/...`` URLs.
"""
