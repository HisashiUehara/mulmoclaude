// Voice-nav driver memory store (M3). Server-side key/value memory used to make
// nav-chat a "partner": remembered facts are injected into the system prompt so
// the LLM can honour preferences ("下道が好き"), places ("いつものところ") and
// names. Stored under the voice-nav skill dir as a single JSON file.
//
// Schema (data/skills/voice-nav/memory.json):
//   { "entries": [ { "key": "道種の好み", "value": "下道が好き",
//                    "kind": "preference"|"place"|"name"|"fact", "at": <ms> } ] }
//
// Bloat control (item 5): capped at MAX_ENTRIES; on overflow, `fact` entries are
// dropped oldest-first while preference/place/name are kept (priority + recency).

import path from "node:path";
import { workspacePath } from "../../workspace/paths.js";
import { loadJsonFile, writeJsonAtomic } from "./json.js";

export interface MemoryEntry {
  key: string;
  value: string;
  kind: MemoryKind;
  at: number;
}
export type MemoryKind = "preference" | "place" | "name" | "fact";

interface MemoryFile {
  entries: MemoryEntry[];
}

const KINDS = new Set<MemoryKind>(["preference", "place", "name", "fact"]);
const KEY_MAX = 60;
const VALUE_MAX = 200;
/** Injected/kept ceiling. Bounds prompt size, latency and cost (item 5). */
export const MAX_MEMORY_ENTRIES = 20;

function memoryPath(): string {
  return path.join(workspacePath, "data", "skills", "voice-nav", "memory.json");
}

export function readMemory(): MemoryEntry[] {
  const file = loadJsonFile<MemoryFile>(memoryPath(), { entries: [] });
  return Array.isArray(file.entries) ? file.entries.filter((entry) => entry && typeof entry.key === "string" && typeof entry.value === "string") : [];
}

/** Cap + prioritise: keep preference/place/name over fact, then most-recent. */
function trimEntries(entries: MemoryEntry[]): MemoryEntry[] {
  if (entries.length <= MAX_MEMORY_ENTRIES) return entries;
  const factPenalty = (entry: MemoryEntry) => (entry.kind === "fact" ? 1 : 0);
  return [...entries].sort((left, right) => factPenalty(left) - factPenalty(right) || right.at - left.at).slice(0, MAX_MEMORY_ENTRIES);
}

/** Add or UPDATE (same key overwrites) a memory entry, immediately (no confirm —
 *  item 6: additions/updates are hands-off-friendly). Returns the new list. */
export async function addMemory(raw: { key?: unknown; value?: unknown; kind?: unknown }, nowMs: number): Promise<MemoryEntry[]> {
  const key = typeof raw.key === "string" ? raw.key.trim().slice(0, KEY_MAX) : "";
  const value = typeof raw.value === "string" ? raw.value.trim().slice(0, VALUE_MAX) : "";
  if (!key || !value) return readMemory();
  const kind: MemoryKind = typeof raw.kind === "string" && KINDS.has(raw.kind as MemoryKind) ? (raw.kind as MemoryKind) : "fact";
  const entries = readMemory();
  const clean: MemoryEntry = { key, value, kind, at: nowMs };
  const existing = entries.findIndex((entry) => entry.key === key);
  if (existing >= 0) entries[existing] = clean;
  else entries.push(clean);
  const trimmed = trimEntries(entries);
  await writeJsonAtomic(memoryPath(), { entries: trimmed });
  return trimmed;
}

/** Remove entries matching `key` (exact or substring both ways). Deletion is the
 *  ONLY confirmed op (item 6) — callers gate this behind a voice confirmation. */
export async function removeMemory(key: string): Promise<{ removed: MemoryEntry[]; entries: MemoryEntry[] }> {
  const needle = (key || "").trim();
  if (!needle) return { removed: [], entries: readMemory() };
  const entries = readMemory();
  const removed = entries.filter((entry) => entry.key === needle || entry.key.includes(needle) || needle.includes(entry.key));
  const kept = entries.filter((entry) => !removed.includes(entry));
  if (removed.length) await writeJsonAtomic(memoryPath(), { entries: kept });
  return { removed, entries: kept };
}

/** Render memory as short prompt lines for injection (item 4). Capped. */
export function formatMemoryForPrompt(entries: MemoryEntry[]): string {
  if (!entries.length) return "";
  const lines = entries.slice(0, MAX_MEMORY_ENTRIES).map((entry) => `- ${entry.key}: ${entry.value}`);
  return ["【ドライバーの記憶（覚えていること。応答の前提にする）】", ...lines].join("\n");
}
