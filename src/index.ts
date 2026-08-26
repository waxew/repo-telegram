// Cloudflare Worker entry point for central and tenant Telegram webhooks.

// Import strongly typed runtime configuration.
import type { Env } from "./env";
// Create a fresh repository per request/invocation.
import { Database } from "./lib/database";
// Protect tenant tokens and verify webhook header digests.
import { constantTimeEqual, decryptSecret, sha256Hex } from "./lib/crypto";
// Use request-scoped Telegram clients and safe diagnostics.
import { TelegramClient } from "./lib/telegram";
import { safeErrorMessage } from "./lib/format";
// Process queued fan-out messages from the cron trigger.
import { processNextBroadcast } from "./lib/broadcast";
// Import central and tenant update handlers.
import { handleBuilderUpdate } from "./handlers/builder";
import { handleStoreUpdate } from "./handlers/store";
// Import hosted ZarinPal routes.
import { finishZarinPalPayment, startZarinPalPayment } from "./lib/zarinpal";
// Import the minimal incoming update type.
import type { TelegramUpdate } from "./types/telegram";

// Return a small text response with consistent security headers.
function textResponse(body: string, status = 200): Response {
  // Telegram only needs a 2xx acknowledgement body.
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

// Reject oversized webhook bodies before parsing JSON into Worker memory.
function bodySizeAllowed(request: Request): boolean {
  // Telegram's normal updates are far smaller than one MiB.
  const rawLength = request.headers.get("content-length");
  // Chunked requests without the header proceed to normal parsing.
  if (!rawLength) return true;
  // Reject malformed or oversized declared lengths.
  const length = Number(rawLength);
  return Number.isFinite(length) && length >= 0 && length <= 1_048_576;
}

// Parse a Telegram JSON update after basic content validation.
async function readTelegramUpdate(request: Request): Promise<TelegramUpdate> {
  // Limit the common declared-length attack path.
  if (!bodySizeAllowed(request)) throw new Error("Webhook body is too large");
  // Require JSON content from Telegram.
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("Webhook body must be JSON");
  }
  // Parse and minimally validate update_id.
  const update = (await request.json()) as Partial<TelegramUpdate>;
  // A valid Telegram update always has an integer update_id.
  if (!Number.isSafeInteger(update.update_id)) throw new Error("Invalid Telegram update");
  // Return the accepted shape for focused handlers.
  return update as TelegramUpdate;
}

// Resolve a tenant and top-up from a hosted payment path.
async function resolvePaymentPath(
  db: Database,
  webhookKey: string,
  topupId: string,
): Promise<{ shop: NonNullable<Awaited<ReturnType<Database["getShopByWebhookKey"]>>>; topup: NonNullable<Awaited<ReturnType<Database["getTopupById"]>>> } | null> {
  // Look up the unguessable tenant path component.
  const shop = await db.getShopByWebhookKey(webhookKey);
  // Unknown shops produce a normal 404 without detail.
  if (!shop) return null;
  // Resolve the top-up under that exact tenant.
  const topup = await db.getTopupById(shop.id, topupId);
  // Unknown/cross-tenant requests are indistinguishable.
  if (!topup) return null;
  // Return both validated rows.
  return { shop, topup };
}

// Export one stateless Worker handler object.
export default {
  // fetch receives HTTPS health, payment, and Telegram webhook requests.
  async fetch(request, env): Promise<Response> {
    // Construct request-owned database state; never place clients in global mutable state.
    const db = new Database(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
    // Parse the request URL once.
    const url = new URL(request.url);
    // A public health endpoint helps Cloudflare/GitHub deployment checks.
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(JSON.stringify({ ok: true, service: "repo-telegram", version: "1.0.0" }), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    // Start page: /pay/zarinpal/<webhook_key>/<topup_id>.
    const paymentStart = url.pathname.match(/^\/pay\/zarinpal\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i);
    if (request.method === "GET" && paymentStart?.[1] && paymentStart[2]) {
      const resolved = await resolvePaymentPath(db, paymentStart[1], paymentStart[2]);
      if (!resolved) return textResponse("Payment request not found", 404);
      return startZarinPalPayment(request, db, resolved.shop, resolved.topup, env.PUBLIC_BASE_URL);
    }

    // Callback page: /pay/zarinpal/callback/<webhook_key>/<topup_id>.
    const paymentCallback = url.pathname.match(/^\/pay\/zarinpal\/callback\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i);
    if (request.method === "GET" && paymentCallback?.[1] && paymentCallback[2]) {
      const resolved = await resolvePaymentPath(db, paymentCallback[1], paymentCallback[2]);
      if (!resolved) return textResponse("Payment request not found", 404);
      const token = await decryptSecret(resolved.shop.token_ciphertext, resolved.shop.token_iv, env.TOKEN_ENCRYPTION_KEY);
      const telegram = new TelegramClient(token);
      return finishZarinPalPayment(request, db, telegram, resolved.shop, resolved.topup);
    }

    // Telegram sends central builder updates only to this fixed path.
    if (url.pathname === "/telegram/builder") {
      // Webhook routes accept POST only.
      if (request.method !== "POST") return textResponse("Method not allowed", 405);
      // Telegram echoes the configured secret in this exact header.
      const secret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
      // Constant-time comparison protects the central webhook.
      if (!constantTimeEqual(secret, env.BUILDER_WEBHOOK_SECRET)) return textResponse("Unauthorized", 401);
      try {
        // Parse and fully process the update before acknowledging it.
        await handleBuilderUpdate(await readTelegramUpdate(request), db, env);
        // Telegram treats any 2xx as successful delivery.
        return textResponse("ok");
      } catch (error) {
        // Log a bounded message without payloads, tokens, or secret headers.
        console.error("builder webhook failed", safeErrorMessage(error));
        // A 500 asks Telegram to retry transient failures.
        return textResponse("retry", 500);
      }
    }

    // Dynamic tenant route: /telegram/store/<webhook_key>.
    const storeMatch = url.pathname.match(/^\/telegram\/store\/([0-9a-f-]{36})$/i);
    if (storeMatch?.[1]) {
      // Store webhooks accept POST only.
      if (request.method !== "POST") return textResponse("Method not allowed", 405);
      try {
        // Resolve the tenant before touching its encrypted token.
        const shop = await db.getShopByWebhookKey(storeMatch[1]);
        // Unknown unguessable paths reveal no details.
        if (!shop) return textResponse("Not found", 404);
        // Hash the supplied header and compare it with the stored digest.
        const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        const suppliedHash = await sha256Hex(suppliedSecret);
        // Reject spoofed updates before parsing the body or decrypting credentials.
        if (!constantTimeEqual(suppliedHash, shop.webhook_secret_hash)) return textResponse("Unauthorized", 401);
        // Decrypt the tenant token only for this authenticated request.
        const token = await decryptSecret(shop.token_ciphertext, shop.token_iv, env.TOKEN_ENCRYPTION_KEY);
        // Create a local Telegram API client that cannot leak into another tenant request.
        const telegram = new TelegramClient(token);
        // Parse and route the authenticated update.
        await handleStoreUpdate(await readTelegramUpdate(request), db, telegram, shop, env);
        // Acknowledge successful processing.
        return textResponse("ok");
      } catch (error) {
        // Store only safe diagnostics in Cloudflare logs.
        console.error("store webhook failed", safeErrorMessage(error));
        // Ask Telegram to retry transient errors.
        return textResponse("retry", 500);
      }
    }

    // No route matched the request.
    return textResponse("Not found", 404);
  },

  // scheduled advances one broadcast batch every minute.
  async scheduled(_controller, env, ctx): Promise<void> {
    // Create an invocation-owned database repository.
    const db = new Database(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
    // Explicitly register background work with the Worker execution context.
    ctx.waitUntil(processNextBroadcast(db, env.TOKEN_ENCRYPTION_KEY));
  },
} satisfies ExportedHandler<Env>;
