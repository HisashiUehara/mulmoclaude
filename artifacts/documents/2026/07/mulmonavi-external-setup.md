# MulmoNavi — 外部セットアップ手順書（OpenAI / Google Cloud / CSP）

MulmoNavi を動かすために**実際に必要だった外部サービスの設定だけ**を、開発記録から抽出したものです。MulmoClaude 本体のインストール・認証・再起動ルールは対象外。各項目を「**何を / なぜ / どう設定したか**」で記述し、同じアプリを作る人がこの部分だけ真似できる粒度にしています。キー本体は伏せ字。

対象は3つ:
1. OpenAI API キー（会話＝nav-chat、音声＝TTS）
2. Google Cloud（Maps 系 API とキー制限）
3. CSP（`config/csp.json` とサーバー側 `media-src` 等）

---

## 1. OpenAI API キー

### 何を
- `.env` に **`OPENAI_API_KEY`** を1本設定する（キー名はこれ固定。サーバーが `process.env.OPENAI_API_KEY` を読む）。

```dotenv
# .env（プロジェクト直下）
OPENAI_API_KEY=sk-proj-xxxxxxxx…（伏せ字）
# 参考: 同じ .env に GEMINI_API_KEY / NEWS_API_KEY もあるが MulmoNavi では未使用
```

サーバー側の読み取り箇所:
```ts
// server/system/env.ts
openaiApiKey: process.env.OPENAI_API_KEY,
```

### なぜ
このキー1本を、**2つの機能で共用**するため:

| 機能 | サーバーの叩き先 | モデル |
|---|---|---|
| 会話 `/api/nav-chat` | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` |
| 音声 `/api/tts` | `https://api.openai.com/v1/audio/speech` | `gpt-4o-mini-tts`（既定）/ `tts-1-hd` / `tts-1` |

- キーは**サーバー側だけで使用**し、ブラウザには一切露出させない（プロキシ経由。クライアントには `sk-` も `api.openai.com` も存在しない）。
- 使用ボイス許可リスト: `nova / alloy / echo / fable / onyx / shimmer / ash / coral / sage`（既定 `shimmer`、日本語は `gpt-4o-mini-tts` ＋ instructions 併用）。

### どう設定したか / 発生した問題と解決
- **設定は `.env` に1行入れるだけ**。今回のプロジェクトではキーは最初から有効で、`/v1/chat/completions`・`/v1/audio/speech` とも 200 で通った（＝OpenAI 側のキー問題は実際には踏んでいない）。
- ただし作り込みの中で、**キー起因ではないが紛らわしい／踏みやすい問題**を2つ処理した:

  1. **キー未設定 → 503 → 内蔵音声にフォールバック**
     - 症状: OpenAI の声が出ず Web Speech（機械音声）になる。
     - 仕様: `env.openaiApiKey` が空なら `/api/tts`・`/api/nav-chat` は **503** を返す設計。クライアントは 503 を受けて **Web Speech / 定型文へ自動フォールバック**（ナビは壊れない）。
     - 解決/確認: `.env` に `OPENAI_API_KEY` が入っているか。入っていれば 200・音声が返る。
     - 注意: 「声が変わらない」の真因は**多くがキーでなくクライアント側のトークン未達**だった（サーバーは 200 を返していた）。まず「サーバー単体で 200 か」を切り分けること。

  2. **`instructions` を対応モデル以外に送ると 400**（キー/プロジェクト不一致に似た症状）
     - 背景: 日本語の自然な発音は `gpt-4o-mini-tts` の `instructions` パラメータで指定する。`tts-1` / `tts-1-hd` は `instructions` 非対応で、送ると OpenAI 側が 400。
     - 解決: サーバーで **`model === "gpt-4o-mini-tts"` のときだけ `instructions` を転送**する分岐を入れた（他モデルには送らない）。

- **一般的な注意（読者向け）**: OpenAI のキーは**プロジェクト単位のスコープ**。使うモデル（`gpt-4o-mini` / `gpt-4o-mini-tts` / `tts-1-hd`）にそのプロジェクトがアクセスできること・支払い方法が有効なことを確認する。プロジェクトが対象モデルにアクセスできないと 4xx（`model_not_found` 等）になり、「キーとプロジェクトの不一致」として現れる。

---

## 2. Google Cloud（Maps 系 API）

### 何を（有効化する API）
MulmoNavi の本体は Google Maps JavaScript API を読み込み、次のライブラリ／サービスを使う:

```js
// voice-nav.html — 読み込むライブラリ
await google.maps.importLibrary("maps");      // 地図表示
await google.maps.importLibrary("places");    // 地点検索
await google.maps.importLibrary("geometry");  // 距離計算（到着判定・逸脱判定）
await google.maps.importLibrary("routes");    // 経路（DirectionsService/Renderer）
```

使っている Google サービスと、**Google Cloud Console で有効化が必要な API**:

| コード上の利用 | 用途 | 有効化する API |
|---|---|---|
| `new google.maps.Map(...)` | 地図描画 | **Maps JavaScript API** |
| `DirectionsService` / `DirectionsRenderer` | ルート構築・描画 | **Directions API** |
| `PlacesService`（`textSearch` / `nearbySearch` / `getDetails`） | 目的地検索・寄り道検索 | **Places API** |
| `Geocoder`（`geocode`） | 住所⇄座標・逆ジオコード（現在地の町名） | **Geocoding API** |

> つまり最低限 **Maps JavaScript API / Directions API / Places API / Geocoding API の4つ**を有効化する。

### なぜ
- 目的地の検索は Places の `textSearch`、寄り道は `nearbySearch`、地図クリック地点の詳細は `getDetails`。
- ルートは Directions、到着・ルート逸脱の判定は `geometry.spherical.computeDistanceBetween`。
- 現在地の町名（会話コンテキスト用）は `Geocoder` の逆ジオコード。
- これらが**別々の API 有効化を要求**するため、1つでも無効だと「地図は出るが検索できない」「ルートが引けない」等の部分故障になる。

### どう設定したか（APIキーと制限）
- **APIキーの持ち方**: 本体にデフォルトキーを埋め込みつつ、`⚙️設定` から端末ローカル（`localStorage.gmaps_key`）で上書き可能にした。

```js
// voice-nav.html
const DEFAULT_KEY = "AIzaSy…（伏せ字）";
const KEY = localStorage.getItem("gmaps_key") || DEFAULT_KEY;
```

- **キーの制限（推奨・UI にも明記）**: アプリケーションの制限を **「HTTP リファラー」**にして、使うオリジンだけ許可する。設定画面にも「キーはこの端末のブラウザにのみ保存されます。**HTTP リファラー制限をかけて利用してください**」と表示。

### 実際に踏んだ／想定したエラーと原因
本体に認証失敗ハンドラを実装しており、原因の切り分けができる:

```js
// Google Maps の認証失敗を捕捉
window.gm_authFailure = function(){ /* 無効キー / リファラー不許可 / 課金なし を案内 */ };
```

| 症状 | 主な原因 | 対処 |
|---|---|---|
| `gm_authFailure` が発火（地図がグレー） | キーが無効／**HTTP リファラー制限で今のオリジンが未許可**／**課金（Billing）未設定** | キーのリファラー許可に現オリジンを追加。プロジェクトに Billing をリンク。 |
| Maps スクリプト自体が読み込めない | **API 未有効化** / 課金未設定 / リファラー制限 / **プレビュー枠の CSP ブロック**（→ 3章） | 4 API を有効化。別ブラウザタブで開くと CSP 由来か切り分け可能。 |
| 地図は出るが検索/ルートが失敗 | **Places / Directions / Geocoding のいずれか未有効化** | 該当 API を有効化。 |

> 実プロジェクトでは、`config/csp.json` に Maps ホストを足す（3章）まで「スクリプト読込拒否」に見える CSP ブロックが起きやすい。**まず CSP、次に API 有効化・課金・リファラー**の順で疑うと早い。

---

## 3. CSP（Content Security Policy）

MulmoNavi 本体は `/artifacts/html/...` として配信され、**サンドボックス用の厳しい CSP**（既定 `default-src 'none'`、`script-src` は限定 CDN のみ）が掛かる。素のままでは Google Maps も自前 API 呼び出しも音声再生も全部ブロックされるため、2箇所で穴を開けた。

### 3-1. `config/csp.json`（ユーザーが足せる https ホスト）

### 何を / どう
`config/csp.json` に **Google Maps 系ホスト**を追加。これは「ベースの CSP に足す」もので、**`https://` オリジンのみ**受理される（`blob:` / `data:` / `'unsafe-*'` は書けない）。

```json
{
  "script-src":  ["https://maps.googleapis.com", "https://maps.gstatic.com"],
  "img-src":     ["https://maps.googleapis.com", "https://maps.gstatic.com"],
  "connect-src": ["https://maps.googleapis.com"]
}
```

### なぜ
- `script-src`: Maps ローダが `maps.googleapis.com` から本体JSを、`maps.gstatic.com` から補助スクリプトを読む。
- `img-src`: 地図タイル・アイコン画像が `maps.googleapis.com` / `maps.gstatic.com` から来る。
- `connect-src`: ベクタータイルや Places/Directions の XHR/fetch が `maps.googleapis.com` に飛ぶ。

→ この3ディレクティブを足すまで、地図は「スクリプト読込拒否」で表示されない。

### 3-2. サーバー側（`https` では書けない `blob:` / `self` を、配信文書だけに付与）

`config/csp.json` は `https://` ホストしか足せないため、**インライン系の許可はビルダー側で配信文書限定に付与**した。

- **何を**: `/artifacts/html` の HTML 応答 CSP に以下を追加（この文書だけにスコープ）:
  - `connect-src 'self'` … アプリが**同一オリジンの自前 API**（`/api/tts`, `/api/nav-chat`, `/api/nav-view-tokens`）を叩けるように。
  - `media-src blob: data:` … OpenAI TTS の音声を **`blob:` URL で再生**できるように（`data:` も許可）。
  - `Cache-Control: no-cache` … 編集した HTML が古いキャッシュで配信されないように。
- **どう**: CSP ビルダー `buildHtmlPreviewCsp()` に `mediaSrc` 引数を足し、`server/index.ts` の `/artifacts/html` 応答で `connectSrc="'self'"`・`mediaSrc="blob: data:"` を渡す。印刷用・srcdoc プレビューは従来どおりロックのまま（この文書だけ緩める）。
- **なぜ**: `blob:` / `data:` / `'self'` は `config/csp.json`（https 限定）では表現できない。かつ全 HTML に緩めると危険なので、**voice-nav を配信する文書だけ**に限定した。`blob:`/`data:` は同一オリジン/インラインのみで、外部流出経路にはならない。

### ブロック発生時の見分け方（DevTools Console）
CSP 違反は Console に必ず出るので、メッセージのディレクティブ名で原因が特定できる:

| Console のメッセージ例 | 足りていないもの | 対処 |
|---|---|---|
| `Refused to load the script 'https://maps.googleapis.com/…' … violates … script-src` | `config/csp.json` の `script-src` | Maps ホストを追加（3-1） |
| 地図タイルが出ず `… violates … img-src` / `connect-src` | `img-src` / `connect-src` | 同上（3-1） |
| `Loading media from 'blob:…' violates … default-src 'none'`（`media-src` 未設定） | 配信文書の `media-src blob:` | サーバー側で付与（3-2） |
| 自前 API の `fetch` が `… violates … connect-src` | 配信文書の `connect-src 'self'` | サーバー側で付与（3-2） |

> 見分けの鉄則: **「script-src / img-src / connect-src」は `config/csp.json`**（https ホスト不足）、**「media-src blob: / connect-src 'self'」はサーバー側の配信文書 CSP**（インライン系不足）。Maps が出ない時はまず前者、音声が鳴らない・API が弾かれる時は後者を疑う。

---

## まとめ（最短チェックリスト）

1. **OpenAI**: `.env` に `OPENAI_API_KEY` を1本。プロジェクトが `gpt-4o-mini` / `gpt-4o-mini-tts` / `tts-1-hd` にアクセス可＋Billing 有効。未設定なら 503 で内蔵音声に落ちる（壊れはしない）。
2. **Google Cloud**: **Maps JavaScript / Directions / Places / Geocoding** の4 API を有効化。キーは HTTP リファラー制限。Billing 必須。
3. **CSP**: `config/csp.json` に Maps の `script-src`/`img-src`/`connect-src`（https ホスト）。サーバー配信文書に `connect-src 'self'` と `media-src blob: data:`。Console の違反メッセージで前者/後者を切り分け。

---

*この文書は MulmoNavi 開発記録から、外部セットアップに該当する部分のみを抽出したものです。キー本体は伏せ字にしています。*
