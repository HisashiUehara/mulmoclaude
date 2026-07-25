# @mulmoclaude/core

Shared server-side core for MulmoClaude and MulmoTerminal — the always-shipped-together subsystems consolidated behind subpath exports so the two hosts can't drift. Server-only except the browser-safe ./artifacts, ./whisper/client, ./workspace-setup/slug, ./translation/client, ./remote-view, ./remote-host and ./plugin-vue entries. All host specifics are injected.

A library, not an application: [MulmoClaude](https://github.com/receptron/mulmoclaude) and [MulmoTerminal](https://github.com/receptron/mulmoterminal) each import the subpaths they need and inject their own host specifics (logger, workspace root, and so on).

## Dev loop

```bash
yarn workspace @mulmoclaude/core run build
yarn workspace @mulmoclaude/core run test
```

## Related projects

Used by both MulmoClaude and MulmoTerminal, and published from the MulmoClaude monorepo by [Receptron](https://github.com/receptron).

- **[MulmoClaude](https://github.com/receptron/mulmoclaude)** — an open-source AI assistant platform that runs on your own computer. Claude Code as the engine, a personal wiki for long-term memory, schema-driven collections for your data, and chat that summons the right GUI (markdown, charts, forms, spreadsheets, wikis) for each task.
- **[MulmoTerminal](https://github.com/receptron/mulmoterminal)** — a terminal-first cockpit for running many AI coding agents in parallel. One roster showing every session's summary and PR status, tmux-backed session persistence, git-worktree isolation, one-click PRs, and mobile push with remote reply.
- **[MulmoTerminal manual](https://receptron.github.io/mulmoterminal/)** — setup, workflows, feature reference, configuration, mobile notifications, and alternative / local model providers. Available in English and Japanese.
