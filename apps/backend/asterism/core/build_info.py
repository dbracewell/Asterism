"""The version and commit this install was built from (US-91.1).

The version is the ``asterism-core`` package version, which
``pnpm check:workspace-tasks`` keeps equal to the root ``package.json``. The
commit comes from the image's ``ASTERISM_COMMIT`` build argument; outside an
image built with it, the commit is unknown.
"""

import os
from importlib import metadata

UNKNOWN = "unknown"


def app_version() -> str:
    try:
        return metadata.version("asterism-core")
    except metadata.PackageNotFoundError:
        return UNKNOWN


def app_commit() -> str:
    return os.environ.get("ASTERISM_COMMIT", "").strip() or UNKNOWN
