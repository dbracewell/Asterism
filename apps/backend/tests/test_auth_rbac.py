import asterism.routers.base as base_router_module
from asterism.utils.security import AuthClaims


def test_admin_ping_returns_403_for_non_admin(client, monkeypatch):
    monkeypatch.setattr(
        base_router_module,
        "verify_jwks_token",
        lambda _: AuthClaims(sub="user-1", email="user-1@example.com"),
    )

    response = client.get(
        "/api/admin/ping",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert response.status_code == 403
    assert response.json() == {"code": 403, "detail": "Forbidden"}


def test_bootstrap_admin_returns_403_for_invalid_setup_token(client, monkeypatch):
    monkeypatch.setattr(
        base_router_module,
        "verify_jwks_token",
        lambda _: AuthClaims(sub="user-1", email="user-1@example.com"),
    )

    response = client.post(
        "/api/setup/bootstrap-admin",
        headers={"Authorization": "Bearer valid-token"},
        json={"setup_token": "wrong-token"},
    )

    assert response.status_code == 403
    assert response.json() == {"code": 403, "detail": "Invalid setup token"}


def test_bootstrap_admin_promotes_current_user_and_allows_admin_routes(
    client,
    monkeypatch,
):
    monkeypatch.setattr(
        base_router_module,
        "verify_jwks_token",
        lambda _: AuthClaims(sub="user-1", email="user-1@example.com"),
    )

    bootstrap_response = client.post(
        "/api/setup/bootstrap-admin",
        headers={"Authorization": "Bearer valid-token"},
        json={"setup_token": "test-setup-token"},
    )

    assert bootstrap_response.status_code == 200
    assert bootstrap_response.json()["id"] == "user-1"
    assert set(bootstrap_response.json()["roles"]) == {"admin", "user"}

    admin_response = client.get(
        "/api/admin/ping",
        headers={"Authorization": "Bearer valid-token"},
    )

    assert admin_response.status_code == 200
    assert admin_response.json() == {"status": "ok"}


def test_bootstrap_admin_is_disabled_after_first_admin_exists(client, monkeypatch):
    def _claims_for_token(token: str) -> AuthClaims:
        if token == "token-user-1":
            return AuthClaims(sub="user-1", email="user-1@example.com")
        return AuthClaims(sub="user-2", email="user-2@example.com")

    monkeypatch.setattr(base_router_module, "verify_jwks_token", _claims_for_token)

    first_response = client.post(
        "/api/setup/bootstrap-admin",
        headers={"Authorization": "Bearer token-user-1"},
        json={"setup_token": "test-setup-token"},
    )
    assert first_response.status_code == 200

    second_response = client.post(
        "/api/setup/bootstrap-admin",
        headers={"Authorization": "Bearer token-user-2"},
        json={"setup_token": "test-setup-token"},
    )

    assert second_response.status_code == 409
    assert second_response.json() == {
        "code": 409,
        "detail": "Admin user is already configured",
    }
