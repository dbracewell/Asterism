def test_stream_returns_401_when_auth_header_missing(client):
    response = client.post(
        "/api/stream",
        json={"content": "hello"},
    )

    assert response.status_code == 401
    assert response.json() == {"code": 401, "detail": "Unauthorized"}


def test_files_returns_401_when_auth_header_missing(client):
    response = client.get("/api/files/example.png")

    assert response.status_code == 401
    assert response.json() == {"code": 401, "detail": "Unauthorized"}
