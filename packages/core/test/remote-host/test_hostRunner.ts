// Unit tests for the command-dispatch lookup (resolveCommandHandler):
//   - a registered method name returns its handler
//   - an unregistered method name returns undefined (→ unknown_method)
//   - proto-key regression (#2319): a method name written by an untrusted remote
//     terminal that collides with an Object.prototype member must NOT resolve to
//     an inherited function and run as if it were registered
//   - boundary: a handler legitimately registered under a proto-collision name
//     is still returned (own property wins)
//
// The lookup is extracted as a pure helper so it is tested directly, without a
// Firestore mock for processCommand.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { backoffDelayMs, classifyListenerError, MAX_LISTEN_RETRIES, resolveCommandHandler } from "../../src/remote-host/server/hostRunner.js";
import type { CommandHandlers } from "../../src/remote-host/index.js";

const handlers: CommandHandlers = {
  listCollections: () => null,
  startChat: () => null,
};

describe("resolveCommandHandler", () => {
  it("returns the handler for a registered method", () => {
    assert.equal(resolveCommandHandler(handlers, "listCollections"), handlers.listCollections);
  });

  it("returns undefined for an unregistered method", () => {
    assert.equal(resolveCommandHandler(handlers, "nope"), undefined);
  });

  for (const proto of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    it(`returns undefined for the prototype key "${proto}"`, () => {
      // A bare `handlers[proto]` would resolve to an Object.prototype member.
      assert.equal(resolveCommandHandler(handlers, proto), undefined);
    });
  }

  it("returns a handler legitimately registered under a proto-collision name (boundary)", () => {
    const ownToString: CommandHandlers["toString"] = () => "real";
    const withOwn: CommandHandlers = { ...handlers, toString: ownToString };
    assert.equal(resolveCommandHandler(withOwn, "toString"), ownToString);
  });
});

describe("classifyListenerError", () => {
  for (const code of ["unavailable", "deadline-exceeded", "internal", "cancelled", "aborted", "resource-exhausted"]) {
    it(`treats "${code}" as transient (re-subscribe worthwhile)`, () => {
      assert.equal(classifyListenerError({ code }), "transient");
    });
  }

  // Auth failures can't be fixed by re-listening; treating them as transient
  // would spin the runner in a doomed retry loop.
  for (const code of ["permission-denied", "unauthenticated"]) {
    it(`treats "${code}" as fatal`, () => {
      assert.equal(classifyListenerError({ code }), "fatal");
    });
  }

  it("treats an unrecognized code as fatal (never loop forever on the unknown)", () => {
    assert.equal(classifyListenerError({ code: "not-a-real-code" }), "fatal");
  });

  it("treats a non-Firestore error (no string code) as fatal", () => {
    assert.equal(classifyListenerError(new Error("boom")), "fatal");
    assert.equal(classifyListenerError(null), "fatal");
    assert.equal(classifyListenerError({ code: 42 }), "fatal");
  });
});

describe("backoffDelayMs", () => {
  it("grows exponentially from the base delay", () => {
    assert.equal(backoffDelayMs(0), 1_000);
    assert.equal(backoffDelayMs(1), 2_000);
    assert.equal(backoffDelayMs(2), 4_000);
    assert.equal(backoffDelayMs(3), 8_000);
  });

  it("saturates at the cap for large attempts", () => {
    assert.equal(backoffDelayMs(10), 30_000);
    assert.equal(backoffDelayMs(MAX_LISTEN_RETRIES), 30_000);
  });
});
