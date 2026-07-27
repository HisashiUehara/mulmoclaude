#!/usr/bin/env python3
"""Overlay annotations from a state JSON onto the original PDF.

Usage:
    render.py <state_json_path> <output_pdf_path>

State JSON shape:
    {
      "source_pdf": "<workspace-relative or absolute path to original PDF>",
      "annotations": [
        {
          "id": 1,
          "page": 0,
          "bbox": [x0, top, x1, bottom],   # placement rect, pdfplumber TOP-origin pts
          "text": "General Notes",         # English overlay text to draw
          "source_ja": "注記",             # (optional) original Japanese, for reference
          "color": "red",                  # (optional) red|blue|green|black; default red
          "kind": "text"                   # (optional) reserved; only "text" supported now
        }
      ]
    }

- Text is drawn in the given color, font-fitted to the bbox width (capped by height).
- Coordinates use pdfplumber's TOP-origin convention (y from the top of the page).
- Any annotation whose page is out of range is skipped (with a warning to stderr).
"""
import argparse
import json
import os
import sys

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import black, blue, green, red
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth

COLORS = {"red": red, "blue": blue, "green": green, "black": black}
FONT = "Helvetica-Bold"


def fit_font_size(text: str, rect_w: float, rect_h: float) -> float:
    size = max(rect_h * 0.8, 6.0)
    if not text:
        return size
    width = stringWidth(text, FONT, size)
    if width > rect_w and width > 0:
        size = size * (rect_w / width)
    return max(size, 4.0)


def resolve_path(p: str, base_dir: str) -> str:
    if os.path.isabs(p):
        return p
    # Try relative to the state file's dir, then to the workspace root (cwd).
    cand = os.path.join(base_dir, p)
    if os.path.exists(cand):
        return cand
    return p


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("state_json")
    ap.add_argument("output_pdf")
    args = ap.parse_args()

    with open(args.state_json, encoding="utf-8") as f:
        state = json.load(f)

    state_dir = os.path.dirname(os.path.abspath(args.state_json))
    src = resolve_path(state["source_pdf"], state_dir)
    if not os.path.exists(src):
        sys.stderr.write(f"source_pdf not found: {src}\n")
        return 1

    reader = PdfReader(src)
    n_pages = len(reader.pages)

    by_page: dict[int, list] = {}
    for ann in state.get("annotations", []):
        pg = int(ann.get("page", 0))
        if pg < 0 or pg >= n_pages:
            sys.stderr.write(f"skip annotation id={ann.get('id')}: page {pg} out of range\n")
            continue
        by_page.setdefault(pg, []).append(ann)

    overlay_buf = _make_overlay(reader, by_page)

    overlay_reader = PdfReader(overlay_buf)
    writer = PdfWriter()
    for i, page in enumerate(reader.pages):
        page.merge_page(overlay_reader.pages[i])
        writer.add_page(page)

    os.makedirs(os.path.dirname(os.path.abspath(args.output_pdf)), exist_ok=True)
    with open(args.output_pdf, "wb") as f:
        writer.write(f)

    drawn = sum(len(v) for v in by_page.values())
    sys.stderr.write(f"rendered {drawn} annotation(s) across {n_pages} page(s) -> {args.output_pdf}\n")
    return 0


def _make_overlay(reader, by_page):
    from io import BytesIO
    buf = BytesIO()
    c = canvas.Canvas(buf)
    for idx, page in enumerate(reader.pages):
        page_w = float(page.mediabox.width)
        page_h = float(page.mediabox.height)
        c.setPageSize((page_w, page_h))
        for ann in by_page.get(idx, []):
            text = (ann.get("text") or "").strip()
            if not text:
                continue
            x0, top, x1, bottom = [float(v) for v in ann["bbox"]]
            rect_w = max(x1 - x0, 1.0)
            rect_h = max(bottom - top, 1.0)
            size = fit_font_size(text, rect_w, rect_h)
            # top-origin rect -> bottom-origin baseline, vertically centered
            y_pdf = page_h - bottom + (rect_h - size) / 2
            c.setFillColor(COLORS.get(ann.get("color", "red"), red))
            c.setFont(FONT, size)
            c.drawString(x0, y_pdf, text)
        c.showPage()
    c.save()
    buf.seek(0)
    return buf


if __name__ == "__main__":
    raise SystemExit(main())
