# fix #2134 — first-turn message decorations break deterministic slash resolution

## Problem

Claude Code CLI resolves a slash command deterministically only when the
user message **starts with** `/name` (it then emits a `<command-name>`
block and invokes the exact named skill). The server decorates the
CLI-bound message in two places that push the slash off position 0, so
the CLI falls back to the model *guessing* the skill from descriptions:

1. **journal pointer** (`server/agent/prompt.ts` `prependJournalPointer`,
   called at `server/api/routes/agent.ts` `dispatchAgentRun`) — prepends a
   `<journal-context>` block on the **first turn** when the workspace has a
   journal (`summaries/_index.md`). Used workspaces almost always have one.
2. **attached-file marker** (`withAttachedFileMarker`) — prepends
   `[Attached file: …]` lines on **every** turn that carries an attachment.

Collection record-detail chats build `/slug id=<itemId> <text>` and start a
**new chat**, so they are always first-turn → always decorated → always
model-guessed. Observed failure: `/todo-malaysia …` invoked the `todo-list`
skill (near-identical name) and wrote to the wrong collection.

Empirically (issue #2134): 122/122 first-turn slash sessions arrived
decorated (0 started with `/`, 0 deterministic resolutions); the only 6
deterministic resolutions were all 2nd+ turns, where nothing is prepended.

## Constraints

- Maintainer: do **not** keep the pointer interleaved in the user message.
- Do **not** move it into the system prompt either (keep the system prompt
  small — explicit user constraint).

## Fix — one principle: never displace a leading `/`

A leading `/` is the CLI's deterministic control token. Server-side
decorations must not push it off position 0. A slash-first message is a
**command**, not an open question, so:

- **journal pointer** → skip entirely on a command turn (prior-session
  context is irrelevant to a deterministic command; this is exactly the set
  of turns that were breaking, so no real feature is lost).
- **attached-file marker** → **append** after the body on a command turn
  (the skill still needs the paths; `/` stays first). Non-command turns keep
  the existing **prepend**.

Detection is `message.startsWith("/")` (no trim) to match the CLI's
position-0 semantics; the collection UI and manual entry produce no leading
whitespace.

## Changes

- `server/api/routes/agent.ts`
  - `withAttachedFileMarker(message, paths, position = "prepend")` — add a
    `"prepend" | "append"` position arg; default preserves current behavior.
  - New pure `decorateMessageForCli({ message, workspacePath, attachedFilePaths, resumed })`
    that encodes the whole policy (skip journal on resume/command; marker
    position by command-ness). `dispatchAgentRun` calls it instead of the
    inline two-liner.
- `test/api/routes/test_agentAttachedFileMarker.ts` — append-position cases.
- `test/api/routes/test_decorateMessageForCli.ts` (new) — the policy matrix:
  - non-command + journal → journal prepended (unchanged)
  - command + journal → NOT prepended, message still starts with `/`
  - command + attachment → starts with `/`, marker appended after body
  - resume (claudeSessionId) → never prepends journal (unchanged)

## Why side-effect-free

Only the **CLI-bound** copy is decorated; the persisted jsonl and the UI
broadcast already use the raw text (`withAttachedFileMarker` docstring), so
this changes nothing users see or that gets stored — only what the model
receives, which is the thing that was broken.
