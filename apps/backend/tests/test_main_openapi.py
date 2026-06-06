def test_openapi_schema_version_and_title(client):
    response = client.get("/openapi.json")

    assert response.status_code == 200
    payload = response.json()
    assert payload["openapi"] == "3.0.3"
    assert payload["info"]["title"] == "Asterism"
    assert payload["info"]["version"] == "1.0.0"


def test_docs_endpoint_is_available(client):
    response = client.get("/api/docs")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
