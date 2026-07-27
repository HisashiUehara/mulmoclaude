---
type: fact
topic: office-apps
---

# Office Apps

- ユーザーは Turner & Townsend KK の Office Manager。社員からのマニュアル問い合わせ（1日20-30件）を自動化するため、`manual-faq` コレクションアプリを構築した。

- 検索＋カテゴリ閲覧できる「ヘルプデスク」custom view (`data/skills/manual-faq/views/helpdesk.html`) が社員向け入口 (`/collections/manual-faq`)。
- カテゴリ: 勤怠 / 経費 / 出張 / 設備・予約 / IT・システム / その他。
- 初期FAQ 6件（勤怠アプリ・経費申請・出張申請・出張予約・座席予約・プリンター設定）を「下書き」状態で投入済み。company-specific な詳細（URL・締切・承認者）は要確認・要更新。
- 見つからない質問は view の「担当者に聞く」ボタンから office ロールのチャットを起動でき、回答を新FAQとして育てられる。

- ユーザー(Turner & Townsend KK, Office Manager)向けに「MS Projectを簡単に作れて、かつMSPを学べる」アプリを構築。

- 本体アプリ: `artifacts/html/2026/07/msp-studio.html`（単体HTML・英語UI）。
  - **Build タブ**: タスク一覧(WBS)をインライン編集（名前/レベル階層/日数/先行タスク/リソース）。先行(Finish-to-Start)から開始・終了日を自動計算（週末スキップ）。ライブGantt、クリティカルパスを赤で表示。**Microsoft Project XML(MSPDI形式)を書き出し** → MS Projectで File▸Open▸XML形式 でインポート可。カレンダー(Mon-Fri 8h)・リソース・依存リンク付き。
  - **XMLインポート対応**: 「Import MS Project XML」ボタンで外部の MSPDI(.xml) を読み込み、タスク/期間/依存/リソースを復元して編集可能に（`importMSPDI()`+`durToDays()`, DOMParser使用）。バイナリ .mpp は非対応（MS Projectで Save As▸XML してから取込む案内をトースト表示）。自作エクスポートとの round-trip 可（UID==ID==appID で先行参照が保たれる）。
  - **Learn タブ**: 完全初心者向け9レッスン（What is MSP / Tasks&Durations / WBS&Summary / Dependencies FS-SS-FF-SF / Milestones / Gantt / Critical Path / Resources&Calendars / Baselines）＋用語集＋ミニクイズ。
  - URLパラメータ: `?data=<base64url JSON {name,start,hours,tasks[]}>` で保存済みスケジュールを読み込み、`?view=learn` でLearnタブ起動。
- コレクション化済み: `MS Project スケジュール` collection（slug: msp-studio, `/collections/msp-studio`）。
  - レコード = 1プロジェクトスケジュール。fields: id/title/category(内装・建築/IT・システム/イベント/社内プロジェクト/その他)/status(下書き/作業中/確定)/done(toggle)/startDate/finishDate/workingDays/taskCount/milestoneCount/hoursPerDay/tasks(table: tid,name,level,days,preds,res)/app(file→本体HTML)/notes/updatedAt。
  - カスタムビュー「MSP Studio を開く」(`views/launcher.html`)= ビルダー起動ボタン＋保存済みスケジュール一覧。カードクリックで `?data=` を組み立ててアプリに内容を読み込んだ状態で新タブ起動。カンバン(status)・カレンダー(startDate→finishDate)ビューも自動付与。
  - サンプル `fit-out-schedule` 投入済み（オフィス内装工事24行、開始2026-07-06→完了2026-12-03、108営業日、18タスク）。
- レコード I/O は manageCollection ツール、スキーマ変更は schemaDocs/getSchema/putSchema。
- 未実装/将来: アプリからコレクションへの直接保存（トークン必要なため現状は手動/アシスタント経由）、依存関係のラグ(FS+2d)対応、.mppバイナリ直読み（要外部変換）。

- ユーザーは仕事で日本語図面の一部を英訳して渡す作業が大量にあり自動化したい。
`data/skills/pdf-translate/` に skill を構築した。

- チャット指示（「図面名を英訳して赤字で載せて」「凡例も訳して」「2つ目消して」「右に寄せて」）で操作。
- フロー: `scripts/extract.py`(pdfplumber で日本語語＋座標抽出) → Claude が該当 span を特定＆英訳 → ジョブのステートJSON(`jobs/<slug>.json`)に注釈追記 → `scripts/render.py`(reportlab+pypdf で赤字オーバーレイ) → 新PDF。
- 状態＝ステートJSONの annotations 配列。追加/削除/移動/色/訳文の修正はJSONを書き換えて再レンダー。累積編集OK。
- 翻訳は Claude 自身が実施（ANTHROPIC_API_KEY 不要）。venv は `data/skills/pdf-translate/.venv`。
- 元実装 github.com/HisashiUehara/pdf_annotator（Streamlit+矩形UI版）から抽出・描画ロジックだけ流用。`github/pdf_annotator/` にクローン済み。
- MVP「図面名を英訳して赤字で載せる」は疑似図面PDFで動作検証済み。
- 将来拡張: kind に arrow/box を足して矢印・囲みマークアップ対応予定（現状 text のみ）。スキャンPDF(画像のみ)は対象外。
- コレクション化済み: `図面英訳ジョブ` collection（slug: pdf-translate, `/collections/pdf-translate`）で各ジョブを一覧管理。レコード `data/pdf-translate/items/<id>.json`（fields: id/title/status[作業中/レビュー/完了]/sourcePdf/outputPdf/annotationCount/pageCount/notes/updatedAt）。ヘッダ「新しい図面を英訳」＋レコード「追記・修正を依頼」ボタン（office ロール, templates/new-job.md・edit-job.md）。デモレコード demo-floor-plan 投入済み。レンダーのたびに manageCollection でレコードも更新する運用。

