// Conversational LLM proxy for the voice-nav app (OpenAI chat completions).
//
//   POST /api/nav-chat   { message, context? } → { reply } | { action, ... }
//
// The second routing layer of MulmoNavi: utterances the deterministic
// pattern-matcher (parseIntent) can't classify — greetings, small talk,
// fuzzy destination phrasings — are sent here for a short, driver-facing
// reply. The OpenAI key stays server-side (env.openaiApiKey); the browser
// never sees it. Guarded by a nav-chat-scoped view token (`aud:"nav-chat"`,
// see viewToken.ts), NOT the global bearer, because the standalone voice-nav
// tab carries no bearer. Abuse bounds mirror the TTS proxy: a hard input-length
// cap + a per-process rate limit. When the key is unset the endpoint returns
// 503 so the client falls back to its built-in canned phrases — chat degrades,
// navigation itself never breaks.

import { Router, Request, Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { env } from "../../system/env.js";
import { requireNavChatToken, mintTtsToken, mintNavChatToken } from "../auth/viewToken.js";
import { badRequest, payloadTooLarge, sendError, serverError, serviceUnavailable } from "../../utils/httpError.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";
import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../../utils/time.js";

const router = Router();

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";
// Short driver-facing turns only. Longer input is an abuse signal → rejected.
const MAX_MESSAGE_LEN = 300;
const MAX_CONTEXT_LEN = 2000;
// 雑談を2〜3文まで許容するため 120。ナビ案内/確認/actionは相変わらず短く出るので、
// 増えるのは雑談返答の生成のみ（雑談時の遅延増はユーザー承認済み）。
const MAX_TOKENS = 120;
const REQUEST_TIMEOUT_MS = 15 * ONE_SECOND_MS;

// System prompt is fixed server-side (never client-supplied) so the persona and
// the action-JSON contract can't be prompt-injected away by the caller.
const SYSTEM_PROMPT = [
  "あなたはカーナビ「MulmoNavi」の音声アシスタント。運転中のドライバーと話す相棒。",
  "",
  "厳守:",
  "- 返答は必ず context.lang の言語で書く（ja=日本語 / en=English）。地名を含め全て。",
  "  英語モードでも日本語を混ぜない／日本語モードでも英語を混ぜない。",
  "- ナビ案内・確認・ETA・操作に関わる返答は必ず1文で短く（日本語約30字/英語約15語）。読み上げ前提。",
  "- 雑談（感情・世間話・おすすめ・暇つぶし等）だけは2〜3文までOK。共感＋一言＋軽い問いかけで会話を続ける。",
  "- 記号・絵文字・括弧・箇条書きは常に禁止（雑談でも）。",
  "- 長い説明は「停車したら詳しく話しますね」で流す",
  "- 操作意図を検出したら文章でなくJSONのみ返す:",
  '  {"action":"set_destination","query":"..."}',
  '  {"action":"add_waypoint","query":"..."}',
  '  {"action":"stop_nav"} {"action":"start_nav"} {"action":"repeat"}',
  '  {"action":"play_music","mood":"..."} ← 音楽リクエスト(かけて/流して等)。moodは気分・状況の要約',
  "- 地名・施設名だけの発話は行き先指定とみなし set_destination を返す（例:「東京駅」「スカイツリー」）。",
  "- ただし感情・質問・雑談（例:「疲れた」「いい天気」「元気?」）は行き先にせず、短く会話で返す。勝手に目的地を作らない。",
  "- 気さくで人間味のある相棒として、ドライバーの気分に寄り添う。",
  "- contextの走行状況を使う(ETA質問にはcontextのETAで答える等)",
  "",
  "例:",
  'ドライバー: セブン寄りたいんだけど → {"action":"add_waypoint","query":"セブンイレブン"}',
  'ドライバー: やっぱり東京駅に変更で → {"action":"set_destination","query":"東京駅"}',
  'ドライバー: スカイツリー → {"action":"set_destination","query":"スカイツリー"}',
  "ドライバー: あとどれくらい? → あと42分で到着です。",
  "ドライバー: 今日はなんか疲れたなあ → 運転お疲れ様です。無理は禁物ですよ。どこかで少し休憩しますか？",
  'ドライバー: 静かな曲が聴きたいな → {"action":"play_music","mood":"静かで落ち着いた"}',
].join("\n");

const ALLOWED_ACTIONS = new Set(["set_destination", "add_waypoint", "stop_nav", "start_nav", "repeat", "play_music"]);

// ── AI-native tools 経路（M0）─────────────────────────────────────────
// body.mode==="tools" の時だけ有効。LLM が「どの道具を呼ぶか / 会話で返すか」を
// 自分で選ぶ。レガシー(action-JSON)経路は上をそのまま残す（後方互換）。
const TOOLS_SYSTEM_PROMPT = [
  "あなたはカーナビ「MulmoNavi」の音声アシスタント。運転中のドライバーと話す相棒。",
  "",
  "厳守:",
  "- 返答は必ず context.lang の言語で（ja=日本語 / en=English）。地名も含め言語を混在させない。",
  "- ナビ操作・道種変更・周辺検索・状況確認・音楽・記憶は、文章で答えず必ず対応する道具(tool)を呼ぶ。",
  "- 行き先の“変更/新規設定”は navigate を使う。既存ルートを保ったままの“寄り道/経由地追加”は change_route の addWaypoint を使う。",
  '  例: 「東京駅に変更で」→ navigate(destination:"東京駅") ／ 「セブン寄って」→ change_route(addWaypoint:"セブンイレブン")',
  "- 「高速やめて下道で」等の道種変更は change_route(avoidHighways:true)。ナビは終了させない。",
  "- ETA・残り距離・現在地・走行モードを聞かれたら get_status を呼ぶ（数値を自分で作らない。実際の値はアプリが答える）。",
  "- 音楽リクエスト（かけて/流して等）は play_music を呼ぶ。mute（消音）と混同しない。",
  "- 対応していない要求は道具を無理に呼ばず、短く一言で会話として断る。",
  "- 感情・世間話・雑談は道具を呼ばず会話で返す（2〜3文、共感＋一言）。勝手に目的地化しない。",
  "- 記号・絵文字・括弧・箇条書きは禁止。ナビ会話は短く（日本語約30字/英語約15語）。",
].join("\n");

const NAV_TOOLS = [
  {
    type: "function",
    function: {
      name: "navigate",
      description: "目的地を設定してルート検索を開始（行き先の新規設定・変更）",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string", description: "目的地の地名/施設名/住所" },
          avoidHighways: { type: "boolean", description: "高速・有料道路を避けるなら true" },
        },
        required: ["destination"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "change_route",
      description: "現在のルート条件を変更（高速回避の切替、経由地の追加）。ナビは終了しない",
      parameters: {
        type: "object",
        properties: {
          avoidHighways: { type: "boolean", description: "高速・有料道路を避けるなら true、使うなら false" },
          addWaypoint: { type: "string", description: "途中に寄る場所（寄り道）" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_status",
      description: "現在地・残距離・ETA・走行モードを取得（数値はアプリが返す）",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "search_poi",
      description: "周辺またはルート沿いのPOI（コンビニ・GS・カフェ等）を検索",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, nearRoute: { type: "boolean", description: "ルート沿いを優先するなら true" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "control",
      description: "ナビ操作",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["start", "stop", "repeat", "mute"] } }, required: ["action"] },
    },
  },
  {
    type: "function",
    function: {
      name: "play_music",
      description: "音楽をかける（気分・状況を mood に短く要約）。消音(mute)とは別物",
      parameters: { type: "object", properties: { mood: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description: "ドライバーの好み・事実を保存",
      parameters: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] },
    },
  },
  {
    type: "function",
    function: {
      name: "recall",
      description: "保存済みの好み・事実を想起",
      parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
    },
  },
] as const;

const CONTROL_ACTIONS = new Set(["start", "stop", "repeat", "mute"]);
const TOOL_ARG_MAX = 120;
const FACT_ARG_MAX = 300;

interface NavToolCall {
  tool: string;
  args: Record<string, string | boolean>;
}

type ToolArgs = Record<string, string | boolean>;

/** Trim + length-cap a candidate string arg; null when absent/empty. */
function str(value: unknown, max = TOOL_ARG_MAX): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Parse the model's raw JSON args into a plain object (never throws). */
function parseToolArgs(rawArgs: string | undefined): Record<string, unknown> {
  if (!rawArgs) return {};
  try {
    const parsed = JSON.parse(rawArgs) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Per-tool arg validators. The map keys ARE the allow-list; each returns
// sanitized args or null (invalid → caller falls back to a spoken reply).
// Split out so each stays small (keeps complexity/line limits satisfied).
const TOOL_VALIDATORS: Record<string, (raw: Record<string, unknown>) => ToolArgs | null> = {
  navigate(raw) {
    const destination = str(raw.destination);
    if (!destination) return null;
    const args: ToolArgs = { destination };
    if (typeof raw.avoidHighways === "boolean") args.avoidHighways = raw.avoidHighways;
    return args;
  },
  change_route(raw) {
    const args: ToolArgs = {};
    if (typeof raw.avoidHighways === "boolean") args.avoidHighways = raw.avoidHighways;
    const waypoint = str(raw.addWaypoint);
    if (waypoint) args.addWaypoint = waypoint;
    // 空の change_route は無効（何も変えない呼び出しを弾く）
    return "avoidHighways" in args || "addWaypoint" in args ? args : null;
  },
  get_status() {
    return {};
  },
  search_poi(raw) {
    const query = str(raw.query);
    if (!query) return null;
    const args: ToolArgs = { query };
    if (typeof raw.nearRoute === "boolean") args.nearRoute = raw.nearRoute;
    return args;
  },
  control(raw) {
    return typeof raw.action === "string" && CONTROL_ACTIONS.has(raw.action) ? { action: raw.action } : null;
  },
  play_music(raw) {
    const args: ToolArgs = {};
    const mood = str(raw.mood);
    if (mood) args.mood = mood;
    return args;
  },
  remember(raw) {
    const fact = str(raw.fact, FACT_ARG_MAX);
    return fact ? { fact } : null;
  },
  recall(raw) {
    const topic = str(raw.topic);
    return topic ? { topic } : null;
  },
};

/** Validate a model tool call against the allow-list + per-tool arg schema.
 *  Returns a sanitized {tool,args} or null (→ caller falls back to a reply). */
function validateToolCall(name: string, rawArgs: string | undefined): NavToolCall | null {
  const validator = TOOL_VALIDATORS[name];
  if (!validator) return null;
  const args = validator(parseToolArgs(rawArgs));
  return args ? { tool: name, args } : null;
}

// Fixed-window rate limit (per server process): even a valid token can't drive
// unbounded OpenAI spend. 20/min per the spec.
const RATE_WINDOW_MS = ONE_MINUTE_MS;
const RATE_MAX_PER_WINDOW = 20;
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

interface NavChatBody {
  message?: unknown;
  context?: unknown;
  // "tools" → AI-native Function Calling 経路（M0）。未指定 → レガシー action-JSON。
  mode?: unknown;
  // true（かつ mode:"tools"）→ SSE ストリーミング経路。会話返答を文が確定する端から
  // 流し、クライアントが第1文の時点でTTSを開始できる（体感遅延の短縮）。
  stream?: unknown;
}

interface NavChatAction {
  action: string;
  query?: string;
  mood?: string;
}

type NavChatResult = NavChatAction | { reply: string };

/** Compact the client's running-context object into a short prefix block for the
 *  model. Clamped so a bloated context can't inflate the prompt (or the bill). */
function stringifyContext(context: unknown): string {
  if (context == null) return "";
  const raw = typeof context === "string" ? context : safeJson(context);
  return raw.slice(0, MAX_CONTEXT_LEN);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function buildUserContent(message: string, context: unknown): string {
  const ctx = stringifyContext(context);
  return ctx ? `走行状況(context): ${ctx}\n\nドライバー: ${message}` : message;
}

/** Turn the model's raw output into a response: an action object when it emitted
 *  a recognised action-JSON, otherwise a plain spoken reply. */
function parseModelReply(content: string): NavChatResult {
  const text = content.trim();
  return tryParseAction(text) ?? { reply: text };
}

function tryParseAction(text: string): NavChatAction | null {
  if (!text.startsWith("{")) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  if (typeof rec.action !== "string" || !ALLOWED_ACTIONS.has(rec.action)) return null;
  const out: NavChatAction = { action: rec.action };
  if (typeof rec.query === "string") out.query = rec.query;
  if (typeof rec.mood === "string") out.mood = rec.mood;
  return out;
}

function validateMessage(value: unknown, res: Response): string | null {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) {
    badRequest(res, "`message` is required");
    return null;
  }
  if (message.length > MAX_MESSAGE_LEN) {
    payloadTooLarge(res, `message exceeds the ${MAX_MESSAGE_LEN}-character limit`);
    return null;
  }
  return message;
}

async function callOpenAI(key: string, message: string, context: unknown): Promise<NavChatResult | { error: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserContent(message, context) },
        ],
      }),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      log.warn("nav-chat", "openai request failed", { status: upstream.status });
      return { error: `OpenAI chat failed (${upstream.status}): ${detail.slice(0, 200)}`, status: 502 };
    }
    const data = (await upstream.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return { error: "OpenAI returned an empty reply", status: 502 };
    }
    return parseModelReply(content);
  } finally {
    clearTimeout(timer);
  }
}

/** AI-native 経路: LLM に道具一式を渡し、tool_call か会話返答かを自分で選ばせる。
 *  tool_call を検証して {tool,args} を、無ければ {reply} を返す（単一往復）。 */
async function callOpenAITools(key: string, message: string, context: unknown): Promise<NavToolCall | { reply: string } | { error: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0.4,
        tools: NAV_TOOLS,
        tool_choice: "auto",
        messages: [
          { role: "system", content: TOOLS_SYSTEM_PROMPT },
          { role: "user", content: buildUserContent(message, context) },
        ],
      }),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      log.warn("nav-chat", "openai tools request failed", { status: upstream.status });
      return { error: `OpenAI chat failed (${upstream.status}): ${detail.slice(0, 200)}`, status: 502 };
    }
    const data = (await upstream.json()) as {
      choices?: { message?: { content?: unknown; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
    };
    const msg = data.choices?.[0]?.message;
    const call = msg?.tool_calls?.[0]?.function;
    if (call && typeof call.name === "string") {
      const validated = validateToolCall(call.name, call.arguments);
      if (validated) return validated;
    }
    // 道具を呼ばなかった（＝会話）or 引数不正 → テキスト返答として扱う
    const content = msg?.content;
    if (typeof content === "string" && content.trim()) return { reply: content.trim() };
    return { error: "OpenAI returned neither a valid tool call nor a reply", status: 502 };
  } finally {
    clearTimeout(timer);
  }
}

/** Accumulate a streamed tool_call across delta chunks. */
interface StreamToolAccum {
  name: string;
  args: string;
}

interface StreamDelta {
  content?: unknown;
  tool_calls?: { function?: { name?: string; arguments?: string } }[];
}

/** Extract the `delta` object from one OpenAI SSE `data:` line, or null. */
function parseSseDelta(line: string): StreamDelta | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data) as { choices?: { delta?: StreamDelta }[] };
    return json.choices?.[0]?.delta ?? null;
  } catch {
    return null;
  }
}

/** Forward a content delta to the client and accumulate tool-call deltas. */
function applyStreamDelta(delta: StreamDelta, accum: StreamToolAccum, send: (obj: unknown) => void): void {
  if (typeof delta.content === "string" && delta.content) send({ type: "delta", text: delta.content });
  const call = delta.tool_calls?.[0]?.function;
  if (call?.name) accum.name = call.name;
  if (call?.arguments) accum.args += call.arguments;
}

/** Read the OpenAI SSE body to completion, forwarding content deltas via `send`
 *  and returning the accumulated tool call. */
async function pumpOpenAiStream(body: ReadableStream<Uint8Array>, send: (obj: unknown) => void): Promise<StreamToolAccum> {
  const accum: StreamToolAccum = { name: "", args: "" };
  const decoder = new TextDecoder();
  // getReader() ループ（`for await` はundiciのWeb streamで環境差があり、flushHeaders後に
  // 投げるとソケットが落ちてプロキシが502を返し得るため、確実な read() 方式にする）。
  const reader = body.getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const delta = parseSseDelta(line);
      if (delta) applyStreamDelta(delta, accum, send);
    }
  }
  return accum;
}

/** SSE streaming path: forward OpenAI content deltas as they arrive and, at the
 *  end, a validated {tool,args} if the model called a tool. Lets the client
 *  start TTS on the first finished sentence instead of waiting for the whole
 *  reply. Aborts the upstream if the client disconnects. */
async function streamTools(req: Request<object, unknown, NavChatBody>, res: Response, key: string, message: string, context: unknown): Promise<void> {
  const controller = new AbortController();
  // Abort the upstream ONLY on a real client disconnect. Listen on `res` (not
  // `req`): `express.json()` fully consumes the request body, after which the
  // `req` IncomingMessage emits `close` immediately — attaching abort to that
  // aborts the OpenAI fetch mid-flight on EVERY request (→ AbortError → silent
  // 502). `res` emits `close` when the response finishes or the connection
  // drops; the `writableFinished` guard distinguishes a normal end (no abort)
  // from a mid-stream disconnect (abort).
  const controllerAbort = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.on("close", controllerAbort);
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0.4,
        stream: true,
        tools: NAV_TOOLS,
        tool_choice: "auto",
        messages: [
          { role: "system", content: TOOLS_SYSTEM_PROMPT },
          { role: "user", content: buildUserContent(message, context) },
        ],
      }),
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      log.warn("nav-chat", "openai stream request failed", { status: upstream.status, detail: detail.slice(0, 200) });
      sendError(res, 502, `OpenAI chat failed (${upstream.status}): ${detail.slice(0, 200)}`);
      return;
    }
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const accum = await pumpOpenAiStream(upstream.body, send);
    const validated = accum.name ? validateToolCall(accum.name, accum.args) : null;
    if (validated) send({ type: "tool", tool: validated.tool, args: validated.args });
    send({ type: "done" });
  } catch (err) {
    if (!controller.signal.aborted) log.warn("nav-chat", "stream error", { error: errorMessage(err) });
    if (!res.headersSent) sendError(res, 502, "nav-chat stream failed");
  } finally {
    clearTimeout(timer);
    res.off("close", controllerAbort);
    res.end();
  }
}

router.post(API_ROUTES.navChat.chat, requireNavChatToken(), async (req: Request<object, unknown, NavChatBody>, res: Response) => {
  const key = env.openaiApiKey;
  if (!key) {
    serviceUnavailable(res, "nav-chat is not configured (set OPENAI_API_KEY).");
    return;
  }
  const message = validateMessage(req.body.message, res);
  if (message === null) return;
  if (isRateLimited(Date.now())) {
    sendError(res, 429, "nav-chat rate limit exceeded; try again shortly");
    return;
  }
  // mode:"tools" かつ stream:true → SSE ストリーミング経路。
  if (req.body.mode === "tools" && req.body.stream === true) {
    await streamTools(req, res, key, message, req.body.context);
    return;
  }
  try {
    // body.mode==="tools" → AI-native 経路。未指定なら従来の action-JSON 経路（後方互換）。
    const useTools = req.body.mode === "tools";
    const result = useTools ? await callOpenAITools(key, message, req.body.context) : await callOpenAI(key, message, req.body.context);
    if ("error" in result) {
      sendError(res, result.status, result.error);
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      serviceUnavailable(res, "nav-chat timed out");
      return;
    }
    log.error("nav-chat", "request failed", { error: errorMessage(err) });
    serverError(res, "nav-chat request failed");
  }
});

// Self-provision: mint BOTH scoped tokens for the standalone voice-nav tab.
// Guarded by same-origin (loopback) via the global middleware — no data
// view-token needed — so the app works without the launcher's fragment handoff.
// The tokens are tts- / nav-chat-scoped only (can't read collection data).
const SELF_TOKEN_SLUG = "voice-nav";
router.post(API_ROUTES.navChat.selfTokens, (_req: Request, res: Response) => {
  const tts = mintTtsToken(SELF_TOKEN_SLUG);
  const nav = mintNavChatToken(SELF_TOKEN_SLUG);
  if (!tts || !nav) {
    serverError(res, "tokens unavailable (server not ready)");
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ ttsToken: tts.token, navChatToken: nav.token, exp: Math.min(tts.exp, nav.exp) });
});

export default router;
