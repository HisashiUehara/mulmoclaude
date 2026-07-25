// The bug-report FAQ is an index of WHERE to check, never of what a value is —
// values go stale silently, a config key or a path cannot (rename one and the
// implementation stops working, so it gets fixed). That only holds if the
// pointers are real, so they are parsed out here and checked by a test: a key
// that no longer exists fails CI instead of misleading a user months later.

export interface FaqEntry {
  symptom: string;
  configKeys: string[];
  sources: string[];
  helps: string[];
}

export type FieldList = "configKeys" | "sources" | "helps";

// A Map, not an object literal: the field name comes from arbitrary prose in a
// markdown file, and `FIELDS["constructor"]` on a literal would answer through
// the prototype chain instead of missing.
const FIELDS = new Map<string, FieldList>([
  ["configKey", "configKeys"],
  ["source", "sources"],
  ["help", "helps"],
]);

const HEADING = "## ";
const FENCE = "```";

const newEntry = (symptom: string): FaqEntry => ({ symptom, configKeys: [], sources: [], helps: [] });

export interface PointerLine {
  list: FieldList;
  value: string;
}

/** Read one `field: value` pointer line, or `null` for anything else — prose,
 *  a blank line, or a sentence that merely contains a colon. Split out so the
 *  line grammar can be tested on its own rather than through whole documents. */
export function parsePointerLine(line: string): PointerLine | null {
  const colon = line.indexOf(":");
  if (colon <= 0) return null;
  const list = FIELDS.get(line.slice(0, colon).trim());
  const value = line.slice(colon + 1).trim();
  return list && value ? { list, value } : null;
}

/** `## symptom` opens an entry; `field: value` lines under it are its pointers.
 *  Everything else is prose for the model to read. A field line before the
 *  first heading belongs to no entry and is dropped — the format block at the
 *  top of the file is documentation, not an entry. Fenced blocks are skipped
 *  for the same reason: the example in that block would parse as real. */
export function parseFaqEntries(markdown: string): FaqEntry[] {
  const entries: FaqEntry[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith(FENCE)) {
      inFence = !inFence;
    } else if (inFence) {
      continue;
    } else if (line.startsWith(HEADING)) {
      entries.push(newEntry(line.slice(HEADING.length).trim()));
    } else {
      const pointer = parsePointerLine(line);
      const current = entries[entries.length - 1];
      if (pointer && current) current[pointer.list].push(pointer.value);
    }
  }
  return entries;
}

/** An entry with no pointer at all is prose the skill cannot verify against the
 *  running system, which is exactly what this format exists to prevent. */
export const entryHasPointer = (entry: FaqEntry): boolean => entry.configKeys.length + entry.sources.length + entry.helps.length > 0;
