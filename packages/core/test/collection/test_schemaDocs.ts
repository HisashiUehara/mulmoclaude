// `renderSchemaDocs` sections the collection-authoring reference so a
// schemaDocs call never overflows the agent's per-tool-result limit (the
// full doc did — the agent gave up on the reference and copied example
// schemas instead). Exercised against a synthetic doc so the tests pin
// the RULES (heading parsing, core selection, topic matching, budgets)
// without coupling to the real doc's evolving outline.
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderSchemaDocs, SCHEMA_DOCS_VERBATIM_LIMIT, SCHEMA_DOCS_RESULT_BUDGET } from "../../src/collection/server/schemaDocs.ts";

const FILL = "lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod.\n";
const pad = (lines: number) => FILL.repeat(lines);

// Headings chosen to hit the core patterns (anatomy / the dsl / field
// types / end-to-end) and to leave clearly-advanced sections out of them.
const DOC = `# Guide
Welcome intro. INTRO_MARK
${pad(30)}
## Anatomy of a widget
ANATOMY_MARK
${pad(30)}
## The DSL
DSL_MARK
${pad(40)}
### Field types
FIELDTYPES_MARK
${pad(40)}
### Special powers
POWERS_MARK
${pad(40)}
## Views
VIEWS_MARK
${pad(20)}
### Kanban view
KANBAN_MARK
${pad(20)}
### Calendar view
CALENDAR_MARK
${pad(20)}
## External data — \`dataSource\`
DATASOURCE_MARK
\`\`\`bash
# not a heading
\`\`\`
${pad(30)}
## Giant section
GIANT_MARK
### Giant child one
${pad(250)}
### Giant child two
${pad(250)}
## End-to-end: creating a widget
ENDTOEND_MARK
${pad(10)}
`;

test("a small doc passes through verbatim, topic or not", () => {
  const small = "# Tiny\nbody\n## Part\nmore";
  assert.ok(small.length <= SCHEMA_DOCS_VERBATIM_LIMIT);
  assert.equal(renderSchemaDocs(small), small);
  assert.equal(renderSchemaDocs(small, "part"), small);
});

test("a large doc without headings passes through — nothing to section on", () => {
  const headless = pad(400);
  assert.ok(headless.length > SCHEMA_DOCS_VERBATIM_LIMIT);
  assert.equal(renderSchemaDocs(headless), headless);
});

test('topic "all" returns the full doc', () => {
  assert.equal(renderSchemaDocs(DOC, "all"), DOC);
  assert.equal(renderSchemaDocs(DOC, " ALL "), DOC);
});

test("default reply = intro + core sections + table of contents, advanced bodies omitted", () => {
  const reply = renderSchemaDocs(DOC);
  for (const mark of ["INTRO_MARK", "ANATOMY_MARK", "DSL_MARK", "FIELDTYPES_MARK", "ENDTOEND_MARK"]) {
    assert.match(reply, new RegExp(mark), `core content ${mark} present`);
  }
  for (const mark of ["POWERS_MARK", "KANBAN_MARK", "DATASOURCE_MARK", "GIANT_MARK"]) {
    assert.doesNotMatch(reply, new RegExp(mark), `advanced content ${mark} stays TOC-only`);
  }
  assert.match(reply, /Sections \(call schemaDocs/, "table of contents present");
  assert.match(reply, /- Special powers/, "advanced sections listed in the TOC");
  assert.ok(reply.length < DOC.length, "default reply is smaller than the full doc");
});

test("headings inside fenced code blocks are not sections", () => {
  assert.doesNotMatch(renderSchemaDocs(DOC), /- not a heading/);
});

test("a topic fetches the matching section's whole subtree", () => {
  const reply = renderSchemaDocs(DOC, "views");
  assert.match(reply, /VIEWS_MARK/);
  assert.match(reply, /KANBAN_MARK/, "subsections included");
  assert.match(reply, /CALENDAR_MARK/);
  assert.doesNotMatch(reply, /DSL_MARK/, "unrelated sections excluded");
});

test("a topic matching both parent and children returns the parent subtree once", () => {
  const reply = renderSchemaDocs(DOC, "view");
  assert.equal(reply.match(/KANBAN_MARK/g)?.length, 1);
  assert.equal(reply.match(/CALENDAR_MARK/g)?.length, 1);
});

test("topic matching ignores case and backticks", () => {
  assert.match(renderSchemaDocs(DOC, "datasource"), /DATASOURCE_MARK/);
  assert.match(renderSchemaDocs(DOC, "KANBAN"), /KANBAN_MARK/);
});

test("an over-budget subtree degrades to its own prose + a subsection list", () => {
  const reply = renderSchemaDocs(DOC, "giant");
  assert.ok(reply.length <= SCHEMA_DOCS_RESULT_BUDGET + 1_000, "reply stays near the budget");
  assert.match(reply, /GIANT_MARK/, "the section's own prose is served");
  assert.match(reply, /- Giant child one/, "children offered as follow-up topics");
  assert.match(reply, /- Giant child two/);
});

test("an unmatched topic reports it and repeats the table of contents", () => {
  const reply = renderSchemaDocs(DOC, "zebra");
  assert.match(reply, /no schemaDocs section matches 'zebra'/);
  assert.match(reply, /Sections \(call schemaDocs/);
});
