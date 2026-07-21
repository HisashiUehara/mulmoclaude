// @mulmobridge/webhook-runtime — shared HTTP-webhook plumbing for the
// messaging bridges that receive events over an inbound webhook (LINE,
// WhatsApp, Viber, LINE WORKS, Google Chat, Messenger).
//
// Each of those bridges used to inline the same Express setup, the same
// `BRIDGE_TRUST_PROXY` parsing, the same rate-limit config and the same
// timing-safe HMAC check. Those are security-relevant and were hardened
// through several Codex reviews (#1326); keeping six copies means a fix
// has to be applied six times. This package is the single source.

import crypto from "crypto";
import express, { type Express } from "express";
import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from "express-rate-limit";

// Honour an explicit `trust proxy` setting so `req.ip` (the rate-limit
// key) reflects the real client IP rather than the load balancer's.
// Default `false` for safety; operators behind a known LB choose from:
//   - hop count:  BRIDGE_TRUST_PROXY=1
//   - boolean:    BRIDGE_TRUST_PROXY=true / false
//   - preset:     BRIDGE_TRUST_PROXY=loopback
//   - CIDR list:  BRIDGE_TRUST_PROXY=10.0.0.0/8,192.168.0.0/16
// Without this every webhook looks like it comes from one IP and the
// limiter degrades into a global throttle. The boolean branch is
// required because Express does NOT auto-convert string "true"/"false"
// — without it, `BRIDGE_TRUST_PROXY=true` is read as a (never-matching)
// CIDR rule (Codex reviews on #1326).
function parseTrustProxyValue(env: string): boolean | number | string {
  const lower = env.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  const numeric = Number(env);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : env;
}

export function configureTrustProxy(app: Express, env: string | undefined = process.env.BRIDGE_TRUST_PROXY): void {
  if (!env) return;
  app.set("trust proxy", parseTrustProxyValue(env));
}

// The base Express app shared by every webhook bridge: hide the
// `x-powered-by` banner, honour `BRIDGE_TRUST_PROXY`, and parse the body
// as raw text so the HMAC signature can be verified before JSON parsing.
// `bodyLimit` overrides the body-size cap (default: Express's 100kb) for
// platforms that send larger payloads.
export function createWebhookApp(opts: { bodyLimit?: string } = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  configureTrustProxy(app);
  app.use(express.text({ type: "application/json", limit: opts.bodyLimit }));
  return app;
}

// Per-IP throttle for a webhook endpoint. CodeQL's
// `js/missing-rate-limiting` rule recognises `express-rate-limit`
// specifically; the default 120 req/min/IP cap sits well above any
// messaging platform's normal delivery rate and exists to bound a flood
// / stuck retry loop.
export function createWebhookRateLimit(limitPerMinute = 120): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: limitPerMinute,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // Route through `ipKeyGenerator(...)` so IPv6 clients get folded to
    // their /56 subnet — a raw `req.ip` key would let IPv6 rotation
    // within a prefix evade the per-client limit. `req.ip` is
    // trust-proxy-aware via `configureTrustProxy`. (Codex reviews on #1326.)
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? "", 56),
  });
}

// Timing-safe HMAC signature check. `algorithm` is the OpenSSL digest
// name (e.g. "SHA256"); `encoding` is how the platform encodes the
// signature it sends (LINE / LINE WORKS: base64; Meta: hex).
//
// The length guard compares BYTE lengths, not string lengths: a
// malformed non-ASCII signature can share `expected`'s JS string length
// while `Buffer.from()` yields more bytes, and `timingSafeEqual` throws
// on unequal-length buffers. Comparing the buffers keeps a bad signature
// a deterministic `false` (fail closed) instead of a thrown 500 — this
// is what the per-bridge `try/catch` wrappers used to guarantee.
export function verifyHmacSignature(
  body: string,
  signature: string,
  secret: string,
  algorithm = "SHA256",
  encoding: crypto.BinaryToTextEncoding = "base64",
): boolean {
  const expected = Buffer.from(crypto.createHmac(algorithm, secret).update(body).digest(encoding));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

// ── Meta (Messenger / WhatsApp) webhook verification ───────────
//
// Meta's GET handshake echoes back `hub.challenge`. Narrowing it to a
// known shape before it reaches `res.send()` is the CodeQL sanitiser that
// clears the `js/reflected-xss` alert (Codex review on #1328) and gives
// defence-in-depth. `[A-Za-z0-9_-]{1,256}` covers every observed base64url
// nonce (~32 chars); widen it HERE if Meta ever extends the format.
export const SAFE_CHALLENGE_RE = /^[A-Za-z0-9_-]{1,256}$/;

/** The challenge string when `raw` matches the shape we'll echo, else
 *  `null`. Non-string query forms (`?hub.challenge[]=…`) return `null`
 *  rather than coercing to "", so callers can't compare a coerced empty. */
export function narrowChallenge(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!SAFE_CHALLENGE_RE.test(raw)) return null;
  return raw;
}
