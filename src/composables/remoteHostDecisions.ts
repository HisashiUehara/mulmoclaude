// Pure decision rules for the remote-host connection watcher, split from
// useRemoteHost.ts so they unit-test without Firebase or a browser.

export interface RemoteHostSignals {
  // A session blob parked in localStorage ⇒ the user wants to be connected. We
  // only auto-reconnect / warn when there is intent — never nag someone who never
  // enabled the remote host.
  intended: boolean;
  connected: boolean;
  reconnectInFlight: boolean;
  // A silent auto-reconnect has already failed (e.g. the parked blob expired and
  // a Google popup is now required).
  reconnectFailed: boolean;
}

// Silently re-attach from the parked blob when the user wants to be connected but
// isn't — without overlapping an in-flight attempt.
export const shouldAutoReconnect = (signals: RemoteHostSignals): boolean => signals.intended && !signals.connected && !signals.reconnectInFlight;

// Show the persistent banner only after a silent reconnect has FAILED, so it
// doesn't flash during a normal quick restart that the next poll heals on its own.
export const shouldShowRemoteHostBanner = (signals: RemoteHostSignals): boolean => signals.intended && !signals.connected && signals.reconnectFailed;

export interface ReconnectStateUpdate {
  // Remove the parked blob from storage.
  dropBlob: boolean;
  // Surface the reconnect banner.
  failed: boolean;
}

// How to update stored state after a popup-free reconnect attempt. The parked
// blob is dropped ONLY when the server says it's genuinely expired (`unauthorized`)
// — a transient failure keeps it for the next poll's retry. Intent is NEVER
// cleared here (only an explicit disconnect clears it), so the banner keeps
// prompting a manual re-login even after the dead blob is removed.
export const reconnectStateUpdate = (ok: boolean, status: number, unauthorized: number): ReconnectStateUpdate =>
  ok ? { dropBlob: false, failed: false } : { dropBlob: status === unauthorized, failed: true };
