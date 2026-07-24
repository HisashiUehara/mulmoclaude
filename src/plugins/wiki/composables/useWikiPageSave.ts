import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import { WIKI_ACTION } from "@mulmoclaude/core/wiki";
import { apiPost } from "../../../utils/api";
import { computeToggledContent } from "../helpers";
import { createTaskSaveQueue, type SaveResult } from "../taskSaveQueue";

interface WikiPageSaveDeps {
  action: Ref<string>;
  content: Ref<string>;
  navError: Ref<string | null>;
  currentSlug: () => string | null;
  endpointBase: string;
  refresh: () => Promise<boolean>;
}

export interface WikiPageSave {
  onTaskCheckboxClick: (event: MouseEvent, target: HTMLInputElement) => void;
}

function revert(target: HTMLInputElement): void {
  target.checked = !target.checked;
}

// Thin DOM/optimistic-update glue over the pure `createTaskSaveQueue`, which
// owns the serialisation + generation-invalidation + page-switch rules
// (#775). This composable only wires the wiki API, i18n, and the checkbox
// event into that queue.
export function useWikiPageSave(deps: WikiPageSaveDeps): WikiPageSave {
  const { t } = useI18n();

  const queue = createTaskSaveQueue({
    persist: async (pageName, content): Promise<SaveResult> => {
      const response = await apiPost<{ data?: { content?: string } }>(deps.endpointBase, {
        action: WIKI_ACTION.save,
        pageName,
        content,
      });
      return { ok: response.ok, status: response.ok ? 200 : response.status, error: response.ok ? "" : response.error };
    },
    refresh: () => deps.refresh(),
    getCurrentSlug: deps.currentSlug,
    onError: (message) => {
      deps.navError.value = message;
    },
    onSuccess: () => {
      deps.navError.value = null;
    },
  });

  function onTaskCheckboxClick(event: MouseEvent, target: HTMLInputElement): void {
    const root = event.currentTarget;
    const pageName = deps.currentSlug();
    // Only the live page view persists toggles; everything else is read-only.
    if (deps.action.value !== WIKI_ACTION.page || !pageName || !(root instanceof HTMLElement)) {
      revert(target);
      return;
    }

    const result = computeToggledContent(target, root, deps.content.value);
    if (result.status !== "toggled") {
      // `mismatch` = source/DOM task-count drift; surface it. `skip` reverts
      // silently (target not among the tasks, or an out-of-range toggle).
      if (result.status === "mismatch") deps.navError.value = t("pluginWiki.taskCountMismatch");
      revert(target);
      return;
    }

    // Optimistic local update — re-render is driven by content's watcher.
    deps.content.value = result.content;
    deps.navError.value = null;
    queue.queueSave(pageName, result.content);
  }

  return { onTaskCheckboxClick };
}
