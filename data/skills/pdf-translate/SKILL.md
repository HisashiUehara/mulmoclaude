---
name: pdf-translate
description: 日本語の図面PDFの指定箇所だけを英訳し、元の位置に赤字でオーバーレイした新しいPDFを生成する。「図面名を英訳して」「右下の注記を訳して入れて」「凡例も訳して」のようなチャット指示で、該当する日本語と座標をPDFから抽出→英訳→赤字で重ねる。「2つ目は消して」「もっと右に置いて」などの修正指示にも対応。図面PDFの英訳・注釈・オーバーレイを頼まれたらこの skill を使う。ジョブは `図面英訳ジョブ` コレクション（slug: pdf-translate, `/collections/pdf-translate`）で一覧管理する。レコードは `data/pdf-translate/items/<id>.json`、record I/O は `manageCollection` ツール、スキーマ変更は `manageCollection` の `schemaDocs`/`getSchema`/`putSchema`。
---

# pdf-translate — 図面PDFのチャット駆動 英訳オーバーレイ

日本語図面PDFの**必要な箇所だけ**を英訳し、元の位置に赤字で重ねた新PDFを出す。
翻訳は Claude（あなた自身）が直接行う（外部APIキー不要）。抽出は pdfplumber、
描画は reportlab+pypdf。元コードは github.com/HisashiUehara/pdf_annotator から流用。

## 状態モデル（重要）

各PDFジョブは1つの **ステートJSON** を持つ。注釈の配列で、これが唯一の真実。
- 追加 = 配列に足す / 削除 = 取り除く / 移動・修正 = bbox や text を書き換える
- 変更のたびにステートJSONから**丸ごと再レンダー**する（累積編集・修正が自然にできる）

保存場所:
- ステート: `data/skills/pdf-translate/jobs/<slug>.json`
- 出力PDF: `artifacts/documents/<YYYY>/<MM>/<slug>-annotated.pdf`
- コレクションのレコード: `data/pdf-translate/items/<slug>.json`（`図面英訳ジョブ` コレクション）

## コレクション（図面英訳ジョブ）

各PDFジョブは `図面英訳ジョブ` コレクション（slug: `pdf-translate`, `/collections/pdf-translate`）の
1レコードとして一覧される。`<slug>` = レコードの `id` = ステートJSONのファイル名で対応づく。

レコードのフィールド:
- `id` — ジョブ slug（例 `a-101-plan`）
- `title` — 図面名 / ラベル
- `status` — `作業中` / `レビュー` / `完了`
- `sourcePdf` — 元PDFのパス（file, クリックで開く）
- `outputPdf` — 英訳オーバーレイPDFのパス（file, クリックで開く）
- `annotationCount` — 注釈数 / `pageCount` — ページ数
- `notes` — メモ / `updatedAt` — 更新日

**レンダーのたびにレコードも更新する**（`manageCollection` putItems）:
- 新規ジョブ → `mode: "create"` で1件作成（status=`レビュー`）
- 既存ジョブの追記/修正 → `mode: "merge"` で annotationCount / updatedAt / status を更新
- 計算フィールドは無いので全フィールド書いてよい。derived/embed も無い。

コレクションのボタン:
- ヘッダ「新しい図面を英訳」→ `templates/new-job.md`（office ロールで新規ジョブ）
- レコード詳細「追記・修正を依頼」→ `templates/edit-job.md`（office ロールで既存ジョブ編集）

`<slug>` は元PDFのファイル名ベースの短い識別子（例 `a-101-plan`）。
同じPDFへの続きの指示では**同じ slug のステートを読み込んで更新**する。

### ステートJSON の形

```json
{
  "source_pdf": "data/attachments/2026/07/xxxx.pdf",
  "annotations": [
    {
      "id": 1,
      "page": 0,
      "bbox": [x0, top, x1, bottom],
      "text": "Drawing Name: First Floor Plan",
      "source_ja": "図面名称：一階平面図",
      "color": "red",
      "kind": "text"
    }
  ]
}
```

- `bbox` は **pdfplumber の TOP原点座標**（左上=原点, x右, y下）。単位は PDF ポイント。
- `text` は描画する英訳。bbox幅にフォントを自動フィット（高さで上限）。
- `color` は `red`（既定）/`blue`/`green`/`black`。
- `id` は注釈ごとにユニーク。削除・移動指示で参照する。

## 実行環境

このディレクトリの venv を使う（依存は導入済み: pdfplumber, pypdf, reportlab, pypdfium2）。
```
data/skills/pdf-translate/.venv/bin/python
```
venv が無ければ:
```
python3 -m venv data/skills/pdf-translate/.venv
data/skills/pdf-translate/.venv/bin/pip install pdfplumber pypdf reportlab pypdfium2
```

## フロー

### A. 新規の英訳オーバーレイ（例:「図面名を英訳して赤字で載せて」）

1. **抽出** — 添付PDFのパス（`[Attached file: ...]` から）を渡す:
   ```
   .venv/bin/python scripts/extract.py <pdf_path>            # 全ページ
   .venv/bin/python scripts/extract.py <pdf_path> --page 0   # 特定ページのみ（多ページで高速）
   ```
   → 日本語 span の一覧（id, text, bbox, page_size, rel_pos）が JSON で返る。

2. **該当箇所を特定** — ユーザーの指示 + 各 span の text と rel_pos から、訳す span を選ぶ。
   図面ドメインのヒント:
   - **図面名称/図面名** はタイトルブロック内 → 右下または下辺（rel_pos の y が 1.0 近く、x は右寄り）。
   - 図面本体に散在する部品・仕様ラベル（例「ケーブル配線支持」）は図面名ではない。
   - **注記** は下部、**凡例** は本体中の記号説明。指示語（「右下の」等）は rel_pos で判断。

3. **英訳** — 選んだ span を自然な英語に訳す（あなたが直接）。ラベル部分（「図面名称：」等）も
   訳語を付けると分かりやすい（"Drawing Name: ..."）。

4. **配置を決める** — 既定は **元行のすぐ下** に置く（日本語に被せず読みやすい）:
   `bbox = [x0, source_bottom+2, x0+幅, source_bottom+2+行高]`。幅は訳文が収まる程度に広げてよい。
   ユーザーが「元の位置に重ねて」と言えば source の bbox をそのまま使う。

5. **ステート更新** — `jobs/<slug>.json` を読み（無ければ新規作成）、`annotations` に追記。
   `id` は既存最大+1。`source_pdf` は元PDFのパス。

6. **レンダー**:
   ```
   .venv/bin/python scripts/render.py jobs/<slug>.json artifacts/documents/<YYYY>/<MM>/<slug>-annotated.pdf
   ```

7. **プレビュー確認**（任意だが推奨） — 出力を PNG 化して自分で見て、位置・色を確認:
   ```
   .venv/bin/python -c "import pypdfium2 as x; d=x.PdfDocument('<out.pdf>'); d[0].render(scale=1.5).to_pil().save('/tmp/preview.png')"
   ```
   Read で /tmp/preview.png を見て、ズレていれば bbox を直して再レンダー。

8. **提示** — 出力PDFを Markdown リンクで返す:
   `[<slug>-annotated.pdf](artifacts/documents/2026/07/<slug>-annotated.pdf)`

### B. 続きの追記（例:「凡例も訳して」）

同じ slug のステートを読み、手順1–7 を繰り返して annotation を足すだけ。
元PDFは変えず、ステートに積み上げて再レンダーするので同じPDFに注釈が増えていく。

### C. 修正指示

- 「2つ目は要らない、消して」 → 該当 `id` の annotation を配列から削除 → 再レンダー。
- 「もっと右に置いて」 → その annotation の bbox の x0/x1 を増やす（例 +40pt）→ 再レンダー。
- 「下にずらして」 → top/bottom を増やす（y は下向き）。「上」なら減らす。
- 「色を青に」 → `color` を変更。
- 「訳を〜に直して」 → `text` を変更。
どれもステートJSONを書き換えて `render.py` を再実行するだけ。

## 制約・注意

- **画像のみのスキャンPDFは対象外**（テキストが抽出できない）。extract の spans が空なら
  その旨を伝える（OCRが別途必要）。
- 縦書きテキストは word 抽出が乱れることがある。ズレたら bbox を手で調整。
- フォントは Helvetica-Bold（英字向け）。訳文は英語前提。
- 将来拡張: `kind` に `arrow`/`box` を足して矢印・囲みマークアップに対応予定（現在は `text` のみ）。

## 動作確認済み

`scripts/extract.py` + `scripts/render.py` で「図面名を英訳して赤字で載せる」が
1発で通ることを疑似図面PDFで検証済み（元の日本語を保持し、英訳を直下に赤字で重ねる）。
