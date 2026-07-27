---
name: 図面PDF英訳オーバーレイアプリ (pdf-translate)
description: 日本語図面PDFの指定箇所だけをチャット指示で英訳し赤字オーバーレイする skill
type: fact
---
ユーザーは仕事で日本語図面の一部を英訳して渡す作業が大量にあり自動化したい。
`data/skills/pdf-translate/` に skill を構築した。

- チャット指示（「図面名を英訳して赤字で載せて」「凡例も訳して」「2つ目消して」「右に寄せて」）で操作。
- フロー: `scripts/extract.py`(pdfplumber で日本語語＋座標抽出) → Claude が該当 span を特定＆英訳 → ジョブのステートJSON(`jobs/<slug>.json`)に注釈追記 → `scripts/render.py`(reportlab+pypdf で赤字オーバーレイ) → 新PDF。
- 状態＝ステートJSONの annotations 配列。追加/削除/移動/色/訳文の修正はJSONを書き換えて再レンダー。累積編集OK。
- 翻訳は Claude 自身が実施（ANTHROPIC_API_KEY 不要）。venv は `data/skills/pdf-translate/.venv`。
- 元実装 github.com/HisashiUehara/pdf_annotator（Streamlit+矩形UI版）から抽出・描画ロジックだけ流用。`github/pdf_annotator/` にクローン済み。
- MVP「図面名を英訳して赤字で載せる」は疑似図面PDFで動作検証済み。
- 将来拡張: kind に arrow/box を足して矢印・囲みマークアップ対応予定（現状 text のみ）。スキャンPDF(画像のみ)は対象外。
- コレクション化済み: `図面英訳ジョブ` collection（slug: pdf-translate, `/collections/pdf-translate`）で各ジョブを一覧管理。レコード `data/pdf-translate/items/<id>.json`（fields: id/title/status[作業中/レビュー/完了]/sourcePdf/outputPdf/annotationCount/pageCount/notes/updatedAt）。ヘッダ「新しい図面を英訳」＋レコード「追記・修正を依頼」ボタン（office ロール, templates/new-job.md・edit-job.md）。デモレコード demo-floor-plan 投入済み。レンダーのたびに manageCollection でレコードも更新する運用。
