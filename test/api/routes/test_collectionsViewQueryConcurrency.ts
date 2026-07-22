// The sibling per-minute limiter has tests; this in-flight cap shipped without
// any. It is the guard that keeps a runaway dashboard loop from stacking
// concurrent full-file DuckDB scans, and every failure mode is a leak: a slot
// that never comes back permanently 429s the collection, a slot released twice
// lets the cap drift upward without bound.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import { makeViewQueryConcurrencyGuard } from "../../../server/api/routes/collections.js";

/** Captures the `close` handler so a test can end the request explicitly —
 *  that is the only thing that returns a slot. */
function fakeRes() {
  let statusCode = 0;
  let body: unknown;
  const closeHandlers: (() => void)[] = [];
  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (payload: unknown) => {
      body = payload;
      return res;
    },
    once: (event: string, handler: () => void) => {
      if (event === "close") closeHandlers.push(handler);
      return res;
    },
  } as unknown as Response;
  return { res, status: () => statusCode, body: () => body, close: () => closeHandlers.forEach((handler) => handler()) };
}

const request = (slug?: string) => ({ params: slug === undefined ? {} : { slug } }) as unknown as Request<{ slug?: string }>;

function call(guard: ReturnType<typeof makeViewQueryConcurrencyGuard>, slug?: string) {
  const { res, status, body, close } = fakeRes();
  let nexted = false;
  guard(request(slug), res, (() => {
    nexted = true;
  }) as NextFunction);
  return { nexted, status: status(), body: body(), close };
}

describe("makeViewQueryConcurrencyGuard", () => {
  it("passes requests up to the cap", () => {
    const guard = makeViewQueryConcurrencyGuard(2);
    assert.equal(call(guard, "tasks").nexted, true);
    assert.equal(call(guard, "tasks").nexted, true);
  });

  it("429s the request that exceeds the cap", () => {
    const guard = makeViewQueryConcurrencyGuard(1);
    call(guard, "tasks");
    const over = call(guard, "tasks");
    assert.equal(over.nexted, false);
    assert.equal(over.status, 429);
    assert.deepEqual(over.body, { error: "too many concurrent queries for this collection — retry shortly" });
  });

  it("returns the slot when the response closes", () => {
    const guard = makeViewQueryConcurrencyGuard(1);
    const first = call(guard, "tasks");
    assert.equal(call(guard, "tasks").nexted, false);
    first.close();
    assert.equal(call(guard, "tasks").nexted, true);
  });

  // `close` also fires on a mid-request client disconnect, and nothing stops a
  // second emit. A second release must be a no-op — otherwise it frees a slot
  // another still-running scan is holding and the cap drifts upward.
  //
  // This needs a second request in flight to detect: with the counter already
  // at zero, a stray release is absorbed by the `?? 1` fallback and looks
  // identical to the correct behaviour.
  it("releases a slot exactly once even if close fires twice", () => {
    const guard = makeViewQueryConcurrencyGuard(2);
    const stillRunning = call(guard, "tasks");
    const finished = call(guard, "tasks");
    finished.close();
    finished.close();
    assert.equal(call(guard, "tasks").nexted, true, "the finished request's slot comes back");
    assert.equal(call(guard, "tasks").nexted, false, "the still-running request's slot must NOT have been freed too");
    stillRunning.close();
  });

  it("counts each slug independently", () => {
    const guard = makeViewQueryConcurrencyGuard(1);
    assert.equal(call(guard, "tasks").nexted, true);
    assert.equal(call(guard, "notes").nexted, true);
    assert.equal(call(guard, "tasks").nexted, false);
  });

  // A 429 never took a slot, so it must not release one either — otherwise a
  // burst of rejections would free capacity the in-flight scans still hold.
  it("does not let a rejected request return a slot", () => {
    const guard = makeViewQueryConcurrencyGuard(1);
    const held = call(guard, "tasks");
    const rejected = call(guard, "tasks");
    assert.equal(rejected.nexted, false);
    rejected.close();
    assert.equal(call(guard, "tasks").nexted, false);
    held.close();
    assert.equal(call(guard, "tasks").nexted, true);
  });

  it("treats a missing slug param as its own bucket rather than throwing", () => {
    const guard = makeViewQueryConcurrencyGuard(1);
    assert.equal(call(guard).nexted, true);
    assert.equal(call(guard).nexted, false);
    assert.equal(call(guard, "tasks").nexted, true);
  });

  // Every request is over the cap, so none should ever reach the handler.
  it("rejects everything when the cap is zero", () => {
    const guard = makeViewQueryConcurrencyGuard(0);
    const first = call(guard, "tasks");
    assert.equal(first.nexted, false);
    assert.equal(first.status, 429);
  });

  it("recovers full capacity after all in-flight requests close", () => {
    const guard = makeViewQueryConcurrencyGuard(2);
    const firstScan = call(guard, "tasks");
    const secondScan = call(guard, "tasks");
    assert.equal(call(guard, "tasks").nexted, false);
    firstScan.close();
    secondScan.close();
    assert.equal(call(guard, "tasks").nexted, true);
    assert.equal(call(guard, "tasks").nexted, true);
    assert.equal(call(guard, "tasks").nexted, false);
  });
});
