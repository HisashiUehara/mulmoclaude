---
type: reference
topic: tasks
---

# 作業メモ・成果物の参照

## MulmoNavi 会話のLLM化（ハイブリッド2層）
- 本体 `artifacts/html/2026/07/voice-nav.html`。第1層=parseIntent(パターンマッチ, 遅延ゼロ: stop/start/repeat/mode/category/高速確認)。第2層=`/api/nav-chat`(OpenAI gpt-4o-mini)へ greet/thanks/ack/chat を委譲、失敗時は定型文フォールバック。
- サーバー: `server/api/routes/navChat.ts`。認証は view-token 専用スコープ `aud:"nav-chat"`(`server/api/auth/viewToken.ts` の mint/require/isNavChatAuthPath)。発行ルートは `collections.ts` の nav-chat-token。`server/index.ts` でCSRF/bearer免除に追加。
- OpenAIキーは `.env` の OPENAI_API_KEY をサーバー側のみで使用(クライアントには鍵もapi.openai.comも無い)。launcher が `#mcnav=` でトークンを本体タブへ渡す。
- 注意: dev は `tsx server/index.ts`(watch無し)。新ルート反映にはサーバー再起動が必要。

## New Starter オンボーディング（案B: Git風構成）★S1〜S5 完了・稼働中
- 3コレクション: `new-starter`（1タスク=1レコード＝branch相当）＋ `new-starter-templates`（標準19タスク=main相当）＋ `onboarding-audit`（イベント集約=commit log相当）。案B（Collection内でGit風概念を模倣・本物のgitは使わない）。
- 全体構成の一次情報は **`data/skills/new-starter/SKILL.md` の「システム全体構成」節**に集約済み（成果物/Git対応/運用手順/実装メモ/将来課題）。改修時はまずそこを読む。
- 手順書: propagate=`data/skills/new-starter/templates/propagate.md`、audit同期=`data/skills/onboarding-audit/templates/sync-audit.md`。ビュー=`data/skills/new-starter/views/tracker.html`。
- diffバッジ=overridden/templateTaskId から算出（ビューは自コレクションしか読めないサンドボックス制約のため）。history はタスクレコード内 table（タイムラインUI源）、onboarding-audit は agent 同期の横断集計面。history.field enum に `template`（テンプレ改訂反映）を追加済み。決定的ID=`<taskId>__<epochms>__<field>`（epochmsはAsia/Tokyo・秒00）。
- デモデータ: 山田太郎（taro-yamada-01〜19, 8/1入社）。onboarding-audit に検証由来の3件あり。
- 将来課題（記録のみ・未実装）:
  1. history 肥大化対策（完了starterの履歴退避・トリム）。
  2. audit 同期の自動schedule化（現状 Refresh の on-demand のみ）。
  3. 頻出差分の検出→テンプレへのマージ提案（onboarding-audit を土台に）。
  4. 分単位ID衝突（同一タスク・同一項目を同一分に複数変更で1件集約）→秒精度化 or 連番付与。
  5. actor 識別（ホストが操作者IDを提供したら既定「Office Manager」を置換）。
- スコープ外（あえて不実装）: (1)真の3-way merge / blame、(2)廃止テンプレ対応レコードの自動削除（データ保全で報告のみ）。

## WeeklyReport 週報英訳パイプライン（AI→DSL→engine）★Stage 1 完了
- 目的: 施工業者の日本語週報を、テナント用テンプレートに流し込んだ英文レポートへ変換。役割分担=AIは翻訳のみ / 抽出・書式・流し込みはengine(コード) / 承認は人間。
- コレクション `weekly-report`（`data/skills/weekly-report/`）。1レコード=1変換案件。status: 入力待ち→抽出済→翻訳済→承認待ち→承認済→完成。
- DSL正準定義=`data/skills/weekly-report/dsl/weekly-report.dsl.schema.json`（items[]: id/source_location/原文/訳文/confidence(high|low)）。confidence=low は確認画面で強調。
- 制約: (1)ステップ5承認スキップの自動実行モードは作らない、(2)NDA完了までダミーデータでE2E、(3)AIは転記・書式を決めない。
- 段階実装（各Stageで停止報告）: S1=SKILL.md+DSL定義+ゴールドペア ✅ / S2=書式・原文抽出engine+ダミー ✅ / S3=AI翻訳 / S4=確認UI(日英横並び・low強調・承認ボタン, 仕様=docs/confirm-ui.md) / S5=流し込みengine+E2E。
- S2実装済(engine/product.py, 凍結pipeline.pyの抽出をread-only再利用): `extract-template`→templateFormat.json(書式=font/size/align・章構成・結合セル=表構造・{{NNN}}プレースホルダ→転記先loc)、`extract-source`→source.dsl.json(items[]=id/source_location/原文, 訳文空・confidence未設定)。ダミー=fixtures/dummy/(make_dummies.py生成器, contractor-report.xlsx/tenant-template.xlsx, sample-output/)。業者ダミーの原文は仮ゴールドと同一にして検証成立。E2E=engine/validate_stage2.py(source: id/loc/原文が仮ゴールド完全一致, template: 全12プレースホルダ検出+書式取得)→PASS。仕様=docs/stage2-engine.md。
- 構成: SKILL.mdは軽量（目的・WF概要・参照のみ）。詳細は段階的開示で分割=`docs/schema.md`（スキーマ）/`docs/gold-pair.md`（E2E期待値の当て方）/`docs/confirm-ui.md`（確認UI仕様）。
- ゴールドペア（全StageのE2E正解参照, サニタイズ済み架空データ）=`fixtures/gold/ideal-report.md`（理想の完成英文レポート）＋`fixtures/gold/expected.dsl.json`（対応DSL12項目, low=006/007/008/010）。※現行は**仮ゴールド**（自作）。実物取込パイプライン完成後に差し替え予定。
- ★方針変更: ゴールドは自作でなく**実物取込パイプライン**で作る。実装済み=`engine/pipeline.py`（Python, openpyxl/python-pptx）。役割=抽出コード/サニタイズAI/出力コード/漏れスキャンコード/承認人間。6段: (1)`import/`に実物.xlsx/.pptx投入→(2)`extract`で書式(font/size/align)・章構成・表・メタ・資産抽出→(3)AIが`sanitized-map.json`でテキストのみ架空化(書式不変)→(4)`apply`=原本コピーに**在所置換**+メタ除去+対応DSL出力→(5)`scan`でサニタイズ漏れ機械照合→presentFormチェックリスト(固有名詞/数値/ロゴ/ヘッダーフッター/プロパティ/埋込)で承認まで停止→(6)承認後import/実物削除+報告。
- 設計要点: 「原本コピーへテキスト在所置換」で書式・構造を構造的に保持(再構築しない)。メタは生XML(core.xml/app.xml)照合(openpyxl既定値の誤検知回避)。汎用語はkept_identicalで漏れ除外。xlsx/pptx両パスE2E検証済(auto_clean:True)。Stage5一致判定=「テキスト+書式」両方。
- 画像対応(追加仕様): テキスト置換で消せない画像/図/埋込のため、apply既定で**全画像(*/media/*)を架空プレースホルダへ差替え**(Pillowで元サイズ・元形式に再エンコード)。ベクタ(EMF/WMF)等は差替え不可→kept-unsupportedでmanual。`--keep-images`で保持時はscanが画像ごとにmanual目視確認項目を出力。image_actions.jsonをapplyが出力しscanが`--images`で読む。両モードE2E検証済。
- ★パイプライン完成・凍結。NDA確認待ち。実物投入→承認後に仮ゴールド差替え予定。要 `pip install -r engine/requirements.txt`(openpyxl/python-pptx/Pillow)。仕様=`docs/gold-import-pipeline.md`、チェックリスト=`docs/sanitize-checklist.md`。中間物は`engine/work/`(一時)。

## RFIAssist RFI資料作成支援（AI→DSL→engine）★Stage 1 完了
- 目的: RFI(Request For Information)資料作成を、依頼受領→ACC提出準備まで支援。役割分担=AIは判定材料整理のみ / 判定・承認は人間 / 送信可能ファイル出力はengine(コード)。メール・ACC直接送信は作らない(出力まで、送信は手動)。
- 中核=再利用可能な「ループ部品」: emit(AIが content+ai_notes 生成, approved常にfalse)→judge(人間のみ, 判定者=自分/相手)→OKで次段/NGで loop_count+1 もう一周。gate=approved:false は後続に流さない。9段ワークフローはこの部品を判定者差し替えで5回並べたもの。
- 5ループ: L1(step2 依頼理解・自分判定, AIは"理解できたか"を判定しない) / L2(step4 不足依頼・相手判定) / L3(step5 要点整理・自分判定) / L4(step7 ドラフト確認・自分判定, NG→AI作り直し) / L5(step8 送信準備・相手判定)。step9=ACC提出パッケージ。
- コレクション `rfi-assist`（`data/skills/rfi-assist/`）。1レコード=1RFI案件。status 9段: 依頼受領→依頼理解(L1)→資料収集→不足依頼(L2)→要点整理(L3)→差込→ドラフト確認(L4)→送信準備(L5)→ACC提出→完了。フィールド: loops[]/collectedDocs[]/dslDrafts[]/outputFiles[]/auditLog[]。
- DSL正準定義=`data/skills/rfi-assist/dsl/rfi-assist.dsl.schema.json`（rfi_id/phase(understand|collect|draft|review|submit)/loop_count/content{宛先,件名,本文,添付[]}/ai_notes/approved）。
- コンテキスト=`data/rfi-assist/context/`（体制表/過去RFI/背景）。空でも動作、あれば候補精度UP。中身はユーザーが後で投入。
- 制約: (1)送信機能作らない=出力まで、(2)approved:false を後続に流さない、(3)AIは判定/承認しない、(4)ダミーデータでE2E。
- 段階実装（各Stageで停止報告）: S1=SKILL.md+DSL+ループ部品設計 ✅ / S2=step2候補出し(context参照) / S3=step3-4(収集+依頼文ドラフト+承認) / S4=step5-7(要点整理・差込・ドラフト確認) / S5=step8-9(送信ファイル・提出パッケージ)+E2E。

## SubmittalGate Submittal承認獲得支援（二重ゲート×AI→DSL→engine）★Stage 1 完了
- 目的: Submittal(お客様承認が必要な物品・仕様)の承認獲得。構造=二重ゲート: my_gate(私が判定・社内の質を固める, step2-5/L1・L2)→ACC提出→client_gate(お客様が最終判定, step6-12/L3・L4・L5・L6)。**RFIAssistのループ部品を再利用**（判定者=私/ゼネコン/お客様, ゲート=my_gate/client_gate を差し替えて6回並べる）。
- ループ部品契約はRFIと共通: emit(AIが diff+content+aiNotes 生成, approved常にfalse)→judge(人間のみ)→OKで次段/NGで loop_count+1。approved:false は後続に流さない。**曖昧・不透明なケースほど人間に回す。AIは判定しない。**
- 6ループ: L1(step3 修正依頼・私判定,監修承認で停止) / L2(step4 修正版確認・私判定) / L3(step6 お客様コメント・お客様判定) / L4(step8 ゼネコン修正依頼・ゼネコン判定,監修で停止) / L5(step10 確認承認・私判定) / L6(step12 お客様承認・お客様判定→結果報告)。step5=ACC提出パッケージ, step11=ACC再提出。
- コレクション `submittal-gate`（`data/skills/submittal-gate/`）。1レコード=1Submittal案件。status 12段+完了: 書類受領→要件照合→修正依頼(L1)→修正版確認(L2)→ACC提出→お客様コメント(L3)→問題点確認→ゼネコン修正依頼(L4)→修正版照合→確認承認(L5)→ACC再提出→結果報告(L6)→完了。フィールド: gate/requiredDocs[]/diffTable[]/loops[]/dslDrafts[]/outputFiles[]/auditLog[]。
- DSL正準定義=`data/skills/submittal-gate/dsl/submittal-gate.dsl.schema.json`（submittal_id/gate(my_gate|client_gate)/phase(check|revise|submit|respond|report)/loop_count/diff[]{項目,要件,提出内容,差分}/content{宛先,本文,添付[]}/approved）。
- 要件定義=`data/submittal-gate/requirements/`（OPR/仕様基準/非互換リスト）。空でも動作。非互換リストに過去照合実績をダミー化(INC-001=GK-SUNVコネクタ×7/8"ケーブル非互換 等)→Stage2照合engine/Stage5 E2Eのテストケース。
- 制約: (1)ACC・メール直接送信は作らない=出力まで、(2)approved:false を後続に流さない、(3)step2でAIは差分材料を出すだけOK/NG判定しない、(4)ダミーデータでE2E。
- 段階実装（各Stageで停止報告）: S1=SKILL.md+DSL+ループ部品流用確認 ✅ / S2=step2照合engine(差分提示) / S3=step3-5(my_gate/L1・L2+ACC提出) / S4=step6-11(client_gate/L3・L4・L5+ACC再提出) / S5=step12結果報告+E2E。
- 注意（解決済）: collection の schema バリデーションは **table の `of` 内で `type:"file"` が不許可**（サブフィールド許容型は string/text/email/number/date/datetime/boolean/markdown/ref/money/enum のみ。file/image/table/derived/toggle/embed はトップレベル専用）。requiredDocs.of.path と outputFiles.of.path を `file`→`string` に修正して登録成功。rfi-assist も同じ原因（collectedDocs.of.path・outputFiles.of.path）で修正済。discovery は毎回ディスクを読む（キャッシュではない）。検証エラーは `server/system/logs/server-YYYY-MM-DD.log` の `prefix:collections` warn に issues として出る。
