// Unit tests for the pure ontology graph builder
// (packages/core/src/collection/core/ontologyGraph.ts) — the one
// implementation the /collections Map panel builds its graph with from
// the raw buildWorkspaceOntology entries, so its collapse/ghost/order
// semantics are pinned here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildOntologyGraph, type CollectionOntologyEntry, type OntologyRelation } from "@mulmoclaude/core/collection";

const entry = (slug: string, relations: OntologyRelation[] = [], recordCount = 0): CollectionOntologyEntry => ({
  slug,
  title: slug.toUpperCase(),
  icon: "📦",
  primaryKey: "id",
  displayField: "id",
  recordCount,
  relations,
});

describe("buildOntologyGraph — nodes", () => {
  it("emits one node per entry, preserving entry order and metadata", () => {
    const graph = buildOntologyGraph([entry("clients", [], 3), entry("invoices", [], 7)]);
    assert.deepEqual(
      graph.nodes.map((node) => [node.slug, node.title, node.recordCount, node.missing]),
      [
        ["clients", "CLIENTS", 3, undefined],
        ["invoices", "INVOICES", 7, undefined],
      ],
    );
  });

  it("appends slug-sorted ghost nodes for relation targets no entry backs", () => {
    const graph = buildOntologyGraph([
      entry("invoices", [
        { field: "clientId", kind: "ref", to: "zeta" },
        { field: "projectId", kind: "ref", to: "alpha" },
      ]),
    ]);
    assert.deepEqual(
      graph.nodes.map((node) => [node.slug, node.missing]),
      [
        ["invoices", undefined],
        ["alpha", true],
        ["zeta", true],
      ],
    );
    const ghost = graph.nodes.find((node) => node.slug === "alpha");
    assert.equal(ghost?.title, "alpha");
    assert.equal(ghost?.recordCount, 0);
  });
});

describe("buildOntologyGraph — edges", () => {
  it("emits forward edges for ref and embed, including dotted table sub-refs", () => {
    const graph = buildOntologyGraph([
      entry("invoices", [
        { field: "clientId", kind: "ref", to: "clients" },
        { field: "lines.itemId", kind: "ref", to: "items" },
        { field: "clientCard", kind: "embed", to: "clients" },
      ]),
      entry("clients"),
      entry("items"),
    ]);
    assert.deepEqual(graph.edges, [
      { from: "invoices", to: "clients", field: "clientId", kind: "ref" },
      { from: "invoices", to: "items", field: "lines.itemId", kind: "ref" },
      { from: "invoices", to: "clients", field: "clientCard", kind: "embed" },
    ]);
  });

  it("collapses backlinks/rollup onto the matching forward ref edge", () => {
    const graph = buildOntologyGraph([
      entry("clients", [
        { field: "invoiceLinks", kind: "backlinks", to: "invoices" },
        { field: "totalBilled", kind: "rollup", to: "invoices" },
      ]),
      entry("invoices", [{ field: "clientId", kind: "ref", to: "clients" }]),
    ]);
    assert.deepEqual(graph.edges, [{ from: "invoices", to: "clients", field: "clientId", kind: "ref", reverseFields: ["invoiceLinks", "totalBilled"] }]);
  });

  it("collapses independently of entry order (reverse declared before the ref owner)", () => {
    const forwardFirst = buildOntologyGraph([
      entry("invoices", [{ field: "clientId", kind: "ref", to: "clients" }]),
      entry("clients", [{ field: "invoiceLinks", kind: "backlinks", to: "invoices" }]),
    ]);
    assert.equal(forwardFirst.edges.length, 1);
    assert.deepEqual(forwardFirst.edges[0].reverseFields, ["invoiceLinks"]);
  });

  it("keeps an uncollapsed backlinks as its own edge in true data direction", () => {
    const graph = buildOntologyGraph([entry("clients", [{ field: "mentions", kind: "backlinks", to: "notes" }])]);
    assert.deepEqual(graph.edges, [{ from: "notes", to: "clients", field: "mentions", kind: "backlinks" }]);
    assert.equal(graph.nodes.find((node) => node.slug === "notes")?.missing, true);
  });

  it("does not collapse a reverse relation onto an embed edge", () => {
    const graph = buildOntologyGraph([
      entry("clients", [{ field: "invoiceLinks", kind: "backlinks", to: "invoices" }]),
      entry("invoices", [{ field: "clientCard", kind: "embed", to: "clients" }]),
    ]);
    assert.deepEqual(graph.edges.map((edge) => edge.kind).sort(), ["backlinks", "embed"]);
  });
});
