# fix(dev): backend OOMs during MulmoScript movie builds and takes the whole `yarn dev` down

## Symptoms

Mid-session the server vanishes. The client pane fills with:

```
[vite] http proxy error: /api/plugins/runtime/mulmoScript/dispatch
AggregateError [ECONNREFUSED]:
    at internalConnectMultiple (node:net:1134:18)
...
yarn sleep && vite exited with code SIGTERM
```

Vite is only a proxy for `/api`, so `ECONNREFUSED` means the Express backend is
already dead. `concurrently -k` then SIGTERMs the client, ending the whole dev
session. Recovery was a full manual restart.

Nothing was written to `server/system/logs/server-*.log` — a clean gap between
the last request and the next boot.

## Root cause

Not an exception. Every crash is a **V8 heap OOM**, which calls `abort()`
directly: no `catch`, no `uncaughtException`, no log line. Confirmed from
macOS crash reports (`~/Library/Logs/DiagnosticReports/node-*.ips`) — 11 of
them over four days, all with the same faulting stack:

```
abort
node::OOMErrorHandler(char const*, v8::OOMDetails const&)
v8::internal::V8::FatalProcessOutOfMemory(...)
v8::internal::Heap::CollectGarbage(...)
...
Builtins_AsyncFunctionAwaitResolveClosure
```

A captured heap snapshot from a 68-beat movie build (7.87 GiB live heap):

| node type | self_size | share |
|---|---|---|
| string | 3850 MiB | 47.8% |
| concatenated string (rope) | 2456 MiB | 30.5% |
| array `(object elements)` | 1333 MiB | 16.6% |
| **system / JSArrayBufferData** | **91 MiB** | **1.1%** |

80.5 M rope nodes, and 20+ JS arrays of ~2.4 **million** elements each — one
per beat. Binary payloads were negligible, and no base64 data URI appeared
among the largest strings, which rules out the View's `fileToDataUri` probe
path.

The retained data is index key strings. mulmocast's `fileCacheAgentFilter`
returned the generated media `buffer` as a GraphAI node result even though the
payload is already on disk and nothing downstream reads it. GraphAI keeps every
node result for the whole run and records a debug key per leaf; a `Buffer` is
array-like but not an `Array`, so that walk takes the `Object.keys()` branch and
emits **one key string per byte** — ~280x expansion, ~115 MB retained per beat.
An array of 2.4 M keys is exactly the `Object.keys()` of a 2.4 MB buffer.

Measured growth for the 68-beat build: 568 MB idle → 4.6 GB at ~2 min → 8.2 GB
at ~8.5 min, linear, never released. Node's default ~4 GB old-space was
exhausted around beat 25, which is why builds of this size could never finish.

**The fix belongs upstream** and exists on mulmocast's
`fix/media-buffer-memory-growth` branch (drop `buffer` from the filter's return
value; 68 beats then peaks at 173 MB). It is **not** in the published 2.9.1 —
that release still does `return output` — so a dependency bump does nothing yet.

## What this change does

Everything here is dev-harness only; no published package is touched.

### 1. `scripts/dev-server.mjs` — supervise the dev backend

`yarn dev` ran `tsx server/index.ts` bare. `server/index.ts` installs
`uncaughtException` / `unhandledRejection` guards (#1364) that deliberately
log-and-exit, with the comment "the launcher / supervisor is responsible for
restart" — but in dev there was no supervisor. The supervisor restarts the
backend on any exit with 300 ms → 5 s backoff, and gives up after 5 consecutive
fast crashes so a genuinely unbootable backend still fails loudly instead of
respawning forever. Signals are forwarded so `server/index.ts` runs its own
graceful shutdown.

Deliberately NOT a file watcher: `yarn dev` has never restarted on save, and
adding that is a separate behaviour change. (MulmoTerminal's sibling fix,
receptron/mulmoterminal#732 / #734, does watch; this one does not.)

A SIGABRT exit now says so explicitly, since a heap OOM otherwise reads as an
unexplained disappearance.

### 2. Heap headroom, and the snapshot flag off by default

`--max-old-space-size=8192` (default ~4 GB on a 96 GB machine). This is
headroom, not a fix — at ~115 MB/beat it buys roughly 65 beats.
`DEV_SERVER_MAX_OLD_SPACE_MB` overrides.

`--heapsnapshot-near-heap-limit=1` is **off** by default. It did its job — it is
how the per-byte key strings were identified — but leaving it armed is harmful:
dumping an 8 GB heap froze the server for ~7 minutes, ballooned RSS to 21 GB
while serializing, and left a 13 GB file. `DEV_SERVER_HEAP_SNAPSHOT=1` re-arms
it when hunting a new retainer.

## Tests

`test/scripts/test_devServer.ts` covers the pure policy helpers: brisk restart
after a long-lived run (and that it clears the crash-loop counter), exponential
backoff while crashes stay fast, the backoff cap, give-up on the 5th consecutive
fast crash, and the SIGABRT hint. Verified end to end against a stub that
crashes on boot (backoff and give-up both fire) and against the real backend
(boots under the supervisor, shuts down gracefully on SIGTERM).

## Follow-up (not in this change)

1. When a mulmocast release carries the `fix/media-buffer-memory-growth` fix,
   bump the dep. The declared range is already `^2.9.0`, which floats, so this
   is a lockfile update.
2. **Then drop `--max-old-space-size=8192`** back to the default. After the fix
   a 68-beat build peaks at 173 MB, so the headroom is unnecessary — and leaving
   it raised makes the next leak harder to notice.
3. The true upstream cause is graphai's `debugResultKeyInner`, which should skip
   binary views. mulmocast's change keeps it off that path regardless.
