// Test helper — reports the root elements every `<Teleport>` in a Vue
// SFC renders, and whether they carry `translate="no"`.
//
// `index.html` marks `#app` with `translate="no"` so browser page
// translation can't rewrite Material Icons ligature text (#2561). A
// teleport moves its content elsewhere in the DOM, where that attribute
// may not be inherited — so a new teleported menu / dialog silently
// reintroduces the bug.
//
// Every teleport is reported, not just `to="body"`. Whether a target is
// inside `#app` is not decidable from source (`:to="teleportTarget"` in
// collection-plugin's record modal resolves to `body` at runtime), and a
// redundant `translate="no"` on an in-app target costs nothing while a
// missed one costs the bug back.
//
// Parsing with Vue's own compiler keeps the *element association* under
// test; a source grep for "translate" would pass on an attribute sitting
// anywhere in the file.

import { parse } from "vue/compiler-sfc";

const NODE_TYPE_ELEMENT = 1;
const NODE_TYPE_ATTRIBUTE = 6;

type SfcTemplateAst = NonNullable<NonNullable<ReturnType<typeof parse>["descriptor"]["template"]>["ast"]>;
type TemplateChild = SfcTemplateAst["children"][number];
type ElementNode = Extract<TemplateChild, { type: typeof NODE_TYPE_ELEMENT }>;
type ElementProp = ElementNode["props"][number];
type AttributeNode = Extract<ElementProp, { type: typeof NODE_TYPE_ATTRIBUTE }>;

export interface TeleportRoot {
  tag: string;
  /** Static `to` value, or `"(dynamic)"` when bound — for the failure message. */
  target: string;
  hasTranslateNo: boolean;
}

const DYNAMIC_TARGET = "(dynamic)";

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

const isTeleport = (element: ElementNode): boolean => element.tag === "Teleport" || element.tag === "teleport";

/** First element on each branch that actually renders a DOM node. */
const rootsBelow = (node: TemplateChild, found: ElementNode[]): void => {
  if (!isElement(node)) return;
  if (!TRANSPARENT_WRAPPERS.has(node.tag)) {
    found.push(node);
    return;
  }
  node.children.forEach((child) => rootsBelow(child, found));
};

const collectTeleports = (node: TemplateChild, found: TeleportRoot[]): void => {
  if (!isElement(node)) return;
  if (isTeleport(node)) {
    const target = staticAttr(node, "to") ?? DYNAMIC_TARGET;
    const roots: ElementNode[] = [];
    node.children.forEach((child) => rootsBelow(child, roots));
    roots.forEach((root) => found.push({ tag: root.tag, target, hasTranslateNo: staticAttr(root, "translate") === "no" }));
  }
  node.children.forEach((child) => collectTeleports(child, found));
};

/** Every root element rendered by a `<Teleport>`, in template order. */
export function findTeleportRoots(sfcSource: string): TeleportRoot[] {
  const { descriptor, errors } = parse(sfcSource);
  if (errors.length > 0) {
    throw new Error(`SFC parse failed: ${errors.map((error) => error.message).join("; ")}`);
  }
  const ast = descriptor.template?.ast;
  if (ast === undefined) return [];
  const found: TeleportRoot[] = [];
  ast.children.forEach((child) => collectTeleports(child, found));
  return found;
}
