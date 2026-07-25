# @mulmobridge/web-push

Auth-agnostic sender for the **mulmoserver `sendPush` Cloud Function**. The app only
POSTs `{ title, body }` + a Firebase Auth ID token; the target devices resolve
server-side from the signed-in user's uid, and device registration / delivery /
dead-token pruning are the server's job (see mulmoserver `docs/web-push-sending.md`).

No firebase or app dependency — the caller injects the ID-token provider, so both
mulmoclaude and mulmoterminal share one source of truth for the wire contract.

## Usage

```ts
import { sendWebPush } from "@mulmobridge/web-push";

const result = await sendWebPush("✅ my-project", "Task finished", {
  // Return the current Firebase Auth ID token, or null when not signed in.
  getIdToken: async () => auth.currentUser?.getIdToken() ?? null,
});
// → { sent, failed, targets } on success, or null when nothing was sent
//   (not signed in / network / timeout / non-2xx). Never throws.
// targets === 0 means the user hasn't enabled notifications on any device.
```

## API

- `sendWebPush(title, body, options)` — POST to `sendPush`. No-ops (returns `null`,
  never fetches) when `getIdToken()` yields `null` or rejects. `AbortController`
  timeout (default 8000 ms). Never throws.
- `buildSendPushBody(title, body, data?)` — the onCall `{ data: { title, body } }`
  envelope, with the routing map nested as `data.data` when non-empty.
- `parseSendPushResult(json)` — read `{ sent, failed, targets }` from the onCall
  `{ result }` envelope, or `null` when the shape doesn't match.
- `DEFAULT_SEND_PUSH_URL` — the mulmoserver production endpoint.

### `SendWebPushOptions`

| Field | Default | Purpose |
|---|---|---|
| `getIdToken` | — (required) | `() => Promise<string \| null>`; `null` ⇒ skip |
| `url` | `DEFAULT_SEND_PUSH_URL` | sendPush endpoint |
| `timeoutMs` | `8000` | request timeout |
| `fetchImpl` | `globalThis.fetch` | test seam |
| `data` | — | `Record<string, string>` forwarded to FCM's `data` block, for routing the tap |

### Routing the tap (`data`)

A push with only a title and body lands the user on the home screen. Attach `data`
so the receiver knows what to open:

```ts
await sendWebPush("✅ my-project", "Task finished", {
  getIdToken,
  data: { sessionId },   // → the receiver can open /terminals/{sessionId}
});
```

FCM requires **string** values. The map is deliberately untyped beyond that — each
host picks its own routing keys.

`data` is added *alongside* `notification`, never instead of it: both mulmoserver
receivers return early when `payload.notification` is missing, so a data-only
message is silently discarded. Omitting `data` (or passing `{}`) sends exactly the
envelope this package sent before the option existed.

## Related projects

Used by both MulmoClaude and MulmoTerminal, and published from the MulmoClaude monorepo by [Receptron](https://github.com/receptron).

- **[MulmoClaude](https://github.com/receptron/mulmoclaude)** — an open-source AI assistant platform that runs on your own computer. Claude Code as the engine, a personal wiki for long-term memory, schema-driven collections for your data, and chat that summons the right GUI (markdown, charts, forms, spreadsheets, wikis) for each task.
- **[MulmoTerminal](https://github.com/receptron/mulmoterminal)** — a terminal-first cockpit for running many AI coding agents in parallel. One roster showing every session's summary and PR status, tmux-backed session persistence, git-worktree isolation, one-click PRs, and mobile push with remote reply.
- **[MulmoTerminal manual](https://receptron.github.io/mulmoterminal/)** — setup, workflows, feature reference, configuration, mobile notifications, and alternative / local model providers. Available in English and Japanese.

## License

MIT
