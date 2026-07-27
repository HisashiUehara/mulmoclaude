# MulmoNavi 開発状況サマリー

作成日: 2026-07-27
対象: 音声カーナビ **MulmoNavi**（本体 `artifacts/html/2026/07/voice-nav.html` ＋ サーバー `server/api/routes/navChat.ts` / `tts.ts` ＋ コレクション `data/skills/voice-nav/`）

> 既存の [`mulmonavi-development-log.md`](./mulmonavi-development-log.md)（7/16 時点）以降の進展を含めた、**現在地のスナップショット**です。

---

## 1. 一行サマリー

パターンマッチ主体のナビから出発し、**LLM が経路要求（RouteIntent）を組み立てる AI-native 構造へ 3 段階で反転**。現在は最終形の **RouteIntent DSL 経路が有効（`USE_INTENT = true`）**で、作業ブランチ `feat/nav-dsl-origin` 上で「目的地の誤解決」と「地図描画」の実機デバッグ中。

---

## 2. 現在のブランチ / コミット状態

| 項目 | 状態 |
|---|---|
| 作業ブランチ | `feat/nav-dsl-origin`（main 未マージ） |
| HEAD | `316f90b48` `feat(nav): RouteIntent DSL + origin concept, resetNavState, gen guards, diag logs`（7/27 20:54） |
| 未コミット | `voice-nav.html` のみ（+6/-2）＝ `[ROUTE-DIAG]` に出発地/目的地の実座標ダンプを追加 |
| 退避ブランチ | `backup-before-dsl-20260727`（DSL 着手前）/ `backup-m0-20260726`（tools 化着手前） |

いつでも DSL 前・tools 前の状態に戻せる状態が確保されています。

---

## 3. アーキテクチャ現状

### 3-1. 発話の流れ

```
[音声🎤 / テキスト]
  │ handleInput（同一発話1.5秒ドロップ / flushTts で AI 発話に割り込み）
  ▼
第1層 layer1Safety（遅延ゼロ・安全即応のみ）
  ├ stop / start / repeat / mode 等
  └ それ以外はすべて第2層へ（＝既定は LLM）
       ▼
  POST /api/nav-chat  mode:"intent"
  （OpenAI gpt-4o-mini ＋ route_intent tool・view-token 認可・走行コンテキスト注入）
       ▼
  RouteIntent DSL エンジン（クライアント）
  mergeIntent（未指定＝前回維持）→ diffIntent → resolvePlace → buildRoute
       └ say → 発話
```

### 3-2. RouteIntent DSL（今回の中核）

LLM は差分ツールを何回も呼ぶのではなく、**経路要求を 1 個の宣言として返す**。

```
{ origin: "current" | {query}, destination: {query}, via: [{query}…],
  prefer: {avoidHighways, avoidTolls}, say: "短い一言" }
```

- **未指定＝維持**（「下道で」だけ言っても目的地は消えない）
- **via は完全配列**（残す経由地も含めて全件返す。全消去は `[]`）
- `origin` 概念を新設し、「出発地を新宿駅にして」に対応（`current` で現在地に復帰）
- `intentSeq` / `routeSeq` の**世代ガードで後勝ち**（連続変更で古い結果が後から上書きするのを防止）
- `resetNavState()` で目的地・経由地・道種・確認待ちを一括クリア

### 3-3. サーバー `/api/nav-chat` は 3 モード併存（段階移行のため）

| mode | 内容 | 状態 |
|---|---|---|
| （未指定） | 旧 action-JSON 方式 | 後方互換のため残置 |
| `"tools"` | 差分 tool calling（`navigate` / `change_route` / `get_status` / `search_poi` / `control` / `remember` / `recall` / `play_music`）。`stream:true` で SSE ストリーミング | ロールバック用に残置（`USE_INTENT=false` で復帰） |
| `"intent"` | **RouteIntent DSL（現行）** | 有効 |

共通ガード: view-token（`aud:"nav-chat"`）／レート 20 req/min ／入力 300 字上限 ／コンテキスト 2000 字 ／`max_tokens` 120 ／timeout 15s ／モデル `gpt-4o-mini`。

### 3-4. 音声（TTS）

- 既定 `gpt-4o-mini-tts`（`instructions` で日本語ネイティブ発音を指定。対応モデルにのみ転送し `tts-1` 系への誤送 400 を回避）
- 言語別ボイス自動切替（日本語 `nova` / 英語 `shimmer`）
- **直列キュー**再生（重なり防止）＋ **IndexedDB キャッシュ**（定型文はゼロ遅延）
- 失敗・キー未設定 → **Web Speech へ自動フォールバック**（ナビは壊れない）
- どのエンジンで鳴ったかを画面バッジで可視化（OpenAI / OpenAI⚡ / 内蔵＋理由）
- **バージイン**: AI 発話中も認識継続、`isEcho()` で自分の TTS のエコーだけ無視

### 3-5. 認可・配信

- **トークン自己取得**: `POST /api/nav-view-tokens`（same-origin ガードのみ・bearer 不要）でアプリ起動時に tts / nav-chat の 2 トークンを自力取得。ランチャーのフラグメント受け渡し依存を排除
- CSP: `config/csp.json` に Maps ホスト（script/img/connect）、`/artifacts/html` 配信文書のみ `connect-src 'self'` ＋ `media-src blob: data:` ＋ `Cache-Control: no-cache`

---

## 4. 開発フェーズの時系列

| 時期 | フェーズ | 内容 |
|---|---|---|
| 7/5〜7/7 | 立ち上げ | Google Maps ＋ Web Speech のブラウザ完結ナビ。Maps が出ない → CSP ホスト追加で解決 |
| 7/8〜7/12 | UI 磨き込み | 例文削除・目的地確認の廃止・高速道路確認の追加・MulmoNavi 改称・**括弧を読ませない恒久ルール**・スマホ用 `phone.html`（Maps ディープリンク） |
| 7/12 | **LLM 会話化** | 調査（Claude CLI は 5.7〜11.5s で遅すぎ）→ **OpenAI gpt-4o-mini 採用**。`/api/nav-chat` 新設、2 層ルーティング |
| 7/12〜7/13 | OpenAI TTS | 眠っていた `/api/tts` を再利用。3 段構え（キャッシュ／リアルタイム／Web Speech フォールバック） |
| 7/12〜7/13 | **トークン到達問題** | 「声が変わらない」の真因はサーバーでなくクライアントのトークン未達。mint ゲート・CSP `media-src blob:`・no-cache で対処 |
| 7/13〜7/15 | 多言語一貫化・バグ退治 | Maps を `language` 付きロード＋切替時リロード。二重発火（`onresult` index 化）・遅延（`gpt-4o-mini-tts` は `tts-1-hd` より速い）・音の重なり（直列キュー化）を解消 |
| 7/15 | **既定の反転** | 「分類できなければ地名検索」→「分類できなければ会話（LLM）」。目的地誤爆が消える |
| 7/15 | 完成度上げ | トークン自己取得 ＋ バージイン |
| 7/16 | ドキュメント化 | 開発記録（development-log） |
| 7/18 | 検証・記事化 | バージイン不発／雑談が浅い の 2 仮説検証 → プロンプト緩和＋`max_tokens=120`。外部セットアップ手順書・note 記事を作成 |
| 7/22〜7/23 | **AI-native 化の設計** | 「パターン追加は限界」→ LLM が道具を選ぶ方式へ。M0→M1→M2 の段階計画に GO |
| 7/26 | M0/M1/M2 実装 | 上流 main と 3-way マージ（保険ブランチ付き）→ tool calling → SSE ストリーミング。502 の切り分け、後勝ち処理、ナビ中の目的地変更、地図描画（`navOn=false`）の実機デバッグ |
| 7/27 | **RouteIntent DSL 化** | 差分ツールをやめ「経路要求を 1 個の宣言で返す」方式へ。`origin` 概念・`resetNavState`・世代ガード・診断ログを実装 |
| 7/27（進行中） | 実機デバッグ | 目的地の誤解決／出発地座標の検証 |

---

## 5. 実装済み機能

**ナビ機能**
- 音声/テキストで目的地検索 → ルート構築 → ターンバイターン読み上げ案内
- 出発地の明示指定（`origin`）と現在地への復帰
- 経由地（寄り道・カテゴリ検索）、徒歩/車モード、高速・有料道路の回避確認
- 到着判定・ルート逸脱リルート（`geometry.spherical`）、地図クリックで目的地指定
- 日本語/英語の完全切替（地名・案内・LLM 応答・TTS・音声認識まで一貫）

**会話**
- 全発話 LLM 委譲（第 1 層は安全即応のみ）／雑談と経路指示の分離
- 走行コンテキスト（現在地の町名・残距離・ETA・言語）注入
- 割り込み（バージイン）・同一発話の二重発火ガード・API 失敗時の定型文フォールバック

**基盤**
- スコープ分離 view-token（tts / nav-chat）＋自己取得、レート制限、入力長制限
- CSP の配信文書限定の緩和、`gm_authFailure` ハンドラによる原因切り分け表示

---

## 6. 未解決 / 進行中

| # | 課題 | 状態 |
|---|---|---|
| 1 | **目的地が誤った場所に解決される**（「新宿駅」→「SHIPSコントロールセンター (SCC)」） | 原因候補: `resolvePlace()` が固有名詞もカテゴリ検索と同じ `textSearch` ＋ `locationBias`（現在地 30km）で解決している。方針は決定済み（**固有名詞は `findPlaceFromQuery`、カテゴリのみ `textSearch`**）だが **未実装** |
| 2 | 出発地が意図した座標になっているかの確認 | `[ROUTE-DIAG]` に origin/dest の実座標ダンプを追加済み（未コミット）。**実機ログ待ち** |
| 3 | 地図上のルート描画が更新されないケース | `[MAP-DIAG]`（コンテナサイズ・可視性・ビューポート移動）と `container@setDirections` 回避策を入れて検証中。診断ログ残置 |
| 4 | `play_music` | toast スタブのまま（Spotify 連携は未着手） |
| 5 | `remember` / `recall` | M1 ではスタブ。**M3 で voice-nav コレクション接続**予定（実走検証後に指示、と保留中） |
| 6 | スマホでの LLM 会話 | フル版の公開 HTTPS 配信＋サーバー到達性が前提のため未対応（現状スマホは Maps ディープリンク方式） |
| 7 | 旧経路（action-JSON / tools＋SSE） | ロールバック用に残置中。DSL 確定後に削除する判断が必要 |
| 8 | ブランチ統合 | `feat/nav-dsl-origin` は main 未マージ。診断ログの整理も統合時の作業 |

---

## 7. 次のアクション（推奨順）

1. **課題1 の実装**（`findPlaceFromQuery` による固有名詞解決の分離）— 目的地誤解決は体験の根幹に効き、課題2・3 の切り分けも汚染する
2. 実機で `[ROUTE-DIAG]` の座標ログを取得し、課題2・3 を確定
3. 安定後に診断ログ（`ROUTE-DIAG` / `MAP-DIAG` / `INTENT`）を整理し、旧経路の残置を削除するか判断
4. `feat/nav-dsl-origin` を main へ統合
5. M3（記憶接続: `remember`/`recall` → voice-nav コレクション）に着手

---

## 8. 外部依存（要設定）

- **OpenAI**: `.env` の `OPENAI_API_KEY` 1 本を会話（`gpt-4o-mini`）と音声（`gpt-4o-mini-tts`）で共用。未設定なら 503 → 内蔵音声に自動フォールバック
- **Google Cloud**: Maps JavaScript / Directions / Places / Geocoding の 4 API 有効化＋Billing。キーは HTTP リファラー制限推奨
- **CSP**: `config/csp.json`（https ホスト）＋サーバー配信文書（`connect-src 'self'` / `media-src blob: data:`）

詳細は [`mulmonavi-external-setup.md`](./mulmonavi-external-setup.md)。

---

*本サマリーは 2026-07-27 時点のリポジトリ状態（HEAD `316f90b48` ＋ 未コミット差分）と開発対話ログから作成しました。*
