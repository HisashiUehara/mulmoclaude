<template>
  <table class="min-w-full text-xs">
    <thead>
      <tr class="bg-slate-50 border-b border-slate-200">
        <th
          v-for="[key, field] in listColumnFields"
          :key="key"
          :aria-sort="isSortableField(field) ? sortAriaValue(key) : undefined"
          class="px-5 py-3 font-bold text-slate-500 text-left uppercase tracking-wider whitespace-nowrap"
        >
          <div class="flex items-center gap-1">
            <span class="truncate max-w-[14rem]" :title="field.label">{{ field.label }}</span>
            <button
              v-if="isSortableField(field)"
              type="button"
              class="inline-flex items-center justify-center rounded p-0.5 -my-1 leading-none transition-colors"
              :class="sortButtonClass(key)"
              :data-testid="`collections-sort-${key}`"
              :aria-label="t('collectionsView.sortBy', { field: field.label })"
              @click.stop="$emit('cycleSort', key)"
              @pointerenter="$emit('update:hoveredSortKey', key)"
              @pointerleave="$emit('update:hoveredSortKey', null)"
            >
              <span class="material-icons text-base align-middle">{{ sortIconName(key) }}</span>
            </button>
          </div>
        </th>
      </tr>
    </thead>
    <tbody class="divide-y divide-slate-100 bg-white">
      <template v-for="item in sortedItems" :key="String(item[collection.schema.primaryKey] ?? '')">
        <tr
          class="hover:bg-slate-50/70 cursor-pointer transition-colors focus:outline-none focus:bg-indigo-50/30"
          :class="rowHighlighted(item) ? 'bg-indigo-50/40' : ''"
          role="button"
          tabindex="0"
          :aria-label="t('collectionsView.openItem', { id: String(item[collection.schema.primaryKey] ?? '') })"
          :data-testid="`collections-row-${item[collection.schema.primaryKey]}`"
          @click="$emit('openView', item)"
          @keydown.enter.self="$emit('openView', item)"
          @keydown.space.self.prevent="$emit('openView', item)"
        >
          <CollectionCell
            v-for="[key, field] in listColumnFields"
            :key="key"
            :field="field"
            :field-key="key"
            :item="item"
            :collection="collection"
            :render="render"
            :is-read-only="isReadOnly"
            :row-inline-saving="rowInlineSaving(item)"
            :enum-originally-empty="enumOriginallyEmpty"
            @commit-toggle="onCommitToggle"
            @commit-inline-edit="onCommitInlineEdit"
          />
        </tr>
      </template>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import CollectionCell from "./CollectionCell.vue";
import { useCollectionI18n } from "../lang";
import type { CollectionRendering } from "../useCollectionRendering";
import { previewSortDir, sortAriaTokenForDir, sortButtonClassForDir, sortIconNameForDir, type SortDir } from "../tableSortDisplay";
import {
  isSortableField,
  rowIdOf,
  type CollectionDetail,
  type CollectionItem,
  type CollectionFieldSpec as FieldSpec,
  type SortState,
} from "@mulmoclaude/core/collection";

const props = defineProps<{
  collection: CollectionDetail;
  listColumnFields: [string, FieldSpec][];
  sortedItems: CollectionItem[];
  render: CollectionRendering;
  isReadOnly: boolean;
  enumOriginallyEmpty: Set<string>;
  /** Rows with an inline cell save in flight (by `rowId`). */
  inlineSavingRows: Set<string>;
  sortState: SortState | null;
  /** The column whose sort button is hovered (drives the next-click preview). */
  hoveredSortKey: string | null;
  /** rowId of the record open in read-only detail, or null. */
  openRowId: string | null;
  /** rowId of the record being edited (non-create), or null. */
  editingRowId: string | null;
}>();

const emit = defineEmits<{
  openView: [item: CollectionItem];
  cycleSort: [key: string];
  commitToggle: [item: CollectionItem, field: FieldSpec];
  commitInlineEdit: [item: CollectionItem, key: string, field: FieldSpec, raw: boolean | string];
  "update:hoveredSortKey": [key: string | null];
}>();

const { t } = useCollectionI18n();

function sortDirectionFor(key: string): SortDir {
  return props.sortState?.field === key ? props.sortState.direction : null;
}

function effectiveSortDir(key: string): SortDir {
  return previewSortDir(sortDirectionFor(key), props.hoveredSortKey === key);
}

const sortIconName = (key: string): string => sortIconNameForDir(effectiveSortDir(key));
const sortButtonClass = (key: string): string => sortButtonClassForDir(effectiveSortDir(key));
const sortAriaValue = (key: string): "ascending" | "descending" | "none" => sortAriaTokenForDir(sortDirectionFor(key));

/** This row has an inline cell save in flight (its inline controls disabled). */
function rowInlineSaving(item: CollectionItem): boolean {
  return props.inlineSavingRows.has(rowIdOf(props.collection.schema.primaryKey, item));
}

/** This row is the one open in read-only detail OR the one being edited. */
function rowHighlighted(item: CollectionItem): boolean {
  const rowKey = rowIdOf(props.collection.schema.primaryKey, item);
  return rowKey === props.openRowId || rowKey === props.editingRowId;
}

function onCommitToggle(item: CollectionItem, field: FieldSpec): void {
  emit("commitToggle", item, field);
}

function onCommitInlineEdit(item: CollectionItem, key: string, field: FieldSpec, raw: boolean | string): void {
  emit("commitInlineEdit", item, key, field, raw);
}
</script>
