---
name: voice-nav
description: 音声で行き先を伝えて経路案内する「音声ナビ（Voice Nav）」アプリ＋よく行く行き先・履歴を貯めるコレクション。Google Maps ベースで「◯◯まで案内して」と話す/入力すると目的地を検索しルートを引き、ターンバイターンで読み上げ案内する（日本語/英語切替・徒歩/車モード・「近くのコンビニ」等の寄り道対応）。本体は artifacts/html/2026/07/voice-nav.html。ユーザーは /collections/voice-nav の「音声ナビを起動」ビューからアプリを別タブで開ける。保存済みの行き先をクリックするとその目的地へ直行（?to=行き先 で自動検索）。レコードは data/skills/voice-nav/items/<id>.json（1件1ファイル）。レコード I/O は manageCollection ツール（生の Read/Write/Edit はエスケープハッチ）、スキーマ変更は manageCollection の schemaDocs/getSchema/putSchema。「音声ナビ出して」「行き先を保存して」等で使う。
---

# 音声ナビ（Voice Nav）＆ 行き先コレクション

音声/テキストで行き先を伝えると Google Maps で経路を引き、ターンバイターンで読み上げ案内するナビアプリ。加えて、よく行く行き先・お気に入り・履歴を貯めて一覧するコレクションでもある。

- 入口: `/collections/voice-nav`
- **テーブル/カンバンビュー** … 保存した行き先を一覧（カンバンは分類で列分け）
- **「音声ナビを起動」ビュー** … アプリを別タブで起動する大きなボタン＋保存済み行き先の一覧（クリックでその目的地へ直行）

## 重要な設計上の制約

音声ナビ本体は Google Maps JS API（`maps.googleapis.com`）を読み込む。カスタムビューはサンドボックス化された iframe（許可 CDN のみ・fetch はデータ API のみ）で動くため、**本体をビュー内に直接埋め込むと地図が動かない**。そのため launcher ビューは「本体を別タブ(`target=_blank`)で開くランチャー」として実装している。地図が必要な本体は通常タブでフル機能で動く。

## ファイル構成

```
data/skills/voice-nav/
├── SKILL.md              … このファイル
├── schema.json           … コレクション定義（フィールド＋launcherビュー登録）
├── views/
│   └── launcher.html     … アプリ起動ランチャー＋保存行き先一覧
└── items/<id>.json       … 行き先レコード（1件1ファイル）

artifacts/html/2026/07/voice-nav.html … 音声ナビ本体（ソース・オブ・トゥルース）
```

## 本体アプリ（voice-nav.html）

- Google Maps + Web Speech API（音声認識 STT / 音声合成 TTS）で動くフロントエンド完結アプリ。
- 「◯◯まで案内して」で目的地検索 → ルート構築 → 「ナビ開始」でターンバイターン案内。
- 「近くのコンビニ/ガソリンスタンド」等でカテゴリ寄り道（経由地追加）。徒歩/車モード、日本語/英語切替。
- **URLパラメータ `?to=行き先`（`?dest=` も可）で目的地を自動検索**。`?mode=walk` で徒歩モード。launcher の行き先ボタンはこれを使ってその目的地へ直行させる。
- Google Maps API キーが必要（⚙️設定から端末ローカルに保存。デフォルトキー埋め込み済み）。

## レコード運用

- 1レコード = 保存した行き先（お気に入り/履歴/自宅・職場 など）。`name` が行き先名、`query` は検索語（未指定なら name を使用）。
- レコードの追加・編集は `manageCollection` ツール（`putItems`）。スキーマ変更は `getSchema`/`putSchema`（`schemaDocs` で DSL 確認）。
- 「◯◯を行き先に保存して」と言われたらこのコレクションにレコード追加する。
