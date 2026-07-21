// Loader for the `page-edit` wiki action (Stage 3a, #963). Returns
// the full markdown content (frontmatter + body) for an LLM-edit
// inline preview. Tries the snapshot file first; falls back to the
// live page if the snapshot has been gc'd; reports `deleted` when
// neither survives.

import { apiGet } from "../../utils/api";
import { pluginEndpoints } from "../api";
import type { WikiEndpoints } from "./index";
import { serializeWithFrontmatter } from "@mulmoclaude/markdown-utils/markdown/frontmatter";

export type PageEditLoadResult = { kind: "snapshot"; content: string; ts: string } | { kind: "current"; content: string } | { kind: "deleted" };

interface SnapshotResponse {
  snapshot: {
    body: string;
    meta: Record<string, unknown>;
    ts: string;
  };
}

interface CurrentPageResponse {
  data: {
    content?: string;
    pageExists?: boolean;
  };
}

/** Fetch the snapshot at `(slug, stamp)`; on 404 fall through to
 *  the live page (`pagePath` lives at `data/wiki/pages/<slug>.md`
 *  by convention, but the slug already encodes that — pagePath is
 *  carried along as audit metadata). */
export async function loadPageEdit(slug: string, stamp: string): Promise<PageEditLoadResult> {
  const wikiEndpoints = pluginEndpoints<WikiEndpoints>("wiki");
  const snap = await apiGet<SnapshotResponse>(`${wikiEndpoints.base}/pages/${encodeURIComponent(slug)}/history/${encodeURIComponent(stamp)}`);
  if (snap.ok) {
    const { body, meta, ts } = snap.data.snapshot;
    return { kind: "snapshot", content: serializeWithFrontmatter(meta, body), ts };
  }
  if (snap.status !== 404) {
    // Network / 5xx: surface as deleted-equivalent for now. The
    // banner stays neutral ("page deleted") rather than leaking
    // transient errors into the UI; refresh recovers when the
    // server is healthy again.
    return { kind: "deleted" };
  }

  const current = await apiGet<CurrentPageResponse>(`${wikiEndpoints.base}?slug=${encodeURIComponent(slug)}`);
  if (current.ok && current.data.data.pageExists && typeof current.data.data.content === "string") {
    return { kind: "current", content: current.data.data.content };
  }
  return { kind: "deleted" };
}
