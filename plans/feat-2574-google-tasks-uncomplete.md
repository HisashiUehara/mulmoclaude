# feat(google): `tasksUncomplete` (#2574)

## Background

Issue #2572 gave `tasksUpdate` `title` / `notes` / `due` and deliberately withheld
`status`, so that `tasksComplete` is the only route to the completed state —
"two ways to set the same state always drift apart".

The consequence #2574 records: **a task completed by mistake cannot be
un-completed** from MulmoClaude. The only fix was to open Google ToDo.

## Option chosen — A (the issue's own recommendation)

| Option | Verdict |
| --- | --- |
| **A. new `tasksUncomplete` kind** | **Chosen.** One kind per target state; each value has exactly one code path setting it. Costs one kind. |
| B. `completed?: boolean` on `tasksComplete` | Rejected — `tasksComplete` that un-completes is a lying name, and renaming breaks existing callers. |
| C. allow `status` on `tasksUpdate` | Rejected — this is precisely the two-routes drift #2572 avoided. |

## Changes

**`@mulmoclaude/core`**

- `uncompleteTask(accessToken, input)` in `src/google/tasks.ts` — PATCHes
  `{ status: "needsAction" }`, mirroring `completeTask`. New
  `TASK_STATUS_NEEDS_ACTION` constant so the literal appears once.
- Exported from `@mulmoclaude/core/google`.
- The `buildTaskPatch` comment now says `completeTask` / `uncompleteTask` own
  the status transition, since it named only the first.

**`@mulmoclaude/google-plugin`**

- `args.ts` — `tasksUncomplete` kind (`taskId` required, optional
  `taskListId`), shaped exactly like `tasksComplete`.
- `index.ts` — the dispatch case.
- `definition.ts` — enum entry, tool description, and `taskId`'s description.

## Two things worth knowing

**The patch carries `status` alone — and whether Google resets the `completed`
timestamp is unverified.** `completeTask` sets only `status` and lets Google
fill the timestamp in; this mirrors it on the way back. Nothing here proves
Google clears it again, and the stubbed tests cannot: `TaskSummary` doesn't
carry `completed`, so a stale one would only ever be visible in Google's own
UI. `docs/manual-testing.md` §10 is the live check; if a date lingers, the fix
is `completed: null` in the patch body. PATCH, not PUT — a PUT would need the
whole task and would drop `title`, `notes`, `due` and `position`.

**Completed tasks are invisible by default.** `tasksList` sends
`showCompleted=false`, so an agent asked to un-complete something cannot find
the id without `showCompleted: true` first. The tool description says so —
otherwise the model lists, sees nothing, and reports the task doesn't exist.

## Testing

**`test/services/google/test_taskStatusTransitions.ts`** (new, 6 tests) —
`globalThis.fetch` stubbed, no network. The regression they guard is a typo or
a copy-paste that leaves both functions sending the same status: the request
still goes out, still looks like success to every caller, and the task simply
doesn't move. What Google does with a *malformed* status is out of reach here —
the stub answers 200 whatever it receives.

- both transitions send exactly `{ status: ... }` and nothing else
- the two send *different* values — catches a copy-paste that leaves both
  sending `completed`
- default list resolution, task-id URL encoding

**`packages/plugins/google-plugin/test/test_args_validation.ts`** — the new
kind joins the blank-`taskListId` sweep (a blank used to reach core as `""` and
build `/lists//tasks`), plus parse / missing-`taskId` cases, plus: an edit field
is **stripped**, so `tasksUncomplete` cannot become a second edit route. The
schema is non-strict throughout, so stripping — not throwing — is the real
guarantee; `tasksComplete` behaves identically.

`test_kind_coverage.ts` pins `args.ts` against `definition.ts`, so a kind added
to one and not the other fails automatically.

**Mutation-checked**: changing `needsAction` to `needsaction` — the casing typo
Google would silently accept — fails 2 tests.

## Release note

This touches two **published** packages. npm users get it only after
`@mulmoclaude/core` and `@mulmoclaude/google-plugin` are republished
(core 1.3.0 / google-plugin 1.0.2 as of this branch). No version bumps here:
per CLAUDE.md the bump belongs to the publish commit, not the feature PR.
