#!/usr/bin/env node
// @mulmobridge/whatsapp — WhatsApp bridge for MulmoClaude.
//
// Uses Meta's WhatsApp Cloud API (webhook mode).
//
// Required env vars:
//   WHATSAPP_ACCESS_TOKEN    — permanent access token
//   WHATSAPP_PHONE_NUMBER_ID — phone number ID from Meta dashboard
//   WHATSAPP_VERIFY_TOKEN    — any string for webhook verification
//   WHATSAPP_APP_SECRET      — App secret for x-hub-signature-256 HMAC
//
// Optional:
//   WHATSAPP_BRIDGE_PORT      — webhook port (default: 3003)
//   WHATSAPP_ALLOWED_NUMBERS  — CSV of phone numbers (empty = all)

import "dotenv/config";
import type { Request, Response } from "express";
import { createBridgeClient } from "@mulmobridge/client";
import { createWebhookApp, createWebhookRateLimit, narrowChallenge, verifyHmacSignature } from "@mulmobridge/webhook-runtime";
import { isRecord, parseCsvSet } from "@mulmoclaude/common";

const TRANSPORT_ID = "whatsapp";
const PORT = Number(process.env.WHATSAPP_BRIDGE_PORT) || 3003;
const FETCH_TIMEOUT_MS = 30_000;

function readRequiredEnv(): { accessToken: string; phoneNumberId: string; verifyToken: string; appSecret: string } {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!accessToken || !phoneNumberId || !verifyToken || !appSecret) {
    console.error(
      "WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, and WHATSAPP_APP_SECRET are required.\nSee README for setup instructions.",
    );
    process.exit(1);
  }
  return { accessToken, phoneNumberId, verifyToken, appSecret };
}
const { accessToken, phoneNumberId, verifyToken, appSecret } = readRequiredEnv();

const allowedNumbers = parseCsvSet(process.env.WHATSAPP_ALLOWED_NUMBERS);
const allowAll = allowedNumbers.size === 0;

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });

mulmo.onPush((pushEvent) => {
  sendWhatsAppMessage(pushEvent.chatId, pushEvent.message).catch((err) => console.error(`[whatsapp] push send failed: ${err}`));
});

// ── WhatsApp Cloud API ──────────────────────────────────────────

const API_BASE = `https://graph.facebook.com/v21.0/${phoneNumberId}`;

async function sendWhatsAppMessage(recipientId: string, text: string): Promise<void> {
  const MAX = 4096;
  const chunks =
    text.length === 0
      ? ["(empty reply)"]
      : Array.from({ length: Math.ceil(text.length / MAX) }, (_, chunkIndex) => text.slice(chunkIndex * MAX, (chunkIndex + 1) * MAX));

  for (const chunk of chunks) {
    try {
      const res = await fetch(`${API_BASE}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipientId,
          type: "text",
          text: { body: chunk },
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[whatsapp] sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[whatsapp] sendMessage error: ${err}`);
    }
  }
}

// ── Signature verification (x-hub-signature-256) ────────────────

function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  // Meta prefixes the hex digest with `sha256=`; strip it before comparing.
  return verifyHmacSignature(rawBody, signature.replace("sha256=", ""), appSecret, "sha256", "hex");
}

// ── Payload extraction ──────────────────────────────────────────

interface WhatsAppTextMessage {
  from: string;
  text: { body: string };
}

// `Array.isArray(x: unknown)` narrows to `any[]`, which reintroduces `any`;
// this preserves the element type as `unknown` so the spread stays checked.
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function parseOneMessage(msg: unknown): WhatsAppTextMessage | null {
  if (!isRecord(msg)) return null;
  if (msg.type !== "text" || typeof msg.from !== "string") return null;
  if (!isRecord(msg.text)) return null;
  const { body } = msg.text;
  if (typeof body !== "string" || !body.trim()) return null;
  return { from: msg.from, text: { body } };
}

function collectRawMessages(body: unknown): unknown[] {
  if (!isRecord(body) || !Array.isArray(body.entry)) return [];
  const raw: unknown[] = [];
  for (const entry of body.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const { messages } = change.value;
      if (isUnknownArray(messages)) raw.push(...messages);
    }
  }
  return raw;
}

function extractTextMessages(body: unknown): WhatsAppTextMessage[] {
  return collectRawMessages(body)
    .map(parseOneMessage)
    .filter((message): message is WhatsAppTextMessage => message !== null);
}

// ── Webhook server ──────────────────────────────────────────────

const app = createWebhookApp();
// The verification GET shares the limiter since a flood of bogus
// `hub.challenge` probes would otherwise hammer us just as effectively.
const webhookRateLimit = createWebhookRateLimit();

// Webhook verification (GET).
//
// Meta sends `hub.mode=subscribe` + the shared `hub.verify_token`
// + a one-time `hub.challenge` ASCII nonce that we must echo back.
// Three layered defences against `js/reflected-xss` — full
// rationale + compatibility notes live in `./verify.ts` next to
// the unit-tested `narrowChallenge` helper.
//
//   1. **Shape whitelist** on `hub.challenge` (`narrowChallenge`)
//      — required to clear CodeQL's data-flow analyser (we tried
//      `text/plain` alone and the alert stayed open).
//   2. **`text/plain` content-type** — neutralises browser HTML
//      execution even if a future regression widened the whitelist.
//   3. **String-narrowing** — `narrowChallenge` rejects non-string
//      query values so `?hub.challenge[]=…` array forms can't
//      bypass the regex via toString().
app.get("/webhook", webhookRateLimit, (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = narrowChallenge(req.query["hub.challenge"]);

  if (mode === "subscribe" && token === verifyToken && challenge !== null) {
    console.log("[whatsapp] webhook verified");
    res.type("text/plain").status(200).send(challenge);
  } else {
    res.status(403).type("text/plain").send("Forbidden");
  }
});

// Webhook events (POST) — signature-verified + rate-limited
app.post("/webhook", webhookRateLimit, async (req: Request, res: Response) => {
  const signature = req.headers["x-hub-signature-256"] as string;
  const rawBody = req.body as string;

  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    console.warn("[whatsapp] webhook signature verification failed");
    res.status(401).send("Invalid signature");
    return;
  }

  res.status(200).send("OK");

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    console.error("[whatsapp] malformed JSON in webhook body");
    return;
  }

  for (const msg of extractTextMessages(parsed)) {
    if (!allowAll && !allowedNumbers.has(msg.from)) {
      console.log(`[whatsapp] denied from=${msg.from}`);
      continue;
    }

    console.log(`[whatsapp] message from=${msg.from} len=${msg.text.body.length}`);

    try {
      const ack = await mulmo.send(msg.from, msg.text.body);
      if (ack.ok) {
        await sendWhatsAppMessage(msg.from, ack.reply ?? "");
      } else {
        const status = ack.status ? ` (${ack.status})` : "";
        await sendWhatsAppMessage(msg.from, `Error${status}: ${ack.error ?? "unknown"}`);
      }
    } catch (err) {
      console.error(`[whatsapp] message handling failed: ${err}`);
    }
  }
});

app.listen(PORT, () => {
  console.log("MulmoClaude WhatsApp bridge");
  console.log(`Webhook listening on http://localhost:${PORT}/webhook`);
});
