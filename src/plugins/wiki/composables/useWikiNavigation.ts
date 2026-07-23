import { computed, type ComputedRef } from "vue";
import { useRoute, useRouter, isNavigationFailure } from "vue-router";
import { WIKI_ACTION, WIKI_ROUTE_SECTION, buildWikiRouteParams, isSafeWikiSlug, type WikiTarget } from "@mulmoclaude/core/wiki";

export type WikiTabView = typeof WIKI_ACTION.log | typeof WIKI_ACTION.lintReport | typeof WIKI_ACTION.graph;

interface WikiNavigationDeps {
  pageWikiRoute: string;
  // Slug carried by an embedded manageWiki tool-result (WikiView mounted inside
  // /chat). On the standalone /wiki route the URL param wins over this.
  pageNameFromResult: () => string | null;
}

export interface WikiNavigation {
  currentSlugReactive: ComputedRef<string | null>;
  currentSlug: () => string | null;
  isStandaloneWikiRoute: ComputedRef<boolean>;
  pushWiki: (target: WikiTarget) => void;
  navigate: (newAction: typeof WIKI_ACTION.index | WikiTabView) => void;
  navigatePage: (pageName: string) => void;
}

export function useWikiNavigation(deps: WikiNavigationDeps): WikiNavigation {
  const route = useRoute();
  const router = useRouter();

  // Prefer the URL on /wiki (source of truth for that route); fall back to the
  // tool-result payload when WikiView is mounted as a manageWiki result inside
  // /chat. `isSafeWikiSlug` guards traversal tokens — the router guard strips
  // them from standalone /wiki URLs, but the tool-result payload arrives from
  // the server/agent and can't assume that upstream filter.
  const currentSlugReactive = computed<string | null>(() => {
    const raw =
      route.name === deps.pageWikiRoute && route.params.section === WIKI_ROUTE_SECTION.pages && typeof route.params.slug === "string"
        ? route.params.slug
        : deps.pageNameFromResult();
    return isSafeWikiSlug(raw) ? raw : null;
  });

  // Imperative accessor for the same value, for call sites that read the slug
  // at a specific moment (fetch endpoint, mid-flight save guard).
  const currentSlug = (): string | null => currentSlugReactive.value;

  const isStandaloneWikiRoute = computed(() => route.name === deps.pageWikiRoute);

  function pushWiki(target: WikiTarget): void {
    router.push({ name: deps.pageWikiRoute, params: buildWikiRouteParams(target) }).catch((err: unknown) => {
      if (!isNavigationFailure(err)) console.error("[wiki] navigation failed:", err);
    });
  }

  function navigate(newAction: typeof WIKI_ACTION.index | WikiTabView): void {
    pushWiki(newAction === WIKI_ACTION.index ? { kind: "index" } : { kind: newAction });
  }

  function navigatePage(pageName: string): void {
    pushWiki({ kind: "page", slug: pageName });
  }

  return { currentSlugReactive, currentSlug, isStandaloneWikiRoute, pushWiki, navigate, navigatePage };
}
