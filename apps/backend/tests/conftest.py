import asyncio
import os
import shutil
import tempfile

import pytest
from fastapi.testclient import TestClient

_TEST_STORAGE_ROOT = tempfile.mkdtemp(prefix="asterism-test-storage-")
os.environ["STORAGE_ROOT"] = _TEST_STORAGE_ROOT
os.environ.setdefault("FRONT_END_URL", "http://localhost:3000")
os.environ.setdefault("BOOTSTRAP_SETUP_TOKEN", "test-setup-token")

from asterism.internal.db import session_manager  # noqa: E402
from asterism.main import app  # noqa: E402
from asterism.models import Base  # noqa: E402


async def _reset_db() -> None:
    async with session_manager.connect() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)


@pytest.fixture
def client() -> TestClient:  # type: ignore
    with TestClient(app) as test_client:
        asyncio.run(_reset_db())
        yield test_client


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_TEST_STORAGE_ROOT, ignore_errors=True)
