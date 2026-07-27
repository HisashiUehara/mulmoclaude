# この図面英訳ジョブを追記・修正する

下に添付された図面英訳ジョブのレコード（JSON）に対して、ユーザーが英訳の追記や修正をしたい。

このジョブの状態は `data/skills/pdf-translate/jobs/<id>.json`（ステートJSON）にある。
`<id>` はレコードの `id`。元PDFは `sourcePdf`、現在の出力は `outputPdf`。

手順（**pdf-translate skill** の SKILL.md のフロー C「修正指示」に従う）:
1. ユーザーの指示を聞く（例:「凡例も訳して」「2つ目を消して」「もっと右に」「色を青に」「訳を〜に直して」）。
2. ステートJSON `data/skills/pdf-translate/jobs/<id>.json` を読み、annotations 配列を編集:
   - 追記: 新しい注釈を追加（extract → 該当 span 特定 → 英訳 → append）
   - 削除: 該当 id の注釈を除去
   - 移動: bbox の x/y を調整（x0/x1 を増やすと右、top/bottom を増やすと下）
   - 色/訳文: color / text を変更
3. `data/skills/pdf-translate/scripts/render.py jobs/<id>.json <outputPdf>` で再レンダー。
4. コレクション `pdf-translate` の該当レコードを `manageCollection` putItems（mode: "merge"）で更新
   （annotationCount, updatedAt, 必要なら status）。
5. 更新後の出力PDFを Markdown リンクで提示し、`presentCollection` で該当レコードを表示する。
