// Pub/sub publisher for photo-location sidecar changes. Host-owned surface
// (the post-save EXIF hook writes sidecars server-side), so this is a plain
// module singleton wired once at startup — no package feature-detect like
// collection-change.ts needs.
//
// The write path (`writeSidecarSafe`) calls `publishPhotoLocationsChanged()`
// after a successful sidecar write; an open photoLocations View subscribes to
// the same channel and refetches, so the list updates without polling.
//
// Channel name comes from `PUBSUB_CHANNELS` (aggregated from the plugin's
// `meta.ts#staticChannels`) so the publisher can't drift from the subscriber.

import type { IPubSub } from "./pub-sub/index.js";
import { PUBSUB_CHANNELS } from "../../src/config/pubsubChannels.js";
import { log } from "../system/logger/index.js";
import { errorMessage } from "../utils/errors.js";

let publisher: (() => void) | null = null;

/** Wire the change publisher to `instance`. Call once at server startup,
 *  next to `initFileChangePublisher` / `initCollectionChangePublisher`. */
export function initPhotoLocationsChangePublisher(instance: IPubSub): void {
  publisher = () => {
    try {
      instance.publish(PUBSUB_CHANNELS.locationsChanged, {});
    } catch (err) {
      // Fire-and-forget, same rationale as the file-change / collection
      // publishers: a dropped event (one missed live refresh) beats crashing
      // the sidecar write path that triggered it.
      log.warn("photo-locations", "locations-changed publish failed; subscribers will miss this event", { error: errorMessage(err) });
    }
  };
}

/** Signal that the sidecar set changed. No-op until the publisher is wired
 *  (and in tests / contexts without a pubsub instance). */
export function publishPhotoLocationsChanged(): void {
  publisher?.();
}
