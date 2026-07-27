---
name: new-starter-templates
description: New Starter オンボーディングの「標準タスクテンプレート」（正典19タスク）を
  データとして管理するコレクション。new-starter コレクションの各タスクはこの
  テンプレ行を templateTaskId で参照する。テンプレの改訂（タスク文面・既定担当ロール・
  期限オフセットの変更、version の更新）や、標準タスクの追加・廃止を頼まれたら使う。
  レコードは data/new-starter-templates/items/<id>.json（1件1ファイル）。ユーザーは
  /collections/new-starter-templates で閲覧する。レコード I/O は manageCollection
  ツール（生の Read/Write/Edit はエスケープハッチ）、スキーマ変更は manageCollection の
  schemaDocs/getSchema/putSchema。
---

# New Starter テンプレート（schema-driven collection）

## Record shape（1レコード = 標準タスク1件）

- `id` — `tpl-01`〜`tpl-19` 形式の primary key
- `seq` — 表示順（1〜19）
- `phase` — 入社前 / 初日 / 最初の1週間〜1ヶ月（必須）
- `category` — アカウント・IT関係 / 物品 / 事務手続き / 初日オリエン / 研修・フォロー
- `task` — 正典タスク名（必須）
- `detail` — 補足
- `defaultOwnerRole` — 既定の担当**ロール**（人事担当/総務担当/配属PJマネージャー等）。個人名ではない
- `requestTo` — 依頼先（例: IT部門）
- `dueOffsetDays` — 入社日基準の相対日数（負=入社前）。クローン時に実 dueDate を計算する
- `version` — テンプレ行の版（必須）。文面等を改訂したら +1 する
- `active` — 有効 / 廃止（必須）

## What to do

**改訂** — 正典項目（task/detail/phase/category/defaultOwnerRole/requestTo/dueOffsetDays）を
変更したら `version` を +1 する。`manageCollection` putItems `mode: merge`。
**追加** — 新しい標準タスクは `tpl-NN`（NN は連番）で `version: 1` `active: 有効` を作成。
**廃止** — `active: 廃止` に変更（レコードは削除しない）。
**反映** — 改訂後、new-starter 側へは collectionAction「テンプレ改訂を全員へ反映」で伝播する
（overridden=true の個人レコードはスキップ）。

new-starter の各タスクは `templateTaskId` でこの行を参照し、`templateVersion` に同期時点の
`version` を持つ。`templateVersion < 現行 version` かつ overridden=false のレコードが反映対象。
