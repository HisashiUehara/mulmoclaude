# @mulmoclaude/google-plugin

MulmoClaude runtime plugin exposing the user's **locally linked Google
account** to the chat agent as one `google` tool (kind-discriminated
dispatch). Server-only — no Vue View.

- Engine: `@mulmoclaude/core/google` (OAuth loopback + PKCE, token store at
  the host-neutral `~/.config/mulmo/google-token.json`, Calendar / Tasks /
  Drive REST). The host's settings UI, remote commands, auth CLI, and this
  tool share one link state — across hosts, too.
- Linking needs **no Google Cloud setup**: the mulmoserver broker applies the
  OAuth client secret Google requires and stores nothing; tokens stay on the
  user's machine. A `~/.secrets/client_secret_*.json` (advanced) keeps the
  whole flow local instead.
- Kinds: `status`; Calendar (`calendarListEvents`, `calendarCreateEvent`);
  Tasks (`taskListsList`, `tasksList`, `tasksCreate`, `tasksComplete`);
  Drive (`driveList`, `driveCreate`, `driveRead`).
- **Drive is `drive.file`-scoped** — the app only ever sees files it created,
  never the user's wider Drive. That's what keeps the scope non-sensitive.
- Not linked yet? The tool's errors tell the LLM to guide the user to this
  app's settings — wording is host-neutral (#2128) because link flows differ
  per host (MulmoClaude: Settings → Plugins → Google or `yarn google:auth`;
  MulmoTerminal: Settings → Google account or `npx mulmoterminal google login`).

## Dev loop

```bash
yarn workspace @mulmoclaude/google-plugin run build
yarn workspace @mulmoclaude/google-plugin run test
```

## Related projects

Used by both MulmoClaude and MulmoTerminal, and published from the MulmoClaude monorepo by [Receptron](https://github.com/receptron).

- **[MulmoClaude](https://github.com/receptron/mulmoclaude)** — an open-source AI assistant platform that runs on your own computer. Claude Code as the engine, a personal wiki for long-term memory, schema-driven collections for your data, and chat that summons the right GUI (markdown, charts, forms, spreadsheets, wikis) for each task.
- **[MulmoTerminal](https://github.com/receptron/mulmoterminal)** — a terminal-first cockpit for running many AI coding agents in parallel. One roster showing every session's summary and PR status, tmux-backed session persistence, git-worktree isolation, one-click PRs, and mobile push with remote reply.
- **[MulmoTerminal manual](https://receptron.github.io/mulmoterminal/)** — setup, workflows, feature reference, configuration, mobile notifications, and alternative / local model providers. Available in English and Japanese.
