<template>
  <!-- Right pane for the selected active skill: header + edit/delete
       controls, then loading / error / edit-mode form / rendered body.
       The destructive control's testid is driven by isSelectedPreset
       (unstar for a catalog-backed activation, delete otherwise) — the
       parent must pass it so the e2e-referenced `skill-delete-btn` does
       not silently flip to `skill-unstar-btn`. -->
  <div class="p-6">
    <div class="flex items-start justify-between gap-4 mb-4">
      <div class="min-w-0">
        <h3 class="text-xl font-semibold text-gray-800 truncate">
          {{ selected.name }}
        </h3>
        <p class="text-sm text-gray-600 mt-1">
          {{ selected.description }}
        </p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <template v-if="editing">
          <button
            class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
            data-testid="skill-cancel-btn"
            @click="emit('cancel')"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            class="h-8 px-2.5 flex items-center gap-1 text-sm rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-40"
            :disabled="saving"
            data-testid="skill-save-btn"
            @click="emit('save')"
          >
            <span class="material-icons text-sm">save</span>
            {{ t("common.save") }}
          </button>
        </template>
        <template v-else>
          <button
            v-if="isSelectedEditable"
            class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            :disabled="detailLoading"
            data-testid="skill-edit-btn"
            @click="emit('edit')"
          >
            <span class="material-icons text-sm">edit</span>
            {{ t("pluginManageSkills.btnEdit") }}
          </button>
          <button
            v-if="isSelectedEditable"
            class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            :class="isSelectedPreset ? '' : 'border-red-300 text-red-600 hover:bg-red-50'"
            :disabled="detailLoading || deleting"
            :data-testid="isSelectedPreset ? 'skill-unstar-btn' : 'skill-delete-btn'"
            :title="isSelectedPreset ? t('pluginManageSkills.unstarPresetSkill') : t('pluginManageSkills.deleteProjectSkill')"
            @click="emit('delete')"
          >
            <span class="material-icons text-sm" :class="isSelectedPreset ? 'text-amber-500' : ''">{{ isSelectedPreset ? "star_border" : "delete" }}</span>
            {{ isSelectedPreset ? t("pluginManageSkills.btnUnstar") : t("pluginManageSkills.btnDelete") }}
          </button>
        </template>
      </div>
    </div>
    <div v-if="detailLoading" class="text-sm text-gray-400 italic">{{ t("pluginManageSkills.loading") }}</div>
    <div v-else-if="detailError" class="text-sm text-red-600">
      {{ detailError }}
    </div>
    <!-- Edit mode -->
    <div v-else-if="editing && detail" class="space-y-4">
      <div>
        <label class="block text-xs font-medium text-gray-500 mb-1"> {{ t("pluginManageSkills.fieldDescription") }} </label>
        <input
          v-model="editDescription"
          data-testid="skill-edit-description"
          class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-800"
        />
      </div>
      <div class="flex-1">
        <label class="block text-xs font-medium text-gray-500 mb-1"> {{ t("pluginManageSkills.fieldBody") }} </label>
        <textarea
          v-model="editBody"
          data-testid="skill-edit-body"
          class="w-full h-96 px-3 py-2 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-800 resize-y"
        ></textarea>
      </div>
    </div>
    <!-- View mode -->
    <!-- eslint-disable vue/no-v-html -- sanitized via DOMPurify; multi-line element so disable/enable pair (CLAUDE.md UI rule) instead of -next-line -->
    <div
      v-else-if="detail && renderedBody"
      ref="markdownRef"
      class="markdown-content text-gray-700"
      data-testid="skill-body-rendered"
      @click="handleExternalLinkClick"
      v-html="renderedBody"
    ></div>
    <!-- eslint-enable vue/no-v-html -->
    <p v-else-if="detail" class="text-sm text-gray-400 italic">{{ t("pluginManageSkills.emptyBody") }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { handleExternalLinkClick } from "@mulmoclaude/markdown-utils/dom/externalLink";
import type { SkillSummary, SkillDetail } from "./index";
import { useSkillMarkdown } from "./useSkillMarkdown";

const { t } = useI18n();

const props = defineProps<{
  selected: SkillSummary;
  detail: SkillDetail | null;
  editing: boolean;
  saving: boolean;
  deleting: boolean;
  detailLoading: boolean;
  detailError: string | null;
  isSelectedEditable: boolean;
  isSelectedPreset: boolean;
}>();

const editDescription = defineModel<string>("editDescription", { required: true });
const editBody = defineModel<string>("editBody", { required: true });

const emit = defineEmits<{
  edit: [];
  cancel: [];
  save: [];
  delete: [];
}>();

// The pane owns rendering its own body: the markdown ref must sit on the
// v-html element that lives here, so mermaid post-processing can reach it.
const { markdownRef, renderedBody } = useSkillMarkdown(() => props.detail?.body);
</script>
