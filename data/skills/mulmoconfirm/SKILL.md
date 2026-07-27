---
name: mulmoconfirm
description: >-
  MulmoConfirm — 確認作業（照合・検証・レビュー）を汎用的に扱う「Confirmation OS」。
  確認を6要素（目的・基準・対象・照合・判断・証跡）で構造化し、AIが計画を起案 →
  人間が承認 → エンジンが照合を実行 → 人間が最終判断して証跡を確定する。
  データセンター建設PMのIST試験成績書確認や単線結線図As-built差分確認が主用途だが、
  確認対象は限定しない。ユーザーが「確認したい」「照合して」「レビューして」と
  ファイルを渡してきたとき、または確認案件の一覧・編集を頼まれたときに使う。
  レコードは data/mulmoconfirm/items/<id>.json（1件1レコード = 1確認案件）。
  ユーザーは /collections/mulmoconfirm の「差分テーブル」ビューで結果を見て最終判断する。
  レコード I/O は manageCollection ツール（生の Read/Write/Edit はエスケープハッチ）、
  スキーマ変更は manageCollection の schemaDocs/getSchema/putSchema。
---

# MulmoConfirm（Confirmation OS 第一弾）

確認作業は必ず次の **6要素** で構成される。1レコード = 1確認案件 = 1つの Confirmation DSL インスタンス。

1. **目的**（`purpose`）— 何のために確認するか
2. **基準**（`criteria`）— 何と照らすか。**必ず出典（`source`）をつける**
3. **対象**（`targets`）— 確認するファイル群
4. **照合**（`checks`）— AI が実行。差分テーブル（基準/期待値/実測値/判定/根拠箇所）
5. **判断**（`checks[].humanVerdict` と `status: 証跡確定`）— **人間だけが行う**
6. **証跡**（`auditLog`）— 全プロセスを記録として残す

## 動作フロー（この順を厳守）

1. **起案** — ユーザーが自然言語で依頼＋ファイルを渡す。AI が `purpose` / `criteria`（出典つき）/ `targets` を起案し、`status: 起案中` でレコードを作成。`auditLog` に「計画起案」を追記。
   - 起案したら `presentForm` で計画（目的・基準・対象）を人間に提示し、承認を得る。
2. **計画承認** — 人間が承認したら `status: 計画承認済`、`planApprovedBy` を記録、`auditLog` に「計画承認」を追記。**承認前に照合してはならない。**
3. **照合実行** — 承認後にのみ、対象ファイルを読んで `checks` を埋める。各行に `aiVerdict`（pass / fail / unclear の3値）と `evidence`（根拠箇所）を必ず入れる。埋め終えたら `status: 照合済`、`auditLog` に「照合実行」を追記。
4. **最終判断・証跡確定** — 人間が「差分テーブル」ビュー（`/collections/mulmoconfirm`）で fail→unclear→pass 順に確認し、各行の `humanVerdict` を決め、`status: 証跡確定` にする。**この確定操作は人間がビューから行う。**

## 判定の3値ルール（`aiVerdict`）

- `pass` — 期待値と実測値が一致し、**根拠箇所がある**もの
- `fail` — 期待値と実測値が食い違うと根拠から言えるもの
- `unclear` — 判定できないもの。**根拠のないものは必ず `unclear`**

## 禁止事項（絶対に守る）

- ❌ AI が最終判断を確定させること（`humanVerdict` を「未判断」以外にする / `status: 証跡確定` にする）。AI は候補までしか出せない。
- ❌ 根拠箇所（`evidence`）なしの `pass`。根拠がなければ `unclear`。
- ❌ `unclear` の握りつぶし（`unclear` を黙って `pass` にする / 一覧から落とす）。

## Record shape

- `id` — 案件スラグ（primary、ファイル名）
- `title` — 案件名（required）
- `status` — 起案中 / 計画承認済 / 照合済 / 証跡確定（required）。**AI は「証跡確定」を書かない**
- `purpose` — 目的
- `criteria[]` — { item, expected, source }。source（出典）必須
- `targets[]` — { name, path, kind }
- `checks[]` — { criterion, expected, actual, aiVerdict(pass/fail/unclear), evidence, humanVerdict, note }。**AI は humanVerdict を「未判断」で初期化し、以後触らない**
- `planApprovedBy` / `confirmedBy` / `confirmedAt` — 人間が記録
- `auditLog[]` — { when, who, action, detail }。各ステップで追記

## What to do

**追加 / 更新** — `manageCollection` putItems。`mode: "create"` で新規、`mode: "merge"`（部分更新）で既存の一部フィールドだけ更新（デフォルトの upsert は全置換で他フィールドが消える）。書き込み前にスキーマ検証され、`rejected` 行は `problem` を見て直して再送。
**一覧 / 参照** — `manageCollection` getItems。
**削除** — レコードファイルを削除。
**スキーマ変更** — `manageCollection` の schemaDocs / getSchema / putSchema。生の schema.json 編集は不可。

書き込み後は `presentCollection`（slug と id）でインラインに提示し、⚠️ が返ったら直す。
