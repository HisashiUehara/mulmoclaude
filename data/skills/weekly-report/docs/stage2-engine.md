# Stage 2 エンジン（書式抽出・原文抽出→DSL化）

本体パイプラインのステップ2-3を担う engine（コード）。実装は [`../engine/product.py`](../engine/product.py)。
凍結済みのゴールド取込エンジン [`../engine/pipeline.py`](../engine/pipeline.py) の抽出関数を read-only で再利用する。

## 担当（AI→DSL→engine の engine 部分）
| ステップ | サブコマンド | 入力 | 出力 |
|---|---|---|---|
| 2 書式抽出 | `extract-template` | テナント用テンプレート(.xlsx/.pptx) | `templateFormat.json`（書式・章構成・表構造・プレースホルダ） |
| 3 原文抽出→DSL化 | `extract-source` | 業者レポート(.xlsx/.pptx) | `source.dsl.json`（DSL items[]。原文のみ、訳文は空） |

翻訳(S3)・確認(S5)・流し込み(S6)は後段。ここは**抽出のみ**で、書式・構造を解釈しない。

## 実行
作業ディレクトリは `data/skills/weekly-report/`。要 `pip install -r engine/requirements.txt`。
```bash
python3 engine/product.py extract-template fixtures/dummy/tenant-template.xlsx
#   -> engine/work/templateFormat.json
python3 engine/product.py extract-source   fixtures/dummy/contractor-report.xlsx
#   -> engine/work/source.dsl.json
python3 engine/validate_stage2.py          # 仮ゴールドと突き合わせ (PASS/FAIL)
```

## templateFormat.json の形（ステップ6の流し込み定義）
- `structure` — シート/スライド・結合セル（表構造）・章構成
- `elements[]` — 各要素の `loc` / `text` / `font`(種類・サイズ・太字・斜体) / `align`(配置) / `is_heading` / `is_placeholder` / `placeholder_id`
- `placeholders` — `{DSL項目ID: 転記先loc}`。`{{NNN}}` 記法で埋め込む。ステップ6は訳文をここへ流し込む。

## source.dsl.json の形（抽出済スキャフォールド）
- `items[]` = `{ id, source_location, 原文, 訳文:"" }`。`confidence` は S3(AI) が付与するため未設定。
- `id` は抽出順の連番（`001`..）。`source_location` は `シート/セル`（xlsx）または `pスライド/図形[para/run]`（pptx）。

## ダミー入力（自作・NDA前の作業用）
[`../fixtures/dummy/`](../fixtures/dummy/) に生成器と成果物を置く。実データは使わない。
- `make_dummies.py` — 生成器。**業者レポートの原文は仮ゴールド `expected.dsl.json` と同一セル・同一文**にして、抽出エンジンの正しさをゴールドで検証できるようにしてある。
- `contractor-report.xlsx` — ダミー業者レポート（sheet 週報, 原文12件）。
- `tenant-template.xlsx` — ダミーテナントテンプレート（英語ラベル＋`{{001}}`..`{{012}}` プレースホルダ、書式付き）。
- `sample-output/` — 抽出結果の参照用サンプル（`source.dsl.json` / `templateFormat.json`）。

## E2E 検証（仮ゴールド期待値）
[`../engine/validate_stage2.py`](../engine/validate_stage2.py):
- `extract-source` の `{id, source_location, 原文}` が仮ゴールドと**完全一致**（訳文は空、confidence は比較対象外＝ gold-pair.md の S2 判定に準拠）。
- `extract-template` が DSL 全項目ID `001..012` のプレースホルダを検出、かつ書式（例: タイトル Arial 16pt bold）を取得。
- 現状 **PASS**。実物ゴールド差し替え後もこの検証をそのまま流用する。
