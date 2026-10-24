import pytest
from asterism.core.config import Config, ConfigValidationError


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
    settings = Config(_env_file=None, storage_root=tmp_path)  # type: ignore
    assert settings.jwt_issuer == "http://localhost:3000"
    assert settings.jwt_audience == settings.jwt_issuer


def test_config_does_not_load_cwd_dotenv(tmp_path, monkeypatch):
    monkeypatch.delenv("PUBLIC_URL", raising=False)
    (tmp_path / ".env").write_text("PUBLIC_URL=https://stale.example\n")
    monkeypatch.chdir(tmp_path)
    settings = Config(storage_root=tmp_path / "storage")
    assert settings.public_url == "http://localhost:3000"


def test_runtime_validation_does_not_create_storage(tmp_path):
    storage = tmp_path / "not-created"
    settings = Config(
        config_profile="development",
        system_key="valid-system-key",
        storage_root=storage,
    )
    settings.validate_runtime()
    assert not storage.exists()
    settings.prepare_storage()
    assert (storage / "files").is_dir()


def test_backend_initialization_does_not_require_runtime_secrets(tmp_path):
    settings = Config(
        config_profile="backend-init",
        system_key="",
        storage_root=tmp_path,
    )
    settings.validate_runtime()


def test_secret_validation_error_is_redacted(tmp_path):
    canary = "replace-with-secret-canary"
    settings = Config(
        config_profile="production",
        system_key=canary,
        storage_root=tmp_path,
        public_url="https://asterism.example.com",
    )
    with pytest.raises(ConfigValidationError) as error:
        settings.validate_runtime()
    assert "SYSTEM_KEY" in str(error.value)
    assert canary not in str(error.value)


@pytest.mark.parametrize(
    "limits",
    [
        {"max_active_chat_jobs": 0},
        {"max_active_chat_jobs": 257},
        {"max_active_chat_jobs_per_user": 0},
        {"max_active_chat_jobs": 2, "max_active_chat_jobs_per_user": 3},
        {"max_chat_controllers": 0},
        {"max_chat_controllers": 513},
        {"max_chat_controllers_per_user": 0},
        {"max_chat_controllers": 2, "max_chat_controllers_per_user": 3},
    ],
)
def test_chat_capacity_configuration_rejects_invalid_limits(tmp_path, limits):
    settings = Config(config_profile="backend-init", storage_root=tmp_path, **limits)
    with pytest.raises(ConfigValidationError):
        settings.validate_runtime()
    assert not (tmp_path / "files").exists()


def test_chat_capacity_defaults_are_finite(tmp_path):
    settings = Config(config_profile="backend-init", storage_root=tmp_path)
    settings.validate_runtime()
    assert (settings.max_active_chat_jobs, settings.max_active_chat_jobs_per_user) == (32, 4)
    assert (settings.max_chat_controllers, settings.max_chat_controllers_per_user) == (128, 16)
