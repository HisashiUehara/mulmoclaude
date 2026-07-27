---
name: task-list
description: Task一覧表 — Emailや議事録など貼り付けられた文章からTaskを抽出し、承認フロー付きで一覧管理するコレクション。ユーザーが文章（Email本文・議事録・チャットログ等）を貼り付けてTask抽出を依頼したとき、または一覧の閲覧・編集・承認を頼まれたときに使う。レコードは data/task-list/items/<id>.json（1件1ファイル）。ユーザーは /collections/task-list の「Task管理」ビューで一覧表・候補承認・集計グラフを見る。レコード I/O は manageCollection ツール（生の Read/Write/Edit はエスケープハッチ）、スキーマ変更は manageCollection の schemaDocs/getSchema/putSchema。
---

# Task一覧表（schema-driven collection）

Emailや議事録の文章を貼り付けると、LLM（私）が **スキーマを埋めるだけ**。
マージ・集計・描画・承認の反映はすべて **deterministicな engine 側**（ホスト＋
custom view の `views/board.html`）が行う。LLMは判断せず、抽出結果を「候補
(candidate)」として書き込むだけ。承認は人間が custom view で行う。

## Record shape

- `id` — 一意なslug（例 `task-20260710-001`）、primary key（拡張子なしのファイル名）
- `title` — Task名（要約した短い名前）、必須
- `summary` — 元文章の要約（text）
- `category` — enum: `submittal` / `RFI` / `drawing` / `vendor` / `report` / `other`、必須
- `assignee` — 担当者（文章から推定、不明なら **省略**＝null）
- `due_date` — 期限 `YYYY-MM-DD`（文章から推定、不明なら **省略**）
- `priority` — enum: `high` / `mid` / `low`、必須
- `status` — enum: `open` / `in progress` / `done`、必須（新規は必ず `open`）
- `done` — toggle（statusのprojection、書き込まない・ホスト計算）
- `approval` — enum: `candidate` / `approved` / `rejected`、必須（新規抽出は必ず `candidate`）
- `source` — 出典（`email` / `meeting` / `chat` など）
- `received_date` — 受信日 `YYYY-MM-DD`（分かれば）

## 文章からTaskを抽出する手順（AI→DSL→engine）

1. ユーザーが貼り付けた文章を読み、実行すべきTaskを列挙する。
2. 各Taskを上記スキーマの1レコードに変換する。**必ず**:
   - `status` = `"open"`（固定）
   - `approval` = `"candidate"`（固定 — 抽出直後は候補。勝手に approved にしない）
   - 不明な `assignee` / `due_date` はキーごと省略する（空文字を書かない）
3. `id` は衝突しないよう連番付き slug にする（`getItems` で既存を確認してから採番）。
   複数回の貼り付けに対応 — 既存レコードは残したまま **追加** する（横に増える）。
4. `manageCollection` putItems（`mode: "create"`）で書き込む。`rejected` が返ったら
   その `problem` を読んで直し、該当行だけ再送。
5. 書き込み後は `presentCollection`（slug=`task-list`）で結果を提示し、
   「候補として追加しました。`/collections/task-list` の Task管理ビューで承認してください」
   と伝える。⚠️ が返ったら Read→修正→Write で直す。

## その他の操作

- **一覧 / 読み取り** — `manageCollection` getItems（`done` などホスト計算値はこれでしか見えない）。
- **編集 / ステータス変更** — `manageCollection` putItems `mode: "merge"`（`{ id, status }` など変更フィールドのみ）。
  デフォルトの upsert は全フィールドを置換するので、部分更新は必ず merge。
- **承認 / 却下** — 基本はユーザーが custom view のボタンで行う（approval を approved/rejected に更新）。
  チャットで頼まれた場合は merge で `approval` を書き換える。
- **削除** — レコードファイルを削除。
- **スキーマ変更** — `manageCollection` の `schemaDocs` / `getSchema` / `putSchema`。生の hand-edit はしない。

## 制約（重要）

- LLMは **スキーマを埋めるだけ**。集計・マージ・描画・承認の反映は engine（ホスト＋view）が行う。
- 抽出Taskは必ず **候補（candidate）** として登録し、承認は人間に残す（候補→承認→反映）。
- チャットで結果を長々と羅列しない。`presentCollection` で提示する。
