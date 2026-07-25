// Test helper — reports the root elements each `<Teleport to="body">`
// in a Vue SFC renders, and whether they carry `translate="no"`.
//
// `index.html` marks `#app` with `translate="no"` so browser page
// translation can't rewrite Material Icons ligature text (#2561). A
// body teleport renders OUTSIDE `#app`, so it does not inherit that
// attribute — a new body-level menu / dialog silently reintroduces the
// bug. Parsing with Vue's own compiler keeps the *element association*
// under test; a source grep for "translate" would pass on an attribute
// sitting anywhere in the file.

import { parse } from "vue/compiler-sfc";

const NODE_TYPE_ELEMENT = 1;
const NODE_TYPE_ATTRIBUTE = 6;

type SfcTemplateAst = NonNullable<NonNullable<ReturnType<typeof parse>["descriptor"]["template"]>["ast"]>;
type TemplateChild = SfcTemplateAst["children"][number];
type ElementNode = Extract<TemplateChild, { type: typeof NODE_TYPE_ELEMENT }>;
type ElementProp = ElementNode["props"][number];
type AttributeNode = Extract<ElementProp, { type: typeof NODE_TYPE_ATTRIBUTE }>;

export interface BodyTeleportRoot {
  tag: string;
  hasTranslateNo: boolean;
}

// Components that render their child through without a DOM element of
// their own — the attribute has to land on what's inside them.
const TRANSPARENT_WRAPPERS = new Set([
  "Transition",
  "transition",
  "TransitionGroup",
  "transition-group",
  "KeepAlive",
  "keep-alive",
  "template",
  "Teleport",
  "teleport",
]);

const isAttribute = (prop: ElementProp): prop is AttributeNode => prop.type === NODE_TYPE_ATTRIBUTE;

const staticAttr = (element: ElementNode, name: string): string | null => {
  const attr = element.props.filter(isAttribute).find((prop) => prop.name === name);
  return attr?.value?.content ?? null;
};

const isElement = (node: TemplateChild): node is ElementNode => node.type === NODE_TYPE_ELEMENT;

// `<Teleport to="body">`. A dynamic `:to` binding is not resolvable
// from source, so it reads as "not a body teleport" rather than being
// guessed at — record such a case by hand if one ever appears.
const isBodyTeleport = (element: ElementNode): boolean => (element.tag === "Teleport" || element.tag === "teleport") && staticAttr(element, "to") === "body";

/** First element on each branch that actually renders a DOM node. */
const rootsBelow = (node: TemplateChild, found: ElementNode[]): void => {
  if (!isElement(node)) return;
  if (!TRANSPARENT_WRAPPERS.has(node.tag)) {
    found.push(node);
    return;
  }
  node.children.forEach((child) => rootsBelow(child, found));
};

const collectTeleports = (node: TemplateChild, found: BodyTeleportRoot[]): void => {
  if (!isElement(node)) return;
  if (isBodyTeleport(node)) {
    const roots: ElementNode[] = [];
    node.children.forEach((child) => rootsBelow(child, roots));
    roots.forEach((root) => found.push({ tag: root.tag, hasTranslateNo: staticAttr(root, "translate") === "no" }));
  }
  node.children.forEach((child) => collectTeleports(child, found));
};

/** Every root element rendered by a `<Teleport to="body">`, in template order. */
export function findBodyTeleportRoots(sfcSource: string): BodyTeleportRoot[] {
  const { descriptor, errors } = parse(sfcSource);
  if (errors.length > 0) {
    throw new Error(`SFC parse failed: ${errors.map((error) => error.message).join("; ")}`);
  }
  const ast = descriptor.template?.ast;
  if (ast === undefined) return [];
  const found: BodyTeleportRoot[] = [];
  ast.children.forEach((child) => collectTeleports(child, found));
  return found;
}
