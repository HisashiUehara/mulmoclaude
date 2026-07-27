#!/usr/bin/env python3
"""WeeklyReport 本体パイプライン Stage 2 (engine = コード担当分).

役割: AI→DSL→engine のうち engine が担う「書式抽出」と「原文抽出→DSL化」。
- extract-template <template>  : テナント用テンプレートの書式(フォント種類/サイズ/配置)・
                                 章構成・表構造・プレースホルダを抽出 -> templateFormat.json
- extract-source   <report>    : 業者レポートから原文を抜き取り DSL の items[] を生成
                                 (訳文は空。confidence は AI(S3) が付与するため未設定) -> source.dsl.json

書式・構造は解釈せずそのまま記録する(翻訳・流し込みは後段)。
凍結済みのゴールド取込エンジン pipeline.py の抽出関数を read-only で再利用する。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pipeline  # noqa: E402  (凍結エンジンの抽出関数を再利用)

_PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")


# ---- ステップ2: 書式抽出 --------------------------------------------------------
def extract_template(path: Path) -> dict:
    ext = pipeline.extract(path)
    elements, placeholders = [], {}
    for it in ext["items"]:
        m = _PLACEHOLDER.search(it["text"])
        elements.append({
            "loc": it["loc"],
            "text": it["text"],
            "font": it["font"],          # フォント種類/サイズ/太字/斜体
            "align": it["align"],        # 配置(水平/垂直)
            "number_format": it.get("number_format"),
            "is_heading": it["is_heading"],
            "is_placeholder": bool(m),
            "placeholder_id": m.group(1) if m else None,
        })
        if m:
            placeholders[m.group(1)] = it["loc"]
    return {
        "_meta": {"stage": "S2-format", "purpose": "テンプレート書式抽出(流し込み先の定義)"},
        "source": ext["source"],
        "structure": ext["structure"],   # 章構成/シート・スライド/結合セル(表構造)
        "elements": elements,
        "placeholders": placeholders,     # {DSL項目ID: 転記先loc}
        "assets": ext["assets"],
    }


# ---- ステップ3: 原文抽出 → DSL化 -------------------------------------------------
def extract_source(path: Path) -> dict:
    ext = pipeline.extract(path)
    items = [{
        "id": it["id"],
        "source_location": it["loc"],
        "原文": it["text"],
        "訳文": "",                      # 翻訳は AI(S3)
    } for it in ext["items"]]
    return {
        "_meta": {"stage": "S2-extract", "status": "抽出済",
                  "note": "訳文は空・confidence未設定(S3で付与)", "source_kind": ext["source"]["kind"]},
        "items": items,
    }


# ---- CLI ----------------------------------------------------------------------
def _resolve(base: Path, p: str) -> Path:
    return Path(p) if Path(p).is_absolute() else base / p


def _dump(obj: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {path}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="WeeklyReport Stage 2 engine (format + source extraction)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    pt = sub.add_parser("extract-template"); pt.add_argument("src")
    pt.add_argument("--out", default="engine/work/templateFormat.json")
    pss = sub.add_parser("extract-source"); pss.add_argument("src")
    pss.add_argument("--out", default="engine/work/source.dsl.json")

    a = ap.parse_args(argv)
    base = Path(__file__).resolve().parent.parent  # data/skills/weekly-report
    src = _resolve(base, a.src)
    if a.cmd == "extract-template":
        _dump(extract_template(src), _resolve(base, a.out))
    elif a.cmd == "extract-source":
        _dump(extract_source(src), _resolve(base, a.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
