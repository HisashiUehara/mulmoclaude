// Small DOM helpers shared across components.

/** Tolerance band for {@link isNearBottom}: a reader sitting within this many
 *  pixels of the end still counts as "at the bottom", so auto-follow survives
 *  the small drift of reading the last line. */
export const NEAR_BOTTOM_THRESHOLD_PX = 80;

// Whether a scroll container is parked at (or just above) its bottom.
// Auto-follow readers gate on this so streaming output stops yanking the
// view away from someone who scrolled up to read (#2179).
export function isNearBottom(
  element: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
  thresholdPx: number = NEAR_BOTTOM_THRESHOLD_PX,
): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= thresholdPx;
}

// Walk a container's descendants and return the first one that
// has both more vertical content than its visible height AND a
// CSS overflow that allows scrolling. Used so canvas-level arrow
// keys can scroll whichever inner element actually owns the
// scrollbar (e.g. a plugin's view component).
//
// Pure in the "no Vue / no module state" sense — it does touch the
// DOM, so its tests use a synthetic element graph rather than the
// real DOM.
export function findScrollableChild(container: HTMLElement): HTMLElement | null {
  const children = container.querySelectorAll("*");
  for (const elem of children) {
    const html = elem as HTMLElement;
    if (html.scrollHeight > html.clientHeight) {
      const style = getComputedStyle(html);
      if (style.overflowY === "auto" || style.overflowY === "scroll" || style.overflow === "auto" || style.overflow === "scroll") {
        return html;
      }
    }
  }
  return null;
}
