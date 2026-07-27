---
name: wishlist
description: 個人のほしい物リスト。ユーザーが買いたい物・欲しい物の追加・一覧・編集・削除・購入済みへの変更を頼んだら使う。品名・カテゴリ・優先度・価格(概算)・ステータス(ほしい/検討中/購入済み)・商品URL・メモを管理する。レコードは data/wishlist/items/<id>.json（1件1ファイル）。ユーザーは /collections/wishlist で一覧・カンバン表示する。レコード I/O は manageCollection ツール（生の Read/Write/Edit はエスケープハッチ）、スキーマ変更は manageCollection の schemaDocs/getSchema/putSchema。
---

# ほしい物リスト（schema-driven collection）

## レコードの形

- `id` — kebab-case のスラッグ。主キー（拡張子なしのファイル名）
- `name` — 品名（必須）
- `category` — カテゴリ enum: PC・家電 / バッグ / ファッション小物 / その他
- `priority` — 優先度 enum: 高 / 中 / 低
- `price` — 価格の概算（円、money型）。不明なら省略
- `status` — ステータス enum: ほしい / 検討中 / 購入済み（必須）
- `purchased` — 「購入済み」トグル（status の projection、書き込まない）
- `url` — 商品URL/リンク
- `notes` — メモ（スペックや理由など）

## 操作

**追加 / 更新** — `manageCollection` putItems。追加は `mode: "create"`（id 衝突を検出）、
一部だけ更新は `mode: "merge"` で `{ id, 変更フィールド }`（デフォルト upsert はレコード全体を置換するため他フィールドが消える）。
`purchased` は computed なので書き込まない。
**一覧 / 参照** — `manageCollection` getItems。
**削除** — レコードファイルを削除。
**スキーマ変更** — `manageCollection` の schemaDocs / getSchema / putSchema。

追加・更新後は `presentCollection`（slug と、単体なら id）でインライン表示する。
チャットに全件を書き出さない。
