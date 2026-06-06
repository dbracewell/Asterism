from types import SimpleNamespace
from uuid import uuid4

import asterism.routers.chat as chat_router_module


def test_new_chat_session_returns_401_when_token_is_invalid(client, monkeypatch):
    def _raise_invalid(_token: str):
        raise Exception("invalid token")

    monkeypatch.setattr(chat_router_module, "verify_jwks_token", _raise_invalid)

    response = client.post(
        "/api/chat/",
        headers={"Authorization": "Bearer invalid-token"},
    )

    assert response.status_code == 401
    assert response.json() == {"code": 401, "detail": "Unauthorized"}


def test_new_chat_session_returns_id_when_authorized(client, monkeypatch):
    expected_session_id = uuid4()

    class FakeChatRepository:
        def __init__(self, _session):
            pass

        async def create_new_session(self, user_id: str):
            assert user_id == "user-123"
            return SimpleNamespace(id=expected_session_id)

    monkeypatch.setattr(chat_router_module, "verify_jwks_token", lambda _: "user-123")
    monkeypatch.setattr(chat_router_module, "ChatRepository", FakeChatRepository)

    response = client.post(
        "/api/chat/",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 201
    assert response.json() == {"id": str(expected_session_id)}
