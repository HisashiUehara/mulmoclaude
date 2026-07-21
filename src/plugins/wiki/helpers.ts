// Host markdown→HTML pipeline for wiki/View.vue. The pure
// `[[wiki-link]]` walker now lives in `@mulmoclaude/core/wiki`
// (shared with MulmoTerminal); this file owns only the host-specific
// wrapping (image-ref rewrite + marked + interactive task lists).

import { marked } from "marked";
import { renderWikiLinks } from "@mulmoclaude/core/wiki";
import { rewriteMarkdownImageRefs } from "@mulmoclaude/markdown-utils/image/rewriteMarkdownImageRefs";
import { makeTasksInteractive } from "@mulmoclaude/markdown-utils/markdown/taskList";

// Re-export so existing host importers (and tests) keep a single
// `./helpers` entry point for the renderer.
export { renderWikiLinks } from "@mulmoclaude/core/wiki";

/**
 * Markdown→HTML pipeline shared between the standalone /wiki view
 * and the chat-inline preview (Stage 3a). Caller passes a body that
 * already has frontmatter stripped, plus the workspace-relative base
 * dir used to rewrite image refs (`data/wiki/pages` for a page,
 * `data/wiki` for log/lint).
 */
export function renderWikiPageHtml(body: string, baseDir: string): string {
  if (!body) return "";
  const withImages = rewriteMarkdownImageRefs(body, baseDir);
  return makeTasksInteractive(marked.parse(renderWikiLinks(withImages)) as string);
}
