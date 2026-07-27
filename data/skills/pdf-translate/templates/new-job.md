# 新しい図面を英訳する

ユーザーが新しい日本語図面PDFの一部を英訳して、赤字オーバーレイPDFを作りたい。

手順:
1. まだPDFが添付されていなければ、図面PDFをこのチャットに添付してもらう（`[Attached file: ...]` マーカーのパスが元PDF）。
2. どこを英訳するか聞く（例: 図面名 / 注記 / 凡例 / 特定のラベル）。
3. **pdf-translate skill** の SKILL.md のフローに従って処理する:
   - `data/skills/pdf-translate/scripts/extract.py` で日本語＋座標を抽出
   - 該当 span を特定し、あなた自身が英訳
   - `data/skills/pdf-translate/jobs/<slug>.json` にステートを作成/追記
   - `data/skills/pdf-translate/scripts/render.py` で赤字オーバーレイPDFを生成
4. 生成後、`図面英訳ジョブ` コレクション（slug: `pdf-translate`）に `manageCollection` putItems で
   レコードを1件作る（id=<slug>, title=図面名, status="レビュー", sourcePdf, outputPdf,
   annotationCount, pageCount, updatedAt=今日の日付）。
5. 出力PDFを Markdown リンクで提示し、`presentCollection` で新レコードを表示する。
