import { ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { loadPageEdit } from "../pageEditLoader";

interface WikiPageEditDeps {
  content: Ref<string>;
}

export interface WikiPageEditState {
  // Snapshot's own timestamp (header subtitle); null once reset / not a snapshot.
  pageEditTs: Ref<string | null>;
  // Shown only when the snapshot was gc'd and we fell back to the live page.
  pageEditBanner: Ref<string | null>;
  // Flips on when neither the snapshot nor the live page survives.
  pageEditDeleted: Ref<boolean>;
  loadPageEditData: (slug: string, stamp: string) => Promise<void>;
  resetPageEdit: () => void;
}

// `page-edit` action state (Stage 3a, #963). Populated when an LLM Write/Edit
// toolResult is mounted: the body comes from the snapshot endpoint, not the
// live-page /api/wiki fetch.
export function useWikiPageEdit(deps: WikiPageEditDeps): WikiPageEditState {
  const { t } = useI18n();
  const pageEditTs = ref<string | null>(null);
  const pageEditBanner = ref<string | null>(null);
  const pageEditDeleted = ref(false);

  function resetPageEdit(): void {
    pageEditTs.value = null;
    pageEditBanner.value = null;
    pageEditDeleted.value = false;
  }

  async function loadPageEditData(slug: string, stamp: string): Promise<void> {
    resetPageEdit();
    deps.content.value = "";

    const result = await loadPageEdit(slug, stamp);
    if (result.kind === "snapshot") {
      pageEditTs.value = result.ts;
      deps.content.value = result.content;
      return;
    }
    if (result.kind === "current") {
      pageEditBanner.value = t("pluginWiki.snapshotExpired");
      deps.content.value = result.content;
      return;
    }
    pageEditDeleted.value = true;
  }

  return { pageEditTs, pageEditBanner, pageEditDeleted, loadPageEditData, resetPageEdit };
}
