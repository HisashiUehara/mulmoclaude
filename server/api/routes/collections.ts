// REST surface for schema-driven collections. Each collection is a
// skill that ships a sibling `schema.json`; the host's <CollectionView>
// component reads through these endpoints.
//
//   GET    /api/collections                       → { collections: CollectionSummary[] }
//   GET    /api/collections/:slug                 → { collection, items }
//   POST   /api/collections/:slug/items           → { item, itemId }
//   PUT    /api/collections/:slug/items/:itemId   → { item, itemId }
//   DELETE /api/collections/:slug/items/:itemId   → { deleted: true }

import { Router, Request, Response, NextFunction } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { actionVisible } from "@mulmoclaude/core/collection";
import {
  collectionWritable,
  computeCollectionIcon,
  discoverCollections,
  generateItemId,
  deleteCollection,
  deleteCollectionRefusalMessage,
  deleteCustomView,
  deleteItem,
  loadCollection,
  readSkillTemplate,
  readCustomViewHtml,
  readCustomViewI18n,
  readOnlyRefusal,
  buildActionSeedPrompt,
  buildCollectionActionSeedPrompt,
  promptPathsFor,
  resolveCreateItemId,
  storeFor,
  toDetail,
  toSummary,
  applyMutateAction,
  validateCollectionRecords,
  writeItem,
} from "../../workspace/collections/index.js";
import type {
  CollectionMutateAction,
  CollectionSeededAction,
  CollectionDetail,
  CollectionItem,
  CollectionSummary,
  DeleteViewResult,
  LoadedCollection,
  RecordIssue,
} from "../../workspace/collections/index.js";
import {
  buildRemoteView,
  mutateRemoteView,
  mutateRemoteViewFailureMessage,
  remoteViewFailureMessage,
  remoteViewItems,
  remoteViewItemsFailureMessage,
  type MutateRemoteViewResult,
  type RemoteViewBuildResult,
  type RemoteViewItemsResult,
} from "../../workspace/collections/remoteView.js";
import { clampLimit, clampOffset, normalizeFields, normalizeMutate } from "@mulmoclaude/core/remote-view";
import { badRequest, notFound, conflict, forbidden, methodNotAllowed, serverError, serviceUnavailable } from "../../utils/httpError.js";
import { ONE_MINUTE_MS } from "../../utils/time.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";
import { workspacePath } from "../../workspace/workspace.js";
import { refreshOne } from "@mulmoclaude/core/feeds/server";
import { manageCollection } from "../../agent/mcp-tools/manageCollection.js";
import { dispatchAgentAction, runningAgentActions } from "./collectionAgentActions.js";
import { clampCapabilities, mintViewToken, requireViewToken, type ViewCapability } from "../auth/viewToken.js";

const router = Router();

// Load a collection by slug or send a 404 and return null. Callers do
// `const collection = await loadCollectionOr404(slug, res); if (!collection) return;`.
// The load-or-404 preamble was repeated across ~16 route handlers.
async function loadCollectionOr404(slug: string, res: Response): Promise<LoadedCollection | null> {
  const collection = await loadCollection(slug);
  if (!collection) {
    notFound(res, `collection '${slug}' not found`);
    return null;
  }
  return collection;
}

type CustomView = NonNullable<LoadedCollection["schema"]["views"]>[number];

// Resolve a collection + one of its custom views by id, or send a 404
// (missing collection or missing view) and return null. Shared by the
// view-file / view-i18n / view-token routes.
async function resolveCustomViewOr404(slug: string, viewId: string, res: Response): Promise<{ collection: LoadedCollection; view: CustomView } | null> {
  const collection = await loadCollectionOr404(slug, res);
  if (!collection) return null;
  const view = (collection.schema.views ?? []).find((entry) => entry.id === viewId);
  if (!view) {
    notFound(res, `custom view '${viewId}' not found on collection '${slug}'`);
    return null;
  }
  return { collection, view };
}

interface CollectionsListResponse {
  collections: CollectionSummary[];
}

interface CollectionDetailResponse {
  collection: CollectionDetail;
  items: CollectionItem[];
  /** Record files that failed validation (malformed JSON / schema
   *  violation) and are silently skipped at read time. Drives the
   *  in-view Repair prompt. Omitted/empty when every record is fine. */
  issues?: RecordIssue[];
  /** In-flight `kind: "agent"` action run keys — drives the button
   *  spinners. Omitted when nothing is running (absent-when-clean). */
  runningActions?: string[];
}

interface ItemMutationResponse {
  itemId: string;
  item: CollectionItem;
}

interface DeleteResponse {
  deleted: true;
  itemId: string;
}

interface DeleteCollectionResponse {
  deleted: true;
  slug: string;
  /** Workspace-relative path to the backup written before removal
   *  (e.g. `archive/2026-05-31-<uuid>`). */
  archivePath: string;
}

interface DeleteViewResponse {
  deleted: true;
  viewId: string;
}

interface ActionSeedResponse {
  /** Assembled seed prompt the client feeds to a new chat. */
  prompt: string;
  /** Role id the new chat should run in (from the action). */
  role: string;
}

/** `kind: "agent"`: the server dispatched the hidden worker itself — no
 *  seed rides back to the client, which just shows the running state. */
interface ActionDispatchedResponse {
  dispatched: true;
}

/** `kind: "mutate"`: the server applied the declarative write itself —
 *  the written record rides back so the client can update in place. */
interface ActionMutatedResponse {
  written: true;
  itemId: string;
  item: CollectionItem;
}

type ActionRunResponse = ActionSeedResponse | ActionDispatchedResponse | ActionMutatedResponse;

// Client-list summary: the static `toSummary` plus, for a collection that
// declares `dynamicIcon`, the computed icon + the source slug(s) a live
// view should watch (see `useDynamicShortcutIcons`). Collections without
// `dynamicIcon` take the fast path (no record read) — only this endpoint
// pays the compute cost; `toDetail`/`toSummary` elsewhere stay static.
async function toClientSummary(collection: LoadedCollection): Promise<CollectionSummary> {
  const summary = toSummary(collection);
  const spec = collection.schema.dynamicIcon;
  if (!spec) return summary;
  const icon = await computeCollectionIcon(collection);
  return { ...summary, icon, iconSources: [spec.source.collection] };
}

router.get(API_ROUTES.collections.list, async (_req: Request, res: Response<CollectionsListResponse>) => {
  try {
    const collections = await discoverCollections();
    const summaries = await Promise.all(collections.map(toClientSummary));
    res.json({ collections: summaries });
  } catch (err) {
    log.warn("collections", "list failed", { error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

router.get(API_ROUTES.collections.detail, async (req: Request<{ slug: string }>, res: Response<CollectionDetailResponse>) => {
  const collection = await loadCollectionOr404(req.params.slug, res);
  if (!collection) return;
  try {
    const items = await storeFor(collection).list();
    // Best-effort validation: a malformed record is silently skipped at
    // read time, so surface the problems here too (the same pass
    // presentCollection runs) and let the view offer a Repair button.
    // Never let validation failure turn a successful detail into a 500.
    let issues: RecordIssue[] = [];
    try {
      issues = await validateCollectionRecords(collection);
    } catch (err) {
      log.warn("collections", "detail validation skipped", { slug: collection.slug, error: errorMessage(err) });
    }
    // Omit `issues` / `runningActions` entirely when everything is fine,
    // matching the "absent when clean" contract on CollectionDetailResponse.
    const runningActions = runningAgentActions(collection.slug);
    res.json({
      collection: toDetail(collection),
      items,
      ...(issues.length > 0 ? { issues } : {}),
      ...(runningActions.length > 0 ? { runningActions } : {}),
    });
  } catch (err) {
    log.warn("collections", "detail failed", { slug: collection.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// Delete an entire collection — the skill (staging + active mirror) AND
// its records — after archiving a restorable copy. Only project-scope,
// non-preset collections are deletable; see deleteCollection for the
// scope rules and the archive layout.
router.delete(API_ROUTES.collections.detail, async (req: Request<{ slug: string }>, res: Response<DeleteCollectionResponse>) => {
  const collection = await loadCollectionOr404(req.params.slug, res);
  if (!collection) return;
  try {
    const result = await deleteCollection(collection);
    if (result.kind !== "ok") {
      forbidden(res, deleteCollectionRefusalMessage(result));
      return;
    }
    log.info("collections", "collection deleted", { slug: result.slug, archivePath: result.archivePath });
    res.json({ deleted: true, slug: result.slug, archivePath: result.archivePath });
  } catch (err) {
    log.warn("collections", "collection delete failed", { slug: req.params.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

function extractRecord(body: unknown): CollectionItem | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as CollectionItem;
}

router.post(API_ROUTES.collections.items, async (req: Request<{ slug: string }>, res: Response<ItemMutationResponse>) => {
  const collection = await loadCollectionOr404(req.params.slug, res);
  if (!collection) return;
  if (!collectionWritable(collection)) {
    methodNotAllowed(res, readOnlyRefusal(collection.slug));
    return;
  }
  const record = extractRecord(req.body);
  if (!record) {
    badRequest(res, "request body must be a JSON object");
    return;
  }
  // Resolve the item id: a singleton collection pins EVERY create to
  // its fixed id (so the "at most one record" contract holds against
  // direct API calls / scripts / concurrent clients — not just the UI,
  // which merely hides Add; with the id pinned, a second create targets
  // the same file and hits the refuseOverwrite conflict below). For a
  // normal collection the body's primaryKey value wins, else a
  // generated id (Codex P1 on #1510).
  const itemId = resolveCreateItemId(collection.schema, record) ?? generateItemId();
  const recordWithId: CollectionItem = { ...record, [collection.schema.primaryKey]: itemId };
  try {
    const result = await writeItem(collection.dataDir, itemId, recordWithId, { refuseOverwrite: true, slug: collection.slug });
    if (result.kind === "invalid-id") {
      badRequest(res, `invalid item id: ${result.itemId}`);
      return;
    }
    if (result.kind === "path-escape") {
      forbidden(res, `data directory for collection '${collection.slug}' escapes the workspace`);
      return;
    }
    if (result.kind === "conflict") {
      conflict(res, `item '${result.itemId}' already exists`);
      return;
    }
    log.info("collections", "item created", { slug: collection.slug, itemId: result.itemId });
    res.json({ itemId: result.itemId, item: result.item });
  } catch (err) {
    log.warn("collections", "item create failed", { slug: collection.slug, itemId, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

router.put(API_ROUTES.collections.item, async (req: Request<{ slug: string; itemId: string }>, res: Response<ItemMutationResponse>) => {
  const collection = await loadCollectionOr404(req.params.slug, res);
  if (!collection) return;
  if (!collectionWritable(collection)) {
    methodNotAllowed(res, readOnlyRefusal(collection.slug));
    return;
  }
  const record = extractRecord(req.body);
  if (!record) {
    badRequest(res, "request body must be a JSON object");
    return;
  }
  // Singleton enforcement: only the fixed id is writable, so a PUT to
  // any other id can't smuggle in a second record (Codex P1 on #1510).
  const { singleton, primaryKey } = collection.schema;
  if (singleton && req.params.itemId !== singleton) {
    badRequest(res, `collection '${collection.slug}' is a singleton; the only valid item id is '${singleton}'`);
    return;
  }
  // PUT pins the primaryKey to the URL itemId — disregard any
  // mismatched primary-key value in the body so the file's id and its
  // record id never drift.
  const recordWithId: CollectionItem = { ...record, [primaryKey]: req.params.itemId };
  try {
    const result = await writeItem(collection.dataDir, req.params.itemId, recordWithId, { slug: collection.slug });
    if (result.kind === "invalid-id") {
      badRequest(res, `invalid item id: ${result.itemId}`);
      return;
    }
    if (result.kind === "path-escape") {
      forbidden(res, `data directory for collection '${collection.slug}' escapes the workspace`);
      return;
    }
    if (result.kind === "conflict") {
      // refuseOverwrite was false — this branch is unreachable, but
      // typescript needs the exhaustive switch.
      serverError(res, "unexpected conflict on update");
      return;
    }
    log.info("collections", "item updated", { slug: collection.slug, itemId: result.itemId });
    res.json({ itemId: result.itemId, item: result.item });
  } catch (err) {
    log.warn("collections", "item update failed", { slug: collection.slug, itemId: req.params.itemId, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

router.delete(API_ROUTES.collections.item, async (req: Request<{ slug: string; itemId: string }>, res: Response<DeleteResponse>) => {
  const collection = await loadCollectionOr404(req.params.slug, res);
  if (!collection) return;
  if (!collectionWritable(collection)) {
    methodNotAllowed(res, readOnlyRefusal(collection.slug));
    return;
  }
  try {
    const result = await deleteItem(collection.dataDir, req.params.itemId, { slug: collection.slug });
    if (result.kind === "invalid-id") {
      badRequest(res, `invalid item id: ${result.itemId}`);
      return;
    }
    if (result.kind === "path-escape") {
      forbidden(res, `data directory for collection '${collection.slug}' escapes the workspace`);
      return;
    }
    if (result.kind === "not-found") {
      notFound(res, `item '${result.itemId}' not found`);
      return;
    }
    log.info("collections", "item deleted", { slug: collection.slug, itemId: result.itemId });
    res.json({ deleted: true, itemId: result.itemId });
  } catch (err) {
    log.warn("collections", "item delete failed", { slug: collection.slug, itemId: req.params.itemId, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

interface RefreshResponse {
  refreshed: true;
  written: number;
  errors: string[];
  /** True when an agent-ingest refresh dispatched a worker (fire-and-forget):
   *  records update asynchronously, so the client shows a note rather than a
   *  written count. */
  dispatched?: boolean;
  /** The visible worker's chat session id (manual Refresh only) so the client
   *  can open it to watch the refresh run. */
  chatId?: string;
}

// Re-run a feed collection's retrieval now. Generic over kind — the
// engine dispatches on `schema.ingest.kind`. 400 when the collection
// carries no `ingest` block (it's an ordinary skill collection, not a
// feed). Backs the CollectionView "Refresh feed" button.
router.post(API_ROUTES.collections.refresh, async (req: Request<{ slug: string }>, res: Response<RefreshResponse>) => {
  const collection = await loadCollectionOr404(req.params.slug, res);
  if (!collection) return;
  if (!collection.schema.ingest) {
    badRequest(res, `collection '${collection.slug}' is not a feed (no ingest config)`);
    return;
  }
  try {
    // Manual Refresh button → run a VISIBLE worker (hidden:false) so the user
    // can open the session and watch/debug it. Scheduled refreshes (the
    // `refreshDue` loop) stay hidden. Declarative feeds ignore the flag.
    const result = await refreshOne(workspacePath, collection, { hidden: false });
    log.info("collections", "feed refreshed via collection route", { slug: collection.slug, written: result.written, dispatched: result.dispatched ?? false });
    res.json({ refreshed: true, written: result.written, errors: result.errors, dispatched: result.dispatched, chatId: result.chatId });
  } catch (err) {
    log.warn("collections", "feed refresh failed", { slug: collection.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// Route the assembled seed by the action's kind: `"chat"` returns it for
// the client to start a visible chat; `"agent"` dispatches the hidden
// worker here and returns only `{ dispatched }` — the client shows the
// running state (spinner via the detail response's `runningActions`).
// 409 on a double-dispatch (the stamp-at-dispatch guard); 503 on a
// cap-miss / launch failure so the button un-sticks and reads honest.
async function respondForActionKind(
  res: Response<ActionRunResponse>,
  collection: LoadedCollection,
  action: CollectionSeededAction,
  seed: ActionSeedResponse,
  itemId?: string,
): Promise<void> {
  if (action.kind !== "agent") {
    res.json(seed);
    return;
  }
  const outcome = await dispatchAgentAction({ collection, action, seed: seed.prompt, itemId });
  if (!outcome.ok) {
    if (outcome.alreadyRunning) conflict(res, outcome.error);
    else serviceUnavailable(res, outcome.error);
    return;
  }
  res.json({ dispatched: true });
}

// Execute a `kind: "mutate"` action: validate the mini-form params, merge
// the resolved `set` over the record through the standard write gate, and
// answer with the written record so the client can update in place. The
// engine work lives in `applyMutateAction` (core); this maps its outcome
// to HTTP.
async function respondForMutateAction(
  res: Response<ActionRunResponse>,
  collection: LoadedCollection,
  action: CollectionMutateAction,
  itemId: string,
  body: { params?: unknown } | undefined,
): Promise<void> {
  const raw = body?.params;
  const params = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const outcome = await applyMutateAction(collection, action, itemId, params);
  if (!outcome.ok) {
    // `itemId` is caller-controlled (a route param) — strip CR/LF so a
    // crafted id can't forge log lines, same pattern as the view routes.
    log.info("collections", "mutate action refused", {
      slug: collection.slug,
      itemId: itemId.replace(/[\r\n]/g, " "),
      actionId: action.id,
      status: outcome.status,
      problem: outcome.problem,
    });
    if (outcome.status === "not-found") notFound(res, outcome.problem);
    else if (outcome.status === "require-unmet") conflict(res, outcome.problem);
    else if (outcome.status === "write-refused") serverError(res, outcome.problem);
    else badRequest(res, outcome.problem);
    return;
  }
  log.info("collections", "mutate action applied", { slug: collection.slug, itemId: itemId.replace(/[\r\n]/g, " "), actionId: action.id });
  res.json({ written: true, itemId, item: outcome.item });
}

// Assemble a schema-declared action's seed prompt for one record. The
// route is fully generic — it reads the record + the action's template
// from the skill dir and returns the seed + the role to run it in; the
// client starts the chat (or, for `kind: "agent"`, the server dispatches
// the hidden worker itself; for `kind: "mutate"`, it applies the
// declarative write). No domain (invoice / PDF / role) literals.
router.post(API_ROUTES.collections.itemAction, async (req: Request<{ slug: string; itemId: string; actionId: string }>, res: Response<ActionRunResponse>) => {
  const collection = await loadCollectionOr404(req.params.slug, res);
  if (!collection) return;
  const action = collection.schema.actions?.find((entry) => entry.id === req.params.actionId);
  if (!action) {
    notFound(res, `action '${req.params.actionId}' not found on collection '${collection.slug}'`);
    return;
  }
  try {
    const record = await storeFor(collection).read(req.params.itemId);
    if (!record) {
      notFound(res, `item '${req.params.itemId}' not found`);
      return;
    }
    // Enforce the action's `when` predicate server-side: the client
    // hides out-of-state buttons, but a stale or crafted request could
    // still target one (e.g. seed a payment journal for a non-paid
    // invoice). The visibility rule is the authorization rule.
    if (!actionVisible(action, record)) {
      conflict(res, `action '${action.id}' is not available for item '${req.params.itemId}' in its current state`);
      return;
    }
    // `kind: "mutate"` needs no template / seed / LLM — the host applies
    // the declarative write itself (require was just enforced above,
    // same visibility-is-authorization rule as the seeded kinds).
    if (action.kind === "mutate") {
      // Schema validation already rejects mutate actions on a dataSource
      // collection; this is the defensive server-side twin.
      if (!collectionWritable(collection)) {
        methodNotAllowed(res, readOnlyRefusal(collection.slug));
        return;
      }
      await respondForMutateAction(res, collection, action, req.params.itemId, req.body as { params?: unknown } | undefined);
      return;
    }
    const template = await readSkillTemplate(collection.skillDir, action.template);
    if (template === null) {
      serverError(res, `template '${action.template}' for action '${action.id}' could not be read`);
      return;
    }
    log.info("collections", "action seed built", { slug: collection.slug, itemId: req.params.itemId, actionId: action.id, kind: action.kind });
    const seed = { prompt: buildActionSeedPrompt(record, template, promptPathsFor(collection, workspacePath)), role: action.role };
    await respondForActionKind(res, collection, action, seed, req.params.itemId);
  } catch (err) {
    log.warn("collections", "action seed failed", {
      slug: collection.slug,
      itemId: req.params.itemId,
      actionId: req.params.actionId,
      error: errorMessage(err),
    });
    serverError(res, errorMessage(err));
  }
});

// Assemble the seed for a collection-level action: read the template and inject
// a compact progress summary of every record. Returns null when the template
// can't be read. Pure plumbing — kept out of the route handler to stay under the
// function-size limit.
async function buildCollectionActionSeed(collection: LoadedCollection, action: CollectionSeededAction): Promise<ActionSeedResponse | null> {
  const template = await readSkillTemplate(collection.skillDir, action.template);
  if (template === null) return null;
  const items = await storeFor(collection).list();
  log.info("collections", "collection action seed built", { slug: collection.slug, actionId: action.id, items: items.length });
  return { prompt: buildCollectionActionSeedPrompt(items, collection.schema, template, promptPathsFor(collection, workspacePath)), role: action.role };
}

// Like the per-record route but with no `itemId`: there is no record to read or
// gate on, so the seed injects a progress summary instead. No domain literals.
router.post(API_ROUTES.collections.collectionAction, async (req: Request<{ slug: string; actionId: string }>, res: Response<ActionRunResponse>) => {
  const collection = await loadCollectionOr404(req.params.slug, res);
  if (!collection) return;
  const action = collection.schema.collectionActions?.find((entry) => entry.id === req.params.actionId);
  if (!action) {
    notFound(res, `collection action '${req.params.actionId}' not found on collection '${collection.slug}'`);
    return;
  }
  // Schema validation already rejects mutate in `collectionActions` (no
  // record to write); this is the defensive twin that also narrows the type.
  if (action.kind === "mutate") {
    badRequest(res, `collection action '${action.id}' has kind "mutate" — mutate actions are record-level only`);
    return;
  }
  try {
    const seed = await buildCollectionActionSeed(collection, action);
    if (seed === null) {
      serverError(res, `template '${action.template}' for action '${action.id}' could not be read`);
      return;
    }
    await respondForActionKind(res, collection, action, seed);
  } catch (err) {
    log.warn("collections", "collection action seed failed", { slug: collection.slug, actionId: req.params.actionId, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// --- Custom views: capability-token minting + scoped data plane ---
//
// The data plane reuses the `manageCollection` tool handler verbatim, so a
// custom view can never do more than the agent itself (same getItems /
// putItems actions, same validation, scoped to one slug). The handler
// returns a JSON string on success and a bare diagnostic string on a guard
// failure (unknown slug, over-limit unselective read, bad putItems shape) —
// forward parsed JSON as 200, the bare string as a 400 `{ error }`.

/** Parse a `read`/`write` capability list from a request body value. */
function parseCapabilities(value: unknown): ViewCapability[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const caps = value.filter((entry): entry is ViewCapability => entry === "read" || entry === "write");
  return caps.length > 0 ? caps : undefined;
}

/** Parse a comma-separated or repeated query param into a string list. */
function parseListParam(value: unknown): string[] | undefined {
  const parts = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value.map(String) : [];
  const cleaned = parts.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

function sendToolResult(res: Response, raw: string): void {
  try {
    res.json(JSON.parse(raw));
  } catch {
    res.status(400).json({ error: raw });
  }
}

// ── View-data routes: a FROZEN public contract ──────────────────────────────
// Everything under `viewData*` below is called by LLM-authored custom-view
// HTML files persisted in users' workspaces (`data/skills/*/views/*.html`,
// `feeds/*/views/*.html`), written against the contract in
// `packages/core/assets/helps/custom-view.md`. Those files cannot be
// re-generated or migrated centrally, so this surface must stay
// backward-compatible indefinitely: keep `?fields=` / `?ids=` semantics, the
// `{ collection, count, items }` / `{ written, rejected }` / `{ rows }`
// response shapes, and the status-code semantics (400 with `{ error }`,
// 403 mutate-kind, 409 require-gate) stable. Evolve by ADDITION only —
// new optional params, new routes — never by renaming or reshaping.
// Storage virtualization (new `CollectionStore` backends — see
// `@mulmoclaude/core` collection/server/store.ts) must be invisible here.
//
// The view-data fetch comes from a sandboxed (opaque-origin) iframe, so it is
// a cross-origin request that the browser gates with CORS. `*` is safe here:
// auth is the unguessable scoped token in the Authorization header (not a
// cookie), so no ambient-credential leak — an origin without the token just
// reads a 401. The custom Authorization header makes the request non-simple,
// so the browser preflights; the OPTIONS handler below answers it.
// Exported for the CORS regression test: a sandboxed view's mutate-action
// call is a non-simple cross-origin POST, so a missing method here fails
// the browser preflight before any handler runs (Codex on PR #2105).
export const VIEW_DATA_CORS_METHODS = "GET, PUT, POST, OPTIONS";

export function viewDataCors(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", VIEW_DATA_CORS_METHODS);
  next();
}

/** Minimal fixed-window rate limiter for the token-scoped mutate-action
 *  route (CodeQL js/missing-rate-limiting): per source IP + slug, well
 *  above any human click rate but a lid on a runaway view loop. In-memory
 *  — the host is single-process — with a lazy sweep so the map can't grow
 *  unbounded. Exported factory so the unit test can drive the window. */
export function makeViewActionRateLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request<{ slug?: string }>, res: Response, next: NextFunction): void => {
    const nowMs = now();
    if (hits.size > 1000) {
      for (const [key, entry] of hits) if (entry.resetAt <= nowMs) hits.delete(key);
    }
    const key = `${req.ip ?? ""}\n${req.params.slug ?? ""}`;
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= nowMs) {
      hits.set(key, { count: 1, resetAt: nowMs + windowMs });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > max) {
      res.status(429).json({ error: "rate limit exceeded — retry shortly" });
      return;
    }
    next();
  };
}

const VIEW_ACTION_RATE_LIMIT_PER_MINUTE = 60;
const viewActionRateLimit = makeViewActionRateLimiter(VIEW_ACTION_RATE_LIMIT_PER_MINUTE, ONE_MINUTE_MS);

router.options(API_ROUTES.collections.viewData, viewDataCors, (_req: Request, res: Response) => {
  res.status(204).end();
});

// Serve a custom view's HTML file. Behind the global bearer (the parent
// fetches it, then renders it sandboxed). Read from the data/skills staging
// path — custom-view HTML is staging-only, never mirrored to .claude/skills
// (rendering is host-side). Path-safe: slug + the schema-validated
// `views/*.html` file, resolved with realpath containment.
router.get(API_ROUTES.collections.viewFile, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const { slug } = req.params;
    const viewId = typeof req.query.id === "string" ? req.query.id : "";
    const resolved = await resolveCustomViewOr404(slug, viewId, res);
    if (!resolved) return;
    const { collection, view } = resolved;
    // Path-safe, source-aware read through the collections domain layer (no raw
    // fs / hardcoded subpaths in the route).
    const html = await readCustomViewHtml(collection, view.file);
    if (html === null) {
      notFound(res, `view file '${view.file}' not found — author it at data/skills/<slug>/${view.file}`);
      return;
    }
    res.type("text/html").send(html);
  } catch (err) {
    log.warn("collections", "view-file read failed", { slug: req.params.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

/** Map a non-ok remote-view build to its HTTP error (message shared with the
 *  channel handler via `remoteViewFailureMessage`). */
function sendRemoteViewFailure(res: Response, result: Exclude<RemoteViewBuildResult, { kind: "ok" }>, slug: string): void {
  const message = remoteViewFailureMessage(result, slug);
  if (result.kind === "view-not-found" || result.kind === "file-missing") notFound(res, message);
  else badRequest(res, message);
}

// Serve a mobile (`target: "mobile"`) custom view wrapped into its sandboxed
// srcdoc — the desktop phone-frame preview's data source. Behind the global
// bearer. Same builder as the command channel's `getRemoteView`, so the
// preview renders the exact artifact the phone receives
// (plans/feat-remote-custom-view.md).
router.get(API_ROUTES.collections.remoteView, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const { slug } = req.params;
    const viewId = typeof req.query.id === "string" ? req.query.id : "";
    const locale = typeof req.query.locale === "string" ? req.query.locale : "";
    const collection = await loadCollectionOr404(slug, res);
    if (!collection) return;
    const result = await buildRemoteView(collection, viewId, locale);
    if (result.kind !== "ok") {
      sendRemoteViewFailure(res, result, slug);
      return;
    }
    res.json({ view: result.view, srcdoc: result.srcdoc, bytes: result.bytes });
  } catch (err) {
    log.warn("collections", "remote-view build failed", { slug: req.params.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

/** Map a non-ok mutate to its HTTP error (message shared with the channel
 *  handler via `mutateRemoteViewFailureMessage`). */
function sendMutateRemoteViewFailure(res: Response, result: Exclude<MutateRemoteViewResult, { kind: "ok" }>, slug: string): void {
  const message = mutateRemoteViewFailureMessage(result, slug);
  if (result.kind === "view-not-found" || result.kind === "item-not-found") notFound(res, message);
  else if (result.kind === "read-only-collection") methodNotAllowed(res, message);
  else if (result.kind === "not-writable" || result.kind === "delete-not-allowed" || result.kind === "field-not-editable" || result.kind === "path-escape")
    forbidden(res, message);
  else badRequest(res, message);
}

// Apply one update/delete on behalf of a mobile view — the desktop phone-frame
// preview's write channel. Behind the global bearer. Same builder + policy as
// the command channel's `mutateRemoteViewItem`, so a preview mutation runs the
// EXACT enforcement the phone will (plans/feat-remote-writable-view.md).
router.post(API_ROUTES.collections.remoteViewMutate, async (req: Request<{ slug: string; viewId: string }>, res: Response) => {
  try {
    const { slug, viewId } = req.params;
    const body = (req.body ?? {}) as { op?: unknown; id?: unknown; patch?: unknown };
    const request = normalizeMutate(body);
    if (!request) {
      badRequest(res, "invalid mutate request — expected { op: 'update'|'delete', id, patch? }");
      return;
    }
    const collection = await loadCollectionOr404(slug, res);
    if (!collection) return;
    const result = await mutateRemoteView(collection, viewId, request);
    if (result.kind !== "ok") {
      sendMutateRemoteViewFailure(res, result, slug);
      return;
    }
    log.info("collections", "remote-view mutate", { slug, viewId, op: result.op });
    res.json(result.op === "delete" ? { op: "delete", id: result.id } : { op: "update", item: result.item });
  } catch (err) {
    log.warn("collections", "remote-view mutate failed", { slug: req.params.slug, viewId: req.params.viewId, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

/** A `fields` projection arrives as a CSV query string (`?fields=title,photo`)
 *  or repeated params; hand `normalizeFields` an array either way. */
function csvParam(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === "string" && value.length > 0) return value.split(",");
  return undefined;
}

/** Map a non-ok item-page build to its HTTP error (message shared with the
 *  channel handler via `remoteViewItemsFailureMessage`). */
function sendRemoteViewItemsFailure(res: Response, result: Exclude<RemoteViewItemsResult, { kind: "ok" }>, slug: string): void {
  const message = remoteViewItemsFailureMessage(result, slug);
  if (result.kind === "view-not-found") notFound(res, message);
  else badRequest(res, message);
}

// One page of a mobile view's records with its declared `imageFields` inlined as
// `data:` URL thumbnails — the desktop phone-frame preview's paging source.
// Behind the global bearer. Same builder as the command channel's
// `getRemoteViewItems`, so the preview pages the exact data (real thumbnails)
// the phone will (plans/feat-remote-view-images.md).
router.get(API_ROUTES.collections.remoteViewItems, async (req: Request<{ slug: string; viewId: string }>, res: Response) => {
  try {
    const { slug, viewId } = req.params;
    const request = { offset: clampOffset(req.query.offset), limit: clampLimit(req.query.limit), fields: normalizeFields(csvParam(req.query.fields)) };
    const collection = await loadCollectionOr404(slug, res);
    if (!collection) return;
    const result = await remoteViewItems(collection, viewId, request);
    if (result.kind !== "ok") {
      sendRemoteViewItemsFailure(res, result, slug);
      return;
    }
    res.json({ page: result.page, inlined: result.inlined, omitted: result.omitted });
  } catch (err) {
    // Strip CR/LF from request-derived params before logging (log-injection
    // resistance, same convention as the view-i18n handler below).
    log.warn("collections", "remote-view items failed", {
      slug: req.params.slug.replace(/[\r\n]/g, " "),
      viewId: req.params.viewId.replace(/[\r\n]/g, " "),
      error: errorMessage(err),
    });
    serverError(res, errorMessage(err));
  }
});

// Translation dict for ONE custom view, locale-filtered server-side. The
// client passes its active app locale; the host returns only that locale's
// strings (fallback `"en"`, then `{}`). The view never sees other locales'
// strings — the host is the picker, the iframe is the consumer. Empty dict
// + `locale: ""` when the view has no `i18n` declared or the file is
// absent / malformed; the iframe-side `__MC_VIEW.t(key)` falls back to the
// key, so an i18n-less view keeps working unchanged.
router.get(API_ROUTES.collections.viewI18n, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const { slug } = req.params;
    const viewId = typeof req.query.id === "string" ? req.query.id : "";
    const locale = typeof req.query.locale === "string" ? req.query.locale : "";
    const resolved = await resolveCustomViewOr404(slug, viewId, res);
    if (!resolved) return;
    const { collection, view } = resolved;
    if (!view.i18n) {
      // The view declared no translation file — return the empty contract so
      // the client doesn't have to special-case "no i18n" with a different
      // shape. `t(key)` will just echo the key.
      res.json({ locale: "", dict: {} });
      return;
    }
    const result = await readCustomViewI18n(collection, view.i18n, locale);
    res.json(result);
  } catch (err) {
    // Strip CR/LF before logging — `loadCollection` already rejects malformed
    // slugs above (so this path always has a safe slug in practice), but
    // belt-and-suspenders for log-injection / forged-line resistance per
    // CodeRabbit review on #1842.
    log.warn("collections", "view-i18n read failed", { slug: req.params.slug.replace(/[\r\n]/g, " "), error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// Mint a scoped token for a custom view. Behind the global bearer (only the
// real frontend can mint); clamps requested caps to what the view declared
// so a `read`-only view can never obtain a `write` token.
router.post(API_ROUTES.collections.viewToken, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const { slug } = req.params;
    const body = (req.body ?? {}) as { viewId?: unknown; capabilities?: unknown };
    const viewId = typeof body.viewId === "string" ? body.viewId.trim() : "";
    if (!viewId) {
      badRequest(res, "`viewId` is required");
      return;
    }
    const resolved = await resolveCustomViewOr404(slug, viewId, res);
    if (!resolved) return;
    const { view } = resolved;
    const granted = clampCapabilities(view.capabilities, parseCapabilities(body.capabilities));
    const minted = mintViewToken(slug, granted);
    if (!minted) {
      serverError(res, "view token unavailable (server not ready)");
      return;
    }
    res.json({ token: minted.token, exp: minted.exp, dataUrl: API_ROUTES.collections.viewData.replace(":slug", slug), capabilities: granted });
  } catch (err) {
    log.warn("collections", "view-token mint failed", { slug: req.params.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// Scoped read: enriched records (getItems). Guarded by the view token only
// (exempt from global bearer + CSRF — see server/index.ts).
router.get(API_ROUTES.collections.viewData, viewDataCors, requireViewToken("read"), async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const ids = parseListParam(req.query.ids);
    const fields = parseListParam(req.query.fields);
    const raw = await manageCollection.handler({
      action: "getItems",
      slug: req.params.slug,
      ...(ids ? { ids } : {}),
      ...(fields ? { fields } : {}),
    });
    sendToolResult(res, raw);
  } catch (err) {
    log.warn("collections", "view-data read failed", { slug: req.params.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// Preflight for the token-scoped query endpoint (POST + JSON from a
// sandboxed opaque-origin iframe — same CORS story as view-data itself).
router.options(API_ROUTES.collections.viewDataQuery, viewDataCors, (_req: Request, res: Response) => {
  res.sendStatus(204);
});

/** Per-slug in-flight cap for view-issued aggregation queries. The
 *  per-minute limiter alone still lets a burst arrive CONCURRENTLY —
 *  each query is a full-file DuckDB scan, so a runaway dashboard loop
 *  could otherwise stack dozens of scans at once. Exported factory so
 *  the unit test can drive the counter without HTTP. */
export function makeViewQueryConcurrencyGuard(max: number) {
  const inflight = new Map<string, number>();
  return (req: Request<{ slug?: string }>, res: Response, next: NextFunction): void => {
    const slug = req.params.slug ?? "";
    const current = inflight.get(slug) ?? 0;
    if (current >= max) {
      res.status(429).json({ error: "too many concurrent queries for this collection — retry shortly" });
      return;
    }
    inflight.set(slug, current + 1);
    let released = false;
    // `close` fires after the response finishes OR the client disconnects
    // mid-request — either way the scan slot must come back exactly once.
    res.once("close", () => {
      if (released) return;
      released = true;
      const now = inflight.get(slug) ?? 1;
      if (now <= 1) inflight.delete(slug);
      else inflight.set(slug, now - 1);
    });
    next();
  };
}

const VIEW_QUERY_MAX_CONCURRENT = 4;
const viewQueryConcurrency = makeViewQueryConcurrencyGuard(VIEW_QUERY_MAX_CONCURRENT);

// Scoped aggregation: run a structured query (the DSL — never raw SQL)
// over a dataSource collection's whole data file. Read capability only:
// the DSL is read-only by construction. Reuses the manageCollection
// handler so a view can never do more than the agent's own queryItems
// (same validation, same file-backed refusal). Guarded twice: the
// per-minute limiter (request volume) + the in-flight cap (concurrent
// full-file scans).
router.post(
  API_ROUTES.collections.viewDataQuery,
  viewDataCors,
  viewActionRateLimit,
  viewQueryConcurrency,
  requireViewToken("read"),
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const body = (req.body ?? {}) as { query?: unknown };
      const raw = await manageCollection.handler({ action: "queryItems", slug: req.params.slug, query: body.query });
      sendToolResult(res, raw);
    } catch (err) {
      // Log the detail server-side; the token holder gets a FIXED message —
      // a raw DuckDB error can carry absolute paths / host internals, and a
      // scoped view is not a trusted audience for those.
      log.warn("collections", "view-data query failed", { slug: req.params.slug.replace(/[\r\n]/g, " "), error: errorMessage(err) });
      serverError(res, "collection query failed");
    }
  },
);

// Scoped write: validated putItems. Requires the `write` capability.
router.put(API_ROUTES.collections.viewData, viewDataCors, requireViewToken("write"), async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const body = (req.body ?? {}) as { items?: unknown; mode?: unknown };
    const raw = await manageCollection.handler({ action: "putItems", slug: req.params.slug, items: body.items, mode: body.mode });
    sendToolResult(res, raw);
  } catch (err) {
    log.warn("collections", "view-data write failed", { slug: req.params.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// Preflight for the token-scoped mutate-action endpoint (POST + JSON from a
// sandboxed opaque-origin iframe — same CORS story as view-data itself).
router.options(API_ROUTES.collections.viewDataAction, viewDataCors, (_req: Request, res: Response) => {
  res.sendStatus(204);
});

// Token-scoped mutate-action invocation: lets a `write`-capable custom view
// press a DECLARED mutate button instead of re-encoding the transition as a
// hand-rolled putItems (which would skip `require` and duplicate the `set`
// logic into the view's HTML). Mutate kind ONLY — a view token must never
// be able to start LLM work, so chat/agent actions stay behind the global
// bearer. The pipeline is the same one the UI button runs: `require`
// re-checked against the record, params validated, write gate, atomic write.
router.post(
  API_ROUTES.collections.viewDataAction,
  viewDataCors,
  viewActionRateLimit,
  requireViewToken("write"),
  async (req: Request<{ slug: string; actionId: string }>, res: Response<ActionRunResponse>) => {
    try {
      const collection = await loadCollectionOr404(req.params.slug, res);
      if (!collection) return;
      const action = collection.schema.actions?.find((entry) => entry.id === req.params.actionId);
      if (!action) {
        notFound(res, `action '${req.params.actionId}' not found on collection '${collection.slug}'`);
        return;
      }
      if (action.kind !== "mutate") {
        forbidden(res, `action '${action.id}' has kind "${action.kind}" — view tokens can only invoke "mutate" actions`);
        return;
      }
      const body = (req.body ?? {}) as { itemId?: unknown; params?: unknown };
      const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
      if (!itemId) {
        badRequest(res, "`itemId` is required (the record's primary-key value)");
        return;
      }
      const record = await storeFor(collection).read(itemId);
      if (!record) {
        notFound(res, `item '${itemId}' not found`);
        return;
      }
      // Same visibility-is-authorization re-check the bearer route runs.
      if (!actionVisible(action, record)) {
        conflict(res, `action '${action.id}' is not available for item '${itemId}' in its current state`);
        return;
      }
      await respondForMutateAction(res, collection, action, itemId, body);
    } catch (err) {
      // Route params are caller-controlled — strip CR/LF so a crafted
      // slug/actionId can't forge log lines (same pattern as viewI18n).
      log.warn("collections", "view mutate action failed", {
        slug: req.params.slug.replace(/[\r\n]/g, " "),
        actionId: req.params.actionId.replace(/[\r\n]/g, " "),
        error: errorMessage(err),
      });
      serverError(res, errorMessage(err));
    }
  },
);

// Map a non-ok view-delete result to the matching HTTP error. Kept beside the
// route so the handler stays short and the status mapping is unit-testable.
function sendDeleteViewRefusal(res: Response, result: Exclude<DeleteViewResult, { kind: "ok" }>): void {
  if (result.kind === "not-found") {
    notFound(res, `custom view '${result.viewId}' not found`);
    return;
  }
  if (result.kind === "unsafe-path") {
    badRequest(res, `custom view '${result.viewId}' has an unsafe file path`);
    return;
  }
  forbidden(
    res,
    result.kind === "user-scope"
      ? "user-scope collections (~/.claude/skills/) are read-only from MulmoClaude"
      : "preset (mc-*) collections re-seed on restart; their views can't be deleted here",
  );
}

// Delete one custom view: drop it from schema.json `views[]` (every on-disk
// copy) and unlink its HTML file. Behind the global bearer. Source-aware;
// refuses user-scope + preset collections, consistent with collection delete.
router.delete(API_ROUTES.collections.viewDelete, async (req: Request<{ slug: string; viewId: string }>, res: Response<DeleteViewResponse>) => {
  try {
    const collection = await loadCollectionOr404(req.params.slug, res);
    if (!collection) return;
    const result = await deleteCustomView(collection, req.params.viewId);
    if (result.kind !== "ok") {
      sendDeleteViewRefusal(res, result);
      return;
    }
    log.info("collections", "custom view deleted", { slug: collection.slug, viewId: result.viewId });
    res.json({ deleted: true, viewId: result.viewId });
  } catch (err) {
    log.warn("collections", "view delete failed", { slug: req.params.slug, viewId: req.params.viewId, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

export default router;
