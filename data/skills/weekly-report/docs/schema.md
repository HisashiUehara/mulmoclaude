# WeeklyReport — スキーマ詳細

SKILL.md 本体から参照される詳細スキーマ定義。DSL（AI↔engine の受け渡し形）と、
コレクション（レコードの器）の2層を定義する。

## 1. 翻訳 DSL（正準定義）

正準ファイル: [`../dsl/weekly-report.dsl.schema.json`](../dsl/weekly-report.dsl.schema.json)（JSON Schema draft-07）。
AI が出力し engine が消費する契約。**この形以外を AI に出させない。**

```json
{
  "items": [
    {
      "id": "001",
      "source_location": "シート名/セル or ページ/要素の参照",
      "原文": "...",
      "訳文": "...",
      "confidence": "high | low"
    }
  ]
}
```

| キー | 型 | 意味 | 生成主体 |
|------|----|------|----------|
| `id` | string | 項目ID（ゼロ埋め連番）。抽出engineが採番し、翻訳・流し込みで同一IDを保持 | engine(抽出) |
| `source_location` | string | 原文の出所。Excel=「シート名/セル」（例 `週報/B3`）、PDF/Doc=「ページ/要素」（例 `p1/見出し`）。流し込み時の転記先特定にも使う | engine(抽出) |
| `原文` | string | 抽出された日本語原文（無加工） | engine(抽出) |
| `訳文` | string | AIの英訳。抽出段階では空、翻訳段階で埋める | AI(翻訳) |
| `confidence` | enum `high`/`low` | 翻訳の確信度。`low` は確認画面で強調 | AI(翻訳) |

### confidence の判定基準（high / low）
翻訳の確信度。**次の3条件のいずれか1つでも該当すれば `low`**（確認画面で強調表示）。
どれにも該当しなければ `high`。判定は原文・訳文の両方を見て行う。

1. **型番・数値・単位を含む** — 例: `XR-4000` / `CR-220` / `RFI-072` / `62%` / `60kW` / `128日` / `第14週`
2. **専門用語を含む** — 例: 二次側結線 / セットアンカー / 梁貫通スリーブ / OAフロア / H形鋼 / 配電盤 / 意匠図
3. **原文が曖昧・省略が多い** — 主語省略、多義的表現、単位の解釈が要る、文脈依存の省略

補足:
- これは**最低基準**（下振れ側）。迷ったら `low` に倒す（人間の確認を促す方が安全）。
- glossary（[`../glossary.json`](../glossary.json)）に定訳がある語は定訳を強制使用するが、**それでも上記1〜3に該当すれば `low` のまま**にする（用語は固定できても、数値転記ミスや文脈の取り違えは人間が確認するため）。
- confidence は AI(S3) が付与し、人間が確認画面(S5)で最終確認する。AI は握りつぶさない（`low`→`high` の勝手な格上げ禁止）。

### glossary（用語集）の強制参照
- ファイル: [`../glossary.json`](../glossary.json)。形式は `{ "原語": "定訳", ... }` のフラットな対応表。
- **翻訳時（S3）は必ず参照**し、原文に glossary の原語が現れたら、その訳語は**定訳を強制使用**する（同義の言い換えは不可）。
- 型番など「訳さず据え置く」語は、定訳を原語と同一文字列にして据え置きを強制する（例: `"XR-4000": "XR-4000"`）。
- 用語の追加・改訂は人間がレビューして反映する（AI は勝手に glossary を書き換えない）。

## 2. コレクション・スキーマ（レコードの器）

正準ファイル: `../schema.json`（変更は `manageCollection` の getSchema/putSchema 経由）。
1レコード = 1変換案件。

| フィールド | 型 | 説明 | 書込主体 |
|-----------|----|------|----------|
| `id` | string(primary) | 案件スラグ（ファイル名） | 起票時 |
| `title` | string(required) | 案件名 | 起票時 |
| `status` | enum(required) | 下記の遷移参照 | 各段階 |
| `contractorReport` | file | 業者レポート（原文・日本語）のパス | 人間(入力) |
| `templateFile` | file | テナント用テンプレートのパス | 人間(入力) |
| `templateFormat` | text | engine が抽出した書式JSON（フォント/サイズ/配置） | engine(S2) |
| `items` | table | 翻訳DSLの投影（`itemId`/`source_location`/`原文`/`訳文`/`confidence`） | engine(S2)→AI(S3) |
| `approvedBy` | string | 承認者 | 人間(S5) |
| `approvedAt` | date | 承認日 | 人間(S5) |
| `outputFile` | file | 完成ファイル（英文レポート）のパス | engine(S6) |
| `auditLog` | table | 全プロセスの証跡（`when`/`who`/`stage`/`detail`） | 各段階で追記 |

### DSL ↔ テーブルの命名対応
DSL の項目キー `id` は、コレクションの `items` テーブルでは **`itemId`** 列にマップする。
理由: レコード主キー `id` と名前が衝突するため。engine は DSL⇄レコード変換時にこの対応を守る。

### ステータス遷移（この順のみ）
```
入力待ち ──[S2/S3 engine]──▶ 抽出済 ──[S3 AI翻訳]──▶ 翻訳済
   └─▶ 承認待ち ──[S5 人間承認]──▶ 承認済 ──[S6 engine流し込み]──▶ 完成
```
- `抽出済`: `templateFormat` と `items[]`（原文のみ）が埋まった状態
- `翻訳済`/`承認待ち`: `items[].訳文` と `confidence` が埋まった状態（人間の確認待ち）
- **AI は `承認済` / `完成` を書かない**（承認=人間、出力=engine）

## 3. 禁止事項（再掲・絶対）
- ステップ5の承認をスキップする自動実行モードを作らない
- 実データを使わない（NDA完了までゴールドペア／ダミーでE2E）
- AI が転記・書式・レイアウトを決めない
- `confidence: low` の握りつぶし（黙って `high` 化／確認画面から除外）
