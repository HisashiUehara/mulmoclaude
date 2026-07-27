// Capability tokens for custom collection views (see
// plans/done/feat-collections-custom-views.md).
//
// A custom view is LLM-authored HTML rendered in a sandboxed
// (`allow-scripts`, opaque-origin) iframe. It must NOT receive the global
// bearer token — that would grant it the whole `/api/*` surface. Instead the
// authenticated parent mints a **scoped, short-lived, signed** token that
// authorizes only the collection's `view-data` endpoint, for one slug, with
// an explicit capability set (`read` and/or `write`). The view sends it as
// `Authorization: Bearer <token>`; `requireViewToken` verifies it.
//
// Stateless + signed: the token is `base64url(payload).HMAC`, keyed by the
// per-startup bearer token (`getCurrentToken`). No server-side store, and a
// restart invalidates every outstanding view token (the key changes) — the
// same lifecycle as the global token. Forging requires the key, which an
// attacker on a loopback-bound server cannot read.
//
// This is the ONLY guard on the view-data routes: they are exempted from the
// global bearer + CSRF middleware (the iframe carries no global token and
// sends `Origin: null`), so the unguessable scoped token is what stands in
// for both. See the exemptions in `server/index.ts`.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { getCurrentToken } from "./token.js";
import { unauthorized } from "../../utils/httpError.js";
import { ONE_HOUR_MS } from "../../utils/time.js";

export type ViewCapability = "read" | "write";

function isCapability(value: unknown): value is ViewCapability {
  return value === "read" || value === "write";
}

/** How long a minted view token stays valid. The parent re-mints on each
 *  render, so a view that outlives this reloads with a fresh token. */
export const VIEW_TOKEN_TTL_MS = ONE_HOUR_MS;

const BEARER_PREFIX = "Bearer ";

/** Token audience. Absent (undefined) ⇒ a "data" token for the view-data
 *  endpoints (the default, back-compatible shape). `"tts"` ⇒ a narrowly-scoped
 *  token that authorizes ONLY the /api/tts proxy; `"nav-chat"` ⇒ authorizes
 *  ONLY the /api/nav-chat proxy. Neither can read/write a collection's data
 *  (see `requireViewToken`, which rejects any non-undefined audience). */
export type ViewTokenAudience = "tts" | "nav-chat";

const RECOGNISED_AUDIENCES: readonly ViewTokenAudience[] = ["tts", "nav-chat"];

function normalizeAudience(value: unknown): ViewTokenAudience | undefined {
  return RECOGNISED_AUDIENCES.includes(value as ViewTokenAudience) ? (value as ViewTokenAudience) : undefined;
}

interface ViewTokenPayload {
  /** The one collection slug this token authorizes. */
  slug: string;
  /** What the token may do against the data endpoint. */
  caps: ViewCapability[];
  /** Absolute expiry, ms since epoch. */
  exp: number;
  /** Optional audience restriction. Absent = data token; "tts"/"nav-chat" = proxy-only. */
  aud?: ViewTokenAudience;
}

function signPayload(payloadB64: string, key: string): string {
  return createHmac("sha256", key).update(payloadB64).digest("base64url");
}

/** Clamp a view's *requested* capabilities to what the view *declared* in
 *  its schema registration — a view registered `["read"]` can never be
 *  minted a `write` token, even if the frontend asks. Undefined declared ⇒
 *  the least-privilege default `["read"]`; undefined requested ⇒ grant the
 *  full declared set. The result is `declared ∩ requested`. */
export function clampCapabilities(declared: ViewCapability[] | undefined, requested: ViewCapability[] | undefined): ViewCapability[] {
  const declaredCaps = declared && declared.length > 0 ? declared : (["read"] as ViewCapability[]);
  const requestedCaps = requested && requested.length > 0 ? requested : declaredCaps;
  return declaredCaps.filter((cap) => requestedCaps.includes(cap));
}

/** Mint a signed token for `slug` granting `caps`, valid for
 *  {@link VIEW_TOKEN_TTL_MS}. Returns null when the server has no bearer
 *  key yet (pre-bootstrap) — callers surface that as "token unavailable". */
export function mintViewToken(slug: string, caps: ViewCapability[], nowMs: number = Date.now()): { token: string; exp: number } | null {
  const key = getCurrentToken();
  if (key === null) return null;
  const exp = nowMs + VIEW_TOKEN_TTL_MS;
  const payload: ViewTokenPayload = { slug, caps, exp };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { token: `${payloadB64}.${signPayload(payloadB64, key)}`, exp };
}

/** Mint a signed token scoped to a single non-data `audience` (never a data
 *  endpoint), valid for {@link VIEW_TOKEN_TTL_MS}. Shared by the TTS and
 *  nav-chat mints below — a leaked token can do nothing but hit that one proxy
 *  (each already length- + rate-capped). */
function mintAudienceToken(slug: string, aud: ViewTokenAudience, nowMs: number): { token: string; exp: number } | null {
  const key = getCurrentToken();
  if (key === null) return null;
  const exp = nowMs + VIEW_TOKEN_TTL_MS;
  const payload: ViewTokenPayload = { slug, caps: ["read"], exp, aud };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { token: `${payloadB64}.${signPayload(payloadB64, key)}`, exp };
}

/** Mint a TTS-scoped token (`aud:"tts"`). Authorizes ONLY the /api/tts proxy.
 *  Least privilege for the standalone voice-nav tab (received via URL fragment). */
export function mintTtsToken(slug: string, nowMs: number = Date.now()): { token: string; exp: number } | null {
  return mintAudienceToken(slug, "tts", nowMs);
}

/** Mint a nav-chat-scoped token (`aud:"nav-chat"`). Authorizes ONLY the
 *  /api/nav-chat proxy — never a collection's data. Handed to the standalone
 *  voice-nav tab the same way the TTS token is. */
export function mintNavChatToken(slug: string, nowMs: number = Date.now()): { token: string; exp: number } | null {
  return mintAudienceToken(slug, "nav-chat", nowMs);
}

/** Verify a token's signature + expiry and return its payload, or null for
 *  any failure (bad shape, tampered payload, wrong signature, expired, or
 *  no server key). Never throws. */
export function verifyViewToken(token: string, nowMs: number = Date.now()): ViewTokenPayload | null {
  const key = getCurrentToken();
  if (key === null) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot >= token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const expectedSig = signPayload(payloadB64, key);
  // Compare BYTE lengths (not string lengths) before timingSafeEqual — it
  // throws a RangeError on a buffer-length mismatch, and a malformed signature
  // with the same character count but multi-byte chars would otherwise crash
  // the request (500) instead of failing closed. The lengths are non-secret
  // (fixed-size HMAC), so the early-out leaks nothing useful.
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(providedBuf, expectedBuf)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.slug !== "string" || typeof candidate.exp !== "number") return null;
  if (!Array.isArray(candidate.caps) || !candidate.caps.every(isCapability)) return null;
  if (nowMs >= candidate.exp) return null;
  // `aud` is optional; only recognised audiences ("tts", "nav-chat") are honoured.
  // Anything else (including absent) is treated as a plain data token.
  const aud = normalizeAudience(candidate.aud);
  return { slug: candidate.slug, caps: candidate.caps as ViewCapability[], exp: candidate.exp, aud };
}

/** Express middleware factory guarding a `view-data` route: require a valid
 *  scoped token whose `slug` matches the route param and whose capability
 *  set includes `action`. 401 (generic message, like `bearerAuth`) on any
 *  failure. */
export function requireViewToken(action: ViewCapability) {
  return function requireViewTokenMiddleware(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) {
      unauthorized(res, "unauthorized");
      return;
    }
    const payload = verifyViewToken(header.slice(BEARER_PREFIX.length));
    // A non-data-audience token (tts / nav-chat) must NEVER reach a data
    // endpoint — it is scoped to its one proxy. Reject any non-undefined aud so
    // it can't read/write collection records.
    if (!payload || payload.aud !== undefined || payload.slug !== req.params.slug || !payload.caps.includes(action)) {
      unauthorized(res, "unauthorized");
      return;
    }
    next();
  };
}

/** Express middleware factory guarding a single-audience proxy route: require a
 *  valid token whose audience is exactly `aud`. 401 (generic message) on any
 *  failure. The token carries no data capability — it authorizes that one proxy
 *  and nothing else. */
function requireAudienceToken(aud: ViewTokenAudience) {
  return function requireAudienceTokenMiddleware(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) {
      unauthorized(res, "unauthorized");
      return;
    }
    const payload = verifyViewToken(header.slice(BEARER_PREFIX.length));
    if (!payload || payload.aud !== aud) {
      unauthorized(res, "unauthorized");
      return;
    }
    next();
  };
}

/** Guard the /api/tts proxy: require a valid `aud:"tts"` token. */
export function requireTtsToken() {
  return requireAudienceToken("tts");
}

/** Guard the /api/nav-chat proxy: require a valid `aud:"nav-chat"` token. */
export function requireNavChatToken() {
  return requireAudienceToken("nav-chat");
}

// Matches a view-data request path with or without the `/api` mount prefix:
// the global CSRF middleware sees `/api/collections/<slug>/view-data` while
// the `/api`-mounted bearer closure sees `/collections/<slug>/view-data`.
// Anchored both ends; `[^/]+` is the slug segment. Two separate regexes
// (base path / the token-scoped mutate-action endpoint) rather than one
// with an optional tail — the combined form trips the unsafe-regex lint.
const VIEW_DATA_PATH_RE = /^\/(?:api\/)?collections\/[^/]+\/view-data$/;
const VIEW_DATA_ACTION_PATH_RE = /^\/(?:api\/)?collections\/[^/]+\/view-data\/actions\/[^/]+$/;
const VIEW_DATA_QUERY_PATH_RE = /^\/(?:api\/)?collections\/[^/]+\/view-data\/query$/;
const VIEW_DATA_IMAGE_PATH_RE = /^\/(?:api\/)?collections\/[^/]+\/view-data\/image$/;

/** True for the view-data endpoint paths (either mount base): the record
 *  read/write base path, the token-scoped mutate-action endpoint, and the
 *  aggregation-query endpoint. Used in `server/index.ts` to exempt these
 *  routes from the global bearer + CSRF guards — they are guarded instead
 *  by {@link requireViewToken}. A path missing here makes its endpoint
 *  UNREACHABLE from a sandboxed view (the global guards reject first) —
 *  add every new `/view-data/...` route to this matcher AND to the
 *  coverage in `test/server/test_viewToken.ts`. */
export function isViewDataPath(pathname: string): boolean {
  return (
    VIEW_DATA_PATH_RE.test(pathname) ||
    VIEW_DATA_ACTION_PATH_RE.test(pathname) ||
    VIEW_DATA_QUERY_PATH_RE.test(pathname) ||
    VIEW_DATA_IMAGE_PATH_RE.test(pathname)
  );
}

// The TTS proxy + the launcher's TTS-token mint endpoint. Both carry a scoped
// token (not the global bearer) and, for the mint call, arrive from a sandboxed
// (opaque-origin, `Origin: null`) iframe — so both are exempted from the global
// bearer + CSRF guards and protected instead by `requireTtsToken` /
// `requireViewToken`. Matches with or without the `/api` mount prefix.
const TTS_SPEECH_PATH_RE = /^\/(?:api\/)?tts$/;
const TTS_TOKEN_MINT_PATH_RE = /^\/(?:api\/)?collections\/[^/]+\/tts-token$/;

/** True for the /api/tts proxy or the /api/collections/:slug/tts-token mint
 *  path (either mount base). Used in `server/index.ts` to exempt them from the
 *  global bearer + CSRF guards. */
export function isTtsAuthPath(pathname: string): boolean {
  return TTS_SPEECH_PATH_RE.test(pathname) || TTS_TOKEN_MINT_PATH_RE.test(pathname);
}

// The nav-chat LLM proxy + its token mint endpoint. Same shape/rationale as
// the TTS pair above: both carry a scoped token (not the global bearer) and the
// mint call arrives from an opaque-origin (`Origin: null`) context, so both are
// exempted from the global bearer + CSRF guards and protected instead by
// `requireNavChatToken` / `requireViewToken`.
const NAV_CHAT_PATH_RE = /^\/(?:api\/)?nav-chat$/;
const NAV_CHAT_TOKEN_MINT_PATH_RE = /^\/(?:api\/)?collections\/[^/]+\/nav-chat-token$/;

/** True for the /api/nav-chat proxy or the /api/collections/:slug/nav-chat-token
 *  mint path (either mount base). Used in `server/index.ts` to exempt them from
 *  the global bearer + CSRF guards. */
export function isNavChatAuthPath(pathname: string): boolean {
  return NAV_CHAT_PATH_RE.test(pathname) || NAV_CHAT_TOKEN_MINT_PATH_RE.test(pathname);
}

// The self-provision endpoint: the standalone voice-nav tab mints its own
// tts + nav-chat tokens here instead of receiving them via the launcher's URL
// fragment. Exempt from the global BEARER guard ONLY (the tab has no bearer) —
// deliberately NOT exempt from the same-origin guard, so `requireSameOrigin`
// still runs and only a loopback-origin page can mint. Matches with/without the
// `/api` mount prefix.
const NAV_VIEW_TOKENS_PATH_RE = /^\/(?:api\/)?nav-view-tokens$/;

/** True for the /api/nav-view-tokens self-provision path (either mount base).
 *  Used in `server/index.ts` to exempt it from the global BEARER guard only. */
export function isNavViewTokensPath(pathname: string): boolean {
  return NAV_VIEW_TOKENS_PATH_RE.test(pathname);
}
