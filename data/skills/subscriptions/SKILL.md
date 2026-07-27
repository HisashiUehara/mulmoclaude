---
name: subscriptions
description: サブスク断捨離・節約トラッカー。ユーザーがサブスク/定期課金の見直し・解約・節約額の可視化を求めたら使う。1レコード = 1サービス（月額・分類・ステータス）。ステータスは 継続/解約予定/解約済み で、解約予定=残タスク・解約済み=削減達成。レコードは data/subscriptions/items/<id>.json（1件1ファイル）。ユーザーは /collections/subscriptions の「節約ダッシュボード」ビューで、月間/年間削減額・Before→After・解約チェックリストを見る。レコード I/O は manageCollection ツール（生の Read/Write/Edit はエスケープハッチ）、スキーマ変更は manageCollection の schemaDocs/getSchema/putSchema。
---

# サブスク断捨離（節約アプリ）

## レコードの形（1サービス1ファイル）

- `id` — 主キー（例: `claude-max`）。ファイル名。
- `name` — サービス名。必須。
- `group` — 分類（enum: AI系 / エンタメ・生活）。必須。
- `status` — 継続 / 解約予定 / 解約済み。必須。**解約予定=残タスク、解約済み=削減達成**。
- `done` — トグル（status の projection）。チェックで解約済み、外すと解約予定。
- `monthlyCost` — 月額(円, JPY money)。必須。年払いは月割換算して入れる。
- `annualCost` — 月額×12（derived, 書き込まない）。
- `billing` — 課金サイクル（月払 / 年払月割 / 従量 等）。
- `rawCost` — 元の課金表記（例: `$110 ≒ 17,050円`）。
- `howto` — 解約手順・メモ。

## 節約ロジック（ダッシュボードが計算）

- Before（見直し前の総額）= 全レコードの monthlyCost 合計
- After（見直し後）= status「継続」の合計
- 削減達成 = status「解約済み」の合計 / 削減見込み = status「解約予定」の合計
- 月間削減額 = 達成 + 見込み、年間削減額 = ×12

## やること

- **サービス追加/更新** — `manageCollection` putItems。年払いは月割で monthlyCost に。
- **解約する** — status を「解約予定」→ 実行後「解約済み」。ダッシュボードのチェックでも可。
- **一覧/表示** — `manageCollection` getItems、または `presentCollection`。
- **スキーマ変更** — `manageCollection` の schemaDocs / getSchema / putSchema。

解約予定のレコードはベル通知で残タスクとして追跡され、解約済みにすると消える。
ダッシュボードは `/collections/subscriptions` の「節約ダッシュボード」。実際の月次支出内訳は別コレクション `spending`（/collections/spending）で管理。
