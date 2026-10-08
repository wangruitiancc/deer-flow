from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from PIL import Image

from matrix_structure import MODEL_VERSION
from matrix_structure.mapping import map_paddle_result


class PaddleStructureBackend:
    model_version = MODEL_VERSION

    def __init__(self, cache_root: Path | None = None) -> None:
        from paddleocr import PPStructureV3

        local_models: dict[str, str] = {}
        if cache_root is not None:
            model_root = cache_root / "official_models"

            def model_dir(name: str) -> str:
                return str(model_root / name)

            local_models = {
                "layout_detection_model_dir": model_dir("PP-DocLayout_plus-L"),
                "region_detection_model_dir": model_dir("PP-DocBlockLayout"),
                "text_detection_model_dir": model_dir("PP-OCRv5_mobile_det"),
                "text_recognition_model_dir": model_dir("PP-OCRv5_mobile_rec"),
                "textline_orientation_model_dir": model_dir(
                    "PP-LCNet_x1_0_textline_ori"
                ),
                "doc_orientation_classify_model_dir": model_dir(
                    "PP-LCNet_x1_0_doc_ori"
                ),
                "table_classification_model_dir": model_dir(
                    "PP-LCNet_x1_0_table_cls"
                ),
                "wired_table_structure_recognition_model_dir": model_dir(
                    "SLANeXt_wired"
                ),
                "wireless_table_structure_recognition_model_dir": model_dir(
                    "SLANet_plus"
                ),
                "wired_table_cells_detection_model_dir": model_dir(
                    "RT-DETR-L_wired_table_cell_det"
                ),
                "wireless_table_cells_detection_model_dir": model_dir(
                    "RT-DETR-L_wireless_table_cell_det"
                ),
                "table_orientation_classify_model_dir": model_dir(
                    "PP-LCNet_x1_0_doc_ori"
                ),
                "formula_recognition_model_dir": model_dir("PP-FormulaNet_plus-L"),
                "chart_recognition_model_dir": model_dir("PP-Chart2Table"),
            }

        self._pipeline = PPStructureV3(
            device="cpu",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            use_seal_recognition=False,
            use_chart_recognition=False,
            use_table_recognition=True,
            use_formula_recognition=True,
            layout_detection_model_name="PP-DocLayout_plus-L",
            text_detection_model_name="PP-OCRv5_mobile_det",
            text_recognition_model_name="PP-OCRv5_mobile_rec",
            **local_models,
        )
        self._lock = threading.Lock()

    def analyze(
        self, image_path: Path, *, enable_table: bool, enable_formula: bool
    ) -> dict[str, Any]:
        with Image.open(image_path) as image:
            width, height = image.size
        with self._lock:
            results = list(
                self._pipeline.predict(
                    str(image_path),
                    use_table_recognition=enable_table,
                    use_formula_recognition=enable_formula,
                    use_chart_recognition=False,
                )
            )
        if len(results) != 1:
            raise ValueError("structure sidecar expects exactly one image result")
        blocks = map_paddle_result(results[0].json, width=width, height=height)
        if not enable_table:
            blocks = [block for block in blocks if block["kind"] != "table"]
        if not enable_formula:
            blocks = [block for block in blocks if block["kind"] != "formula"]
        for index, block in enumerate(blocks):
            block["structure_index"] = index
            block["reading_order"] = index
        return {
            "version": "matrix-structure-http-v1",
            "model_version": self.model_version,
            "width_pixels": width,
            "height_pixels": height,
            "blocks": blocks,
        }
