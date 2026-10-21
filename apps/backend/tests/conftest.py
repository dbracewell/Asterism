import pytest
from asterism.core.config import config
from asterism.domains.user.service import clear_user_cache

# Tests run under the "test" profile, which skips the SYSTEM_KEY validation that
# full runtimes enforce. Settings encryption refuses to work without a key, so
# pin an explicit test-only key here (must not match a placeholder prefix).
config.system_key = "unit-test-fernet-key-0123456789abcdef"


@pytest.fixture(autouse=True)
def _reset_user_caches():
    clear_user_cache()
    yield
    clear_user_cache()
