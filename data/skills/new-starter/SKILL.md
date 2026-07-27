---
name: new-starter
description: New Starter（新入社員）オンボーディングのチェックリスト＋Action Tracker。
  入社前・初日・最初の1ヶ月にやるべき準備タスクを、担当者・ステータス・期限・メモ付きで
  1タスク1レコードとして管理する。誰のどのタスクがどこまで進んでいるかを可視化する。
  新入社員の追加、タスクの進捗更新、担当割当、メモ追記を頼まれたら使う。
  レコードは data/new-starter/items/<id>.json（1件1ファイル）。ユーザーは
  /collections/new-starter を開き、「Action Tracker」ビューで進捗を確認・更新する。
  レコード I/O は manageCollection ツール（生の Read/Write/Edit はエスケープハッチ）、
  スキーマ変更は manageCollection の schemaDocs/getSchema/putSchema。
---

# New Starter オンボーディング（schema-driven collection）

## Record shape（1レコード = 1タスク）

- `id` — `<starterSlug>-<nn>` 形式の primary key（例 `taro-yamada-01`）
- `starter` — 新入社員の氏名（必須）。同一人物のタスクは同じ値で束ねる
- `startDate` — 入社日（date）
- `phase` — 入社前 / 初日 / 最初の1週間〜1ヶ月（必須）
- `category` — アカウント・IT関係 / 物品 / 事務手続き / 初日オリエン / 研修・フォロー
- `task` — タスク名（必須）
- `detail` — 補足・注意事項
- `owner` — 担当者（社内で対応する人）
- `requestTo` — 依頼先（例: IT部門）
- `status` — 未着手 / 対応中 / 完了 / 保留・N/A（必須）
- `done` — toggle（host-computed 投影。status を完了/未着手に切替。書き込まない）
- `dueDate` — 期限（date）
- `memo` — メモ代わりの自由記述
- `templateTaskId` — ref → new-starter-templates（由来テンプレ行。空＝テンプレ外の追加タスク）
- `templateVersion` — 同期済みテンプレ行の version（number）
- `overridden` — boolean。テンプレから意図的に変更＝**テンプレ改訂反映から保護（スキップ対象）**
- `templateSyncState` — enum「同期済 / 保護によりスキップ」。propagate が更新、ビューがバッジ表示
- `history` — table（変更履歴／タイムラインUIの源）。`of`: at(datetime) / actor(string) /
  field(enum: status/owner/dueDate/**template**) / from / to。※status/owner/dueDate 変更時に
  ビューが1件 append。`template` はテンプレ改訂反映（propagate）で記録

## 標準タスクテンプレート（新入社員1名につき19件）

新しい新入社員を追加するときは、この19タスクを `starter` を差し替えて複製する。

### 入社前
- アカウント・IT関係（依頼先=IT部門）
  1. Microsoftアカウント作成（メール, Teams, SharePointアクセス権）
  2. 全社共通SharePointサイトへのアクセス確認（必要なProjectサイトの権限付与も併せて依頼）
  3. 配布グループ・Teamsチャネルへの追加
  4. PC・携帯のキッティング依頼（納期があるので早めに）
  5. 勤怠・経費・出張申請アプリのアカウント発行とライセンス割当
  6. 座席予約アプリのアカウント発行と利用権限付与
- 物品
  7. PC、携帯、充電器
  8. PPE（ヘルメット、安全靴、ベスト等）※サイズ事前ヒアリング
  9. 入館証・セキュリティカード
- 事務手続き
  10. ロッカーの確保
  11. 名刺の発注

### 初日（初日オリエン）
  12. 物品一式の受け渡しと受領サイン
  13. PC初期セットアップ支援（MFA設定, VPN, プリンタ）
  14. 管理アプリの使い方説明（勤怠打刻, 経費・出張申請フロー, 承認者）
  15. 座席予約アプリの使い方説明（初日の座席は事前予約）
  16. SharePointの案内（全社共通サイト構成, 各Projectサイト遷移, 就業規則・社内規定・テンプレート類の場所）
  17. チーム紹介、オフィスツアー、緊急連絡先の共有

### 最初の1週間〜1ヶ月（研修・フォロー）
  18. 必須研修（安全衛生, 情報セキュリティ, コンプライアンス）
  19. 1on1の設定、メンター/バディの割当

※現場入場に必要な書類は各Project memberから本人へ直接案内する運用のため対象外。

## What to do

**新入社員を追加** — 上記19タスクを `starter` を差し替えて `manageCollection` putItems
（`mode: "create"`）で一括作成。id は `<starterSlug>-01`〜`-19`。status は全て「未着手」。
`startDate` が分かればセットし、`dueDate` は入社日基準で埋める。

**進捗更新** — `manageCollection` putItems（`mode: "merge"`、`{ id, status }` などの部分行）。
`done` は書かない（status の投影）。

**一覧・読取** — `manageCollection` getItems（`ids` / `fields` で絞る）。

**削除** — レコードファイルを削除。

**スキーマ変更** — `manageCollection` の schemaDocs / getSchema / putSchema。

更新後は `presentCollection`（slug と対象 id）でインラインに提示し、⚠️ が出たら修正する。

---

# システム全体構成（案B: Git風オンボーディング管理 / S1〜S5 完了）

「テンプレート＝main、個人＝branch」を **本物のgitではなく Collection データ構造で模倣**した3コレクション構成。
ホスト無改造・サンドボックス制約内で完結する。

## 3コレクションの役割

| slug | 役割 | Git概念の対応 |
|---|---|---|
| `new-starter-templates` | 標準19タスク（正典）。version / active / dueOffsetDays / defaultOwnerRole | **main** |
| `new-starter` | 各新入社員のタスク（本体）。上記フィールド＋history | **branch**（starterごと） |
| `onboarding-audit` | history を1イベント=1レコードに集約（決定的ID＝冪等）。横断集計面 | **commit log** |

- **overridden=true** = ローカル変更の保護（propagate から除外）
- **propagate（collectionAction「テンプレ改訂を全員へ反映」）** = merge 相当（3-way mergeなし）
- **diffバッジ** = ビューが自コレクション内の値だけで算出（templateTaskId 空→追加 / overridden→変更 / それ以外→テンプレ通り）。
  ※ビューはサンドボックスで**自コレクションしか読めない**ため、テンプレとのライブ比較はしない設計

## 運用手順の要点

1. **新入社員追加**: tracker「＋新入社員を追加」→ office チャットがテンプレ19件を複製
   （status全「未着手」、owner=defaultOwnerRole、dueDate=入社日+dueOffsetDays）。
2. **日々の進捗**: tracker でチェック＝完了、担当/期限/メモ編集。status/owner/dueDate 変更は history 自動記録。
3. **個別カスタム**: テンプレと変えるタスクは「テンプレから変更(保護)」ON＝以後の反映から除外（赤枠バッジで可視化）。
4. **テンプレ改訂**: `new-starter-templates` を編集し version+1 → ヘッダ「テンプレ改訂を全員へ反映」。
   非保護=正典項目のみ更新（運用項目は不可触）／保護=スキップ／欠落=新規作成／廃止=報告のみ。
5. **監査集計**: `onboarding-audit` の Refresh（on-demand ingest）で最新化 → 担当者別/項目別/テンプレ別で集計。

## 実装メモ（次回の改修時に注意）

- スキーマ変更は必ず `manageCollection` putSchema（検証付き）。ビュー改修は `views/tracker.html` のみ。
- propagate 手順書は `templates/propagate.md`、audit 同期手順書は `../onboarding-audit/templates/sync-audit.md`。
- 決定的IDは `<taskId>__<epochms>__<field>`（epochms は at を Asia/Tokyo・秒00で解釈）。

## 将来課題（未実装・記録のみ）

1. **history 肥大化対策**（完了starterの履歴退避・トリム）
2. **audit 同期の自動schedule化**（現状 on-demand の Refresh のみ）
3. **頻出差分の検出→テンプレへのマージ提案**（onboarding-audit を土台に）
4. **分単位ID衝突**（同一タスク・同一項目を同一分に複数変更すると1件に集約）→ 秒精度化 or 連番付与
5. **actor 識別**（ホストが操作者IDを提供したら既定「Office Manager」を置換）

### スコープ外（今回あえて不実装）
- 真の3-way merge / blame 相当
- 廃止テンプレ（active=廃止）に対応するレコードの自動削除（データ保全のため報告のみ）

