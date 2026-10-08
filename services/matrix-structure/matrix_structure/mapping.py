from __future__ import annotations

import math
from html.parser import HTMLParser
from typing import Any


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[tuple[str, int, int]]] = []
        self._row: list[tuple[str, int, int]] | None = None
        self._parts: list[str] | None = None
        self._row_span = 1
        self._column_span = 1

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lowered = tag.lower()
        if lowered == "tr":
            self._row = []
        elif lowered in {"td", "th"} and self._row is not None:
            attributes = {key.lower(): value for key, value in attrs}
            self._row_span = _positive_span(attributes.get("rowspan"))
            self._column_span = _positive_span(attributes.get("colspan"))
            self._parts = []
        elif lowered == "br" and self._parts is not None:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._parts is not None:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.lower()
        if lowered in {"td", "th"} and self._row is not None and self._parts is not None:
            text = " ".join("".join(self._parts).split())
            self._row.append((text, self._row_span, self._column_span))
            self._parts = None
        elif lowered == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None


def _positive_span(raw: str | None) -> int:
    try:
        value = int(raw or "1")
    except ValueError:
        return 1
    return value if 1 <= value <= 1000 else 1


def parse_table_html(html: str) -> dict[str, Any]:
    parser = _TableParser()
    parser.feed(html)
    if not parser.rows:
        raise ValueError("table result does not contain rows")
    occupied: set[tuple[int, int]] = set()
    cells: list[dict[str, Any]] = []
    max_row = 0
    max_column = 0
    for row_index, raw_row in enumerate(parser.rows):
        column = 0
        for text, row_span, column_span in raw_row:
            while (row_index, column) in occupied:
                column += 1
            for covered_row in range(row_index, row_index + row_span):
                for covered_column in range(column, column + column_span):
                    if (covered_row, covered_column) in occupied:
                        raise ValueError("table result contains overlapping cells")
                    occupied.add((covered_row, covered_column))
            cells.append(
                {
                    "row": row_index,
                    "column": column,
                    "row_span": row_span,
                    "column_span": column_span,
                    "text": text,
                }
            )
            max_row = max(max_row, row_index + row_span)
            max_column = max(max_column, column + column_span)
            column += column_span
    if not cells or max_row < 1 or max_column < 1:
        raise ValueError("table result is empty")
    return {"type": "table", "rows": max_row, "columns": max_column, "cells": cells}


def _numbers(value: Any) -> list[float]:
    output: list[float] = []
    if isinstance(value, (list, tuple)):
        for item in value:
            output.extend(_numbers(item))
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        if math.isfinite(number):
            output.append(number)
    return output


def normalize_bbox(value: Any, width: int, height: int) -> list[float] | None:
    numbers = _numbers(value)
    if width <= 0 or height <= 0 or len(numbers) < 4:
        return None
    if len(numbers) == 4:
        x0, y0, x1, y1 = numbers
    else:
        xs = numbers[0::2]
        ys = numbers[1::2]
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
    x0 = max(0.0, min(1.0, x0 / width))
    y0 = max(0.0, min(1.0, y0 / height))
    x1 = max(0.0, min(1.0, x1 / width))
    y1 = max(0.0, min(1.0, y1 / height))
    return [x0, y0, x1, y1] if x0 < x1 and y0 < y1 else None


def _table_text(structure: dict[str, Any]) -> str:
    grid = [["" for _ in range(structure["columns"])] for _ in range(structure["rows"])]
    for cell in structure["cells"]:
        grid[cell["row"]][cell["column"]] = cell["text"]
    return "\n".join("\t".join(row).rstrip() for row in grid).strip()


def _average_score(table: dict[str, Any]) -> float | None:
    raw = table.get("table_ocr_pred")
    scores = raw.get("rec_scores") if isinstance(raw, dict) else None
    values = [float(value) for value in scores or [] if isinstance(value, (int, float))]
    values = [value for value in values if math.isfinite(value) and 0 <= value <= 1]
    return sum(values) / len(values) if values else None


def map_paddle_result(raw: Any, *, width: int, height: int) -> list[dict[str, Any]]:
    if not isinstance(raw, dict):
        raise ValueError("PP-Structure result must be an object")
    body = raw.get("res", raw)
    if not isinstance(body, dict):
        raise ValueError("PP-Structure result body must be an object")
    parsing = body.get("parsing_res_list")
    regions = parsing if isinstance(parsing, list) else []
    table_regions = [
        item
        for item in regions
        if isinstance(item, dict) and item.get("block_label") == "table"
    ]
    formula_regions = [
        item
        for item in regions
        if isinstance(item, dict) and item.get("block_label") == "formula"
    ]
    blocks: list[dict[str, Any]] = []

    tables = body.get("table_res_list")
    for index, table in enumerate(tables if isinstance(tables, list) else []):
        if not isinstance(table, dict):
            continue
        html = table.get("pred_html")
        if not isinstance(html, str) or not html.strip():
            raise ValueError("table result is missing pred_html")
        structure = parse_table_html(html)
        region = table_regions[index] if index < len(table_regions) else {}
        bbox = normalize_bbox(region.get("block_bbox"), width, height)
        if bbox is None:
            bbox = normalize_bbox(table.get("cell_box_list"), width, height)
        blocks.append(
            {
                "source_order": regions.index(region) if region in regions else 10_000 + index,
                "kind": "table",
                "text": _table_text(structure),
                "bbox": bbox,
                "confidence": _average_score(table),
                "structure": structure,
            }
        )

    formulas = body.get("formula_res_list")
    for index, formula in enumerate(formulas if isinstance(formulas, list) else []):
        if not isinstance(formula, dict):
            continue
        latex = formula.get("rec_formula")
        if not isinstance(latex, str) or not latex.strip():
            raise ValueError("formula result is missing LaTeX")
        region = formula_regions[index] if index < len(formula_regions) else {}
        bbox = normalize_bbox(formula.get("dt_polys"), width, height)
        if bbox is None:
            bbox = normalize_bbox(region.get("block_bbox"), width, height)
        blocks.append(
            {
                "source_order": regions.index(region) if region in regions else 20_000 + index,
                "kind": "formula",
                "text": latex.strip(),
                "bbox": bbox,
                "confidence": None,
                "structure": {"type": "formula", "latex": latex.strip()},
            }
        )

    blocks.sort(
        key=lambda block: (
            block["source_order"],
            block["bbox"][1] if block["bbox"] else 1.0,
            block["bbox"][0] if block["bbox"] else 1.0,
        )
    )
    for index, block in enumerate(blocks):
        block["structure_index"] = index
        block["reading_order"] = index
        block.pop("source_order", None)
    return blocks
