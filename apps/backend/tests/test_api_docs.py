"""US-115.2: production serves no API schema or docs pages."""

from asterism.main import api_docs_urls
from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_production_serves_no_schema_or_docs():
    app = FastAPI(**api_docs_urls("production"))
    client = TestClient(app)
    for path in ("/openapi.json", "/docs", "/redoc", "/api/py/docs"):
        assert client.get(path).status_code == 404, path


def test_other_profiles_keep_the_schema_for_codegen_and_development():
    for profile in ("development", "test", "codegen"):
        app = FastAPI(**api_docs_urls(profile))
        client = TestClient(app)
        assert client.get("/openapi.json").status_code == 200
        assert client.get("/api/py/docs").status_code == 200
