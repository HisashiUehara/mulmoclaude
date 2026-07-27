---
name: employees
description: 従業員マスタ。社員の氏名・部署・区分（一般社員/上司/人事）・承認者（上司）・時給を管理する。勤怠管理（kintai）コレクションが employeeId / supervisorId でここを参照する。社員の追加・変更・一覧を頼まれたら使う。レコードは data/employees/items/<id>.json（1件1ファイル）。ユーザーは /collections/employees で閲覧。レコード I/O は manageCollection ツール（生の Read/Write/Edit はエスケープハッチ）、スキーマ変更は manageCollection の schemaDocs/getSchema/putSchema。
---

# 従業員マスタ（schema-driven collection）

## レコード形状

- `id` — 社員ID（primary key・ファイル名）。例: `e001`
- `name` — 氏名（必須）
- `department` — 部署
- `role` — 区分 enum: `一般社員` / `上司` / `人事`（必須）
- `supervisorId` — 承認者（上司）。employees への ref
- `hourlyWage` — 時給（money, JPY）
- `email` — メール

## やること

- **追加/更新** — manageCollection putItems。追加は `mode: "create"`、一部更新は `mode: "merge"`。
- **一覧/参照** — manageCollection getItems。
- **削除** — レコードファイルを削除。
- **スキーマ変更** — manageCollection schemaDocs → getSchema → putSchema。

## メモ

- `role` が `人事` の社員は勤怠アプリの人事管理ビューを閲覧できる。
- `role` が `上司`（および部下を持つ人事）は承認ビューを閲覧できる。
- `supervisorId` は勤怠の承認申請先（submittedTo）を決める。
