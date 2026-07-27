#!/usr/bin/env python3
"""Extract Japanese word spans (text + coordinates) from a PDF.

Usage:
    extract.py <pdf_path> [--page N]

Outputs a JSON object to stdout:
    {
      "pages": [{"index": 0, "width": W, "height": H}, ...],
      "spans": [
        {"id": 0, "page": 0, "text": "図面名称",
         "bbox": [x0, top, x1, bottom],          # pdfplumber TOP-origin points
         "page_size": [W, H],
         "rel_pos": [x_frac, y_frac]},           # top-left corner, 0..1
        ...
      ]
    }

Coordinate system (IMPORTANT): origin is TOP-LEFT of the page, x grows RIGHT,
y grows DOWN. rel_pos lets you reason about title blocks etc.
(bottom-right of page => rel_pos near [1.0, 1.0]).
"""
import argparse
import json
import sys

import pdfplumber

JAPANESE_RANGES = [
    ("぀", "ゟ"),   # hiragana
    ("゠", "ヿ"),   # katakana
    ("一", "鿿"),   # CJK unified ideographs
    ("㐀", "䶿"),   # CJK extension A
    ("ｦ", "ﾟ"),  # halfwidth katakana
]


def has_japanese(s: str) -> bool:
    for c in s:
        for lo, hi in JAPANESE_RANGES:
            if lo <= c <= hi:
                return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf_path")
    ap.add_argument("--page", type=int, default=None,
                    help="0-indexed page to scan (default: all pages)")
    args = ap.parse_args()

    spans = []
    pages_meta = []
    next_id = 0
    with pdfplumber.open(args.pdf_path) as pdf:
        if args.page is None:
            targets = list(enumerate(pdf.pages))
        else:
            targets = [(args.page, pdf.pages[args.page])]
        for page_idx, page in enumerate(pdf.pages):
            pages_meta.append({
                "index": page_idx,
                "width": round(float(page.width), 1),
                "height": round(float(page.height), 1),
            })
        for page_idx, page in targets:
            pw, ph = float(page.width), float(page.height)
            try:
                words = page.extract_words()
            except Exception:
                words = []
            for w in words:
                text = (w.get("text") or "").strip()
                if not text or not has_japanese(text):
                    continue
                x0, top, x1, bottom = (
                    float(w["x0"]), float(w["top"]),
                    float(w["x1"]), float(w["bottom"]),
                )
                spans.append({
                    "id": next_id,
                    "page": page_idx,
                    "text": text,
                    "bbox": [round(x0, 1), round(top, 1),
                             round(x1, 1), round(bottom, 1)],
                    "page_size": [round(pw, 1), round(ph, 1)],
                    "rel_pos": [round(x0 / pw, 3) if pw else 0.0,
                                round(top / ph, 3) if ph else 0.0],
                })
                next_id += 1

    json.dump({"pages": pages_meta, "spans": spans},
              sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
