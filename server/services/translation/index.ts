// Translation service factory. Reads the on-disk cache, routes
// only the missing sentences through an injected `translateBatch`,
// merges new translations back, and returns the assembled result
// in the caller's input order.
//
// The injection seam is deliberate: production wires
// `defaultTranslateBatch` from `./llm.ts` (which spawns the
// `claude` CLI), unit tests pass a deterministic fake.

import { loadDictionary, saveDictionary } from "../../utils/files/translation-io.js";
import { assembleResult, mergeTranslations, splitHitMiss } from "./cache.js";
import type { TranslateRequest, TranslateResponse, TranslationService, TranslationServiceDeps } from "./types.js";

const NAMESPACE_RE = /^[a-zA-Z0-9_-]+$/;
// Fixed-length alternation, no nested quantifiers — safe from ReDoS.
// eslint-disable-next-line security/detect-unsafe-regex -- single-pass match against a 2- or 5-char locale code, no backtracking.
const LANGUAGE_RE = /^[a-z]{2}(?:-[A-Z]{2})?$/;

// Bound the request shape so a single call cannot blow past the
// `claude -p <json>` argv limit (POSIX `E2BIG`, typically ~128 KiB)
// or balloon the per-call cost. UI-string callers stay well inside
// these — Role suggested queries are ~5 strings × ~50 chars.
const MAX_SENTENCES = 256;
const MAX_SENTENCE_CHARS = 1024;
const MAX_TOTAL_CHARS = 32 * 1024;

export class TranslationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationInputError";
  }
}

function validateRequest(req: TranslateRequest): void {
  if (typeof req.namespace !== "string" || !NAMESPACE_RE.test(req.namespace)) {
    throw new TranslationInputError(`invalid namespace: ${JSON.stringify(req.namespace)}`);
  }
  if (typeof req.targetLanguage !== "string" || !LANGUAGE_RE.test(req.targetLanguage)) {
    throw new TranslationInputError(`invalid targetLanguage: ${JSON.stringify(req.targetLanguage)}`);
  }
  if (!Array.isArray(req.sentences) || req.sentences.length === 0) {
    throw new TranslationInputError("sentences must be a non-empty array");
  }
  if (req.sentences.length > MAX_SENTENCES) {
    throw new TranslationInputError(`sentences exceeds ${MAX_SENTENCES} entries`);
  }
  let totalChars = 0;
  for (const sentence of req.sentences) {
    if (typeof sentence !== "string" || sentence.length === 0) {
      throw new TranslationInputError("sentences must contain non-empty strings");
    }
    if (sentence.length > MAX_SENTENCE_CHARS) {
      throw new TranslationInputError(`sentence exceeds ${MAX_SENTENCE_CHARS} characters`);
    }
    totalChars += sentence.length;
    if (totalChars > MAX_TOTAL_CHARS) {
      throw new TranslationInputError(`total sentence length exceeds ${MAX_TOTAL_CHARS} characters`);
    }
  }
}

export function createTranslationService(deps: TranslationServiceDeps): TranslationService {
  const { translateBatch, workspaceRoot } = deps;
  // Per-namespace serialization chain. Two concurrent translate() calls
  // on the same namespace would otherwise race the read-merge-write
  // step; chaining ensures the second sees the first's persisted output.
  const chains = new Map<string, Promise<unknown>>();

  async function runOnce(req: TranslateRequest): Promise<TranslateResponse> {
    const dict = loadDictionary(req.namespace, workspaceRoot);
    const { cached, misses } = splitHitMiss(dict, req.sentences, req.targetLanguage);
    if (misses.length === 0) {
      return { translations: assembleResult(req.sentences, cached, new Map()) };
    }
    const translated = await translateBatch({ targetLanguage: req.targetLanguage, sentences: misses });
    if (translated.length !== misses.length) {
      throw new Error(`[translation] translateBatch returned ${translated.length} translations for ${misses.length} sentences`);
    }
    const fresh = new Map<string, string>();
    misses.forEach((sentence, index) => fresh.set(sentence, translated[index]));
    const next = mergeTranslations(dict, req.targetLanguage, fresh);
    await saveDictionary(req.namespace, next, workspaceRoot);
    return { translations: assembleResult(req.sentences, cached, fresh) };
  }

  function serialize<T>(namespace: string, runner: () => Promise<T>): Promise<T> {
    const prev = chains.get(namespace) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(runner);
    const tracked = next.catch(() => undefined);
    chains.set(namespace, tracked);
    // Housekeeping only, and `tracked` already swallowed the rejection — the
    // caller waits on `next`, not on this.
    void tracked.then(() => {
      if (chains.get(namespace) === tracked) chains.delete(namespace);
    });
    return next;
  }

  async function translate(req: TranslateRequest): Promise<TranslateResponse> {
    validateRequest(req);
    if (req.targetLanguage === "en") {
      return { translations: [...req.sentences] };
    }
    return serialize(req.namespace, () => runOnce(req));
  }

  return { translate };
}
