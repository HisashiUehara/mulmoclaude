// Text-to-speech proxy (OpenAI `/v1/audio/speech`).
//
//   POST /api/tts   { text, voice?, model?, format? } → audio bytes
//
// The OpenAI key stays server-side (env.openaiApiKey); the browser never sees
// it. Guarded by a TTS-scoped view token (`aud:"tts"`, see viewToken.ts) rather
// than the global bearer, because the standalone voice-nav app tab carries no
// bearer. Two abuse ceilings bound the damage if a token ever leaks (it is
// loopback-only + 1 h TTL already): a hard input-length cap and a per-process
// rate limit. When the key is unset the endpoint returns 503 so the client
// falls back to the browser's Web Speech API — navigation itself never breaks.

import { Router, Request, Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { env } from "../../system/env.js";
import { requireTtsToken } from "../auth/viewToken.js";
import { badRequest, payloadTooLarge, sendError, serviceUnavailable } from "../../utils/httpError.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";
import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../../utils/time.js";

const router = Router();

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
// Hard input ceiling (req: cap the text length as an abuse bound). Navigation
// phrases and chat replies are short; anything longer is rejected, not billed.
const MAX_TEXT_LEN = 500;
const REQUEST_TIMEOUT_MS = 20 * ONE_SECOND_MS;

const ALLOWED_VOICES = new Set(["nova", "alloy", "echo", "fable", "onyx", "shimmer", "ash", "coral", "sage"]);
const ALLOWED_MODELS = new Set(["tts-1", "tts-1-hd", "gpt-4o-mini-tts"]);
const FORMAT_MIME: Record<string, string> = { mp3: "audio/mpeg", opus: "audio/ogg", aac: "audio/aac", wav: "audio/wav" };

// Fixed-window rate limit (per server process). The second abuse ceiling: even
// with a valid token, a caller can't drive unbounded OpenAI spend.
const RATE_WINDOW_MS = ONE_MINUTE_MS;
const RATE_MAX_PER_WINDOW = 40;
let windowStart = 0;
let windowCount = 0;

function isRateLimited(nowMs: number): boolean {
  if (nowMs - windowStart >= RATE_WINDOW_MS) {
    windowStart = nowMs;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount > RATE_MAX_PER_WINDOW;
}

interface TtsBody {
  text?: unknown;
  voice?: unknown;
  model?: unknown;
  format?: unknown;
  instructions?: unknown;
}

// Steerability hint (voice/accent/tone). Only `gpt-4o-mini-tts` honours it;
// tts-1 / tts-1-hd reject an `instructions` field, so it is forwarded ONLY for
// that model. Capped like `text` so it can't be an abuse/cost vector.
const MAX_INSTRUCTIONS_LEN = 400;

function pick(value: unknown, allowed: Set<string>, fallback: string): string {
  return typeof value === "string" && allowed.has(value) ? value : fallback;
}

interface SpeechParams {
  text: string;
  voice: string;
  model: string;
  format: string;
  instructions: string;
}

/** Call OpenAI /v1/audio/speech and return the audio bytes, or a mapped error.
 *  Split from the handler so the route stays under the line/complexity limits. */
async function requestSpeech(key: string, params: SpeechParams): Promise<{ audio: Buffer } | { error: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetch(OPENAI_TTS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // `instructions` is forwarded ONLY to the model that supports it (set by
      // the caller), so tts-1 / tts-1-hd never receive it and 400.
      body: JSON.stringify({
        model: params.model,
        voice: params.voice,
        input: params.text,
        response_format: params.format,
        ...(params.instructions ? { instructions: params.instructions } : {}),
      }),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      log.warn("tts", "openai request failed", { status: upstream.status });
      return { error: `OpenAI TTS failed (${upstream.status}): ${detail.slice(0, 200)}`, status: 502 };
    }
    return { audio: Buffer.from(await upstream.arrayBuffer()) };
  } catch (err) {
    if (controller.signal.aborted) return { error: "OpenAI TTS timed out", status: 503 };
    log.error("tts", "request failed", { error: errorMessage(err) });
    return { error: "tts request failed", status: 500 };
  } finally {
    clearTimeout(timer);
  }
}

router.post(API_ROUTES.tts.speech, requireTtsToken(), async (req: Request<object, unknown, TtsBody>, res: Response) => {
  const key = env.openaiApiKey;
  if (!key) {
    serviceUnavailable(res, "OpenAI TTS is not configured (set OPENAI_API_KEY).");
    return;
  }
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    badRequest(res, "`text` is required");
    return;
  }
  if (text.length > MAX_TEXT_LEN) {
    payloadTooLarge(res, `text exceeds the ${MAX_TEXT_LEN}-character limit`);
    return;
  }
  if (isRateLimited(Date.now())) {
    sendError(res, 429, "TTS rate limit exceeded; try again shortly");
    return;
  }
  const voice = pick(req.body.voice, ALLOWED_VOICES, "shimmer");
  const model = pick(req.body.model, ALLOWED_MODELS, "tts-1-hd");
  const format = pick(req.body.format, new Set(Object.keys(FORMAT_MIME)), "mp3");
  const rawInstructions = typeof req.body.instructions === "string" ? req.body.instructions.trim().slice(0, MAX_INSTRUCTIONS_LEN) : "";
  const instructions = model === "gpt-4o-mini-tts" ? rawInstructions : "";
  const result = await requestSpeech(key, { text, voice, model, format, instructions });
  if ("error" in result) {
    sendError(res, result.status, result.error);
    return;
  }
  res.setHeader("Content-Type", FORMAT_MIME[format]);
  res.setHeader("Cache-Control", "no-store");
  res.send(result.audio);
});

export default router;
