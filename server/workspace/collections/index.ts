export {
  discoverCollections,
  loadCollection,
  toSummary,
  toDetail,
  CollectionSchemaZ,
  resolveDataDir,
  type LoadedCollection,
} from "@mulmoclaude/core/collection/server";
export { validateCollectionRecords, validateRecordObject, COMPUTED_TYPES, type RecordIssue } from "@mulmoclaude/core/collection/server";
export { buildWorkspaceOntology, schemaRelations, type CollectionOntologyEntry, type OntologyRelation } from "@mulmoclaude/core/collection/server";
export { applyMutateAction, firstMutateParamProblem, type MutateActionOutcome } from "@mulmoclaude/core/collection/server";
export { enrichItems, computeCollectionIcon } from "@mulmoclaude/core/collection/server";
export { storeFor, collectionWritable, readOnlyRefusal, type CollectionStore } from "@mulmoclaude/core/collection/server";
export { deleteCollection, deleteCollectionRefusalMessage, type DeleteCollectionResult } from "@mulmoclaude/core/collection/server";
export { deleteCustomView, type DeleteViewResult } from "@mulmoclaude/core/collection/server";
// NOTE (storage virtualization, plans/refactor-storage-virtualization.md):
// the raw io READERS (`listItems` / `readItem`) are deliberately NOT
// re-exported — host code reads records only through `storeFor(...)` so a
// future storage backend can't be bypassed. `writeItem` / `deleteItem` stay
// direct until Stage 2 folds writes into the store.
export {
  writeItem,
  deleteItem,
  safeRecordId,
  generateItemId,
  resolveCreateItemId,
  readSkillTemplate,
  readCustomViewHtml,
  readCustomViewI18n,
  buildActionSeedPrompt,
  buildCollectionActionSeedPrompt,
  promptPathsFor,
  type WriteItemResult,
  type DeleteItemResult,
} from "@mulmoclaude/core/collection/server";
export type {
  CollectionSchema,
  CollectionAction,
  CollectionMutateAction,
  CollectionSeededAction,
  CollectionCustomView,
  CollectionViewCapability,
  CollectionFieldSpec,
  CollectionFieldType,
  CollectionSummary,
  CollectionDetail,
  CollectionItem,
  CollectionSource,
} from "./types.js";
