---
name: fumou-meeting-bot
description: 社内の「不毛な議論」を人間の代わりにAIたちが永遠に戦い抜くネタチャットボットアプリ（🌵 不毛会議Bot）＋その会議ログを貯めるコレクション（🌵 不毛会議ログ）。Botは議題を投げ込むと6人の"あるある社員AI"（論点ずらし課長・とりあえず持ち帰る部長・前例主義おじさん・横文字コンサル・心配性の法務・空気読む若手）が結論の出ない議論を延々と繰り広げる。不毛度メーター／会議経過時間／決定事項:特になしカウンタ付き。単体で動くオフラインHTMLアプリ。ユーザーは /collections/fumou-meeting-bot で会議ログを一覧でき、「不毛会議室（Bot起動）」ビューからBot本体を起動できる。「不毛会議Bot出して」「不毛会議ログに追加して」等で使う。レコードは data/fumou-meeting-bot/items/<id>.json（1件1ファイル）。レコード I/O は manageCollection ツール（生の Read/Write/Edit はエスケープハッチ）、スキーマ変更は manageCollection の schemaDocs/getSchema/putSchema。
---

# 🌵 不毛会議Bot ＆ 不毛会議ログ（スキーマ駆動コレクション）

社内でありがちな「結論の出ない不毛な議論」を、人間の代わりにAIキャラたちが永遠に戦い抜くネタチャットボットアプリ。加えて、開催した"不毛会議"を記録・一覧するコレクションでもある。

- 入口: `/collections/fumou-meeting-bot`
- **テーブル/カンバン/カレンダービュー** … 過去の不毛会議ログを一覧（カンバンは決定事項で列分け、カレンダーは開催日で配置）
- **「不毛会議室（Bot起動）」ビュー** … Bot本体（`views/room.html`）をその場で起動。議題を投げ込むと6キャラが不毛な議論を展開する

## ファイル構成

```
data/skills/fumou-meeting-bot/
├── SKILL.md          … このファイル
├── schema.json       … コレクション定義（フィールド＋カスタムビュー登録）
├── app.html          … Bot本体のソース・オブ・トゥルース（単体表示用）
└── views/room.html   … コレクションのカスタムビューに埋め込むBot本体（app.htmlのコピー）
data/fumou-meeting-bot/items/<id>.json … 会議ログのレコード（1件1ファイル）
```

Bot本体は完全自己完結（CSS/JSすべてインライン、CDN不使用、外部fetchなし）なので、サンドボックスされたカスタムビューでもそのまま動く。**app.html を改修したら views/room.html にもコピーして同期すること**（`cp app.html views/room.html`）。

## レコードの形（会議ログ）

- `id` — kebab-case のスラッグ（主キー = ファイル名）。慣例: `<議題スラッグ>-<YYYYMMDD>`
- `topic` — 議題（1行）。必須
- `participants` — 参加したAIキャラ（スラッシュ区切り）
- `durationMin` — 会議時間（分）
- `fruitlessness` — 不毛度（%）
- `outcome` — 決定事項。enum: `継続審議` / `持ち帰り` / `次回再検討` / `迷宮入り` / `特になし`
- `heldOn` — 開催日（YYYY-MM-DD）
- `notes` — 議事メモ（自由文。※内部にダブルクオートを書くときは「」で囲むか \" でエスケープ）

## やること

**Botを起動（単体表示）** — `app.html` を Read → `presentHtml` の `html` にその中身を渡す（title: `🌵 不毛会議Bot`）。コレクション経由なら `/collections/fumou-meeting-bot` の「不毛会議室」ビューでも起動できる。

**会議ログの追加 / 更新** — `manageCollection` putItems。追加は `mode: "create"`（ID衝突を検出）、既存の一部フィールド変更は `mode: "merge"`（デフォルトのupsertはレコード全体を置き換えるので省略フィールドが消える）。
**一覧 / 参照** — `manageCollection` getItems。
**削除** — レコードファイルを削除。
**スキーマ変更** — `manageCollection` の `schemaDocs` → `getSchema` → `putSchema`（`schema.json` を直接編集しない）。

追加・更新後は `presentCollection`（slug と id）で表示し、`⚠️` が返ったら Read → 修正 → Write。

## Bot中身の仕組み（改修する時用）

- 6キャラ = `bots` 配列。発言候補は `lines`（キャラID→セリフ配列）に台本ベースで格納。ランダム選択で返すだけで外部LLMは呼ばない。
- `openers`（前置き語）/`derails`（論点ずらし専用）/`topics`（定番議題チップ）/`outcomes`（"結論"候補＝全部先送り）も配列。
- ステータス: 不毛度メーター／会議経過時間／決定事項カウンタ。

### よくある改修依頼と対応箇所

- **キャラ追加/セリフ追加** → `bots` に1件足し、`lines` に同じ id のセリフ配列を追加。
- **議題プリセット追加** → `topics` 配列に文字列を足す。
- **トーン変更** → `lines` の各セリフを書き換える。
- 改修時は `app.html` を編集 → `cp app.html views/room.html` で同期 → 再度 `presentHtml` で確認。

## 発展アイデア（未実装・依頼が来たら）

- Botの会議終了時に、その結果を会議ログレコードとして自動保存（カスタムビューの write 権限を使う）
- 本物のAIが応答する版（Claude ロール/チャットと連携）
- 会議結果の「議事録PDF」自動生成（決定事項: なし、を正式文書化するネタ）
