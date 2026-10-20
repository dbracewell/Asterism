"""Manifest of modules that register event-bus handlers as an import side effect.

Importing this module guarantees every ``@event_bus.on`` handler is registered
before the system starts serving. Add a module here — annotated with the event
types it registers — whenever a new module uses ``@event_bus.on`` and is not
already imported as part of normal app wiring. Kept explicit (no package
walking) so handler loading stays auditable and import-cycle-free.
"""

import asterism.domains.llm.draft  # noqa: F401  DRAFT_MODEL_UPDATED
