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
- Knowledge processing policy persistence (:mod:`knowledge`), which stores the
  image-captioning selection inside application settings.
- The service layer (:mod:`service`) and the FastAPI router exposed under
  ``/settings`` (:mod:`settings_router`).
"""
