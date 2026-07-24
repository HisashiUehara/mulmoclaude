import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { reconnectStateUpdate, shouldAutoReconnect, shouldShowRemoteHostBanner, type RemoteHostSignals } from "../../src/composables/remoteHostDecisions";

const base: RemoteHostSignals = { intended: false, connected: false, reconnectInFlight: false, reconnectFailed: false };

describe("shouldAutoReconnect", () => {
  it("reconnects when the user intends to be connected but isn't", () => {
    assert.equal(shouldAutoReconnect({ ...base, intended: true }), true);
  });

  it("does nothing when there is no intent (user never enabled remote host)", () => {
    assert.equal(shouldAutoReconnect({ ...base, intended: false }), false);
  });

  it("does nothing when already connected", () => {
    assert.equal(shouldAutoReconnect({ ...base, intended: true, connected: true }), false);
  });

  it("never overlaps an in-flight attempt", () => {
    assert.equal(shouldAutoReconnect({ ...base, intended: true, reconnectInFlight: true }), false);
  });
});

describe("shouldShowRemoteHostBanner", () => {
  it("shows once a silent reconnect has failed", () => {
    assert.equal(shouldShowRemoteHostBanner({ ...base, intended: true, reconnectFailed: true }), true);
  });

  it("stays hidden before the first reconnect attempt fails (no flap on a quick restart)", () => {
    assert.equal(shouldShowRemoteHostBanner({ ...base, intended: true, reconnectFailed: false }), false);
  });

  it("stays hidden when connected even if a prior attempt failed", () => {
    assert.equal(shouldShowRemoteHostBanner({ ...base, intended: true, connected: true, reconnectFailed: true }), false);
  });

  it("stays hidden without intent (user never enabled remote host)", () => {
    assert.equal(shouldShowRemoteHostBanner({ ...base, intended: false, reconnectFailed: true }), false);
  });
});

describe("reconnectStateUpdate", () => {
  const UNAUTHORIZED = 401;

  it("keeps everything on a successful reconnect", () => {
    assert.deepEqual(reconnectStateUpdate(true, 200, UNAUTHORIZED), { dropBlob: false, failed: false });
  });

  // Regression (#2535 review): 401 must drop the dead blob but still fail so the
  // banner shows — intent is preserved by the caller, not cleared here.
  it("drops the expired blob and fails on 401", () => {
    assert.deepEqual(reconnectStateUpdate(false, UNAUTHORIZED, UNAUTHORIZED), { dropBlob: true, failed: true });
  });

  it("keeps the blob on a transient failure so the next poll can retry", () => {
    assert.deepEqual(reconnectStateUpdate(false, 503, UNAUTHORIZED), { dropBlob: false, failed: true });
    assert.deepEqual(reconnectStateUpdate(false, 0, UNAUTHORIZED), { dropBlob: false, failed: true });
  });
});
