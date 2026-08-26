// Storefront webhook routing resolves tenant, user, membership, and admin permissions.

// Import request-scoped runtime configuration.
import type { Env } from "../env";
// Import persistence and Telegram helpers already created by the route.
import type { Database } from "../lib/database";
import type { TelegramClient } from "../lib/telegram";
// Import session/deep-link and HTML helpers.
import { escapeHtml, parsePositiveInteger, storeSessionKey } from "../lib/format";
// Import the tenant domain row and Telegram update types.
import type { ForceChannel, ShopBotRow } from "../types/domain";
import type { InlineKeyboardMarkup, TelegramUpdate, TelegramUser } from "../types/telegram";
// Import main customer navigation labels.
import { BUTTONS } from "../ui/texts";
import { shopMainKeyboard } from "../ui/keyboards";
// Import separated customer and administrator state machines.
import { handleAdminCallback, handleAdminMessage } from "./admin";
import {
  handleCustomerCallback,
  handleCustomerDiscountMessage,
  handleCustomerMessage,
  showShopHome,
} from "./customer";
// Import the common context shapes for explicit construction.
import type { StoreCallbackContext, StoreMessageContext } from "./context";

// Parse an optional numeric referral id from /start.
function parseStoreReferrer(text: string | undefined): number | null {
  // Require the official deep-link command plus one numeric payload.
  const match = text?.trim().match(/^\/start\s+(\d+)$/);
  // Convert through the shared safe positive-integer validator.
  return match?.[1] ? parsePositiveInteger(match[1]) : null;
}

// Parse a product deep link formatted as /start p_<public_code>.
function parseProductCode(text: string | undefined): number | null {
  // Product payloads are explicitly namespaced from referral ids.
  const match = text?.trim().match(/^\/start\s+p_(\d+)$/);
  // Reject unsafe or malformed numbers.
  return match?.[1] ? parsePositiveInteger(match[1]) : null;
}

// Determine tenant-admin access using immutable numeric Telegram ids only.
function isShopAdmin(shop: ShopBotRow, user: TelegramUser): boolean {
  // The primary owner always has access.
  if (shop.owner_telegram_id === user.id) return true;
  // A configured second id receives the same panel access.
  return shop.settings.second_admin_id === String(user.id);
}

// Decide whether the storefront subscription currently allows customer traffic.
function shopAcceptsCustomers(shop: ShopBotRow): boolean {
  // Suspended and explicitly expired shops are never customer-accessible.
  if (shop.status === "suspended" || shop.status === "expired") return false;
  // Active subscriptions use subscription_ends_at when one is configured.
  if (shop.status === "active") {
    return !shop.subscription_ends_at || new Date(shop.subscription_ends_at).getTime() > Date.now();
  }
  // Trial shops remain accessible until trial_ends_at.
  return new Date(shop.trial_ends_at).getTime() > Date.now();
}

// Check all configured forced-join channels and return those still missing.
async function missingRequiredChannels(
  telegram: TelegramClient,
  channels: ForceChannel[],
  telegramUserId: number,
): Promise<ForceChannel[]> {
  // Each membership read is independent, so resolve them concurrently.
  const results = await Promise.all(channels.map(async (channel) => {
    try {
      // Ask Telegram for the user's current membership.
      const member = await telegram.getChatMember(channel.chat_id, telegramUserId);
      // These statuses represent an active channel member.
      const joined = ["creator", "administrator", "member"].includes(member.status)
        || (member.status === "restricted" && member.is_member === true);
      // Return null for joined channels and the channel for missing ones.
      return joined ? null : channel;
    } catch {
      // A misconfigured channel/bot permission cannot be treated as a valid join.
      return channel;
    }
  }));
  // Remove joined null values with a type predicate.
  return results.filter((channel): channel is ForceChannel => channel !== null);
}

// Show the required channel buttons and an explicit re-check action.
async function sendJoinWarning(telegram: TelegramClient, chatId: number, channels: ForceChannel[]): Promise<void> {
  // Each required channel becomes a URL button.
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      ...channels.map((channel) => [{ text: `عضویت در ${channel.title} 📣`, url: channel.url, style: "primary" as const }]),
      [{ text: "عضو شدم؛ بررسی کن ✅", callback_data: "join:check", style: "success" }],
    ],
  };
  // Explain the gate without exposing internal channel ids.
  await telegram.sendMessage(chatId, "🔒 برای استفاده از فروشگاه ابتدا در کانال‌های زیر عضو شوید، سپس دکمه بررسی را بزنید:", keyboard);
}

// Handle one authenticated tenant update.
export async function handleStoreUpdate(
  update: TelegramUpdate,
  db: Database,
  telegram: TelegramClient,
  shop: ShopBotRow,
  env: Env,
): Promise<void> {
  // Callback queries require immediate acknowledgement to clear Telegram's spinner.
  if (update.callback_query) {
    try {
      // A blank acknowledgement is sufficient; handler messages provide details.
      await telegram.answerCallbackQuery(update.callback_query.id);
    } catch {
      // A stale callback can fail acknowledgement but should not crash the webhook.
    }
  }
  // Normalize message/callback sender and chat into one routing shape.
  const callback = update.callback_query;
  // A callback must have its original message to determine the destination chat.
  const message = update.message ?? callback?.message;
  // Use callback.from when present because message.from is the bot on old callbacks.
  const from = callback?.from ?? update.message?.from;
  // Ignore unsupported channel/member updates and non-private storefront interactions.
  if (!message || !from || message.chat.type !== "private") return;
  // Upsert the storefront user; only /start may assign a first-time referrer.
  const user = await db.upsertStoreUser(shop.id, from, parseStoreReferrer(update.message?.text));
  // Determine management access before subscription and force-join gates.
  const isAdmin = isShopAdmin(shop, from);
  // Keep administrator access available for an expired shop so it can be repaired/renewed.
  if (!isAdmin && !shopAcceptsCustomers(shop)) {
    await telegram.sendMessage(message.chat.id, "⛔️ اشتراک این فروشگاه پایان یافته و موقتاً در دسترس نیست.");
    return;
  }
  // Enforce configured channel memberships for customers, never for shop admins.
  if (!isAdmin && shop.settings.force_channels.length > 0) {
    const missing = await missingRequiredChannels(telegram, shop.settings.force_channels, from.id);
    if (missing.length > 0) {
      await sendJoinWarning(telegram, message.chat.id, missing);
      return;
    }
  }
  // Resolve the durable state after the user upsert.
  const sessionKey = storeSessionKey(shop.id, from.id);
  // Load any in-progress wizard.
  const session = await db.getSession(sessionKey);
  // Shared fields are explicit request-owned values.
  const common = {
    db,
    telegram,
    shop,
    user,
    session,
    sessionKey,
    isAdmin,
    publicBaseUrl: env.PUBLIC_BASE_URL,
  };

  // Route inline callbacks before normal messages.
  if (callback?.data) {
    // Build a callback context with its compact action and chat id.
    const context: StoreCallbackContext = {
      ...common,
      chatId: message.chat.id,
      callbackData: callback.data,
    };
    // A successful forced-join re-check reaches the normal home.
    if (callback.data === "join:check") {
      await showShopHome(context, message.chat.id);
      return;
    }
    // Administrator callbacks take priority only when authorization passed.
    if (isAdmin && await handleAdminCallback(context)) return;
    // Customer catalogue/invoice callbacks are available to all users including owners.
    if (await handleCustomerCallback(context)) return;
    // A callback can outlive deleted content; return a clear fallback.
    await telegram.sendMessage(message.chat.id, "این گزینه دیگر معتبر نیست؛ از منوی اصلی دوباره انتخاب کنید.", shopMainKeyboard);
    return;
  }

  // Remaining routes require an actual incoming message.
  if (!update.message) return;
  // Build the message context.
  const context: StoreMessageContext = { ...common, message: update.message };
  // /start resets abandoned state and shows optional deep-linked product.
  if (update.message.text?.startsWith("/start")) {
    await db.clearSession(sessionKey);
    await showShopHome(context, message.chat.id);
    const publicCode = parseProductCode(update.message.text);
    if (publicCode) {
      const product = await db.getProductByPublicCode(shop.id, publicCode);
      if (product?.is_active) {
        const plans = await db.listPlans(product.id, true);
        const { productCaption } = await import("../ui/texts");
        const { planPurchaseKeyboard } = await import("../ui/keyboards");
        if (product.image_file_ids[0]) {
          await telegram.sendPhoto(message.chat.id, product.image_file_ids[0], productCaption(product), planPurchaseKeyboard(product, plans));
        } else {
          await telegram.sendMessage(message.chat.id, productCaption(product), planPurchaseKeyboard(product, plans));
        }
      }
    }
    return;
  }
  // Reject the management button for normal customers with a direct explanation.
  if (update.message.text?.trim() === BUTTONS.adminPanel && !isAdmin) {
    await telegram.sendMessage(message.chat.id, "⛔️ این بخش فقط برای مدیر فروشگاه است.", shopMainKeyboard);
    return;
  }
  // Admin wizards and panel labels are evaluated before customer routes.
  if (isAdmin && await handleAdminMessage(context)) return;
  // Discount code text is a focused customer invoice state.
  if (await handleCustomerDiscountMessage(context)) return;
  // Route all remaining storefront messages.
  if (await handleCustomerMessage(context)) return;
  // Unknown input gives orientation without mutating state.
  await telegram.sendMessage(
    message.chat.id,
    `پیام دریافت شد، ${escapeHtml(from.first_name)}. لطفاً یکی از گزینه‌های منو را انتخاب کنید.`,
    shopMainKeyboard,
  );
}
