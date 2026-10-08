from __future__ import annotations

import json

import pytest

from matrix_structure import assets


def test_verify_assets_fails_closed_after_model_tampering(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    cache_root = tmp_path / "models"
    model_root = cache_root / "official_models" / "synthetic-model"
    model_root.mkdir(parents=True)
    weight = model_root / "inference.pdiparams"
    weight.write_bytes(b"known-model-bytes")

    monkeypatch.setattr(assets, "REQUIRED_MODELS", ("synthetic-model",))
    monkeypatch.setattr(assets, "REQUIRED_PACKAGES", {})
    manifest_path = tmp_path / "models.manifest.json"
    manifest_path.write_text(
        json.dumps(assets.snapshot_manifest(cache_root)), encoding="utf-8"
    )

    assets.verify_assets(cache_root, manifest_path)
    weight.write_bytes(b"tampered-model-bytes")

    with pytest.raises(ValueError, match="hashes"):
        assets.verify_assets(cache_root, manifest_path)
