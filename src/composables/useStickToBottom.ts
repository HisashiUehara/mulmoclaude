// Tracks whether a scroll container is parked at (or just above) its bottom,
// so auto-follow callers can stop yanking the view away from a reader who
// scrolled up mid-stream (#2179).
//
// Starts stuck: a fresh list follows new output until the reader deliberately
// scrolls away, and re-arms the moment they scroll back down — the Slack /
// Discord behaviour. Only real scroll events move the flag, so a container
// that simply grows taller below the viewport keeps following.

import { getCurrentInstance, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { isNearBottom, NEAR_BOTTOM_THRESHOLD_PX } from "../utils/dom/scrollable";

export function useStickToBottom(elementRef: Ref<HTMLElement | null>, thresholdPx: number = NEAR_BOTTOM_THRESHOLD_PX) {
  const stuck = ref(true);
  let attached: HTMLElement | null = null;

  const sync = (): void => {
    if (attached) stuck.value = isNearBottom(attached, thresholdPx);
  };

  const detach = (): void => {
    attached?.removeEventListener("scroll", sync);
    attached = null;
  };

  watch(
    elementRef,
    (element) => {
      detach();
      if (!element) return;
      attached = element;
      // A freshly mounted container follows again — otherwise a reader who
      // had scrolled away in a previous list would find the new one silently
      // not following.
      stuck.value = true;
      element.addEventListener("scroll", sync, { passive: true });
    },
    { immediate: true },
  );

  // Guarded so the composable can also be driven directly from a test, where
  // there is no component instance to own the hook.
  if (getCurrentInstance()) onBeforeUnmount(detach);

  /** Re-arm following after an explicit jump-to-bottom (sending a message). */
  const resume = (): void => {
    stuck.value = true;
  };

  return { stuck, resume };
}
