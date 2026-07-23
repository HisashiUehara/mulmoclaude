// Public entry for `@mulmoclaude/core/plugin-vue` — the browser-safe Vue surface
// shared by plugin Views. Server-only consumers never import this subpath, so
// `vue` stays an optional peer of core.
export { useFileWatch } from "./useFileWatch.ts";
