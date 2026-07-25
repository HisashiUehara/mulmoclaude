# perf: stop re-reading every session's meta on each list scan (#2588)

## Problem

`GET /api/sessions` supports a diff cursor, and the client uses it
(`useSessionHistory.ts:85-103`). The **server** does not: `loadAllSessions()`
walks every session in the window and only then filters by `changeMs`.

So a request that returns an **empty diff** — the common case on tab return —
still pays a full scan. Per session:

- `stat` the `.jsonl` (cutoff check)
- `readSessionMeta` → open + read + `JSON.parse` the `.json` sidecar
- `stat` the `.json`

## Measured

On this workspace, 90-day window:

| | |
| --- | --- |
| Sessions in window | **493** (the #2581 reporter has 488 — not an unusual number) |
| Scan, current | **16.9 ms** |
| Scan, cache hit | **1.9 ms** |

~9× on macOS SSD. The gap should widen on Windows, where the **read** is what
Defender inspects while a `stat` is comparatively cheap.

**This does not explain the freeze in #2581.** 17 ms is not seconds. It is
waste worth removing on its own terms, not a diagnosis.

## Change

`server/utils/stampedCache.ts` (new) — a cache whose entry is valid only while
its stamp matches. The stamp is what the caller can read more cheaply than the
value; here, the mtimes the scan stats anyway.

That shape is the point: **no TTL to tune and no watcher to miss an event**, so
serving a value the filesystem has changed is unrepresentable rather than merely
unlikely. A watcher-based short-circuit would be faster still (zero syscalls)
but fails silently when an event is missed — the sidebar would just stop
updating, which is the worst failure mode available here.

In the route, the meta `stat` moves **before** the read so it can key the cache,
and only the **file-derived** part is cached. `live` state and the chat-index
entry move independently of those mtimes and are re-applied on every scan.

### Both mtimes are in the stamp

`readSessionMeta` has two sources: the `.json` sidecar, and — when that is
missing or corrupt — the first line of the `.jsonl`, which costs a read of the
**whole transcript** (`sessions.ts:57`). Keying on the sidecar alone would leave
that fallback paying full price forever.

On this workspace 9 sessions have no sidecar, totalling 4.2 MB, but all 9 fall
outside the 90-day window so none currently pays. It is a latent cost, not an
active one — a recent session losing its sidecar would read its whole jsonl on
every list request.

### A null meta is not cached

Missing or corrupt means the mtimes that produced the null may never move again,
so a negative entry could outlive a repair that rewrote neither file.

## Tests

`test/utils/test_stampedCache.ts` — the dangerous failure is a HIT that should
have been a miss, so the restamp cases carry the weight: stamp moved forward,
stamp moved **backwards** (a restore, a clock change, an older copy — equality
rather than ordering is what makes that safe), superseded stamps not
resurrecting, and `retainOnly` bounding the map.

`test/routes/test_sessionsRoute.ts` — three cases driving the **real handler
twice** with a mutation in between, which is the only way a stale hit shows up:
a rewritten meta must produce the new title, a deleted session must leave the
list, and untouched sessions must survive the scan.

Mutation-checked: pinning the stamp to a constant (so the cache always hits)
turns the rewritten-title test red.

## Test seam

The cache is module-level, so it outlives the fixture directory a suite wipes
between cases — and those cases legitimately rewrite the same session id at the
same mtime, which production never does. Without a reset, a future test writing
an existing id with different content would silently be served the previous
case's meta. `clearSessionMetaCache()` is called from `beforeEach`.

Found reviewing my own diff: `s1` and `a` are already reused across cases today.
They happen not to collide because the content matches too, so nothing fails
yet — it is a landmine rather than a live bug.

## Known limitation

Validity is mtime **equality**. Two writes landing inside the same mtime tick
would leave the first cached. Filesystem mtimes here are millisecond-grained and
meta writes go through an atomic rename, so this needs two writes in the same
millisecond; recorded rather than worked around.

## Not done

The scan still `stat`s twice per session. Removing that needs a watcher on
`conversations/chat/` with the silent-staleness risk described above — a
separate decision, and one that wants #2581's measurements first.
