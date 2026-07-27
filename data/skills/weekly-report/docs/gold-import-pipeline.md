# ゴールド取込パイプライン（実物 → サニタイズ済みゴールド）

ゴールドペアを**自作せず、実物レポートから取り込んで**作るためのパイプライン。
役割分担は本体と同じ **AI → DSL → engine**（抽出=コード / サニタイズ=AI / 出力=コード /
漏れスキャン=コード / 承認=人間）。engine 実装は [`../engine/pipeline.py`](../engine/pipeline.py)。

## 全体像（6段）

| # | 主体 | 内容 | 実装 |
|---|------|------|------|
| 1 | 人間 | `import/` に実物レポート（.xlsx / .pptx）を1つ置く | [`../import/`](../import/) |
| 2 | engine | レイアウト・書式（フォント種類/サイズ/配置）・章構成・表構造・メタ・資産を抽出 → `extracted.json` | `pipeline.py extract` |
| 3 | AI + engine | テキスト内容のみ架空データに差し替え（会社名・人名・エリア名・型番・数値・プロジェクト名すべて）→ `sanitized-map.json`。**画像・図・埋め込みはテキスト置換で消せないため、engine が既定で全画像を架空プレースホルダへ差替え**。**書式・構造は一切変えない** | AI（下記ルール）＋ `apply` |
| 4 | engine | 原本コピーにテキストを**在所置換**＋**全画像をプレースホルダ化**したサニタイズ版ゴールド（元と同形式）＋対応DSLを `fixtures/gold/` に出力 | `pipeline.py apply` |
| 5 | **人間** | サニタイズ漏れチェックリストを確認画面（`presentForm`）で提示、**承認するまで停止** | [`sanitize-checklist.md`](sanitize-checklist.md) ＋ `pipeline.py scan` |
| 6 | engine | 承認後、`import/` の実物ファイルを削除し、削除完了を報告 | 削除＋報告 |

### なぜ「在所置換」なのか（書式を一切変えない設計）
ステップ4は原本を**再構築しない**。原本のコピーを開き、セル値／run テキストだけを
差し替える。フォント・サイズ・配置・結合セル・表・図形位置・スタイルはすべて原本の
まま残るため、「書式と構造は一切変えない」を構造的に保証できる。

## 実行手順（運用ランブック）

前提: `pip install -r engine/requirements.txt`（openpyxl / python-pptx）。
作業ディレクトリは `data/skills/weekly-report/`。中間物は `engine/work/`（一時・追跡外）。

```bash
# 2) 抽出（コード）
python3 engine/pipeline.py extract import/<実物ファイル>
#   -> engine/work/extracted.json（items[].loc/text/font/align/is_heading + structure + metadata + assets）

# 3) サニタイズ（AI）: extracted.json を読み、engine/work/sanitized-map.json を作る（下記スキーマ）

# 4) 出力（コード）: 在所置換 + 全画像プレースホルダ化 + メタ除去 + 対応DSL
python3 engine/pipeline.py apply import/<実物ファイル> engine/work/sanitized-map.json \
        fixtures/gold/<gold同形式ファイル> --dsl fixtures/gold/expected.dsl.json
#   既定で全画像を差替え。元画像を残す場合のみ末尾に --keep-images を付ける。
#   -> engine/work/image_actions.json（各画像の replaced / kept / kept-unsupported）

# 5) 漏れスキャン（コード）→ チェックリスト → 人間承認（presentForm）
python3 engine/pipeline.py scan engine/work/extracted.json fixtures/gold/<gold同形式ファイル> \
        --map engine/work/sanitized-map.json --images engine/work/image_actions.json
#   -> engine/work/leak_findings.json（auto_clean と各カテゴリの ok/warn/manual）

# 6) 承認後（コード）: 実物削除 + 報告
rm import/<実物ファイル>   # 承認が下りて初めて実行
```

## sanitized-map.json のスキーマ（AI の出力）

```json
{
  "items": [
    {
      "id": "001",
      "loc": "週報/B3",
      "lang": "ja",
      "sanitized_text": "架空建設株式会社",
      "pair_key": "002",
      "confidence": "high"
    }
  ]
}
```

- `loc` は extracted.json の項目 `loc` と一致させる（在所置換の宛先）。
- `sanitized_text` は**テキスト内容のみ**の架空差し替え。書式・改行・記号構造は原文の形を保つ。
- `pair_key`（任意）: 同じ値を持つ ja 項目と en 項目を1つの DSL 項目（原文↔訳文）に束ねる。
  省略時は項目単独（`lang` に応じ 原文 or 訳文 を埋める）。
- `confidence`（任意）: DSL に引き継ぐ high/low。

## サニタイズの原則（AI）
- **差し替える**: 会社名・人名・プロジェクト名・エリア名・型番・数値・住所・電話・RFI番号など、実在を示す一切。
- **保つ**: レイアウト、章構成、表の行数・列数、文体、語調、記述の粒度、単位の付き方。
- 汎用語（「週次進捗報告書」等の見出し定型）は差し替え不要 → scan は `kept_identical` として区別し漏れ扱いしない。

## 画像・図・埋め込みの扱い（テキスト置換で消せない要素）
- **既定動作**: `apply` は**全画像（`*/media/*`）を架空のプレースホルダ画像へ差し替える**。元画像と同サイズ・同形式（png/jpg/gif/bmp）で灰色プレースホルダに再エンコードし、図形位置・枠サイズは原本のまま。ロゴ・写真・図に写り込んだ実在情報を確実に除去する。
- **差替え不可な形式**（EMF/WMF 等のベクタ）は自動差替えできないため保持し、`kept-unsupported` として記録 → ステップ5で `manual`（手当要）として列挙。
- **元画像を残す運用**: `apply --keep-images` を付けると画像を差し替えず保持する。この場合、保持した画像を**1枚ずつ**ステップ5チェックリストの `manual` 目視確認項目として提示する（[`sanitize-checklist.md`](sanitize-checklist.md) カテゴリ3）。
- **埋め込みオブジェクト**（`*/embeddings/*`・OLE）は自動処理せず、ステップ5で `manual` 確認。

## 出力物
- `fixtures/gold/<gold>` — サニタイズ済みゴールド（元と同形式の .xlsx / .pptx）。
- `fixtures/gold/expected.dsl.json` — 対応する DSL 実体（正解参照）。
- ※ 現行の `ideal-report.md` / `expected.dsl.json` は**仮ゴールド**（自作サンプル）。
  実物取込が完了したら、このパイプラインの出力で**差し替える**。

## 一致判定（Stage 5）
Stage 5 の E2E 一致判定は「**テキスト内容 + 書式**」の両方を対象とする。
- テキスト: DSL 訳文 ⇄ 出力レポート本文の一致。
- 書式: フォント種類・サイズ・配置・表構造が `templateFormat`（および原本）と一致。
  在所置換で原本書式を保持しているため、書式差分は「テンプレートへの流し込み」段で評価する。

## 安全・制約
- 実データは `import/` にのみ置き、**承認後に必ず削除**。コミット/共有しない。
- 画像ロゴ・ヘッダーフッター・埋め込みオブジェクトは自動サニタイズ不可 → チェックリストで人間が個別確認（`manual`）。
- `scan` の `warn` が残る間は承認しない。`auto_clean:false` のまま先へ進めない。
