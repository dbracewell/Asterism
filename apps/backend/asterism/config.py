import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()


class Config:
    def _read_docker_secret(self, secret_name: str) -> Any:
        try:
            secret_path = f"/run/secrets/{secret_name}"
            if os.path.exists(secret_path):
                with open(secret_path, "r") as f:
                    return f.read().strip()
        except IOError:
            pass
        return None

    def _get_value(self, key: str, default: Any) -> Any:
        value = self._read_docker_secret(key)
        if value is not None:
            return value
        value = self._read_docker_secret(key.lower())
        if value is not None:
            return value
        return os.environ.get(key, default)

    @property
    def FRONT_END_URL(self) -> str:
        return self._get_value("FRONT_END_URL", "http://localhost:3000")

    @property
    def DB_SCHEMA(self) -> str:
        return self._get_value("DB_SCHEMA", "asterism")

    @property
    def DB_FILE(self) -> Path:
        return (self.STORAGE_ROOT / "backend.db").resolve()

    @property
    def DB_USER(self) -> str:
        return self._get_value("DB_USER", "postgres")

    @property
    def DB_HOST(self) -> str:
        return self._get_value("DB_HOST", "localhost")

    @property
    def DB_PORT(self) -> int:
        return int(self._get_value("DB_PORT", "5432"))

    @property
    def DB_PASSWORD(self) -> str:
        return self._get_value("DB_PASSWORD", "NO_PASSWORD")

    @property
    def DB_CONNECTION(self) -> str:
        return self._get_value("DB_CONNECTION", "sqlite+aiosqlite")

    @property
    def DB_URL(self) -> str:
        connection = self.DB_CONNECTION
        if "sqlite" in connection:
            return f"{connection}:////{self.DB_FILE}"

        return f"{self.DB_CONNECTION}://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/lang3s"

    @property
    def BETTER_AUTH_URL(self) -> str:
        return self._get_value("BETTER_AUTH_URL", self.FRONT_END_URL)

    @property
    def JWT_ISSUER(self) -> str:
        return self._get_value("JWT_ISSUER", self.BETTER_AUTH_URL)

    @property
    def JWT_AUDIENCE(self) -> str:
        return self._get_value("JWT_AUDIENCE", self.BETTER_AUTH_URL)

    @property
    def JWKS_URL(self) -> str:
        return self._get_value("JWKS_URL", f"{self.BETTER_AUTH_URL}/api/auth/jwks")

    @property
    def BOOTSTRAP_SETUP_TOKEN(self) -> str:
        return self._get_value("BOOTSTRAP_SETUP_TOKEN", "")

    @property
    def STORAGE_ROOT(self) -> Path:
        storage_root = Path(self._get_value("STORAGE_ROOT", "/storage"))
        storage_root.mkdir(exist_ok=True)
        return storage_root

    @property
    def FILES_ROOT(self) -> Path:
        files_root = self.STORAGE_ROOT / "files"
        files_root.mkdir(exist_ok=True)
        return files_root

    def get_user_file(self, user_id: str, filename: str) -> Path:
        files_dir = self.FILES_ROOT / user_id / filename
        return files_dir.resolve()


config = Config()
