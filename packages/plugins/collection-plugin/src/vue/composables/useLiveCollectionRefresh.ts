// Live updates: refetch the active collection in place when the server reports a
// record change (agent writes mid-chat, another tab's UI write, a feed refresh,
// a host `spawn` successor — all ride the host's collection-change channel).
// `subscribeChanges` is an OPTIONAL host capability; without it the view keeps its
// manual-refresh behaviour.
//
// Debounced so a bulk write (N rows) collapses to one refetch, and DEFERRED (not
// dropped) while an inline/create edit is unsaved so a live refetch never clobbers
// the user's draft. A change that lands mid-edit sets a pending flag that the
// `editing` watch flushes once the edit ends — by save OR cancel — so a cancelled
// edit doesn't leave the view stale. The pure defer decision lives in
// `../liveRefresh`; this is the reactive shell (timer + subscription lifecycle).

import { onUnmounted, watch, type Ref } from "vue";
import type { EditState } from "@mulmoclaude/core/collection";
import type { CollectionUi } from "../uiContext";
import { LIVE_REFRESH_DEBOUNCE_MS, debouncedChangeAction, shouldFlushDeferredRefresh } from "../liveRefresh";

interface UseLiveCollectionRefreshParams {
  activeSlug: Readonly<Ref<string | undefined>>;
  /** The unsaved-edit signal — a change arriving while this is set is deferred. */
  editing: Ref<EditState | null>;
  cui: CollectionUi;
  /** In-place refetch (parent-owned: it touches collection / items / render / the
   *  open detail). Called with the slug the change was for, or the current slug on
   *  a deferred flush. */
  refreshItemsInPlace: (slug: string) => Promise<void>;
}

export function useLiveCollectionRefresh({ activeSlug, editing, cui, refreshItemsInPlace }: UseLiveCollectionRefreshParams): void {
  let changeUnsub: (() => void) | null = null;
  let liveRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingRemoteRefresh = false;

  function clearLiveRefreshTimer(): void {
    if (liveRefreshTimer !== undefined) {
      clearTimeout(liveRefreshTimer);
      liveRefreshTimer = undefined;
    }
  }

  function onRemoteChange(slug: string): void {
    clearLiveRefreshTimer();
    liveRefreshTimer = setTimeout(() => {
      liveRefreshTimer = undefined;
      const action = debouncedChangeAction(editing.value !== null, activeSlug.value, slug);
      if (action === "defer") {
        pendingRemoteRefresh = true; // defer past the edit, don't drop it
        return;
      }
      if (action === "refresh") void refreshItemsInPlace(slug);
    }, LIVE_REFRESH_DEBOUNCE_MS);
  }

  // Flush a remote change that arrived mid-edit once the edit ends (save or
  // cancel). The save path refetches on its own, but cancel has no other refresh
  // path — without this, a cancelled edit would strand the deferred update.
  watch(editing, (current) => {
    if (!shouldFlushDeferredRefresh(current !== null, pendingRemoteRefresh)) return;
    pendingRemoteRefresh = false;
    if (activeSlug.value) void refreshItemsInPlace(activeSlug.value);
  });

  watch(
    activeSlug,
    (slug) => {
      changeUnsub?.();
      changeUnsub = null;
      clearLiveRefreshTimer();
      if (slug && cui.subscribeChanges) {
        changeUnsub = cui.subscribeChanges(slug, () => onRemoteChange(slug));
      }
    },
    { immediate: true },
  );

  onUnmounted(() => {
    changeUnsub?.();
    changeUnsub = null;
    clearLiveRefreshTimer();
  });
}
