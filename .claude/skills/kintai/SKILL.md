---
name: kintai
description: 勤怠管理。従業員の始業/終業/休憩・有給・出張・欠勤を1日1レコードで記録し、上司への承認申請フロー（下書き→申請中→承認済/否認）と、承認済み勤怠の給与計算・グラフ集計を行う。従業員マスタ（employees）を employeeId / submittedTo で参照する。勤怠の入力・申請・承認・集計を頼まれたら使う。レコードは data/kintai/items/<id>.json（1件1ファイル）。ユーザーは /collections/kintai を開き、「勤怠アプリ」ビューでロール（従業員/上司/人事）を切り替えて打刻・承認・給与表・グラフを操作する。レコード I/O は manageCollection ツール（生の Read/Write/Edit はエスケープハッチ）、スキーマ変更は manageCollection の schemaDocs/getSchema/putSchema。
---

# 勤怠管理（schema-driven collection）

## レコード形状

- `id` — primary key。例: `k-e001-20260713`（`k-<社員ID>-<YYYYMMDD>`）
- `employeeId` — 従業員（employees への ref）
- `employeeName` — 氏名（表示用の非正規化コピー）
- `date` — 勤務日（date, 必須）
- `workType` — 勤務区分 enum: `出勤` / `有給休暇` / `欠勤` / `休日`（必須）
- `businessTrip` — 出張フラグ（boolean）
- `startTime` / `endTime` — 始業・終業（"HH:MM" 文字列。出勤のみ）
- `breakMinutes` — 休憩（分・出勤のみ）
- `workedMinutes` — 実働（分）。アプリが (終業-始業-休憩) で計算して書き込む
- `workedHours` — **derived**（`workedMinutes / 60`）。書き込まない
- `dailyPay` — **derived**（`workedMinutes / 60 * employeeId.hourlyWage`, JPY）。書き込まない
- `status` — 承認状況 enum: `下書き` / `申請中` / `承認済` / `否認`（必須）
- `submittedTo` — 承認申請先（上司の社員ID・employees への ref）
- `approvedBy` — 承認者
- `rejectReason` — 否認理由（否認時のみ）
- `note` — 備考

## 承認フロー

1. 従業員が打刻・入力 → `下書き`
2. 従業員が上司へ申請 → `申請中`（`submittedTo` に上司ID）
3. 上司が承認 → `承認済`（`approvedBy` に上司名）／否認 → `否認`（`rejectReason`）
4. `承認済` レコードのみ人事が給与計算・グラフ集計に使う

## やること

- **追加/更新** — manageCollection putItems。追加は `mode: "create"`、一部更新は `mode: "merge"`。
- **一覧/参照** — manageCollection getItems（derived の workedHours/dailyPay は getItems でのみ見える）。
- **削除** — レコードファイルを削除。
- **スキーマ変更** — manageCollection schemaDocs → getSchema → putSchema。
- derived（`workedHours` / `dailyPay`）は絶対に書き込まない。

## メモ

- 所定労働は1日8時間（480分）。480分超が時間外。残業代の支給条件は後日実装（今は実働・時間外を表示のみ）。
- ロール別の閲覧制御（承認UIは上司のみ・人事管理表は人事のみ）は「勤怠アプリ」ビュー内のロール切替で表現（本環境に本物の認証はない）。
