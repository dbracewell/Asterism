"""Settings services, one module per settings area; this module re-exports their public functions.

- :mod:`.user_settings`: per-user settings rows.
- :mod:`.app_settings`: application settings and tool settings.
- :mod:`.providers`: providers, models, the draft model and model lookup.

Conventions shared by all three:

- Functions accept an optional ``session``; when omitted a new session is opened
  (for background use), when given the caller keeps ownership via
  :func:`get_async_db_session`.
- API keys round-trip redacted: responses serialize :class:`SecretStr` to
  ``**********``, and writes that echo that sentinel keep the stored key.
- Provider/model edits that could orphan the selected captioning model call
  :func:`asterism.domains.settings.captioning_guard.get_captioning_selection_guard`
  before commit. The knowledge domain owns that selection and registers the
  implementation; the settings domain never imports the knowledge package.
- A provider write that breaks a database constraint returns a 409 that says
  what to change, never an unhandled database error.
"""

from .app_settings import (
    _validate_non_provider_app_setting,
    bulk_update_app_setting,
    delete_app_setting,
    get_app_settings,
    update_tool_settings,
    upsert_app_setting,
    validation_message,
)
from .providers import (
    bulk_upsert_providers,
    get_all_providers,
    get_captioning_models,
    get_draft_model,
    get_model_and_provider,
    get_provider_for_discovery,
    get_provider_models,
    get_provider_settings,
    get_user_models,
    llm_display_info,
    replace_provider_models,
    stored_draft_model_id,
    update_provider_model,
    update_provider_settings,
)
from .tool_settings import get_tool_settings
from .user_settings import (
    FONT_SIZES,
    _validate_user_setting,
    bulk_upsert_user_settings,
    delete_user_setting,
    get_user_setting,
    get_user_settings,
    upsert_user_setting,
)

# Validators re-exported for tests that check them directly.
__all__ = [
    "FONT_SIZES",
    "_validate_non_provider_app_setting",
    "_validate_user_setting",
    "bulk_update_app_setting",
    "bulk_upsert_providers",
    "bulk_upsert_user_settings",
    "delete_app_setting",
    "delete_user_setting",
    "get_all_providers",
    "get_app_settings",
    "get_captioning_models",
    "get_draft_model",
    "get_model_and_provider",
    "get_provider_for_discovery",
    "get_provider_models",
    "get_provider_settings",
    "get_tool_settings",
    "get_user_models",
    "get_user_setting",
    "get_user_settings",
    "llm_display_info",
    "replace_provider_models",
    "stored_draft_model_id",
    "update_provider_model",
    "update_provider_settings",
    "update_tool_settings",
    "upsert_app_setting",
    "upsert_user_setting",
    "validation_message",
]
