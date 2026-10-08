from __future__ import annotations

import pytest

from matrix_structure.mapping import map_paddle_result, normalize_bbox, parse_table_html


def test_parse_table_html_preserves_spans() -> None:
    structure = parse_table_html(
        "<table><tr><th rowspan='2'>Name</th><th colspan='2'>Amount</th></tr>"
        "<tr><td>Net</td><td>Tax</td></tr><tr><td>A</td><td>10</td><td>1</td></tr></table>"
    )
    assert structure["rows"] == 3
    assert structure["columns"] == 3
    assert structure["cells"][0] == {
        "row": 0,
        "column": 0,
        "row_span": 2,
        "column_span": 1,
        "text": "Name",
    }
    assert structure["cells"][1]["column_span"] == 2
    assert structure["cells"][2]["column"] == 1


def test_map_paddle_result_returns_strict_table_and_formula_blocks() -> None:
    raw = {
        "res": {
            "parsing_res_list": [
                {"block_label": "table", "block_bbox": [10, 20, 90, 60]},
                {"block_label": "formula", "block_bbox": [20, 70, 80, 90]},
            ],
            "table_res_list": [
                {
                    "pred_html": "<table><tr><td>A</td><td>B</td></tr></table>",
                    "cell_box_list": [[10, 20, 50, 60], [50, 20, 90, 60]],
                    "table_ocr_pred": {"rec_scores": [0.8, 1.0]},
                }
            ],
            "formula_res_list": [
                {"rec_formula": "x^2", "dt_polys": [20, 70, 80, 90]}
            ],
        }
    }
    blocks = map_paddle_result(raw, width=100, height=100)
    assert [block["kind"] for block in blocks] == ["table", "formula"]
    assert blocks[0]["structure"]["columns"] == 2
    assert blocks[0]["text"] == "A\tB"
    assert blocks[0]["confidence"] == pytest.approx(0.9)
    assert blocks[0]["bbox"] == [0.1, 0.2, 0.9, 0.6]
    assert blocks[1]["structure"] == {"type": "formula", "latex": "x^2"}


def test_empty_table_is_rejected() -> None:
    with pytest.raises(ValueError, match="rows"):
        parse_table_html("<table></table>")


def test_normalize_bbox_accepts_polygons_and_rejects_invalid_values() -> None:
    assert normalize_bbox([[10, 20], [80, 20], [80, 90], [10, 90]], 100, 100) == [
        0.1,
        0.2,
        0.8,
        0.9,
    ]
    assert normalize_bbox([0, 0, 0, 1], 100, 100) is None
