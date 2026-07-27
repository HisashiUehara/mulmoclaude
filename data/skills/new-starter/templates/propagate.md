# テンプレ改訂を全員へ反映（propagate）

new-starter-templates（標準タスク）の改訂を、new-starter の各新入社員のタスクへ伝播する。
**正典項目のみ**同期し、運用項目は決して触らない。overridden=true は保護してスキップする。

## 用語

- **正典項目**（テンプレが定義・同期する）: `task` / `detail` / `phase` / `category`
- **運用項目**（各人固有・絶対に上書きしない）: `status` / `owner` / `dueDate` / `memo`
  （例外: レコードを新規作成する場合のみ、owner と dueDate に初期値を入れる）

## 手順

1. `manageCollection` getItems（slug: `new-starter-templates`）で全テンプレ行を取得（version/active 含む）。
2. `manageCollection` getItems（slug: `new-starter`）で全タスクを取得。
3. `starter`（新入社員）ごとに、`active = 有効` の各テンプレ行 `T`（現行 version = V）について：
   - その starter に `templateTaskId = T.id` のレコードが **無い**（＝欠落）:
     - **新規作成**する（`mode: create`）。
       - id = 既存の同 starter レコードidの共通prefix（末尾 `-NN` を除いた部分）＋ `-` ＋ `T.seq` の2桁
         （例 prefix `taro-yamada` ＋ `-19`）。
       - 正典項目 = T の値。`starter` = その氏名。`startDate` = 既存レコードの startDate。
       - `status` = 未着手、`owner` = `T.defaultOwnerRole`（初期値）、
         `dueDate` = `startDate` + `T.dueOffsetDays` 日（土日調整はしない・素の加算）。
       - `templateTaskId` = T.id、`templateVersion` = V、`overridden` = false、`templateSyncState` = 同期済。
   - レコードが **有る**（= R）:
     - `R.overridden = true` → **スキップ**。`templateSyncState = 保護によりスキップ` を立てる（merge）。
       正典項目・運用項目とも一切変更しない。（ビューが赤枠バッジで可視化）
     - `R.overridden = false` かつ `R.templateVersion < V` → **更新**。
       - 正典項目（task/detail/phase/category）を T の値で上書き。運用項目は不変。
       - `templateVersion = V`、`templateSyncState = 同期済`。
       - `history` に1件追記する: `{ at: 現在時刻, actor: "テンプレ反映", field: "template",
         from: "<旧 task>(v<旧version>)", to: "<新 task>(v<V>)" }`。
         （history.field の enum に `template` を含める。タイムラインでは「テンプレ改訂」と表示される）
     - `R.overridden = false` かつ `R.templateVersion == V` → 変更なし（no-op）。
4. `active = 廃止` のテンプレ行 → **レコードは削除しない**。対応レコードがある場合は「廃止対象」として
   件数を報告に含めるのみ（自動削除・自動保留化はしない＝データ保全）。

## 完了報告フォーマット

実行後、以下を提示する：

```
テンプレ反映 完了
- 更新 n件: <starter/タスク名 の一覧>
- 新規 m件: <starter/タスク名 の一覧>
- スキップ k件（保護）: <starter/タスク名 の一覧>
- 廃止対象 j件（削除せず報告のみ）: <starter/タスク名 の一覧>
```

## 注意

- 運用項目（status/owner/dueDate/memo）は既存レコードで**絶対に変更しない**。
- overridden=true は保護。ユーザーが意図的にカスタム化した内容を勝手に戻さない。
- history の巻き戻し・version の巻き戻しはしない。
