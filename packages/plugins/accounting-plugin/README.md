# @mulmoclaude/accounting-plugin

Double-entry accounting plugin for MulmoClaude and MulmoTerminal. Three surfaces: ./shared (isomorphic enums/meta, browser-safe), ./vue (chat View/Preview + canvas app), ./server (createAccountingRouter — the workspace-file-backed backend, wired via dependency injection so it pulls zero host-only infra).

A plugin for [MulmoClaude](https://github.com/receptron/mulmoclaude) and [MulmoTerminal](https://github.com/receptron/mulmoterminal) — loaded by the host, not run standalone.

## Dev loop

```bash
yarn workspace @mulmoclaude/accounting-plugin run build
yarn workspace @mulmoclaude/accounting-plugin run test
```

## Related projects

Used by both MulmoClaude and MulmoTerminal, and published from the MulmoClaude monorepo by [Receptron](https://github.com/receptron).

- **[MulmoClaude](https://github.com/receptron/mulmoclaude)** — an open-source AI assistant platform that runs on your own computer. Claude Code as the engine, a personal wiki for long-term memory, schema-driven collections for your data, and chat that summons the right GUI (markdown, charts, forms, spreadsheets, wikis) for each task.
- **[MulmoTerminal](https://github.com/receptron/mulmoterminal)** — a terminal-first cockpit for running many AI coding agents in parallel. One roster showing every session's summary and PR status, tmux-backed session persistence, git-worktree isolation, one-click PRs, and mobile push with remote reply.
- **[MulmoTerminal manual](https://receptron.github.io/mulmoterminal/)** — setup, workflows, feature reference, configuration, mobile notifications, and alternative / local model providers. Available in English and Japanese.
