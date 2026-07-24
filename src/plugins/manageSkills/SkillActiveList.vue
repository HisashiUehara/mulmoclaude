<template>
  <!-- ★ Active section: skills discovered by Claude Code in
       `.claude/skills/` and loaded into the system prompt. Rows select
       into the right pane; provenance shows as a per-row badge. -->
  <div data-testid="skill-section-active">
    <button
      type="button"
      data-testid="skill-section-toggle-active"
      class="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:bg-gray-100 border-b border-gray-100"
      :aria-expanded="open"
      aria-controls="skill-section-panel-active"
      @click="emit('toggle')"
    >
      <span class="flex items-center gap-1">
        <span class="material-icons text-base">{{ open ? "expand_more" : "chevron_right" }}</span>
        {{ t("pluginManageSkills.sectionActive") }}
      </span>
      <span data-testid="skill-section-count-active" class="text-gray-400 font-normal normal-case">{{ skills.length }}</span>
    </button>
    <div v-show="open" id="skill-section-panel-active" role="group">
      <div
        v-for="skill in skills"
        :key="skill.name"
        :data-testid="`skill-item-${skill.name}`"
        class="cursor-pointer px-4 py-3 border-b border-gray-100 text-sm hover:bg-white transition-colors focus:outline-none focus:bg-white focus:border-l-2 focus:border-l-blue-400"
        :class="selectedName === skill.name && !catalogSelected ? 'bg-white border-l-2 border-l-blue-500' : ''"
        role="button"
        tabindex="0"
        :aria-pressed="selectedName === skill.name && !catalogSelected"
        @click="emit('select', skill.name)"
        @keydown.enter.prevent="emit('select', skill.name)"
        @keydown.space.prevent="emit('select', skill.name)"
      >
        <div class="flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <div class="font-medium text-gray-800 truncate">{{ skill.name }}</div>
            <div class="text-xs text-gray-500 truncate mt-0.5">
              {{ skill.description }}
            </div>
          </div>
          <span class="shrink-0 material-icons text-sm" :class="skillBadge(skill).colour" :title="skillBadge(skill).title" aria-hidden="true">{{
            skillBadge(skill).icon
          }}</span>
        </div>
      </div>
      <i18n-t v-if="skills.length === 0" keypath="pluginManageSkills.emptyWithPath" tag="p" class="p-4 text-sm text-gray-400 italic">
        <template #path>
          <code class="text-[11px]">{{ t("pluginManageSkills.emptySkillPath") }}</code>
        </template>
      </i18n-t>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { SkillSummary } from "./index";
import { skillBadgeMeta, type SourceMeta } from "./categories";

const { t } = useI18n();

defineProps<{
  skills: SkillSummary[];
  open: boolean;
  selectedName: string | null;
  catalogSelected: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  select: [name: string];
}>();

// Thin view wrapper: the pure skillBadgeMeta returns an i18n title KEY;
// resolve it here through the live t() so the template keeps its
// { icon, title, colour } contract.
function skillBadge(skill: SkillSummary): SourceMeta {
  const meta = skillBadgeMeta(skill);
  return { icon: meta.icon, colour: meta.colour, title: t(meta.titleKey) };
}
</script>
