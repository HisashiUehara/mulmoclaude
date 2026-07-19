// Composable: fetch file content, aborting an in-flight load when a
// newer one starts. Split out of useFileSelection (#507) so the abort
// invariant can be exercised without a vue-router context.

import { ref } from "vue";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

interface TextContent {
  kind: "text";
  path: string;
  content: string;
  size: number;
  modifiedMs: number;
}

interface MetaContent {
  kind: "image" | "pdf" | "audio" | "video" | "binary" | "too-large";
  path: string;
  size: number;
  modifiedMs: number;
  message?: string;
}

export type FileContent = TextContent | MetaContent;

export function useFileContentLoader() {
  const content = ref<FileContent | null>(null);
  const contentLoading = ref(false);
  const contentError = ref<string | null>(null);

  let contentAbort: AbortController | null = null;

  async function loadContent(filePath: string): Promise<void> {
    contentAbort?.abort();
    const controller = new AbortController();
    contentAbort = controller;

    contentLoading.value = true;
    contentError.value = null;
    content.value = null;
    try {
      const result = await apiGet<FileContent>(API_ROUTES.files.content, { path: filePath }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!result.ok) {
        contentError.value = result.error;
      } else {
        content.value = result.data;
      }
    } finally {
      // A stale request resolving after a newer one started must not
      // clear the newer request's loading state.
      if (contentAbort === controller) {
        contentLoading.value = false;
        contentAbort = null;
      }
    }
  }

  function abortContent(): void {
    contentAbort?.abort();
    contentAbort = null;
    contentLoading.value = false;
  }

  return { content, contentLoading, contentError, loadContent, abortContent };
}
