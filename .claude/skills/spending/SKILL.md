---
name: spending
description: 毎月の支払い内訳トラッカー。ユーザーが「今月の内訳を追加して」「支出を可視化して」等と言ったら使う。1レコード = 「対象月 × カテゴリ」の金額・件数。レコードは data/spending/items/<id>.json（1件1ファイル）。ユーザーは /collections/spending の「内訳ダッシュボード」ビューで、選択月の円グラフ（項目別・色分け）とその下の年間グラフ（月別カテゴリ積み上げ棒）を見る。レコード I/O は manageCollection ツール（生の Read/Write/Edit はエスケープハッチ）、スキーマ変更は manageCollection の schemaDocs/getSchema/putSchema。
---

# 支出内訳（schema-driven collection）

## レコードの形

- `id` — 主キー。`<month>_<カテゴリslug>` 形式（例: `2026-06_suica`）。ファイル名になる。
- `month` — 対象月 `YYYY-MM`（請求締め月）。必須。同じ月のカテゴリ行はこの値でまとまる。
- `periodLabel` — 請求期間の表示ラベル（例: `5/16〜6/15`）。任意。
- `category` — カテゴリ（enum）。必須。色分けの単位。新カテゴリが要る場合は putSchema で values に追加。
- `amount` — 金額（JPY, money）。必須。
- `count` — 件数（number）。任意。
- `note` — メモ（text）。任意。

## やること

- **月の内訳を追加** — その月の各カテゴリを1行ずつ、`manageCollection` putItems（`mode: "create"`）で投入する。id は `<month>_<slug>`。件数・期間も入れる。
- **修正** — `mode: "merge"` で対象行の変更フィールドだけ更新。
- **一覧/表示** — `manageCollection` getItems、または `presentCollection`。チャットに全表を書き出さない。
- **新カテゴリ** — `manageCollection` getSchema → category.values に追加 → putSchema。
- **スキーマ変更** — `manageCollection` の schemaDocs / getSchema / putSchema。生の schema.json 編集はしない。

ダッシュボード（円グラフ＋年間グラフ）は `/collections/spending` の「内訳ダッシュボード」ビュー。月を追加すると onChange で即時更新される。
