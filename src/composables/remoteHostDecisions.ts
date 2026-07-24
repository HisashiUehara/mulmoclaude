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
