#!/usr/bin/env python3
"""Stage 2 E2E 検証: 抽出結果を仮ゴールドと突き合わせる。

- extract-source(ダミー業者レポート) の {id, source_location, 原文} が仮ゴールドと一致するか。
  (訳文・confidence は S3 で付与するため比較対象外 — gold-pair.md の S2 判定に準拠)
- extract-template(ダミーテンプレート) が DSL 全項目ID(001..012)のプレースホルダを検出したか。
"""
import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
GOLD = json.loads((BASE / "fixtures/gold/expected.dsl.json").read_text(encoding="utf-8"))


def _load(p: str) -> dict:
    return json.loads((BASE / p).read_text(encoding="utf-8"))


def check_source() -> bool:
    src = _load("engine/work/source.dsl.json")
    gold = {g["id"]: g for g in GOLD["items"]}
    got = {i["id"]: i for i in src["items"]}
    ok = True
    if set(gold) != set(got):
        print(f"  [NG] 項目ID不一致 gold={sorted(gold)} got={sorted(got)}"); ok = False
    for gid, g in gold.items():
        i = got.get(gid)
        if not i:
            ok = False; continue
        if i["source_location"] != g["source_location"]:
            print(f"  [NG] {gid} loc {i['source_location']} != {g['source_location']}"); ok = False
        if i["原文"] != g["原文"]:
            print(f"  [NG] {gid} 原文不一致"); ok = False
        if i["訳文"] != "":
            print(f"  [NG] {gid} 訳文は空であるべき"); ok = False
    print(f"  source: {'OK' if ok else 'NG'} ({len(got)}項目, 原文/loc/id を照合)")
    return ok


def check_template() -> bool:
    tf = _load("engine/work/templateFormat.json")
    want = {g["id"] for g in GOLD["items"]}
    got = set(tf["placeholders"].keys())
    ok = want == got
    if not ok:
        print(f"  [NG] プレースホルダ不足/余剰 missing={sorted(want-got)} extra={sorted(got-want)}")
    # 書式が取れているかの軽い確認(タイトルの font)
    a1 = next((e for e in tf["elements"] if e["loc"].endswith("/A1")), None)
    fmt_ok = bool(a1 and a1["font"]["name"] and a1["font"]["size"])
    print(f"  template: {'OK' if ok and fmt_ok else 'NG'} "
          f"(placeholders {len(got)}/{len(want)}, タイトル書式={a1['font'] if a1 else None})")
    return ok and fmt_ok


if __name__ == "__main__":
    print("== Stage 2 検証 (仮ゴールド期待値) ==")
    r1 = check_source()
    r2 = check_template()
    print("== RESULT:", "PASS ✅" if (r1 and r2) else "FAIL ❌", "==")
    sys.exit(0 if (r1 and r2) else 1)
