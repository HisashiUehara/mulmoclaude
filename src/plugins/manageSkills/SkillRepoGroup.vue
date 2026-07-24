<template>
  <!-- One installed external repo (#1383 PR-C2): a collapsible header
       with update / uninstall controls over its discovered skill rows.
       Rows behave exactly like preset rows (select → right pane). -->
  <div :data-testid="`skill-catalog-repo-${repo.repoId}`" class="border-t border-gray-100">
    <div class="w-full flex items-center hover:bg-gray-100">
      <button
        type="button"
        :data-testid="`skill-catalog-repo-toggle-${repo.repoId}`"
        class="flex-1 min-w-0 flex items-center gap-1 px-4 py-2 text-[11px] uppercase tracking-wide text-gray-500 font-semibold"
        :aria-expanded="open"
        @click="emit('toggle')"
      >
        <span class="material-icons text-sm">{{ open ? "expand_more" : "chevron_right" }}</span>
        <span class="truncate normal-case text-gray-600">{{ repoLabel(repo) }}</span>
        <span class="text-gray-400 font-normal">({{ entries.length }})</span>
      </button>
      <button
        type="button"
        class="h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-blue-600 disabled:opacity-40"
        :data-testid="`skill-catalog-repo-update-${repo.repoId}`"
        :disabled="updating || uninstalling"
        :title="t('pluginManageSkills.catalogUpdateRepo')"
        :aria-label="t('pluginManageSkills.catalogUpdateRepo')"
        :aria-busy="updating"
        @click="emit('update')"
      >
        <span class="material-icons text-sm" :class="updating ? 'animate-spin' : ''" aria-hidden="true">refresh</span>
      </button>
      <button
        type="button"
        class="h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-red-600 disabled:opacity-40"
        :data-testid="`skill-catalog-repo-uninstall-${repo.repoId}`"
        :disabled="uninstalling || updating"
        :title="t('pluginManageSkills.catalogUninstallRepo')"
        :aria-label="t('pluginManageSkills.catalogUninstallRepo')"
        :aria-busy="uninstalling"
        @click="emit('uninstall')"
      >
        <span class="material-icons text-sm" aria-hidden="true">delete_outline</span>
      </button>
    </div>
    <div v-show="open" role="group">
      <div
        v-for="entry in entries"
        :key="`catalog-ext-${entryKey(entry)}`"
        :data-testid="`skill-catalog-item-${entryKey(entry)}`"
        class="cursor-pointer px-4 py-3 border-b border-gray-100 text-sm hover:bg-white transition-colors focus:outline-none focus:bg-white focus:border-l-2 focus:border-l-blue-400"
        :class="selectedCatalogKey === entryKey(entry) ? 'bg-white border-l-2 border-l-blue-500' : ''"
        role="button"
        tabindex="0"
        :aria-pressed="selectedCatalogKey === entryKey(entry)"
        @click="emit('select', entry)"
        @keydown.enter.prevent="emit('select', entry)"
        @keydown.space.prevent="emit('select', entry)"
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
          <span class="shrink-0 material-icons text-sm text-gray-400" :title="t('pluginManageSkills.sourceExternalTitle')" aria-hidden="true">cloud</span>
        </div>
      </div>
      <p v-if="entries.length === 0" class="px-4 py-3 text-xs text-gray-400 italic">
        {{ t("pluginManageSkills.catalogRepoEmpty") }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { entryKey, repoLabel } from "./categories";
import type { CatalogEntry } from "./useSkillCatalog";
import type { ExternalRepo } from "./useExternalRepos";

const { t } = useI18n();

defineProps<{
  repo: ExternalRepo;
  entries: CatalogEntry[];
  open: boolean;
  selectedCatalogKey: string | null;
  updating: boolean;
  uninstalling: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  update: [];
  uninstall: [];
  select: [entry: CatalogEntry];
}>();
</script>
