---
name: MSP Studio — MS Project作成＆学習アプリ＋コレクション
description: MS Projectスケジュールを作成・学習でき、MSPDI(.xml)を書き出せる単体HTMLアプリと、作ったスケジュールを管理するコレクション
type: fact
---

ユーザー(Turner & Townsend KK, Office Manager)向けに「MS Projectを簡単に作れて、かつMSPを学べる」アプリを構築。

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
