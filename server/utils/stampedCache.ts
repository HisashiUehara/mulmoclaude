// A cache whose entries are valid only while their stamp matches.
//
// The stamp is whatever the caller can read more cheaply than the value
// itself — for the session list it is the mtimes the scan already stats,
// so a hit skips the file read and the JSON parse but can never serve a
// value the filesystem has since changed. That is the property worth
// having: no TTL to tune and no watcher to miss an event, so a stale
// entry is not merely unlikely but unrepresentable.
//
// `retainOnly` exists because a long-lived process would otherwise keep
// one entry per key it has ever seen, including deleted ones.

export interface StampedCache<T> {
  /** The cached value for `key`, or undefined when absent or restamped. */
  get: (key: string, stamp: string) => T | undefined;
  set: (key: string, stamp: string, value: T) => void;
  /** Drop every key not in `liveKeys`. Returns how many were dropped. */
  retainOnly: (liveKeys: Iterable<string>) => number;
  /** Drop everything. For a caller whose whole source was replaced under it
   *  — notably a test suite that wipes its fixture directory between cases,
   *  where the stamps can legitimately repeat. */
  clear: () => void;
  size: () => number;
}

export function createStampedCache<T>(): StampedCache<T> {
  const entries = new Map<string, { stamp: string; value: T }>();
  return {
    get(key, stamp) {
      const entry = entries.get(key);
      return entry !== undefined && entry.stamp === stamp ? entry.value : undefined;
    },
    set(key, stamp, value) {
      entries.set(key, { stamp, value });
    },
    retainOnly(liveKeys) {
      const live = liveKeys instanceof Set ? liveKeys : new Set(liveKeys);
      let dropped = 0;
      for (const key of [...entries.keys()]) {
        if (live.has(key)) continue;
        entries.delete(key);
        dropped += 1;
      }
      return dropped;
    },
    clear: () => entries.clear(),
    size: () => entries.size,
  };
}
