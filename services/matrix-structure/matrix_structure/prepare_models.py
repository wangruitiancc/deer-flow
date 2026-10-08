from __future__ import annotations

import argparse
import os
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

from matrix_structure.assets import verify_assets


def main() -> None:
    parser = argparse.ArgumentParser(description="Explicitly prepare locked PP-Structure assets")
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    cache_root = args.cache_root.expanduser().resolve()
    manifest_path = args.manifest.expanduser().resolve()
    cache_root.mkdir(parents=True, exist_ok=True)
    os.environ["PADDLE_PDX_CACHE_HOME"] = str(cache_root)
    os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "BOS")

    from matrix_structure.backend import PaddleStructureBackend

    image = Image.new("RGB", (640, 480), "white")
    draw = ImageDraw.Draw(image)
    draw.text((40, 40), "Matrix Structure asset preparation", fill="black")
    with tempfile.TemporaryDirectory(prefix="matrix-structure-prepare-") as raw_dir:
        sample = Path(raw_dir) / "sample.png"
        image.save(sample)
        PaddleStructureBackend().analyze(sample, enable_table=True, enable_formula=True)
    verify_assets(cache_root, manifest_path)


if __name__ == "__main__":
    main()
