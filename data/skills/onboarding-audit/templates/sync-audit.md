# オンボーディング監査ログ 同期手順（ingest agent）

new-starter 各タスクの `history`（status/owner/dueDate の変更記録）を、onboarding-audit に
1イベント=1レコードで平坦化・集約する。**冪等**（何度実行しても重複を作らない）に行うこと。
終わったら黙って停止する（このワーカーのキャンバスは誰も見ていない。何も present しない）。

## 手順

1. `manageCollection` getItems（slug: `new-starter`, fields: `starter,task,templateTaskId,history`）で
   全タスクを取得する。
2. `manageCollection` getItems（slug: `onboarding-audit`, fields: `id`）で既存の監査レコードIDを取得し、
   Set にしておく（冪等判定用）。
3. 各タスクの `history` 配列の各エントリ `e` について、監査レコードを1件組み立てる：
   - **決定的ID** = `<taskId>__<epochms>__<field>`
     - `epochms` = エントリ `at`（`YYYY-MM-DDTHH:MM`、**秒は00**）を **Asia/Tokyo** として解釈した Unix エポック**ミリ秒**（決定的に。現在時刻の秒で埋めないこと）。
   - `at` = `e.at`
   - `actor` = `e.actor`（空なら "Office Manager"）
   - `starter` = そのタスクの `starter`
   - `taskId` = そのタスクの id
   - `taskName` = そのタスクの `task`
   - `templateTaskId` = そのタスクの `templateTaskId`（無ければ空）
   - `field` = `e.field`
   - `fromValue` = `e.from` / `toValue` = `e.to`
4. **既存Setに無いIDだけ**を `manageCollection` putItems（slug: `onboarding-audit`, mode: `create`）で作成する。
   （`mode: create` は既存IDを弾くため、取りこぼしと二重登録の両面で安全。rejected は「既に同期済」を意味し無害。）
5. 作成件数を1行ログして停止する。何も present しない。

## 注意 / 既知の限界

- 同一タスクの同一 `field` を**同一分**（同じ `YYYY-MM-DDTHH:MM`）に複数回変更した場合、決定的IDが衝突し
  1件に集約される（history は分単位精度のため）。実用上まれ。将来、秒精度化または連番付与で解消予定。
- actor はビュー側の識別限界により既定「Office Manager」。将来ホストが操作者IDを提供したら置換。
- onboarding-audit への書込はこの同期のみ。ユーザー/ビューからの直接編集はしない。
