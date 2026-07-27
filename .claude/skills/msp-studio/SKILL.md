---
name: msp-studio
description: MS Project スケジュールを作成・学習できる「MSP Studio」アプリと、作ったスケジュールを保存・管理するコレクション。ユーザーが工程表・ガントチャート・プロジェクト計画（内装工事/システム開発/イベント/社内プロジェクト等）を作りたい、MS Project(.xml)を書き出したい、MSPの使い方を学びたい、または作ったスケジュールを「コレクションに保存して」と頼んだらこの skill を使う。本体アプリは artifacts/html/2026/07/msp-studio.html。ユーザーは /collections/msp-studio の「MSP Studio を開く」ビューからビルダーを起動し、保存済みスケジュールをクリックすると内容をアプリに読み込んだ状態で開ける。レコードは data/skills/msp-studio/items/<id>.json（1件1ファイル）。レコード I/O は manageCollection ツール（生の Read/Write/Edit はエスケープハッチ）、スキーマ変更は manageCollection の schemaDocs/getSchema/putSchema。
---

# MSP Studio（schema 駆動コレクション）

Microsoft Project 形式(.xml, MSPDI)を書き出せる作成ツール兼学習アプリ。各レコード＝1つのプロジェクトスケジュール。

## 本体アプリ
- `artifacts/html/2026/07/msp-studio.html` — 単体HTML。Build タブ（WBS入力→ガント→XML書き出し）と Learn タブ（初心者向け9レッスン）。
- URL パラメータ:
  - `?data=<base64url(JSON)>` — 保存済みスケジュールを読み込む。JSON は `{ name, start, hours, tasks:[{id,name,level,days,preds,res}] }`。
  - `?view=learn` — Learn タブを開いた状態で起動。
- launcher ビューがレコードから `?data=` を組み立てて開くので、通常は手で URL を作る必要はない。

## レコード shape（`data/skills/msp-studio/items/<id>.json`）
- `id` — kebab-case slug、主キー（ファイル名）
- `title` — プロジェクト名（必須）
- `category` — enum: 内装・建築 / IT・システム / イベント / 社内プロジェクト / その他
- `status` — enum: 下書き / 作業中 / 確定
- `done` — toggle（status を確定/作業中に射影。書き込み不要の投影フィールド）
- `startDate` / `finishDate` — date（YYYY-MM-DD）。カレンダービューの開始/終了に使用
- `workingDays` / `taskCount` / `milestoneCount` / `hoursPerDay` — number
- `tasks` — table。列: `tid`(番号) / `name` / `level`(階層1〜) / `days`(0=マイルストーン) / `preds`("3,4"形式の先行タスクID文字列) / `res`(リソース)
- `app` — file。ビルダーアプリへのパス（全レコード共通で `artifacts/html/2026/07/msp-studio.html`）
- `notes` — text
- `updatedAt` — date

## やること
- **追加 / 更新** — `manageCollection` putItems。行はスキーマ検証されるので `rejected` は `problem` を見て直して再送。追加時は `mode:"create"`（id 衝突を拒否）、一部フィールドだけ変えるときは `mode:"merge"` で `{id, 変更フィールド}`。`done` は toggle 投影なので書き込まない。
- **一覧 / 参照** — `manageCollection` getItems。
- **削除** — レコードファイルを削除。
- **スキーマ変更** — `manageCollection` の `schemaDocs`/`getSchema`/`putSchema`（生の schema.json 編集はしない）。
- 追加・更新後は `presentCollection`（slug と id）でインライン表示し、⚠️ が返ったら Read→修正→Write。

## 運用メモ
- ユーザーがアプリでスケジュールを作り「保存して」と言ったら、その内容（プロジェクト名・開始日・タスク一覧）を聞き取り、`tasks` table に落として1レコード作成する。開始日と日数から `startDate`/`finishDate`/`workingDays`/`taskCount`/`milestoneCount` を算出して埋める。
- サンプル `fit-out-schedule`（内装工事24タスク）を投入済み。
