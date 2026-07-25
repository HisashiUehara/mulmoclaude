# fix(files): one home for the host↔POSIX workspace-path crossing (#2542)

## Symptom

On a Windows host, a `.gitignore` rule stopped hiding anything below the
workspace root — the entries surfaced in the Files tree. Root-level entries
still filtered correctly, which is what made it easy to miss.

## Root cause

Workspace-relative paths are a POSIX contract: `TreeNode.path`, the upload
response, the `file:` pubsub channel, `<collection_paths>` in the agent prompt,
export manifests and wiki link hrefs are all `/`-separated on every host. Only
the filesystem layer speaks `path.sep`.

The tree walk built its paths with `node:path`, which returns host-shaped
strings, and then fed them to the `ignore` package, which only matches POSIX
input. Verified against the version in the lockfile:

| input | matches `node_modules/` / `ignored.md` |
|---|---|
| `dir1/ignored.md` | ✅ true |
| `dir1\ignored.md` | ❌ **false** |

## Sweep (per the "a bug at one call site is a report about a RULE" rule)

16 sites decide this rule. Classified before changing anything:

**A — crosses to the POSIX contract (6, all routed through the new helper):**

| site | state before |
|---|---|
| `files.ts` tree seed (`path.relative`) | 🔴 bug — Windows-shaped seed |
| `files.ts` tree children (`path.join`) | 🔴 bug — the #2542 symptom |
| `upload-name.ts` `uploadRelPath` | 🟡 #2540 fixed it with a blanket `\`→`/` replace |
| `wiki-backlinks/index.ts` | 🟢 hand-rolled `.split(path.sep).join("/")` |
| `exportCollection.ts` | 🟢 hand-rolled, same |
| `skillAssets.ts` | 🟢 hand-rolled, same (#1897) |

Fixing only the reported line would have left the seed host-shaped and produced
`dir1\sub/name` — mixed. Three hand-rolled copies of one rule is proof the
helper was already needed.

**B — host-internal, MUST NOT be touched (10):** `files.ts` 300/354/753/869/933/970,
`safe.ts:167`, `wiki-pages/io.ts:118`, `packHtml.ts:48`, `pdf.ts:114`,
`skill-bridge:76`, `wiki/paths.ts:33`. These compare against `path.sep` or `..`
for containment; normalising them would trade one bug for another.

## The helper

`@mulmoclaude/core/files` (already "the one implementation" of atomic writes and
the containment check) gains:

- `toPosixRelPath(hostRelPath, sep?)` — **splits on the host separator** rather
  than replacing every `\`. A backslash is a legal POSIX filename character, so
  a blanket replace turns the single directory `we\ird` into two segments and
  sends the write elsewhere. No-op on POSIX, correct on Windows.
- `joinPosixRelPath(dirRelPosix, segment)` — appends one segment to an
  already-POSIX parent, touching nothing inside either.

`sep` is a parameter so the Windows rule is assertable from a POSIX runner.
Bound to the host's own separator, the rule is invisible outside Windows CI —
which is how the backslash form reached main twice (#2540, #2542).

## Side effect of the #2540 alignment

`uploadRelPath` now handles both edge cases correctly, where each previous
implementation only handled one:

| input | blanket replace (#2540) | plain `path.posix.join` | now |
|---|---|---|---|
| Windows client sends `data\sub` | `data/sub/photo.png` ✅ | `data\sub/photo.png` ❌ | ✅ |
| POSIX dir literally named `we\ird` | `we/ird/photo.png` ❌ | `we\ird/photo.png` ✅ | ✅ |

## Verification

- Mutation check: with the tree join reverted to a Windows-shaped join, 5 tests
  go red on macOS — both `.gitignore` cases and all three path-shape cases.
- That mutation also exposed a **false-passing assertion** in the first draft:
  the leaked node's own `name` comes back as the whole `dir1\node_modules`
  string, so an equality check on `name` reported "absent" for an entry that was
  present. The assertions now match on a path substring.
- `yarn format` / `lint` (0 errors, 45 pre-existing warnings) / `typecheck` /
  `build` / `test` (7923 pass, 0 fail).

## Known limitation

The one-time cost on Windows: `TreeNode.path` changes from `sub\a` to `sub/a`,
and `src/utils/files/expandedDirs.ts` persists expand/collapse state in
localStorage keyed by the raw path string. Existing Windows users see the Files
tree's expanded state reset once. No other consumer of those paths was found.
