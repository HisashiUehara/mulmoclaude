// Facebook Messenger platform plugin.
//
// Required secrets (wrangler secret put):
//   MESSENGER_APP_SECRET        — App secret for x-hub-signature-256 HMAC
//   MESSENGER_PAGE_ACCESS_TOKEN — Page access token
//   MESSENGER_VERIFY_TOKEN      — Arbitrary string for webhook verification

import { isRecord } from "@mulmoclaude/common";
import { PLATFORMS, type RelayMessage, type Env } from "../types.js";
import { envSecret, requireEnvSecret } from "../utils/envSecret.js";
import { registerPlatform, CONNECTION_MODES, type PlatformPlugin } from "../platform.js";
import { handleMetaVerification, verifyMetaWebhookSignature } from "./meta.js";
import { postJsonChunks } from "./respond.js";
import { makeRelayMessage } from "./relay-message.js";

const MAX_MESSENGER_TEXT = 2000;

interface ExtractedMessage {
  senderId: string;
  text: string;
}

function parseOneEvent(event: unknown): ExtractedMessage | null {
  if (!isRecord(event) || !isRecord(event.sender) || typeof event.sender.id !== "string") return null;
  if (!isRecord(event.message) || typeof event.message.text !== "string") return null;
  const text = event.message.text.trim();
  if (!text) return null;
  return { senderId: event.sender.id, text };
}

function extractMessages(body: unknown): ExtractedMessage[] {
  if (!isRecord(body) || !Array.isArray(body.entry)) return [];
  const out: ExtractedMessage[] = [];
  for (const entry of body.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.messaging)) continue;
    for (const event of entry.messaging) {
      const msg = parseOneEvent(event);
      if (msg) out.push(msg);
    }
  }
  return out;
}

const messengerPlugin: PlatformPlugin = {
  name: PLATFORMS.messenger,
  mode: CONNECTION_MODES.webhook,
  webhookPath: "/webhook/messenger",

  isConfigured(env: Env): boolean {
    return Boolean(env.MESSENGER_APP_SECRET) && Boolean(env.MESSENGER_PAGE_ACCESS_TOKEN);
  },

  handleVerification(request: Request, env: Env): Response {
    return handleMetaVerification(request, envSecret(env, "MESSENGER_VERIFY_TOKEN") ?? "");
  },

  async handleWebhook(request: Request, body: string, env: Env): Promise<RelayMessage[]> {
    await verifyMetaWebhookSignature(request, body, requireEnvSecret(env, "MESSENGER_APP_SECRET"), "Messenger");

    return extractMessages(JSON.parse(body)).map((msg) =>
      makeRelayMessage({ platform: PLATFORMS.messenger, senderId: msg.senderId, chatId: msg.senderId, text: msg.text }),
    );
  },

  async sendResponse(chatId: string, text: string, env: Env): Promise<void> {
    // Authorization header (not query string) — Graph API supports it, and
    // avoids leaking the token into CDN / proxy access logs and error reports.
    await postJsonChunks({
      text,
      maxTextLength: MAX_MESSENGER_TEXT,
      label: "Messenger",
      endpoint: "https://graph.facebook.com/v21.0/me/messages",
      accessToken: requireEnvSecret(env, "MESSENGER_PAGE_ACCESS_TOKEN"),
      buildBody: (chunk) => ({ recipient: { id: chatId }, message: { text: chunk } }),
    });
  },
};

registerPlatform(messengerPlugin);
