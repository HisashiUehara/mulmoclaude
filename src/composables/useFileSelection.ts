// Composable: file selection + URL sync. Content loading/abort is
// owned by useFileContentLoader; this composes it and keeps the
// route-sync concern. Extracted from FilesView.vue (#507 step 2).

import { ref } from "vue";
import { useRoute, useRouter, isNavigationFailure } from "vue-router";
import { isNonEmptyString } from "../utils/types";
import { useFileContentLoader } from "./useFileContentLoader";

/** Segment-wise traversal check: rejects `../` path components
 *  but allows legitimate filenames like `my..notes.txt`. */
export function isValidFilePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.startsWith("/")) return false;
  return !value.split("/").some((seg) => seg === "..");
}

/**
 * Extract the logical file path from a route's `pathMatch` param.
 * Vue Router hands the repeatable catch-all back as an array, a
 * single string, or `undefined` depending on what matched — normalise
 * to a `string | null` so the rest of the composable doesn't care.
 */
export function readPathMatch(raw: unknown): string | null {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    return raw.join("/");
  }
  if (isNonEmptyString(raw)) return raw;
  return null;
}

export function useFileSelection() {
  const route = useRoute();
  const router = useRouter();

  const { content, contentLoading, contentError, loadContent, abortContent } = useFileContentLoader();

  const pathFromRoute = readPathMatch(route.params.pathMatch);
  const selectedPath = ref<string | null>(isValidFilePath(pathFromRoute) ? pathFromRoute : null);

  function selectFile(filePath: string): void {
    selectedPath.value = filePath;
    // Fire-and-forget: the loader surfaces its own outcome through
    // `contentLoading` / `contentError`, and selection must not block on I/O.
    void loadContent(filePath);
    // Pass segments as an array so Vue Router encodes each segment
    // independently (spaces / multi-byte / `?#%` get UTF-8 percent-
    // encoding), while slashes stay as path separators. Passing the
    // joined string would urlencode `/` → `%2F` and collapse the
    // visible path shape.
    router.push({ name: "files", params: { pathMatch: filePath.split("/") }, query: route.query }).catch((err: unknown) => {
      if (!isNavigationFailure(err)) {
        // Frontend composable — server logger not available.
        // console.error is the standard pattern in Vue composables.
        console.error("[selectFile] navigation failed:", err);
      }
    });
  }

  function deselectFile(): void {
    abortContent();
    selectedPath.value = null;
    content.value = null;
    contentError.value = null;
    router.replace({ name: "files", params: { pathMatch: [] }, query: route.query }).catch((err: unknown) => {
      if (!isNavigationFailure(err)) {
        console.error("[deselectFile] navigation failed:", err);
      }
    });
  }

  return {
    selectedPath,
    content,
    contentLoading,
    contentError,
    loadContent,
    selectFile,
    deselectFile,
    abortContent,
  };
}
