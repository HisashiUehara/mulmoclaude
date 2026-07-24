<template>
  <!-- 📚 Catalog section: launcher-managed presets + installed external
       repos. Rows behave like the active list — click selects an entry,
       loading its detail into the right pane with ★ Star actions. -->
  <div data-testid="skill-section-catalog" class="border-t border-gray-200">
    <button
      type="button"
      data-testid="skill-section-toggle-catalog"
      class="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:bg-gray-100 border-b border-gray-100"
      :aria-expanded="open"
      aria-controls="skill-section-panel-catalog"
      @click="emit('toggle')"
    >
      <span class="flex items-center gap-1">
        <span class="material-icons text-base">{{ open ? "expand_more" : "chevron_right" }}</span>
        {{ t("pluginManageSkills.sectionCatalog") }}
      </span>
      <span data-testid="skill-section-count-catalog" class="text-gray-400 font-normal normal-case">{{ presets.length + externalCount }}</span>
    </button>
    <div v-show="open" id="skill-section-panel-catalog" role="group">
      <div class="px-4 py-2 text-[11px] uppercase tracking-wide text-gray-500 font-semibold" data-testid="skill-catalog-section-heading">
        {{ t("pluginManageSkills.catalogPresetHeading") }}
      </div>
      <div
        v-for="entry in presets"
        :key="`catalog-preset-${entryKey(entry)}`"
        :data-testid="`skill-catalog-item-${entryKey(entry)}`"
        class="cursor-pointer px-4 py-3 border-b border-gray-100 text-sm hover:bg-white transition-colors focus:outline-none focus:bg-white focus:border-l-2 focus:border-l-blue-400"
        :class="selectedCatalogKey === entryKey(entry) ? 'bg-white border-l-2 border-l-blue-500' : ''"
        role="button"
        tabindex="0"
        :aria-pressed="selectedCatalogKey === entryKey(entry)"
        @click="emit('select-entry', entry)"
        @keydown.enter.prevent="emit('select-entry', entry)"
        @keydown.space.prevent="emit('select-entry', entry)"
      >
        <div class="flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <div class="font-medium text-gray-700 truncate">{{ entry.name }}</div>
            <div class="text-xs text-gray-500 truncate mt-0.5">{{ entry.description }}</div>
          </div>
          <span
            v-if="entry.alreadyActive"
            class="shrink-0 material-icons text-sm text-yellow-500"
            :title="t('pluginManageSkills.catalogStarred')"
            :data-testid="`skill-catalog-starred-indicator-${entryKey(entry)}`"
            aria-hidden="true"
            >star</span
          >
          <span class="shrink-0 material-icons text-sm" :class="presetSourceMeta.colour" :title="presetSourceMeta.title" aria-hidden="true">{{
            presetSourceMeta.icon
          }}</span>
        </div>
      </div>
      <p v-if="presets.length === 0 && !catalogError" class="px-4 py-3 text-xs text-gray-400 italic" data-testid="skill-catalog-empty">
        {{ t("pluginManageSkills.catalogEmpty") }}
      </p>
      <div v-if="catalogError" class="px-4 py-2 text-xs text-red-600">{{ catalogError }}</div>
      <!-- The repo-list load failure gets its own channel, separate from a
           per-repo action error in the groups (which a shared catalogError
           would clobber). -->
      <div v-if="repoListError" class="px-4 py-2 text-xs text-red-600" data-testid="skill-catalog-repo-list-error">{{ repoListError }}</div>

      <SkillRepoGroup
        v-for="group in externalGroups"
        :key="`catalog-repo-${group.repo.repoId}`"
        :repo="group.repo"
        :entries="group.entries"
        :open="!repoCollapsed.has(group.repo.repoId)"
        :selected-catalog-key="selectedCatalogKey"
        :updating="updatingRepoId === group.repo.repoId"
        :uninstalling="uninstallingRepoId === group.repo.repoId"
        @toggle="emit('toggle-repo', group.repo.repoId)"
        @update="emit('update-repo', group.repo)"
        @uninstall="emit('uninstall-repo', group.repo.repoId)"
        @select="emit('select-entry', $event)"
      />

      <button
        type="button"
        data-testid="skill-catalog-add-repo"
        class="w-full flex items-center gap-1 px-4 py-3 text-sm text-blue-600 hover:bg-white border-t border-gray-100"
        @click="emit('add-repo')"
      >
        <span class="material-icons text-sm" aria-hidden="true">add</span>
        {{ t("pluginManageSkills.catalogAddRepo") }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { entryKey, type SourceMeta } from "./categories";
import type { CatalogEntry } from "./useSkillCatalog";
import type { ExternalRepo, ExternalReposGroup } from "./useExternalRepos";
import SkillRepoGroup from "./SkillRepoGroup.vue";

const { t } = useI18n();

defineProps<{
  open: boolean;
  presets: CatalogEntry[];
  externalCount: number;
  externalGroups: ExternalReposGroup[];
  // repoId ∈ set ⇒ collapsed (absent ⇒ expanded); owned by useExternalRepos.
  repoCollapsed: Set<string>;
  selectedCatalogKey: string | null;
  catalogError: string | null;
  repoListError: string | null;
  presetSourceMeta: SourceMeta;
  updatingRepoId: string | null;
  uninstallingRepoId: string | null;
}>();

const emit = defineEmits<{
  toggle: [];
  "select-entry": [entry: CatalogEntry];
  "toggle-repo": [repoId: string];
  "update-repo": [repo: ExternalRepo];
  "uninstall-repo": [repoId: string];
  "add-repo": [];
}>();
</script>
