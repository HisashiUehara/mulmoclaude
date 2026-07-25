# @mulmoclaude/edgar-plugin

SEC EDGAR runtime plugin for MulmoClaude — wraps the public EDGAR API as one tool with kind-discriminated dispatch. Server-only; no Vue View.

A plugin for [MulmoClaude](https://github.com/receptron/mulmoclaude) — loaded by the host, not run standalone.

## Dev loop

```bash
yarn workspace @mulmoclaude/edgar-plugin run build
yarn workspace @mulmoclaude/edgar-plugin run test
```

## Related projects

Published from the MulmoClaude monorepo by [Receptron](https://github.com/receptron).

- **[MulmoClaude](https://github.com/receptron/mulmoclaude)** — an open-source AI assistant platform that runs on your own computer. Claude Code as the engine, a personal wiki for long-term memory, schema-driven collections for your data, and chat that summons the right GUI (markdown, charts, forms, spreadsheets, wikis) for each task.
- **[MulmoTerminal](https://github.com/receptron/mulmoterminal)** — a terminal-first cockpit for running many AI coding agents in parallel. One roster showing every session's summary and PR status, tmux-backed session persistence, git-worktree isolation, one-click PRs, and mobile push with remote reply.
- **[MulmoTerminal manual](https://receptron.github.io/mulmoterminal/)** — setup, workflows, feature reference, configuration, mobile notifications, and alternative / local model providers. Available in English and Japanese.
