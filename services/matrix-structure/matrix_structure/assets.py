from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
from typing import Any

ASSET_MANIFEST_VERSION = "matrix-structure-assets-v1"
REQUIRED_PACKAGES = {
    "paddleocr": "3.2.0",
    "paddlepaddle": "3.2.2",
    "paddlex": "3.2.1",
}
REQUIRED_MODELS = (
    "PP-DocBlockLayout",
    "PP-DocLayout_plus-L",
    "PP-OCRv5_mobile_det",
    "PP-OCRv5_mobile_rec",
    "PP-LCNet_x1_0_table_cls",
    "SLANeXt_wired",
    "SLANet_plus",
    "RT-DETR-L_wired_table_cell_det",
    "RT-DETR-L_wireless_table_cell_det",
    "PP-FormulaNet_plus-L",
    "PP-Chart2Table",
    "PP-LCNet_x1_0_doc_ori",
    "PP-LCNet_x1_0_textline_ori",
)


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def model_tree_record(cache_root: Path, model_name: str) -> dict[str, Any]:
    model_root = cache_root / "official_models" / model_name
    if not model_root.is_dir():
        raise ValueError(f"required model directory is missing: {model_name}")
    files = sorted(path for path in model_root.rglob("*") if path.is_file())
    if not files:
        raise ValueError(f"required model directory is empty: {model_name}")
    tree = hashlib.sha256()
    total_bytes = 0
    for path in files:
        relative = path.relative_to(model_root).as_posix()
        size = path.stat().st_size
        total_bytes += size
        tree.update(relative.encode("utf-8"))
        tree.update(b"\0")
        tree.update(str(size).encode("ascii"))
        tree.update(b"\0")
        tree.update(bytes.fromhex(_file_sha256(path)))
    return {
        "name": model_name,
        "path": f"official_models/{model_name}",
        "file_count": len(files),
        "total_bytes": total_bytes,
        "tree_sha256": tree.hexdigest(),
    }


def snapshot_manifest(cache_root: Path) -> dict[str, Any]:
    return {
        "version": ASSET_MANIFEST_VERSION,
        "packages": REQUIRED_PACKAGES,
        "models": [model_tree_record(cache_root, name) for name in REQUIRED_MODELS],
    }


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("structure model manifest is unavailable or invalid") from exc
    if not isinstance(payload, dict) or payload.get("version") != ASSET_MANIFEST_VERSION:
        raise ValueError("structure model manifest version is invalid")
    return payload


def verify_assets(cache_root: Path, manifest_path: Path) -> dict[str, Any]:
    expected = load_manifest(manifest_path)
    if expected.get("packages") != REQUIRED_PACKAGES:
        raise ValueError("structure package lock does not match the model manifest")
    for package, version in REQUIRED_PACKAGES.items():
        try:
            installed = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError as exc:
            raise ValueError(f"required package is missing: {package}") from exc
        if installed != version:
            raise ValueError(f"required package version mismatch: {package}")
    actual = snapshot_manifest(cache_root)
    if actual != expected:
        raise ValueError("structure model asset hashes do not match the manifest")
    return actual


def main() -> None:
    parser = argparse.ArgumentParser(description="Snapshot or verify PP-Structure model assets")
    parser.add_argument("action", choices=("snapshot", "verify"))
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    cache_root = args.cache_root.expanduser().resolve()
    manifest_path = args.manifest.expanduser().resolve()
    if args.action == "snapshot":
        payload = snapshot_manifest(cache_root)
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return
    verify_assets(cache_root, manifest_path)


if __name__ == "__main__":
    main()
