# feat(#2571): 「これバグ？」の自己解決優先 triage

mulmoterminal#797 と同じ機能を MulmoClaude に。**ゴールは issue を作ることではなく、
ユーザーがその場で解決すること。** issue は他の3ステップが挙動を説明できなかった残りかす。

## #797 から意図的に変えた3点

### (1) 配布形態: 同梱 skill → 既存 help への節追加

preset skill (`mc-bug-report`) は `data/skills/catalog/preset/` に入るだけで、★スターされるまで
`.claude/skills/` に来ない（`packages/core/src/workspace-setup/sync.ts`）。壊れて困っている人が
事前にスターしている前提は成り立たないので却下。

help doc は毎 boot で `config/helps/` に seed されるので既定で効く。さらに**手順の新規 help は立てず
`error-recovery.md` に節を足す** — 手順の索引が2つに分かれると「gh が使えない」のような両方に出る
話の重複管理が始まり、片方が確実に腐る。

`bug-report-faq.md` を別ファイルにするのはこれと矛盾しない。あちらは**手順ではなくデータ**
（症状 → 確認先の pointer 表）で、CI がパースして pointer の実在を検証する対象になる。手順は
`error-recovery.md` が持ち、FAQ はそこから引かれる索引、という役割分担。

### (2) 入口: starter query（新 UI ゼロ）

`RoleSchema.queries` は `ChatInput.vue` → `SuggestionsPanel.vue` に渡り、クリック可能な候補として
並ぶ。`general` role に1行足すだけで入口ができる。新 role も新 UI も要らない。

### (3) マスキング: LLM の散文指示 → サーバ側のコード ★主眼

#797 は「`*_KEY` は値を出さずキー名のみ」と skill 本文に書いて model に守らせていた。
MulmoClaude は条件が悪い: `googleMapsApiKey` は平文保存、`config/mcp.json` の env / headers に
トークンが入り得る。散文指示はいずれ漏らすので、サーバがマスク済み markdown を返す。

**アロウリスト方式**（deny list ではない）: 値を出すのは明示したキーだけ。新しい設定キーが
増えたとき、既定で「伏せる」方向に倒れる。

## 実装

| ファイル | 内容 |
|---|---|
| `server/system/config.ts` | `APP_SETTINGS_KEYS` / `SAFE_SETTINGS_KEYS` を `as const` で追加。型レベルで `AppSettings` と一致を強制 |
| `server/utils/diagnostics/report.ts` | 純関数。`redactSettings()` + `buildDiagnosticsReport()`。I/O なし |
| `server/api/routes/diagnostics.ts` | `GET /api/diagnostics/report` — I/O を集めて純関数に渡すだけ |
| `src/config/apiRoutes.ts` | route 定数 |
| `packages/core/src/workspace-setup/faq-entries.ts` | FAQ パーサ（純関数） |
| `packages/core/assets/helps/bug-report-faq.md` | 症状 → 確認先の索引（CI 検証対象） |
| `packages/core/assets/helps/error-recovery.md` | 「ユーザーが症状を申告した場合」節を追加 |
| `packages/core/assets/helps/index.md` | FAQ を1行登録 |
| `server/prompts/system/system.md` | 発火条件を「ツール失敗 **または** ユーザー申告」に広げる |
| `src/config/roles.ts` | `general` の `queries` に1行 |
| `docs/shared-utils.md` | redact ヘルパを登録 |

### system.md は「追加なし」では済まない

該当節の見出しは `## When a tool call fails`、本文も
「BEFORE asking the user a clarifying question or giving up」でツール失敗に閉じている。
ユーザーが「なんか変」と言っただけではツールは失敗していないので発火しない。見出し＋1文を広げる。

### FAQ の書式（値を書かない索引）

```
## 症状を、ユーザーが言いそうな言葉で

configKey: <settings.json のキー>
source: <実装パス>
help: <helps/*.md>

何を確認するか。値そのものは書かない。
```

> 値は黙って腐るが、設定キーやパスは変われば実装が動かなくなるので必ず直る。

CI 検証: `configKey` が `APP_SETTINGS_KEYS` に実在 / `source`・`help` のパスが実在 /
全エントリが少なくとも1つ pointer を持つ。

`AppSettings` は Zod でなく TS `interface` なので実行時にキー一覧が取れない。
`APP_SETTINGS_KEYS` を `as const` で足し、`AppSettings` との一致を型で縛る。診断レポートの
アロウリストも同じ定数から引くので、設定キーが増えたとき1箇所で追随する。

## テスト

| ファイル | 何を守るか |
|---|---|
| `test/workspace/test_faq_entries.ts` | パーサの単体（fence 内無視 / 見出し前の field 破棄 / prototype 汚染） |
| `test/workspace/test_bug_report_faq.ts` | 同梱 FAQ の実ファイル検証（pointer 実在） |
| `test/server/utils/test_diagnostics_report.ts` | マスキング。**未知キーが既定で伏せられること**を含む |

**破壊確認**: 各テストが対象を壊したとき赤くなることを確認する（`configKey` をリネーム /
アロウリストに未知キーを足す / `source` パスを移動）。

## `gh` は既定で使えない前提

サンドボックス有効（Docker あり＝既定）だとエージェント内に `gh` 認証が無い。Step 3 の検索と
Step 4 の投稿は `gh` が通らない側を主導線にする（URL 提示 + markdown 全文）。
分岐は `error-recovery.md` の gh/SSH 節と `github.md` に既にあるので参照するだけ。

## バージョン

`packages/core/assets/helps/*` を触るので `@mulmoclaude/core` 1.4.0 → 1.5.0、
launcher の dep range も `^1.5.0`（launcher-sync gate は同 PR での更新を要求する）。
launcher 自身の `version` は触らない（`/publish-mulmoclaude` の領域）。
plugins 側の range は publish 時に一括で追随させる（直近の #2569 も同じ扱い）。

## スコープ外

- アプリが起動しない / エージェントが立ち上がらないケース（`~/.claude/skills/` 同梱の仕組みが
  新規に必要で丸ごと別作業）
- 診断レポートを UI のボタンからコピーできるようにする（route ができれば後から足せる）
