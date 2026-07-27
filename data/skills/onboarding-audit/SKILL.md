---
name: onboarding-audit
description: New Starter オンボーディングの「変更監査ログ」を集約するコレクション。
  new-starter 各タスクの history（status/owner/dueDate の変更）を 1イベント=1レコードに
  平坦化して蓄積し、担当者別・項目別の横断集計や、将来の「頻出差分→テンプレ反映提案」の
  土台にする。監査ログの同期・閲覧・集計を頼まれたら使う。書込は ingest agent 同期のみ
  （ビューやユーザーからの直接編集は想定しない）。レコードは
  data/onboarding-audit/items/<id>.json（1件1ファイル）。ユーザーは
  /collections/onboarding-audit で閲覧し、ヘッダの Refresh で同期する。レコード I/O は
  manageCollection ツール（生の Read/Write/Edit はエスケープハッチ）、スキーマ変更は
  manageCollection の schemaDocs/getSchema/putSchema。
---

# オンボーディング監査ログ（schema-driven collection）

## Record shape（1レコード = 1変更イベント）

- `id` — 決定的ID `<taskId>__<epochms>__<field>`（冪等同期のキー。同じ history 由来なら常に同じID）
- `at` — 変更日時（datetime。history エントリの `at` をそのまま）
- `actor` — 操作者（history の `actor`。識別限界により既定は「Office Manager」）
- `starter` — 新入社員（元 new-starter レコードの `starter`）
- `taskId` — 元タスクの id（ref → new-starter）
- `taskName` — 元タスク名（`task`）
- `templateTaskId` — 元タスクの `templateTaskId`（横断集計・頻出差分検出用）
- `field` — 変更項目（status / owner / dueDate）
- `fromValue` / `toValue` — 変更前 / 変更後

## 同期（ingest agent, on-demand）

`templates/sync-audit.md` の手順で、new-starter 全レコードの `history` を走査し、
決定的IDで**未登録のイベントのみ**作成する（冪等）。詳細は同ファイル参照。

## What to do

- **同期** — ヘッダ Refresh（ingest）で自動。手動なら templates/sync-audit.md の手順を実行。
- **閲覧・集計** — `manageCollection` getItems。`field` で項目別、`actor`/`starter` で横断集計。
- **書込** — ingest 同期のみ。ユーザー/ビューからの直接編集は行わない。
