// Public entry for `@mulmoclaude/core/plugin-vue` — the browser-safe Vue surface shared
// by plugin Views and the host. Server-only consumers never import this subpath, so `vue`
// stays an optional peer of core.
export { useFileWatch } from "./useFileWatch.ts";
export { useMarkdownDoc } from "./useMarkdownDoc.ts";
export { formatScalarField, buildMarkdownDocView, type MarkdownDocField, type MarkdownDocView } from "./markdownDoc.ts";
export { useClipboardCopy, type UseClipboardCopyHandle } from "./useClipboardCopy.ts";
