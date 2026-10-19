import pytest
from asterism.domains.user.service import clear_user_cache


@pytest.fixture(autouse=True)
def _reset_user_caches():
    clear_user_cache()
    yield
    clear_user_cache()
