from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _integer(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


@dataclass(frozen=True)
class Settings:
    bind_host: str
    port: int
    token: str
    max_upload_bytes: int
    cache_root: Path
    manifest_path: Path
    temp_root: Path | None

    @classmethod
    def from_env(cls) -> Settings:
        token = os.environ.get("MATRIX_STRUCTURE_HTTP_TOKEN", "").strip()
        if len(token) < 24:
            raise ValueError("MATRIX_STRUCTURE_HTTP_TOKEN must contain at least 24 characters")
        default_root = Path(__file__).resolve().parents[1] / "resources"
        cache_root = Path(
            os.environ.get("MATRIX_STRUCTURE_CACHE_ROOT", str(default_root / "models"))
        ).expanduser().resolve()
        manifest_path = Path(
            os.environ.get(
                "MATRIX_STRUCTURE_MODEL_MANIFEST", str(default_root / "models.manifest.json")
            )
        ).expanduser().resolve()
        raw_temp = os.environ.get("MATRIX_STRUCTURE_TEMP_ROOT", "").strip()
        return cls(
            bind_host=os.environ.get("MATRIX_STRUCTURE_BIND_HOST", "127.0.0.1").strip()
            or "127.0.0.1",
            port=_integer("MATRIX_STRUCTURE_PORT", 8091, 1, 65_535),
            token=token,
            max_upload_bytes=_integer(
                "MATRIX_STRUCTURE_MAX_UPLOAD_BYTES", 26_214_400, 1, 134_217_728
            ),
            cache_root=cache_root,
            manifest_path=manifest_path,
            temp_root=Path(raw_temp).expanduser().resolve() if raw_temp else None,
        )
