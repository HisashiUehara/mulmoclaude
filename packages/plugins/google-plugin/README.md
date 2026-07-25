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
- Kinds: `status`; Calendar (`calendarListCalendars`, `calendarColors`,
  `calendarListEvents`, `calendarSync`, `calendarCreateEvent`,
  `calendarUpdateEvent`, `calendarDeleteEvent`); Tasks (`taskListsList`,
  `tasksList`, `tasksCreate`, `tasksUpdate`, `tasksComplete`, `tasksDelete`);
  Drive (`driveList`, `driveCreate`, `driveRead`).
- Editing is a **patch**: omitted fields keep their value, and `""` clears a
  description / notes. Deletes are irreversible, so the tool tells the agent to
  confirm with the user first.
- Date-times must carry a **timezone offset** (`2026-07-17T09:00:00+09:00`);
  Calendar rejects date-only and offset-less values with an opaque 400, so the
  schema rejects them first with an actionable message.
- **Drive is `drive.file`-scoped** — the app only ever sees files it created,
  never the user's wider Drive. That's what keeps the scope non-sensitive.
- Not linked yet? The tool's errors tell the LLM to guide the user to this
  app's settings — wording is host-neutral (#2128) because link flows differ
  per host (MulmoClaude: Settings → Plugins → Google or `yarn google:auth`;
  MulmoTerminal: Settings → Google account or `npx mulmoterminal google login`).

## About MulmoClaude and MulmoTerminal

- **[MulmoClaude](https://github.com/receptron/mulmoclaude)** — an AI-native
  application platform built on Claude Code. Chat summons the right GUI for each
  task (documents, charts, forms, wikis, spreadsheets, 3D scenes), and
  everything your assistant accumulates stays as plain files in your own
  workspace, on your own machine.
- **[MulmoTerminal](https://github.com/receptron/mulmoterminal)** — run a whole
  team of coding agents from your browser. Many Claude Code / Codex sessions at
  once in a grid, colour-coded so you see which are working, which need you and
  which are done, plus git worktrees, one-click PRs and cost readouts. One `npx`
  command, no Electron, no config.

📖 **User guide**: <https://receptron.github.io/mulmoterminal/> (日本語 / English)

## Dev loop

```bash
yarn workspace @mulmoclaude/google-plugin run build
yarn workspace @mulmoclaude/google-plugin run test
```

## License

MIT
