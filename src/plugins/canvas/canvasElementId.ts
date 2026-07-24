// The vue-drawing-canvas library locates its <canvas> with
// `document.querySelector('#' + canvasId)`, and its `canvasId` prop
// defaults to the SAME literal `"VueDrawingCanvas"` for every instance.
// Two canvases mounted at once (e.g. two openCanvas results in stack
// layout) then collide: the second instance's setContext / save operate
// on the FIRST instance's element, cross-contaminating both saved PNGs.
//
// A per-instance id keyed on the result uuid (plus the remount counter,
// so a resize-driven remount gets a fresh element) keeps them distinct.
// The id must be a valid CSS selector target, so any character outside
// [A-Za-z0-9_-] is replaced.
export const canvasElementId = (uuid: string | null | undefined, renderKey: number): string => {
  const safeUuid = (uuid ?? "default").replace(/[^A-Za-z0-9_-]/g, "-");
  return `vdc-${safeUuid}-${renderKey}`;
};
