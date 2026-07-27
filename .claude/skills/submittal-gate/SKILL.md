---
name: submittal-gate
description: >-
  SubmittalGate — Submittal(お客様承認が必要な物品・仕様)の承認獲得プロセスを支援する
  「AI → DSL → engine」パイプライン。構造は二重ゲート: 私のゲート(my_gate)で社内の
  質を固め、お客様のゲート(client_gate)で顧客承認を取り切る。中核は RFIAssist から
  再利用する「ループ部品」(出す→人間が判定→OKなら次へ/NGならもう一周)を、判定者
  (私/ゼネコン/お客様)とゲートを差し替えて6回並べたもの。AIは判定材料(要件との差分・
  不明点)の整理と下書き作成のみを行い、OK/NGの判定と承認は必ず人間が行う。engineの役割は
  「送信可能な完成ファイルの出力」まで(メール/ACCへの直接送信は作らない)。ユーザーが
  ゼネコンから上がった提出書類を渡してきたとき、または要件照合・修正依頼文作成・
  ドラフト確認・提出パッケージ出力・結果報告を頼まれたときに使う。1レコード = 1Submittal案件。
  レコードは data/submittal-gate/items/<id>.json(1件1ファイル)。ユーザーは
  /collections/submittal-gate で一覧・確認する。受け渡しDSLの正準定義は
  dsl/submittal-gate.dsl.schema.json。要件定義(OPR等)は data/submittal-gate/requirements/
  配下に置く。レコード I/O は manageCollection ツール(生の Read/Write/Edit はエスケープ
  ハッチ)、スキーマ変更は manageCollection の schemaDocs / getSchema / putSchema。
---

# SubmittalGate（二重ゲート × AI → DSL → engine パイプライン）

Submittal（お客様承認が必要な物品・仕様）の承認獲得プロセスを支援する。
**役割分担を厳守する** — AIは判定材料の整理と下書き作成のみ、判定と承認は人間、
送信可能ファイルの出力は engine（コード）。

## 二重ゲート（本スキルの構造）

承認は2つのゲートを順に通す。**曖昧・不透明なケースほど人間に回す。AIは判定しない。**

```
   ゼネコン提出
        │
        ▼
 ┌──────────────── 私のゲート (my_gate) ─────────────────┐
 │  ステップ2-5 : 要件照合 → 修正依頼(L1) → 修正版確認(L2) │
 │  → 私が承認(停止) → ACC提出パッケージ出力             │  ← 社内で質を固める
 └────────────────────────┬─────────────────────────────┘
                          │  ACC提出
                          ▼
 ┌──────────────── お客様のゲート (client_gate) ─────────┐
 │  ステップ6-12 : お客様コメント(L3) → 問題点確認         │
 │  → ゼネコン修正依頼(L4) → 修正版照合 → 確認承認(L5)     │  ← 顧客承認を取り切る
 │  → ACC再提出 → お客様承認(L6) → 結果報告出力           │
 └───────────────────────────────────────────────────────┘
```

- **my_gate** … 私（社内）が判定するゲート。お客様に出す前に自分たちの責任範囲を固める。
- **client_gate** … お客様が最終判定するゲート。お客様コメントを受け、ゼネコンに直して
  もらい、再提出して承認を取り切る。client_gate の中にも「私判定(L5)」と
  「ゼネコン判定(L4)」の内部ループが入る。

## 設計思想（AI → DSL → engine）

- **AI** は「判定材料の整理」と「下書き作成」だけを担う。要件との差分（`diff`）・不明点を
  提示し、依頼文/報告文の下書き（`content`）を作る。**判定（OK/NG）も承認
  （approved: true）も一切しない。**
- **DSL** は AI と engine と人間をつなぐ中間表現。正準定義は
  [`dsl/submittal-gate.dsl.schema.json`](dsl/submittal-gate.dsl.schema.json)。
  1オブジェクト = `{ submittal_id, gate, phase, loop_count, diff[], content{宛先,本文,添付[]}, approved }`。
- **engine（コード）** は照合・差分算出・差し込み・**送信可能な完成ファイルの出力**を担う。
  役割は「出力」までで、**送信はしない**（メール/ACC への直接送信機能は作らない）。
- **人間（あなた）** は各ループの判定と、停止点での承認を担う。

## ループ部品（RFIAssist から再利用する共通型）

すべての判定はこの1つの部品に集約される。12段のワークフローは、この部品を
**判定者（私／ゼネコン／お客様）とゲート（my_gate／client_gate）を差し替えて 6 回**
並べたものにすぎない。**RFIAssist の `loops[]` / `dslDrafts[]` / gate 契約をそのまま流用する。**

```
                ┌─────────────────────────────────────────────┐
                │            ループ部品 (loop primitive)         │
                │                                             │
   [入力] ───►  emit(材料/下書き)   … AI が diff / content / aiNotes を作る
                     │
                     ▼
                judge(判定者, 人間)  … 判定者は「私」「ゼネコン」「お客様」。
                     │                判定は必ず人間が下す。
                     │                AI は判定しない・approved を触らない。
              ┌──────┴──────┐
            OK │            │ NG
              ▼             ▼
          [次の段へ]   loop_count += 1 ──► emit へ戻る（もう一周）
                │
                └─────────────────────────────────────────────┘
```

**部品の契約（不変条件・RFIAssist と共通）**

| 要素 | 内容 |
|------|------|
| emit | AI が `diff`（要件との差分材料）と `content`（下書き）と `aiNotes` を生成。`approved` は必ず `false`。 |
| judge | 判定は **人間のみ**。AI は「材料の整理」だけで、OK/NG を出さない。 |
| 判定者 | `私`（社内で自己完結して判定）/ `ゼネコン`（相手の修正応答を待って判定）/ `お客様`（顧客の承認を待って判定）。 |
| OK | 次の段へ進む。DSL の `approved` を人間が `true` にして初めて後続へ流れる。 |
| NG | `loop_count += 1` し、AI が材料を作り直して emit からもう一周。 |
| gate | **`approved: false` の DSL オブジェクトを後続ステップに流してはならない。** |

- コレクションでは各ループを `loops[]` テーブルの1行として持つ（`loopId` L1〜L6、
  `gate`、`judge`、`loopCount`、`state`=未開始/進行中/OK/NG、`aiNotes`）。
- 「ゼネコン判定」「お客様判定」のループは、AI が依頼/送信の下書きを出し、
  **人間が承認（停止）** した後、engine が送信可能ファイルを出力し、相手の応答が
  返ってきてから人間が OK/NG を判定する。

## ワークフロー（12段・ループ6個・この順を厳守）

| # | 主体 | 内容 | ゲート | ループ | 対応ステータス |
|---|------|------|--------|--------|----------------|
| 1 | 人間 | ゼネコンから必要書類が上がる（`requiredDocs[]` に入力） | my_gate | — | `書類受領` |
| 2 | AI | 要件定義（`requirements/`）と照合し、**差分を整理して提示**（`diff[]`）。**判定はしない** | my_gate | — | `要件照合` |
| 3 | AI→人間→コード | 修正依頼。AIが依頼文ドラフト → **人間が監修・承認（停止）** → engine が送信用ファイルを出力 | my_gate | **L1: 私判定** | `修正依頼(L1)` |
| 4 | AI→人間 | 修正版の再確認。AIが差分整理 → 人間が判定 | my_gate | **L2: 私判定** | `修正版確認(L2)` |
| 5 | 人間→コード | **人間承認（停止）** → engine が ACC提出用パッケージを出力 | my_gate → client_gate | — | `ACC提出` |
| 6 | コード→人間 | お客様コメント受領 → engine が私に通知 | client_gate | **L3: お客様判定** | `お客様コメント(L3)` |
| 7 | 人間 | 問題点を確認 | client_gate | — | `問題点確認` |
| 8 | AI→人間→コード | ゼネコンへ修正依頼。AIがドラフト → **人間が監修（停止）** → engine が送信用ファイルを出力 | client_gate | **L4: ゼネコン判定** | `ゼネコン修正依頼(L4)` |
| 9 | AI | 修正版の修正内容を確認し、**差分を提示**（`diff[]`） | client_gate | — | `修正版照合` |
| 10 | 人間 | 確認・承認 | client_gate | **L5: 私判定** | `確認承認(L5)` |
| 11 | 人間→コード | **人間承認（停止）** → engine が ACC再提出用パッケージを出力 | client_gate | — | `ACC再提出` |
| 12 | コード | お客様承認後 → engine が関係者向け結果報告ドラフトを出力 | client_gate | **L6: お客様判定** | `結果報告(L6)` → `完了` |

## 受け渡し DSL（正準定義は dsl/submittal-gate.dsl.schema.json）

```json
{
  "submittal_id": "SUB-2026-007",
  "gate": "my_gate | client_gate",
  "phase": "check | revise | submit | respond | report",
  "loop_count": 1,
  "diff": [ { "項目": "...", "要件": "...", "提出内容": "...", "差分": "..." } ],
  "content": { "宛先": "...", "本文": "...", "添付": [] },
  "approved": false
}
```

- AI は `diff` と `content` と `ai_notes`（→ コレクションの `aiNotes`）のみを埋め、
  `approved` は **常に false**。
- コレクションでは差分を `diffTable[]`、DSL受け渡しを `dslDrafts[]` の行として保存する
  （`添付` は配列 → カンマ区切りテキストにマップ）。

## 要件定義フォルダ（`data/submittal-gate/requirements/`）

ステップ2の照合に使う参照材料。**空でも動作する**設計。中身はユーザーが後から投入する。

- `requirements/OPR/` — Owner's Project Requirements（要件定義書）。照合の一次根拠。
- `requirements/仕様基準/` — 仕様書・規格・基準値（型式・寸法・性能条件）。
- `requirements/非互換リスト/` — 既知の非互換の実績（例: GK-SUNV と 7/8" ケーブルの
  非互換）。過去の照合実績を**テストケースとしてダミー化**して置く。

**照合の設計方針**: AIは「差分が◯点あります」のように**材料を出すだけ**。OK/NGの判定は私。
要件が空・不明瞭なときは一般的な照合観点（型式・寸法・電気特性・互換性）で差分候補を挙げ、
`aiNotes` に「要件未投入のため一般観点」と明記する。

## 制約（絶対に守る）

- ❌ メール・ACC への **直接送信機能は作らない**。engine の役割は「送信可能な完成ファイルの
  出力」まで。送信は当面ユーザーが手動で行う。
- ❌ `approved: false` の DSL を後続ステップに流さない（ループ部品の gate）。
- ❌ AI が判定（OK/NG）や承認（approved: true）を行わない。判定・承認は人間の停止点。
- ❌ ステップ2でAIが要件適合を「OK/NG判定」しない。差分材料を出すだけ。判定は人間。
- ⚠️ **判定が曖昧・不透明なケースほど人間に回す。AIに判定させない。**
- ✅ ダミーデータで E2E を通す（実データ投入前でも全12段が動くこと）。

## Record shape

- `id` — 案件スラグ（主キー、ファイル名）
- `title` — 案件名（required）
- `submittalId` — Submittal-ID（DSL の `submittal_id` と一致）
- `gate` — 現在のゲート（`my_gate` / `client_gate`）
- `status` — 12段ステータス（required）。**AI は `完了` を勝手に書かない**（最終承認は人間）
- `requiredDocs[]` — ゼネコン提出書類。{ `docId`, `name`, `revision`, `path`, `receivedAt` }
- `diffTable[]` — ステップ2/9の差分。{ `diffId`, `loopCount`, `項目`, `要件`, `提出内容`, `差分`, `sourceReq` }
- `loops[]` — ループ部品の状態。{ `loopId`(L1〜L6), `name`, `gate`, `judge`(私/ゼネコン/お客様), `loopCount`, `state`, `aiNotes` }
- `dslDrafts[]` — DSL受け渡し記録。{ `draftId`, `gate`, `phase`, `loopCount`, `宛先`, `本文`, `添付`, `aiNotes`, `approved`, `approvedBy`, `approvedAt` }
- `outputFiles[]` — engine 出力ファイル。{ `fileId`, `kind`(修正依頼/ACC提出/ゼネコン修正依頼/ACC再提出/結果報告), `path`, `note` }
- `approvedBy` / `approvedAt` — 人間の最終承認記録
- `auditLog[]` — { `when`, `who`(AI/人間/コード), `gate`, `stage`, `detail` }。各ステップで追記

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

- **Stage 1** — SKILL.md + DSLスキーマ + ループ部品の流用確認 ← ✅ 本ファイル群
- **Stage 2** — ステップ2の照合エンジン（要件との差分提示）
- **Stage 3** — ステップ3-5（my_gate 側のループ / L1・L2 + ACC提出パッケージ）
- **Stage 4** — ステップ6-11（client_gate 側のループ / L3・L4・L5 + ACC再提出）
- **Stage 5** — ステップ12（結果報告）+ ダミーデータ E2E → 完了報告
