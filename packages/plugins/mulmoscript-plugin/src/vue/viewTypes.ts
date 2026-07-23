// Loose UI-facing script shapes shared between the View orchestrator and its
// composables. `MulmoScript` is intentionally a structural superset (every
// field optional + index signature) so the empty-beat fallbacks and the
// deck-web boundary re-typing stay cast-light. Kept out of View.vue so the
// extracted composables can import the same shapes without importing the SFC.

import type { SlideLayout, SlideTheme } from "@mulmocast/deck-web";
import type { Beat } from "./helpers";

export interface ImageEntry {
  type: string;
  prompt?: string;
  [key: string]: unknown;
}

export interface MulmoScript {
  title?: string;
  description?: string;
  lang?: string;
  beats?: Beat[];
  imageParams?: {
    images?: Record<string, ImageEntry>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// `@mulmocast/deck-web` types its `script` prop as a *structural* superset of
// MulmoScript (every key optional + index signature) using `SlideLayout` /
// `SlideTheme` from `@mulmocast/deck`. Our strict `MulmoScript` doesn't unify
// with that shape by name, so the deck editor boundary re-types through these.
export interface DeckBeatShape {
  image?: {
    type?: string;
    slide?: SlideLayout;
    theme?: SlideTheme;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface DeckScriptShape {
  beats?: DeckBeatShape[];
  presentationStyle?: { slideParams?: { theme?: SlideTheme } };
  slideParams?: { theme?: SlideTheme };
  [k: string]: unknown;
}
