import pytest
import pytest_asyncio
from asterism.common import headless_browser
from asterism.core.config import config
from asterism.domains.canvas.diagrams import DOMPURIFY_BUNDLE, MERMAID_BUNDLE
from asterism.domains.user.lifecycle import clear_suspension_cache
from asterism.domains.user.service import clear_user_cache

# The backend CI job installs neither the frontend's packages nor Chromium;
# there `pnpm check:image` draws a diagram inside the built image instead.
BUNDLES_INSTALLED = MERMAID_BUNDLE.is_file() and DOMPURIFY_BUNDLE.is_file()


@pytest_asyncio.fixture
async def chromium():
    """Skip unless the pooled Chromium and the diagram bundles are there; close it afterwards."""
    if not BUNDLES_INSTALLED:
        pytest.skip("the frontend's packages are not installed")
    try:
        await headless_browser.acquire_browser()
    except Exception as exc:
        await headless_browser.close_browser()
        if "Executable doesn't exist" in str(exc):
            pytest.skip("Playwright Chromium is not installed")
        raise
    yield
    await headless_browser.close_browser()


# Tests run under the "test" profile, which skips the SYSTEM_KEY validation that
# full runtimes enforce. Settings encryption refuses to work without a key, so
# pin an explicit test-only key here (must not match a placeholder prefix).
config.system_key = "unit-test-fernet-key-0123456789abcdef"


@pytest.fixture(autouse=True)
def _reset_user_caches():
    clear_user_cache()
    clear_suspension_cache()
    yield
    clear_user_cache()
    clear_suspension_cache()


@pytest.fixture(autouse=True)
def _forget_lazily_initialized_sessions():
    """Drop a session manager a test left initialized (e.g. by usage recording, which
    opens its own session lazily), so the next test cannot inherit a stale database URL."""
    from asterism.db.database import db_session_manager

    initialized = db_session_manager.is_initialized
    yield
    if not initialized and db_session_manager.is_initialized:
        db_session_manager._engine = None  # pyright: ignore[reportPrivateUsage]
        db_session_manager._session_maker = None  # pyright: ignore[reportPrivateUsage]
