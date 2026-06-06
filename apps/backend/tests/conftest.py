import os
import shutil
import tempfile

from fastapi.testclient import TestClient
import pytest

_TEST_STORAGE_ROOT = tempfile.mkdtemp(prefix="asterism-test-storage-")
os.environ["STORAGE_ROOT"] = _TEST_STORAGE_ROOT
os.environ.setdefault("FRONT_END_URL", "http://localhost:3000")

from asterism.main import app  # noqa: E402


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_TEST_STORAGE_ROOT, ignore_errors=True)
