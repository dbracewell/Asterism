from types import SimpleNamespace

import jwt
import pytest
from asterism.core.exceptions import UnauthorizedException
from asterism.core.security import verify_jwks_token


def _mock_jwt_decode(monkeypatch: pytest.MonkeyPatch, payload: object) -> None:
    monkeypatch.setattr(
        "asterism.core.security.jwks_client.get_signing_key_from_jwt",
        lambda _token: SimpleNamespace(key="test-key"),
    )
    monkeypatch.setattr(
        "asterism.core.security.jwt.decode",
        lambda *_args, **_kwargs: payload,
    )


def test_verify_jwks_token_accepts_valid_claims(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_jwt_decode(
        monkeypatch,
        {
            "id": "user-123",
            "sub": "user-123",
            "email": "alice@example.com",
            "name": "Alice",
            "role": "admin",
            "timezone": "UTC",
        },
    )

    user = verify_jwks_token("valid-token")

    assert user.id == "user-123"
    assert user.email == "alice@example.com"
    assert user.name == "Alice"
    assert user.role == "admin"
    assert user.timezone == "UTC"


def test_verify_jwks_token_accepts_sub_when_id_omitted(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_jwt_decode(
        monkeypatch,
        {
            "sub": "user-456",
            "email": "bob@example.com",
            "name": "Bob",
            "role": "user",
        },
    )

    user = verify_jwks_token("valid-sub-token")

    assert user.id == "user-456"
    assert user.role == "user"
    assert user.timezone is None


@pytest.mark.parametrize(
    "invalid_payload",
    [
        {
            "email": "alice@example.com",
            "name": "Alice",
            "role": "user",
        },
        {
            "id": None,
            "sub": None,
            "email": "alice@example.com",
            "name": "Alice",
            "role": "user",
        },
        {
            "id": "   ",
            "email": "alice@example.com",
            "name": "Alice",
            "role": "user",
        },
        {
            "id": 12345,
            "email": "alice@example.com",
            "name": "Alice",
            "role": "user",
        },
        {
            "id": "user-1",
            "sub": "user-2",
            "email": "alice@example.com",
            "name": "Alice",
            "role": "user",
        },
        {
            "id": "user-1",
            "email": None,
            "name": "Alice",
            "role": "user",
        },
        {
            "id": "user-1",
            "email": "alice@example.com",
            "name": "",
            "role": "user",
        },
        {
            "id": "user-1",
            "email": "alice@example.com",
            "name": "Alice",
            "role": None,
        },
        {
            "id": "user-1",
            "email": "alice@example.com",
            "name": "Alice",
            "role": "superadmin",
        },
        {
            "id": "user-1",
            "email": "alice@example.com",
            "name": "Alice",
            "role": "user",
            "timezone": 123,
        },
    ],
)
def test_verify_jwks_token_rejects_malformed_claims_with_unauthorized(
    monkeypatch: pytest.MonkeyPatch,
    invalid_payload: dict[str, object],
) -> None:
    _mock_jwt_decode(monkeypatch, invalid_payload)

    with pytest.raises(UnauthorizedException) as exc_info:
        verify_jwks_token("malformed-token")

    assert exc_info.value.code == 401


def test_verify_jwks_token_converts_pyjwt_error_to_unauthorized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _raise_jwt_error(_token: str) -> SimpleNamespace:
        raise jwt.InvalidTokenError("invalid signature")

    monkeypatch.setattr(
        "asterism.core.security.jwks_client.get_signing_key_from_jwt",
        _raise_jwt_error,
    )

    with pytest.raises(UnauthorizedException) as exc_info:
        verify_jwks_token("bad-token")

    assert exc_info.value.code == 401


def test_generate_thumbnail_returns_none_on_decompression_bomb(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from asterism.common.images import generate_thumbnail
    from PIL import Image

    def _raise_bomb(*_args: object, **_kwargs: object) -> None:
        raise Image.DecompressionBombError("Image size exceeds limit")

    monkeypatch.setattr("asterism.common.images.Image.open", _raise_bomb)

    assert generate_thumbnail(b"fake-image-bytes") is None


@pytest.mark.asyncio
async def test_validation_exception_handler_does_not_echo_raw_input() -> None:
    from asterism.main import validation_exception_handler
    from fastapi.exceptions import RequestValidationError
    from starlette.requests import Request

    exc = RequestValidationError(
        [
            {
                "loc": ("body", "api_key"),
                "msg": "Input should be a valid string",
                "type": "string_type",
                "input": "super-secret-leaked-input-value",
            },
        ],
    )
    request = Request({"type": "http", "method": "POST", "path": "/test", "headers": []})

    response = await validation_exception_handler(request, exc)
    body_text = bytes(response.body).decode("utf-8")

    assert response.status_code == 422
    assert "Input should be a valid string" in body_text
    assert "super-secret-leaked-input-value" not in body_text
