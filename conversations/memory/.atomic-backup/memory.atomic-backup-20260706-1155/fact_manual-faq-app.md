---
name: 社内マニュアルFAQアプリ (manual-faq)
description: Turner & Townsend KK 向けに構築した社内マニュアル問い合わせ自動化アプリ
type: fact
---
ユーザーは Turner & Townsend KK の Office Manager。社員からのマニュアル問い合わせ（1日20-30件）を自動化するため、`manual-faq` コレクションアプリを構築した。

- 検索＋カテゴリ閲覧できる「ヘルプデスク」custom view (`data/skills/manual-faq/views/helpdesk.html`) が社員向け入口 (`/collections/manual-faq`)。
- カテゴリ: 勤怠 / 経費 / 出張 / 設備・予約 / IT・システム / その他。
- 初期FAQ 6件（勤怠アプリ・経費申請・出張申請・出張予約・座席予約・プリンター設定）を「下書き」状態で投入済み。company-specific な詳細（URL・締切・承認者）は要確認・要更新。
- 見つからない質問は view の「担当者に聞く」ボタンから office ロールのチャットを起動でき、回答を新FAQとして育てられる。
