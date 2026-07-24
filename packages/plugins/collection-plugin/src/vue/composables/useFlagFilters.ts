// Flag-filter chips (table view only): one tri-state chip per predicate-shaped
// field (all → hide → only), ANDed with the text search. Schemas with only the
// legacy completion pair (no flag) get a synthesized "done" chip. Chip state is a
// SHARED per-collection localStorage preference (like the table sort) — read here
// and reset on collection switch; the write lives in the parent's persist watch.
//
// The reactive shell, extracted from CollectionView; the tri-state transition,
// own-property read, and icon/colour mappings live in `../flagFilterDisplay`, and
// the per-row predicate (`chipMatches` / `flagFieldValue`) in core.

import { computed, ref, type ComputedRef, type Ref } from "vue";
import { chipMatches, flagFieldValue, type FlagChip, type CollectionDetail, type CollectionItem } from "@mulmoclaude/core/collection";
import { readCollectionFlagFilters, type FlagFilterMode, type FlagFilterState } from "../collectionViewMode";
import {
  buildFlagChips,
  cycleFlagFilterState,
  flagChipClassForMode,
  flagChipIconClassForMode,
  flagChipIconForMode,
  flagFilterModeOf,
} from "../flagFilterDisplay";
import { useClickOutside } from "./useClickOutside";
import type { useCollectionI18n } from "../lang";

type Translate = ReturnType<typeof useCollectionI18n>["t"];

interface UseFlagFiltersParams {
  collection: Ref<CollectionDetail | null>;
  /** The text-search-filtered rows; the chips narrow these further (AND). */
  filteredItems: Readonly<Ref<CollectionItem[]>>;
  activeSlug: Readonly<Ref<string | undefined>>;
  /** Enriches a record so a flag over derived/rollup inputs reads correctly. */
  deriveRecord: (item: CollectionItem) => CollectionItem;
  t: Translate;
}

export interface UseFlagFilters {
  flagFilters: Ref<FlagFilterState>;
  flagChips: ComputedRef<FlagChip[]>;
  tableFilteredItems: ComputedRef<CollectionItem[]>;
  activeFlagFilterCount: ComputedRef<number>;
  filterMenuOpen: Ref<boolean>;
  filterMenuRef: Ref<HTMLElement | null>;
  /** A flag FIELD's computed boolean for one row (list cells + sort). */
  flagValueOf: (key: string, item: CollectionItem) => boolean;
  flagFilterMode: (key: string) => FlagFilterMode | undefined;
  cycleFlagFilter: (key: string) => void;
  flagChipIcon: (key: string) => string;
  flagChipIconClass: (key: string) => string;
  flagChipClass: (key: string) => string;
  flagChipTitle: (chip: FlagChip) => string;
  /** Restore the given collection's stored (shared) chip states — the
   *  switch-collection reset; chip state belongs to a schema, never carried across. */
  resetForSlug: (slug: string | undefined) => void;
}

function storedFlagFiltersFor(slug: string | undefined): FlagFilterState {
  return slug ? readCollectionFlagFilters(slug) : {};
}

export function useFlagFilters({ collection, filteredItems, activeSlug, deriveRecord, t }: UseFlagFiltersParams): UseFlagFilters {
  const flagFilters = ref<FlagFilterState>(storedFlagFiltersFor(activeSlug.value));
  const { open: filterMenuOpen, menuRef: filterMenuRef } = useClickOutside();

  const flagChips = computed<FlagChip[]>(() => {
    const schema = collection.value?.schema;
    return schema ? buildFlagChips(schema, t("collectionsView.flagDoneChip")) : [];
  });

  const flagFilterMode = (key: string): FlagFilterMode | undefined => flagFilterModeOf(flagFilters.value, key);

  const flagValueOf = (key: string, item: CollectionItem): boolean => flagFieldValue(deriveRecord(item), key);

  /** `filteredItems` further narrowed by every ACTIVE chip (AND). Consumed only
   *  by the table (sortedItems / count summary / empty state). */
  const tableFilteredItems = computed<CollectionItem[]>(() => {
    const schema = collection.value?.schema;
    const active = flagChips.value.filter((chip) => flagFilterMode(chip.key) !== undefined);
    if (!schema || active.length === 0) return filteredItems.value;
    return filteredItems.value.filter((item) =>
      active.every((chip) => chipMatches(chip, schema, item, deriveRecord) === (flagFilterMode(chip.key) === "only")),
    );
  });

  /** Cycle a chip all → hide → only → all. */
  function cycleFlagFilter(key: string): void {
    flagFilters.value = cycleFlagFilterState(flagFilters.value, key);
  }

  const flagChipIcon = (key: string): string => flagChipIconForMode(flagFilterMode(key));
  const flagChipIconClass = (key: string): string => flagChipIconClassForMode(flagFilterMode(key));
  const flagChipClass = (key: string): string => flagChipClassForMode(flagFilterMode(key));

  /** How many chips currently filter (badge on the menu trigger). */
  const activeFlagFilterCount = computed<number>(() => flagChips.value.filter((chip) => flagFilterMode(chip.key) !== undefined).length);

  function flagChipTitle(chip: FlagChip): string {
    const mode = flagFilterMode(chip.key);
    if (mode === "hide") return t("collectionsView.flagFilterHide", { label: chip.label });
    if (mode === "only") return t("collectionsView.flagFilterOnly", { label: chip.label });
    return t("collectionsView.flagFilterAll", { label: chip.label });
  }

  function resetForSlug(slug: string | undefined): void {
    flagFilters.value = storedFlagFiltersFor(slug);
  }

  return {
    flagFilters,
    flagChips,
    tableFilteredItems,
    activeFlagFilterCount,
    filterMenuOpen,
    filterMenuRef,
    flagValueOf,
    flagFilterMode,
    cycleFlagFilter,
    flagChipIcon,
    flagChipIconClass,
    flagChipClass,
    flagChipTitle,
    resetForSlug,
  };
}
