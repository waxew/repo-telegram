// The central builder bot validates BotFather tokens and provisions tenant webhooks.

// Import runtime configuration shared by the Worker router.
import type { Env } from "../env";
// Import persistence and Telegram clients.
import type { Database } from "../lib/database";
import { TelegramClient } from "../lib/telegram";
// Import token protection and webhook-secret helpers.
import { encryptSecret, generateWebhookSecret, looksLikeTelegramBotToken, sha256Hex } from "../lib/crypto";
// Import stable session and HTML helpers.
import { builderSessionKey, escapeHtml, safeErrorMessage } from "../lib/format";
// Import the incoming update shape.
import type { TelegramUpdate } from "../types/telegram";
// Import exact reference-flow copy and keyboards.
import { BOTFATHER_GUIDE, BUILD_AUDIENCE_TEXT, BUTTONS, builderAccountText } from "../ui/texts";
import { buildAudienceKeyboard, builderMainKeyboard } from "../ui/keyboards";

// Parse an optional /start referral id without trusting usernames.
function parseBuilderReferrer(text: string | undefined): number | null {
  // A missing text cannot contain a deep-link payload.
  if (!text) return null;
  // Accept only the builder's compact r<base36> format.
  const match = text.match(/^\/start\s+r([0-9a-z]+)$/i);
  // Reject normal starts and malformed payloads.
  if (!match?.[1]) return null;
  // Decode the deterministic referral identifier.
  const value = Number.parseInt(match[1], 36);
  // Telegram ids must remain safe positive integers.
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

// Handle one authenticated update received by the central builder webhook.
export async function handleBuilderUpdate(update: TelegramUpdate, db: Database, env: Env): Promise<void> {
  // Builder workflows currently consume private messages only.
  const message = update.message;
  // Ignore channel posts and other unsupported update shapes.
  if (!message?.from || message.chat.type !== "private") return;
  // Create a Telegram client for the central bot token.
  const telegram = new TelegramClient(env.BUILDER_BOT_TOKEN);
  // Upsert the account before any menu action.
  const account = await db.upsertBuilderAccount(message.from, parseBuilderReferrer(message.text));
  // Address all replies to the private chat that generated the update.
  const chatId = message.chat.id;
  // Normalize optional text for exact reply-keyboard routing.
  const text = message.text?.trim() ?? "";
  // Resolve the durable wizard state.
  const sessionKey = builderSessionKey(message.from.id);
  // Load it after the account upsert so first-time users work immediately.
  const session = await db.getSession(sessionKey);

  // /start and back always reset the central builder navigation.
  if (text.startsWith("/start") || text === BUTTONS.back) {
    // Cancel any abandoned token form.
    await db.clearSession(sessionKey);
    // Present the main builder menu.
    await telegram.sendMessage(chatId, "👋 <b>به ربات فروشگاه‌ساز خوش آمدید.</b>\n\nاز منوی زیر انتخاب کنید:", builderMainKeyboard);
    return;
  }

  // Start the shop creation flow.
  if (text === BUTTONS.buildStore) {
    // Clear unrelated state before choosing an audience.
    await db.clearSession(sessionKey);
    // Ask the exact self/customer question from the reference flow.
    await telegram.sendMessage(chatId, BUILD_AUDIENCE_TEXT, buildAudienceKeyboard);
    return;
  }

  // Both audience choices lead to token collection, while preserving the billing mode.
  if (text === BUTTONS.forMyself || text === BUTTONS.forCustomer) {
    // Save the audience for future subscription/pricing extensions.
    await db.setSession({
      session_key: sessionKey,
      scope: "builder",
      shop_id: null,
      telegram_user_id: message.from.id,
      step: "await_bot_token",
      data: { audience: text === BUTTONS.forMyself ? "self" : "customer" },
    });
    // Show the complete BotFather guide and keep a back button available.
    await telegram.sendMessage(chatId, BOTFATHER_GUIDE, buildAudienceKeyboard);
    return;
  }

  // Complete provisioning when the durable wizard expects a BotFather token.
  if (session?.step === "await_bot_token") {
    // Prevent malformed values from reaching Telegram.
    if (!looksLikeTelegramBotToken(text)) {
      await telegram.sendMessage(chatId, "❌ فرمت توکن صحیح نیست. توکن کامل BotFather را بدون فاصله ارسال کنید.", buildAudienceKeyboard);
      return;
    }
    try {
      // Validate ownership/validity indirectly by asking Telegram for public bot identity.
      const customerTelegram = new TelegramClient(text);
      // getMe never exposes or stores the token in logs.
      const identity = await customerTelegram.getMe();
      // Encrypt the token before the first database write.
      const encrypted = await encryptSecret(text, env.TOKEN_ENCRYPTION_KEY);
      // Generate an independent secret for Telegram's webhook header.
      const webhookSecret = generateWebhookSecret();
      // Store only the SHA-256 digest of that webhook secret.
      const webhookSecretHash = await sha256Hex(webhookSecret);
      // Insert the tenant with its public bot metadata.
      const shop = await db.createShop({
        ownerTelegramId: message.from.id,
        botTelegramId: identity.id,
        botUsername: identity.username,
        botDisplayName: identity.first_name,
        tokenCiphertext: encrypted.ciphertext,
        tokenIv: encrypted.iv,
        webhookSecretHash,
        // Persist the audience-specific trial duration shown before token entry.
        trialDays: session.data.audience === "customer" ? 30 : 7,
      });
      // Build an HTTPS URL unique to this tenant.
      const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, "");
      try {
        // Register the customer bot directly through Telegram's official API.
        await customerTelegram.setWebhook(`${baseUrl}/telegram/store/${shop.webhook_key}`, webhookSecret);
      } catch (error) {
        // Roll back the tenant row when Telegram did not accept its webhook.
        await db.deleteShop(message.from.id, shop.id);
        // Re-throw so the user receives the normal retry guidance below.
        throw error;
      }
      // End the token wizard only after webhook registration succeeds.
      await db.clearSession(sessionKey);
      // Confirm the exact created bot and its trial status.
      await telegram.sendMessage(
        chatId,
        [
          "✅ <b>ربات فروشگاهی با موفقیت متصل شد.</b>",
          "",
          `🤖 نام: ${escapeHtml(identity.first_name)}`,
          `🔗 آدرس: @${escapeHtml(identity.username)}`,
          "🎁 دوره آزمایشی: ۷ روز",
          "",
          "اکنون ربات ساخته‌شده را باز کنید و از «پنل مدیریت» محصولات خود را وارد کنید.",
        ].join("\n"),
        builderMainKeyboard,
      );
    } catch (error) {
      // Keep the wizard active so the user can correct/revoke the token.
      await telegram.sendMessage(
        chatId,
        `❌ اتصال انجام نشد. توکن را بررسی کنید و دوباره بفرستید.\n\n<code>${escapeHtml(safeErrorMessage(error))}</code>`,
        buildAudienceKeyboard,
      );
    }
    return;
  }

  // Show all bots owned by the current builder.
  if (text === BUTTONS.myBots) {
    // Load tenant rows only for this immutable Telegram id.
    const shops = await db.listOwnerShops(message.from.id);
    // Convert the list to compact bot links.
    const lines = shops.length > 0
      ? shops.map((shop, index) => `${index + 1}. <a href="https://t.me/${escapeHtml(shop.bot_username)}">@${escapeHtml(shop.bot_username)}</a> — ${shop.status}`)
      : ["هنوز رباتی نساخته‌اید."];
    // Send the list with the persistent main keyboard.
    await telegram.sendMessage(chatId, ["🤖 <b>ربات‌های من</b>", "", ...lines].join("\n"), builderMainKeyboard);
    return;
  }

  // Render the central account summary.
  if (text === BUTTONS.builderAccount) {
    // Shop rows provide count and nearest expiration date.
    const shops = await db.listOwnerShops(message.from.id);
    // Present the formatted account card.
    await telegram.sendMessage(chatId, builderAccountText(account, shops), builderMainKeyboard);
    return;
  }

  // Subscription payment is intentionally routed to support until a billing provider is configured.
  if (text === BUTTONS.renew) {
    // Avoid pretending a payment happened in an unconfigured environment.
    await telegram.sendMessage(chatId, "💎 برای تمدید اشتراک، ربات موردنظر را از «ربات‌های من» انتخاب کرده و با پشتیبانی هماهنگ کنید.", builderMainKeyboard);
    return;
  }

  // Central support displays the configured username when present.
  if (text === BUTTONS.builderSupport) {
    // Escape the configurable username before using HTML mode.
    const support = env.BUILDER_SUPPORT_USERNAME ? `@${escapeHtml(env.BUILDER_SUPPORT_USERNAME.replace(/^@/, ""))}` : "هنوز تنظیم نشده است";
    // Return the support destination.
    await telegram.sendMessage(chatId, `📞 <b>پشتیبانی ربات‌ساز</b>\n\n${support}`, builderMainKeyboard);
    return;
  }

  // Unknown input returns a short orientation message without changing state.
  await telegram.sendMessage(chatId, "لطفاً یکی از گزینه‌های منو را انتخاب کنید.", builderMainKeyboard);
}
