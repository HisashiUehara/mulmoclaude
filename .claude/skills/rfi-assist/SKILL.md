---
name: rfi-assist
description: >-
  RFIAssist — RFI(Request For Information)資料作成を、依頼受領からACC提出準備まで
  支援する「AI → DSL → engine」パイプライン。中核は再利用可能な「ループ部品」
  (出す→人間が判定→OKなら次へ/NGならもう一周)。AIは判定材料(差分・候補・不明点)の
  整理のみを行い、判定・承認は必ず人間が行う。engineの役割は「送信可能な完成ファイルの
  出力」まで(メール/ACCへの直接送信は作らない)。ユーザーがRFI依頼を渡してきたとき、
  または案件の理解・資料収集・不足依頼文作成・ドラフト確認・提出パッケージ出力を
  頼まれたときに使う。1レコード = 1RFI案件。レコードは data/rfi-assist/items/<id>.json
  (1件1ファイル)。ユーザーは /collections/rfi-assist で一覧・確認する。受け渡しDSLの
  正準定義は dsl/rfi-assist.dsl.schema.json。コンテキストは data/rfi-assist/context/
  配下(体制表・過去RFI・背景)。レコード I/O は manageCollection ツール(生の
  Read/Write/Edit はエスケープハッチ)、スキーマ変更は manageCollection の
  schemaDocs / getSchema / putSchema。
---

# RFIAssist（AI → DSL → engine パイプライン）

RFI（Request For Information）資料作成を、依頼受領から ACC 提出準備まで支援する。
**役割分担を厳守する** — AIは判定材料の整理のみ、判定と承認は人間、送信可能ファイルの
出力は engine（コード）。

## 設計思想（AI → DSL → engine）

- **AI** は「判定材料の整理」だけを担う。差分・候補・不明点を提示し、下書き（`content`）を
  作る。**判定（OK/NG）も承認（approved: true）も一切しない。**
- **DSL** は AI と engine と人間をつなぐ中間表現。正準定義は
  [`dsl/rfi-assist.dsl.schema.json`](dsl/rfi-assist.dsl.schema.json)。
  1オブジェクト = `{ rfi_id, phase, loop_count, content{宛先,件名,本文,添付[]}, ai_notes, approved }`。
- **engine（コード）** は検索・収集・差し込み・**送信可能な完成ファイルの出力**を担う。
  役割は「出力」までで、**送信はしない**（メール/ACC への直接送信機能は作らない）。
- **人間（あなた）** は各ループの判定と、停止点での承認を担う。

## ループ部品（本スキルの中核・再利用可能な共通型）

すべての判定はこの1つの部品に集約される。9段のワークフローは、この部品を
**判定者（自分／相手）を差し替えて 5 回** 並べたものにすぎない。

```
                ┌─────────────────────────────────────────────┐
                │            ループ部品 (loop primitive)         │
                │                                             │
   [入力] ───►  emit(材料/下書き)   … AI が content と ai_notes を作る
                     │
                     ▼
                judge(判定者, 人間)  … 判定者は「自分」か「相手」。
                     │                判定は必ず人間が下す。
                     │                AI は判定しない・approved を触らない。
              ┌──────┴──────┐
            OK │            │ NG
              ▼             ▼
          [次の段へ]   loop_count += 1 ──► emit へ戻る（もう一周）
                │
                └─────────────────────────────────────────────┘
```

**部品の契約（不変条件）**

| 要素 | 内容 |
|------|------|
| emit | AI が `content`（下書き）と `ai_notes`（差分・候補・不明点）を生成。`approved` は必ず `false`。 |
| judge | 判定は **人間のみ**。AI は「材料の整理」だけで、OK/NG を出さない。 |
| 判定者 | `自分`（社内で自己完結して判定）または `相手`（相手の応答・承認を待って判定）。 |
| OK | 次の段へ進む。DSL の `approved` を人間が `true` にして初めて後続へ流れる。 |
| NG | `loop_count += 1` し、AI が ai_notes を作り直して emit からもう一周。 |
| gate | **`approved: false` の DSL オブジェクトを後続ステップに流してはならない。** |

- コレクションでは各ループを `loops[]` テーブルの1行として持つ（`loopId` L1〜L5、
  `judge`、`loopCount`、`state`=未開始/進行中/OK/NG、`aiNotes`）。
- 「相手判定」のループは、AI が依頼/送信の下書きを出し、**人間が承認（停止）** した後、
  engine が送信可能ファイルを出力し、相手の応答が返ってきてから人間が OK/NG を判定する。

## ワークフロー（9段・ループ5個・この順を厳守）

| # | 主体 | 内容 | ループ | 対応ステータス |
|---|------|------|--------|----------------|
| 1 | 人間 | 依頼受領（依頼原文を `requestBody` に入力） | — | `依頼受領` |
| 2 | AI→人間 | 依頼内容の理解。AIは `context/` を参照し **調べる先・聞く先の候補をリスト提示**。人間は理解できるまで繰り返す（**AIに「理解できたか」は判定させない**） | **L1: 自分判定** | `依頼理解(L1)` |
| 3 | AI | 指定フォルダ群から **必要書類を検索・収集** → `collectedDocs[]` を埋める | — | `資料収集` |
| 4 | AI→人間→コード | 不足資料の依頼。AIが依頼文ドラフト（DSL）を作成 → **人間が承認（停止）** → engine が送信用ファイルを出力。相手の返送で判定 | **L2: 相手判定** | `不足依頼(L2)` |
| 5 | AI→人間 | 受領資料の要点整理 → 人間が満足か確認 | **L3: 自分判定** | `要点整理(L3)` |
| 6 | コード | 資料を本資料に差し込み | — | `差込` |
| 7 | AI/人間 | ドラフト確認。NGなら **AIが作り直し** | **L4: 自分判定** | `ドラフト確認(L4)` |
| 8 | 人間→コード | **人間承認（停止）** → engine がお客様向け送信ファイルを出力。お客様の応答で判定 | **L5: 相手判定** | `送信準備(L5)` |
| 9 | 人間→コード | お客様承認後、**人間の最終確認（停止）** → engine が ACC 提出用パッケージを出力 | — | `ACC提出` → `完了` |

## 受け渡し DSL（正準定義は dsl/rfi-assist.dsl.schema.json）

```json
{
  "rfi_id": "RFI-2026-014",
  "phase": "understand | collect | draft | review | submit",
  "loop_count": 1,
  "content": { "宛先": "...", "件名": "...", "本文": "...", "添付": [] },
  "ai_notes": "判定材料(差分・候補・不明点)",
  "approved": false
}
```

- AI は `content` と `ai_notes` のみを埋め、`approved` は **常に false**。
- コレクションでは各 DSL オブジェクトを `dslDrafts[]` の1行として保存する
  （`添付` は配列 → カンマ区切りテキストにマップ）。

## コンテキストフォルダ（`data/rfi-assist/context/`）

ステップ2の候補精度を上げるための参照材料。**空でも動作する**設計。
中身はユーザーが後から投入する。

- `context/体制表/` — 誰が何の担当か（→「聞く先」候補の根拠）
- `context/過去RFI/` — 過去RFIの実績（→類似依頼・定石の根拠）
- `context/背景/` — プロジェクト背景・目的（→依頼の意図理解の根拠）

空のときは一般的な候補（部門横断で当たるべき先の定石）を提示し、
`ai_notes` に「コンテキスト未投入のため一般候補」と明記する。

## 制約（絶対に守る）

- ❌ メール・ACC への **直接送信機能は作らない**。engine の役割は「送信可能な完成ファイルの
  出力」まで。送信は当面ユーザーが手動で行う。
- ❌ `approved: false` の DSL を後続ステップに流さない（ループ部品の gate）。
- ❌ AI が判定（OK/NG）や承認（approved: true）を行わない。判定・承認は人間の停止点。
- ❌ ステップ2でAIが「理解できたか」を判定しない。人間が繰り返す。
- ✅ ダミーデータで E2E を通す（実データ投入前でも全段が動くこと）。

## Record shape

- `id` — 案件スラグ（主キー、ファイル名）
- `title` — 案件名（required）
- `rfiId` — RFI-ID（DSL の `rfi_id` と一致）
- `status` — 9段ステータス（required）。`依頼受領`/`依頼理解(L1)`/`資料収集`/`不足依頼(L2)`/
  `要点整理(L3)`/`差込`/`ドラフト確認(L4)`/`送信準備(L5)`/`ACC提出`/`完了`。
  **AI は `ACC提出`/`完了` を勝手に書かない**（最終承認は人間）
- `requestBody` — 依頼原文（ステップ1のインプット）
- `loops[]` — ループ部品の状態。{ `loopId`(L1〜L5), `name`, `judge`(自分/相手), `loopCount`, `state`(未開始/進行中/OK/NG), `aiNotes` }
- `collectedDocs[]` — 収集書類。{ `docId`, `name`, `sourceFolder`, `path`, `state`(必要/収集済/不足) }
- `dslDrafts[]` — DSL受け渡し記録。{ `draftId`, `phase`, `loopCount`, `宛先`, `件名`, `本文`, `添付`, `aiNotes`, `approved`, `approvedBy`, `approvedAt` }
- `outputFiles[]` — engine が出力した完成ファイル。{ `fileId`, `kind`(不足依頼/お客様送信/ACC提出), `path`, `note` }
- `approvedBy` / `approvedAt` — 人間の最終承認記録
- `auditLog[]` — { `when`, `who`(AI/人間/コード), `stage`, `detail` }。各ステップで追記

## What to do

**追加 / 更新** — `manageCollection` putItems。新規は `mode: "create"`、既存の一部更新は
`mode: "merge"`（部分行 `{ id, <変更フィールド> }`。デフォルトの upsert は全置換で
他フィールドが消える）。書き込み前にスキーマ検証され、`rejected` 行は `problem` を見て
直して再送。
**一覧 / 参照** — `manageCollection` getItems。
**削除** — レコードファイルを削除。
**スキーマ変更** — `manageCollection` の schemaDocs / getSchema / putSchema。生の
schema.json 編集は不可。

書き込み後は `presentCollection`（slug と id）でインラインに提示し、⚠️ が返ったら直す。

## 実装ステージ（各段階で停止して報告）

- **Stage 1** — SKILL.md + DSLスキーマ + ループ部品の設計 ← ✅ 本ファイル群
- **Stage 2** — ステップ2の候補出し（`context/` 参照）
- **Stage 3** — ステップ3-4（収集 + 依頼文ドラフト + 承認フロー）
- **Stage 4** — ステップ5-7（要点整理・差し込み・ドラフト確認）
- **Stage 5** — ステップ8-9（送信ファイル・提出パッケージ出力）、E2E → 完了報告
