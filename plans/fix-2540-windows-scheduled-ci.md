# fix(ci): both Windows scheduled workflows are red (#2540)

## Symptoms

| Workflow | Step | Failure |
|---|---|---|
| `docker sandbox (Windows junction repro)` | Build @mulmoclaude/x-plugin | `TS2307: Cannot find module '@mulmoclaude/common'` |
| `lint_test (Windows)` (22.x + 24.x) | `yarn run test:coverage` | 4 × `writeUploadWithRename` — `'data\photo.png'` vs `'data/photo.png'` |

## Root causes

### 1. Stale hand-picked build in the sandbox canary

`docker_sandbox_windows.yaml` built `@mulmoclaude/x-plugin` alone before the
whole-workspace build, on the assumption — spelled out in the step's comment —
that the plugin is a self-contained bundle with no workspace dependencies.
x-plugin has since taken a dependency on `@mulmoclaude/common`, which nothing
had built at that point in the job.

The step is redundant: `yarn build:packages:dev`, which runs immediately after,
builds `@mulmoclaude/common` first and then every plugin under
`packages/plugins/*` — x-plugin included.

Because the job died there, neither the sandbox probe nor the #2052
end-to-end MCP check has run since the dependency landed.

### 2. Host-shaped path escaping into a POSIX contract

`writeUploadWithRename` composed its returned workspace-relative path with
`path.join`, which yields `data\photo.png` on Windows. That string is:

- returned to the client as `WriteContentResponse.path`
- passed to `publishFileChange` → the `file:<path>` pubsub channel

Both are `/`-separated contracts on every host (see `toPosixWorkspacePath` in
`src/config/pubsubChannels.ts`). So a Windows host was serving mixed-separator
paths — a real bug, not just a test-expectation mismatch.

It stayed invisible on the ubuntu/macos matrix because the rule was bound to
the runner's own `path.join`.

## Changes

1. `server/utils/files/upload-name.ts` — new pure `uploadRelPath(dirRel, filename, join?)`:
   joins and swaps `\` → `/`. Separators are swapped, never segments dropped, so
   an absolute path stays absolute and `resolveNewFilePath` still refuses it.
   `join` is a parameter so the Windows rule is assertable from a POSIX runner.
2. `server/api/routes/files.ts` — `writeUploadWithRename` and the upload
   start-log preview use it instead of `path.join`.
3. `test/utils/test_upload_name.ts` — a `uploadRelPath` suite that runs every
   case against BOTH `path.posix.join` and `path.win32.join`, asserting the same
   POSIX result on each.
4. `.github/workflows/docker_sandbox_windows.yaml` — drop the standalone
   x-plugin build; the whole-workspace build that follows already covers it.
   Comment records why a hand-picked subset rots.

## Verification

- Mutation check: with the `\` → `/` swap removed, 8 of the 10 new cases go red
  on macOS; restored, all pass.
- `yarn format` / `yarn lint` (0 errors, 45 pre-existing warnings) / `yarn typecheck` /
  `yarn build` / `yarn test` (7915 pass, 0 fail).
- Both workflows re-run via `workflow_dispatch` on the fix branch.

## Follow-up worth considering

The `lint_test (Windows)` failure sat on main for days across ~15 pushes. The
Windows job is neither a required check nor surfaced on PRs, so nothing blocked
the merges. Deciding whether it should gate merges is out of scope here.
