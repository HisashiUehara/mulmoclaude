---
name: weekly-report
description: >-
  WeeklyReport — 施工業者の週次レポート（日本語）を、テナント向け英文レポートに変換する
  「AI → DSL → engine」パイプライン。AIは翻訳のみ、原文抽出・書式抽出・テンプレートへの
  流し込みはコード(engine)、日英の確認と承認は人間が行う。ユーザーが「週報を英訳して」
  「テナント用レポートを作って」と業者レポート＋テンプレートを渡してきたとき、または
  変換案件の一覧・確認・承認・出力を頼まれたときに使う。1レコード = 1変換案件。
  レコードは data/weekly-report/items/<id>.json（1件1ファイル）。ユーザーは
  /collections/weekly-report で一覧・確認する。詳細は docs/ 配下（スキーマ・ゴールドペア・
  確認UI仕様）を参照。レコード I/O は manageCollection ツール（生の Read/Write/Edit は
  エスケープハッチ）、スキーマ変更は manageCollection の schemaDocs / getSchema / putSchema。
---

# WeeklyReport（AI → DSL → engine パイプライン）

施工業者の日本語週次レポートを、テナント向け英文レポートへ機械的に変換する。
**役割分担を厳守する** — AIは翻訳のみ、転記と書式はコード、承認は人間。

## 目的と設計思想
- **AI** = 「原文 → 訳文」の翻訳だけ。書式・レイアウト・転記には触れない。
- **DSL** = AIとengineをつなぐ中間表現。1項目 = { `id`, `source_location`, `原文`, `訳文`, `confidence` }。
- **engine（コード）** = 原文抽出・書式抽出・テンプレートへの流し込み。転記ミスを構造的に防ぐ。
- **人間** = ステップ5で日英を横並び確認し承認。**ここで必ず停止する。**

## ワークフロー概要（6段・この順を厳守）
| # | 主体 | 内容 | ステータス |
|---|------|------|-----------|
| 1 | 人間 | 元ファイル2つを入力（業者レポート + テナント用テンプレート） | `入力待ち` |
| 2 | engine | テンプレートの書式（フォント/サイズ/配置）を抽出 | `抽出済` |
| 3 | engine | 業者レポートから原文を抽出し DSL の `items[]`（原文）を生成 | `抽出済` |
| 4 | AI | 各項目を翻訳し `訳文` と `confidence`(high/low) を埋める | `翻訳済`→`承認待ち` |
| 5 | **人間** | 日英を横並びで確認・承認。**必ず停止** | `承認済` |
| 6 | engine | 承認済みDSLのみをテンプレートに流し込み完成ファイルを出力 | `完成` |

## 詳細ドキュメント（段階的開示 — 必要時に参照）
- **スキーマ定義**（DSL＋コレクション＋ステータス遷移＋confidence基準） → [`docs/schema.md`](docs/schema.md)
- **ゴールドペア**（E2E期待値。理想の完成レポート＋対応DSL、各Stageでの当て方） → [`docs/gold-pair.md`](docs/gold-pair.md)
- **ゴールド取込パイプライン**（実物→サニタイズ済みゴールド。抽出=コード/サニタイズ=AI/承認=人間） → [`docs/gold-import-pipeline.md`](docs/gold-import-pipeline.md)
- **サニタイズ漏れチェックリスト**（承認画面の判定項目6カテゴリ） → [`docs/sanitize-checklist.md`](docs/sanitize-checklist.md)
- **Stage 2 エンジン**（書式抽出・原文抽出→DSL化。ダミー入力・E2E検証） → [`docs/stage2-engine.md`](docs/stage2-engine.md)
- **確認UI仕様**（ステップ5：日英横並び・low強調・承認ボタン。Stage 4で実装） → [`docs/confirm-ui.md`](docs/confirm-ui.md)
- **DSL正準定義**（JSON Schema） → [`dsl/weekly-report.dsl.schema.json`](dsl/weekly-report.dsl.schema.json)
- **ゴールドペア実体（仮ゴールド）** → [`fixtures/gold/ideal-report.md`](fixtures/gold/ideal-report.md) ＋ [`fixtures/gold/expected.dsl.json`](fixtures/gold/expected.dsl.json)
  - ※現行は自作の**仮ゴールド**。実物を `import/` に投入しパイプラインを回すと、この出力で差し替える。
- **engine（コード担当）** → [`engine/pipeline.py`](engine/pipeline.py)（`extract` / `apply` / `scan`）、[`engine/requirements.txt`](engine/requirements.txt)

## ゴールドは実物取込で作る（自作しない）
ゴールドペアは実物レポートから取り込む。手順: `import/` に実物(.xlsx/.pptx)を置く → engine が
書式・構造を保ったままテキストだけ架空化し、**既定で全画像を架空プレースホルダへ差替え**（`--keep-images`
で保持時は画像ごとに目視確認） → サニタイズ漏れチェックリストを提示し**承認まで停止** →
承認後に実物を削除。詳細は [`docs/gold-import-pipeline.md`](docs/gold-import-pipeline.md)。
**Stage 5 の一致判定は「テキスト内容 + 書式」の両方**を対象とする。

> **パイプラインは完成・凍結**（NDA確認待ち）。実物投入後に仮ゴールドを差し替える。

## 制約（絶対に守る／詳細は docs/schema.md）
- ステップ5の承認をスキップする自動実行モードは作らない。
- 実データは使わない。NDA完了まではゴールドペア／自作ダミーでE2Eを通す。
- AI は転記・書式・レイアウトを決めない。`confidence: low` を握りつぶさない。

## What to do（レコード操作）
- **追加/更新** — `manageCollection` putItems。新規=`mode:"create"`、部分更新=`mode:"merge"`（`{ id, <変更> }`。upsertは全置換注意）。`rejected` 行は `problem` を見て直す。
- **一覧/参照** — `manageCollection` getItems。
- **削除** — レコードファイルを削除。
- **スキーマ変更** — `manageCollection` の schemaDocs / getSchema / putSchema（生の schema.json 編集は不可）。
- 書き込み後は `presentCollection`（slug と id）で提示し、⚠️ が返ったら直す。

## 実装ステージ（各段階で停止して報告）
- **Stage 1** — SKILL.md + DSLスキーマ定義 + ゴールドペア ← ✅
- **ゴールド取込パイプライン** — 実物→サニタイズ済みゴールド ← ✅ 完成・凍結（NDA確認待ち）
- **Stage 2** — ステップ2-3の engine（書式抽出・原文抽出→DSL化）+ ダミーデータ ← ✅（[`docs/stage2-engine.md`](docs/stage2-engine.md)。仮ゴールドで E2E PASS）
- **Stage 3** — ステップ4の AI 翻訳
- **Stage 4** — ステップ5の確認UI（[`docs/confirm-ui.md`](docs/confirm-ui.md) 準拠）
- **Stage 5** — ステップ6の流し込み engine、E2Eテスト（ゴールドペアで検証）
