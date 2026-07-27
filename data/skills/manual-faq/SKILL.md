---
name: manual-faq
description: Turner & Townsend KK の社内マニュアルFAQナレッジベース。社員からのマニュアル関連の問い合わせ（勤怠アプリ・経費申請・出張申請/予約・座席予約・プリンター設定など）を Q&A 形式で管理する。社員は `/collections/manual-faq` の「ヘルプデスク」ビューで検索・カテゴリ閲覧して自己解決できる。FAQ の追加・編集を頼まれたらこの skill を使う。レコードは `data/manual-faq/items/<id>.json`（1件1ファイル）。レコード I/O は `manageCollection` ツール（生の Read/Write/Edit はエスケープハッチ）。スキーマ変更は `manageCollection` の `schemaDocs`/`getSchema`/`putSchema`。
---

# 社内マニュアルFAQ（スキーマ駆動コレクション）

社員からよく来る問い合わせを Q&A として蓄積し、社員が自分で検索・閲覧して解決できるようにするナレッジベース。

## レコードの形

- `id` — kebab-case のスラッグ（主キー = ファイル名、拡張子なし）
- `question` — 質問文（1行）。必須
- `category` — `勤怠` / `経費` / `出張` / `設備・予約` / `IT・システム` / `その他` のいずれか。必須
- `answer` — 回答（Markdown 可。手順は番号付きリストで）。必須
- `keywords` — 検索用の別名・言い換え（スペース区切り）。例: 「タイムシート 勤務表 打刻」
- `owner` — 担当部署・問い合わせ先（例: 総務、経理、IT ヘルプデスク）
- `status` — `公開` / `下書き`。社員に見せる前は `下書き`
- `updatedAt` — 最終更新日（YYYY-MM-DD）

## やること

**追加 / 更新** — `manageCollection` putItems。各行はスキーマ検証を通過してから書き込まれる。追加時は `mode: "create"`（ID 衝突を検出）、既存の一部フィールド変更は `mode: "merge"` を使う（デフォルトの upsert はレコード全体を置き換えるので、省略した任意フィールドが消える）。
**一覧 / 参照** — `manageCollection` getItems。
**削除** — レコードファイルを削除。
**スキーマ変更**（フィールド・ビュー追加など）— `manageCollection` の `schemaDocs` → `getSchema` → `putSchema`。`schema.json` を直接編集しない。

追加・更新後は `presentCollection`（slug と id）で該当レコードを表示し、`⚠️` が返ったら Read → 修正 → Write で対応する。

## 運用メモ

- 新しい問い合わせが来て既存 FAQ に無ければ、それを新レコードとして追加していく（ナレッジが育つ）。
- 回答は「手順」を番号付きで、company-specific な詳細（URL・締切日・承認者）は正確な値に随時更新する。
- 社員向けの入口は `/collections/manual-faq` の「ヘルプデスク」ビュー（検索＋カテゴリ閲覧）。
