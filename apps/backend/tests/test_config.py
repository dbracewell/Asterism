from asterism.core.config import Config


def test_public_url_is_the_only_jwt_identity_setting(tmp_path, monkeypatch):
    monkeypatch.setenv("PUBLIC_URL", "https://asterism.example.com")
    settings = Config(_env_file=None, storage_root=tmp_path)  # type:ignore
    assert settings.jwt_issuer == "https://asterism.example.com"
    assert settings.jwt_audience == settings.jwt_issuer
    assert settings.cors_allowed_origins == [settings.public_url]
    # Key discovery and webhooks stay local even with a remote public hostname.
    assert settings.jwks_url == "http://127.0.0.1:3000/api/auth/jwks"
    assert settings.frontend_internal_url == "http://127.0.0.1:3000"


def test_default_public_url(tmp_path, monkeypatch):
    monkeypatch.delenv("PUBLIC_URL", raising=False)
    settings = Config(_env_file=None, storage_root=tmp_path)
    assert settings.jwt_issuer == "http://localhost:3000"
    assert settings.jwt_audience == settings.jwt_issuer
