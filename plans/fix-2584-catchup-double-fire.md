# fix: collapse the double-fired tab-return catch-up (#2584)

## Problem

`catchUpMissedEvents` fires from two surfaces with nothing between them:

```
socket reconnect  → pubsubOnReconnect   → catchUpMissedEvents("reconnect")
tab becomes visible → visibilitychange  → catchUpMissedEvents("visibility")
```

On the common path they fire **together**: Chrome throttles a backgrounded
tab until the socket drops, so returning to it reconnects and flips visibility
at the same moment. Two passes run concurrently.

## What doubles

`catchUpMissedEvents` drives two calls:

1. `refreshSessionStates()` → `GET /api/sessions` → `loadAllSessions()` walks
   **every session inside the 90-day window**, doing two `stat`s plus a meta
   read each (`server/api/routes/sessions.ts:155-203`). On a 488-session
   workspace that is roughly 1500 filesystem calls.
2. `refreshSessionTranscript()` → full transcript GET + full
   `parseSessionEntries` (no range parameters).

## Not a correctness bug

`refreshSessionStates` has a generation guard (`refreshToken`), and
`refreshSessionTranscript` only adopts a strictly-richer server view. Nothing
breaks — the work is simply done twice.

Fixed anyway because it is wasted work regardless of how the #2581 performance
investigation lands, and there is no design question attached to it.

## Both surfaces must stay

`src/App.vue`'s existing comment records why: Chrome's throttling can leave the
socket `connected` on the server while delivery stops, with no `disconnect` to
hook — visibility catches that. A genuine drop needs the reconnect path.
Deleting either one restores the gap it was added to close.

So they are **coalesced**, not deduplicated by removal.

## Change

`src/utils/inFlightShare.ts` (new) — `createInFlightShare()` returns
`{ run, isRunning }`. A call made while a pass runs joins it.

**No trailing re-run**, and that is the whole distinction from
`makeSingleFlight` (`server/utils/singleFlight.ts`): there, a trigger arriving
mid-pass stands for state the pass never looked at, so it must run again. Here
both triggers are detections of one event, so the second has nothing new to
report.

The two existing guards stay. They cover interleaving with **live** events,
which the share does not touch.

`isRunning()` exists so the caller can log the collapse — the console line
`catchUpMissedEvents` already emitted is what makes the double fire observable,
so it now reports joining instead of going silent.

## Tests

`test/utils/test_inFlightShare.ts` — the behaviour under test is the ABSENCE of
a second run, which manual testing cannot see (both passes succeed, the UI
looks right). Covers: mid-pass join runs the task once, both callers get the
same promise, a trigger after settling starts a new pass, a rejected pass does
not wedge the slot, the failure reaches every joiner, and a burst collapses to
one.

Mutation-checked: replacing `??=` with `=` (every trigger starts its own pass)
turns 4 of the 7 red.

## Verification in the browser

`App.vue` logs on every catch-up, so the fix is observable without tooling.
Before: two lines on tab return. After: one `catching up after …` plus one
`joined the pass already running`.
