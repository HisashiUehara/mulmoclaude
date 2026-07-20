// Sectioned delivery of the collection-authoring reference
// (`collection-skills.md`). Served whole, the doc is a ~75KB tool result
// that overflows the agent's per-result limit — the failure mode that
// pushed an agent back to copying example schemas instead of reading the
// reference `schemaDocs` exists to serve. Rendering is keyed off the
// doc's own markdown headings, so the doc keeps growing without this
// module needing to know its outline:
//   - no topic → the core authoring guide (intro, anatomy, the DSL and
//     its field types, create/edit walkthroughs) + a table of contents
//   - topic    → the matching section(s), subsections included
//   - "all"    → the historical full dump, for callers that insist
import { defangForPrompt } from "../core/promptSafety";

/** A doc at/below this size is returned whole — sectioning something the
 *  agent can read in one gulp only costs round-trips. This is also what
 *  keeps short user-authored workspace copies (config/helps) verbatim. */
export const SCHEMA_DOCS_VERBATIM_LIMIT = 20_000;

/** Ceiling for an assembled topic reply, safely inside the agent's
 *  per-result limit (the full doc is what overflowed it). A matched
 *  section too large to fit degrades to its own prose plus a list of its
 *  subsections to fetch individually. */
export const SCHEMA_DOCS_RESULT_BUDGET = 32_000;

/** The sections every schema author needs, matched against headings so
 *  the doc can be reorganised without touching this list (an unmatched
 *  pattern is simply skipped): what a collection IS, the schema DSL and
 *  its field types, and the create/edit walkthroughs. Advanced sections
 *  (actions, bells, views, dataSource, storage) stay TOC-only. */
const CORE_SECTION_PATTERNS = ["anatomy", "skill.md", "the dsl", "field types", "end-to-end", "editing an existing"];

interface DocSection {
  level: number;
  heading: string;
  /** Line index of the heading itself. */
  start: number;
  /** Exclusive end of the section's own prose: the next heading of ANY level. */
  ownEnd: number;
  /** Exclusive end of the section's subtree: the next heading of level <= own. */
  deepEnd: number;
}

/** Backticks stripped + lowercased, so `topic: "dataSource"` matches the
 *  heading "External data (CSV) collections — `dataSource`". */
const normalize = (text: string): string => text.toLowerCase().replace(/`/g, "");

const sliceLines = (lines: string[], from: number, until: number): string => lines.slice(from, until).join("\n").trim();

/** All `#`–`###` headings, skipping fenced code blocks (a `# comment`
 *  inside an example must not become a section boundary). */
function headingLines(lines: string[]): { index: number; level: number; heading: string }[] {
  const found: { index: number; level: number; heading: string }[] = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (line.startsWith("```")) fenced = !fenced;
    const match = fenced ? null : /^(#{1,3}) (.+)$/.exec(line);
    if (match) found.push({ index, level: match[1].length, heading: match[2].trim() });
  });
  return found;
}

function parseSections(lines: string[]): DocSection[] {
  const heads = headingLines(lines);
  return heads.map((head, i) => {
    const closer = heads.slice(i + 1).find((other) => other.level <= head.level);
    return {
      level: head.level,
      heading: head.heading,
      start: head.index,
      ownEnd: heads[i + 1]?.index ?? lines.length,
      deepEnd: closer?.index ?? lines.length,
    };
  });
}

function tableOfContents(sections: DocSection[]): string {
  const rows = sections.map((section) => `${"  ".repeat(section.level - 1)}- ${section.heading}`);
  return `Sections (call schemaDocs with \`topic: "<heading>"\` for any of them; \`topic: "all"\` for the full document):\n${rows.join("\n")}`;
}

/** The no-topic reply: the doc's intro + the core authoring sections
 *  (own prose only — a core parent's advanced subsections stay TOC-only),
 *  closed by the full table of contents. */
function renderDefault(lines: string[], sections: DocSection[]): string {
  const isCore = (section: DocSection, i: number) => i === 0 || CORE_SECTION_PATTERNS.some((pattern) => normalize(section.heading).includes(pattern));
  const body = sections
    .filter(isCore)
    .map((section) => sliceLines(lines, section.start, section.ownEnd))
    .join("\n\n");
  return `${body}\n\n---\n\n${tableOfContents(sections)}`;
}

/** Case-insensitive substring match on headings, minus any match already
 *  contained in another match's subtree (its parent's deep body covers it). */
function matchSections(sections: DocSection[], topic: string): DocSection[] {
  const needle = normalize(topic).trim();
  const matched = sections.filter((section) => normalize(section.heading).includes(needle));
  return matched.filter((section) => !matched.some((other) => other !== section && other.start < section.start && section.deepEnd <= other.deepEnd));
}

/** One matched section: its whole subtree when that fits the budget,
 *  otherwise its own prose + a pointer list of subsections to fetch. */
function renderSection(lines: string[], sections: DocSection[], section: DocSection, budget: number): string {
  const deep = sliceLines(lines, section.start, section.deepEnd);
  if (deep.length <= budget) return deep;
  const children = sections.filter((child) => child.start > section.start && child.start < section.deepEnd && child.level === section.level + 1);
  const list = children.map((child) => `- ${child.heading}`).join("\n");
  return `${sliceLines(lines, section.start, section.ownEnd)}\n\nSubsections (too large to include together — fetch each with \`topic\`):\n${list}`;
}

function renderTopic(lines: string[], sections: DocSection[], topic: string): string {
  const matched = matchSections(sections, topic);
  if (matched.length === 0) {
    return `manageCollection: no schemaDocs section matches '${defangForPrompt(topic)}'.\n\n${tableOfContents(sections)}`;
  }
  const perMatch = Math.floor(SCHEMA_DOCS_RESULT_BUDGET / matched.length);
  return matched.map((section) => renderSection(lines, sections, section, perMatch)).join("\n\n");
}

/** Render the authoring reference for one schemaDocs call. Small docs and
 *  docs without headings pass through verbatim — there is nothing better
 *  to key a section off. */
export function renderSchemaDocs(doc: string, topic?: string): string {
  const requested = topic?.trim() ?? "";
  if (normalize(requested) === "all") return doc;
  if (doc.length <= SCHEMA_DOCS_VERBATIM_LIMIT) return doc;
  const lines = doc.split("\n");
  const sections = parseSections(lines);
  if (sections.length === 0) return doc;
  return requested ? renderTopic(lines, sections, requested) : renderDefault(lines, sections);
}
