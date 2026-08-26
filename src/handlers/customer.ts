// Customer storefront handlers reproduce catalogue, wallet, order, and support flows.

// Import shared request-scoped contexts.
import type { StoreCallbackContext, StoreMessageContext } from "./context";
// Import domain rows needed by visual helpers.
import type { ConversationSessionRow, ProductRow } from "../types/domain";
// Import validation, media, and presentation helpers.
import {
  escapeHtml,
  formatPersianDateTime,
  formatToman,
  largestPhotoFileId,
  normalizeDigits,
  parsePositiveInteger,
} from "../lib/format";
// Import exact reference-flow copy.
import { BUTTONS, customerAccountText, invoiceText, orderStatusLabel, productCaption } from "../ui/texts";
// Import reusable native Telegram keyboards.
import {
  accountKeyboard,
  categoryCatalogueKeyboard,
  invoiceKeyboard,
  paymentMethodKeyboard,
  planPurchaseKeyboard,
  shopMainKeyboard,
} from "../ui/keyboards";
// Import the inline keyboard shape for small customer-specific actions.
import type { InlineKeyboardMarkup } from "../types/telegram";

// Read a string from JSON session data without unsafe assertions.
function sessionString(session: ConversationSessionRow | null, key: string): string | null {
  // JSON values can be nested, so validate the primitive at runtime.
  const value = session?.data[key];
  // Only strings are accepted for identifiers, codes, and modes.
  return typeof value === "string" ? value : null;
}

// Read a number from JSON session data.
function sessionNumber(session: ConversationSessionRow | null, key: string): number | null {
  // Retrieve the unknown JSON value.
  const value = session?.data[key];
  // Reject strings to keep numeric state unambiguous.
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

// Persist a customer wizard step with the common tenant/user fields.
async function setCustomerSession(
  context: StoreMessageContext | StoreCallbackContext,
  step: string,
  data: ConversationSessionRow["data"] = {},
): Promise<void> {
  // Upsert the complete namespaced session.
  await context.db.setSession({
    session_key: context.sessionKey,
    scope: "store",
    shop_id: context.shop.id,
    telegram_user_id: context.user.telegram_user_id,
    step,
    data,
  });
}

// Send one product card with its active purchase plans.
async function sendProductCard(context: StoreMessageContext | StoreCallbackContext, chatId: number, product: ProductRow): Promise<void> {
  // Load the product's active plan buttons.
  const plans = await context.db.listPlans(product.id, true);
  // Create a shared card keyboard even when the plan list is empty.
  const keyboard = planPurchaseKeyboard(product, plans);
  // Prefer the first uploaded product photo like the reference video.
  const photo = product.image_file_ids[0];
  // Send either a media card or a text-only fallback.
  if (photo) {
    await context.telegram.sendPhoto(chatId, photo, productCaption(product), keyboard);
  } else {
    await context.telegram.sendMessage(chatId, productCaption(product), keyboard);
  }
}

// Render all products from one category/search result without flooding unbounded chats.
async function sendProductList(
  context: StoreMessageContext | StoreCallbackContext,
  chatId: number,
  products: ProductRow[],
): Promise<void> {
  // Explain an empty result clearly.
  if (products.length === 0) {
    await context.telegram.sendMessage(chatId, "محصولی پیدا نشد.", shopMainKeyboard);
    return;
  }
  // Send cards sequentially to preserve catalogue order.
  for (const product of products.slice(0, 20)) await sendProductCard(context, chatId, product);
}

// Send the configured start presentation and main keyboard.
export async function showShopHome(context: StoreMessageContext | StoreCallbackContext, chatId: number): Promise<void> {
  // A configured Telegram file_id reproduces the owner's start artwork.
  if (context.shop.settings.start_photo_file_id) {
    await context.telegram.sendPhoto(
      chatId,
      context.shop.settings.start_photo_file_id,
      context.shop.settings.start_text,
      shopMainKeyboard,
    );
    return;
  }
  // Text-only shops still receive the same persistent navigation.
  await context.telegram.sendMessage(chatId, context.shop.settings.start_text, shopMainKeyboard);
}

// Handle a customer message; return true when this module consumed it.
export async function handleCustomerMessage(context: StoreMessageContext): Promise<boolean> {
  // Normalize optional message text for reply-keyboard comparisons.
  const text = context.message.text?.trim() ?? "";
  // Keep a short local chat alias.
  const chatId = context.message.chat.id;

  // Back cancels any customer wizard and returns home.
  if (text === BUTTONS.back) {
    await context.db.clearSession(context.sessionKey);
    await showShopHome(context, chatId);
    return true;
  }

  // Display catalogue categories as inline blue buttons.
  if (text === BUTTONS.products) {
    await context.db.clearSession(context.sessionKey);
    const categories = await context.db.listCategories(context.shop.id);
    if (categories.length === 0) {
      // A new shop has no products until its owner configures them.
      await context.telegram.sendMessage(chatId, "هنوز دسته‌بندی یا محصولی ثبت نشده است.", shopMainKeyboard);
    } else {
      // Attach the dynamic category selector.
      await context.telegram.sendMessage(chatId, "📂 <b>دسته‌بندی موردنظر را انتخاب کنید:</b>", categoryCatalogueKeyboard(categories));
    }
    return true;
  }

  // Start a product-name search wizard.
  if (text === BUTTONS.searchProduct) {
    await setCustomerSession(context, "customer_search");
    await context.telegram.sendMessage(chatId, "🔍 نام فارسی یا انگلیسی محصول را ارسال کنید:", { keyboard: [[BUTTONS.back]], resize_keyboard: true, is_persistent: true });
    return true;
  }

  // Search the active tenant catalogue.
  if (context.session?.step === "customer_search") {
    if (!text) {
      await context.telegram.sendMessage(chatId, "لطفاً نام محصول را به‌صورت متن بفرستید.");
      return true;
    }
    const products = await context.db.searchProducts(context.shop.id, text);
    await context.db.clearSession(context.sessionKey);
    await sendProductList(context, chatId, products);
    return true;
  }

  // Render balance, referral link, recent orders, and ledger entries.
  if (text === BUTTONS.customerAccount) {
    await context.db.clearSession(context.sessionKey);
    const [orders, transactions] = await Promise.all([
      context.db.listRecentOrders(context.user.id),
      context.db.listRecentTransactions(context.user.id),
    ]);
    const transactionLines = transactions.map((transaction) => {
      // Prefix credits with + while debits already include a minus sign.
      const sign = transaction.amount > 0 ? "+" : "";
      // Fall back to a generic description for old imported rows.
      const description = escapeHtml(transaction.description ?? "تراکنش کیف پول");
      // Keep each ledger line compact on mobile.
      return `• ${description}: <b>${sign}${formatToman(transaction.amount)}</b>`;
    });
    await context.telegram.sendMessage(
      chatId,
      customerAccountText(context.shop, context.user, orders, transactionLines),
      accountKeyboard,
    );
    return true;
  }

  // Start wallet top-up by choosing one enabled method.
  if (text === BUTTONS.increaseBalance) {
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "💳 روش افزایش موجودی را انتخاب کنید:", paymentMethodKeyboard(context.shop.settings));
    return true;
  }

  // Card-to-card begins by collecting a positive Toman amount.
  if (text === BUTTONS.cardToCard && context.shop.settings.payment.card_enabled) {
    await setCustomerSession(context, "customer_topup_amount", { method: "card" });
    await context.telegram.sendMessage(chatId, "💰 مبلغ موردنظر را به تومان و فقط با عدد ارسال کنید:");
    return true;
  }

  // ZarinPal uses the same amount validation before creating a hosted payment link.
  if (text === BUTTONS.zarinpal && context.shop.settings.payment.zarinpal_enabled) {
    await setCustomerSession(context, "customer_topup_amount", { method: "zarinpal" });
    await context.telegram.sendMessage(chatId, "💰 مبلغ شارژ آنلاین را به تومان و فقط با عدد ارسال کنید:");
    return true;
  }

  // Validate and create either kind of top-up request.
  if (context.session?.step === "customer_topup_amount") {
    const amount = parsePositiveInteger(text);
    const method = sessionString(context.session, "method");
    if (!amount || (method !== "card" && method !== "zarinpal")) {
      await context.telegram.sendMessage(chatId, "❌ مبلغ معتبر نیست؛ فقط یک عدد بزرگ‌تر از صفر بفرستید.");
      return true;
    }
    if (method === "card") {
      // Card details must exist before a receipt can be requested.
      const cardNumber = context.shop.settings.payment.card_number;
      const cardHolder = context.shop.settings.payment.card_holder;
      if (!cardNumber || !cardHolder) {
        await context.db.clearSession(context.sessionKey);
        await context.telegram.sendMessage(chatId, "❌ اطلاعات کارت هنوز توسط مدیر فروشگاه تکمیل نشده است.", shopMainKeyboard);
        return true;
      }
      // Create the database request only after payment instructions are complete.
      const topup = await context.db.createTopup(context.shop.id, context.user.id, amount, method);
      // Persist the request id while waiting for a photo/document receipt.
      await setCustomerSession(context, "customer_topup_receipt", {
        topup_id: topup.id,
        amount,
        transaction_code: topup.transaction_code,
      });
      // Show copyable card data and exact receipt instructions.
      const keyboard: InlineKeyboardMarkup = {
        inline_keyboard: [[{ text: "کپی شماره کارت 📋", copy_text: { text: cardNumber } }]],
      };
      await context.telegram.sendMessage(
        chatId,
        [
          "💳 <b>پرداخت کارت‌به‌کارت</b>",
          "",
          `💰 مبلغ: <b>${formatToman(amount)}</b>`,
          `💳 شماره کارت: <code>${escapeHtml(cardNumber)}</code>`,
          `👤 به نام: ${escapeHtml(cardHolder)}`,
          `🔖 کد تراکنش: <code>${topup.transaction_code}</code>`,
          "",
          "پس از واریز، تصویر یا فایل رسید را همین‌جا ارسال کنید.",
        ].join("\n"),
        keyboard,
      );
      return true;
    }
    // Create the online request after amount/method validation.
    const topup = await context.db.createTopup(context.shop.id, context.user.id, amount, method);
    // Online payment is opened on a Worker endpoint that requests a ZarinPal authority.
    await context.db.clearSession(context.sessionKey);
    const paymentUrl = `${context.publicBaseUrl.replace(/\/$/, "")}/pay/zarinpal/${context.shop.webhook_key}/${topup.id}`;
    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [[{ text: "ورود به درگاه زرین‌پال 💳", url: paymentUrl, style: "success" }]],
    };
    await context.telegram.sendMessage(
      chatId,
      `✅ درخواست شارژ <b>${formatToman(amount)}</b> ساخته شد.\n🔖 کد: <code>${topup.transaction_code}</code>`,
      keyboard,
    );
    return true;
  }

  // Attach and forward a card receipt for owner review.
  if (context.session?.step === "customer_topup_receipt") {
    const receiptFileId = largestPhotoFileId(context.message) ?? context.message.document?.file_id ?? null;
    const topupId = sessionString(context.session, "topup_id");
    const amount = sessionNumber(context.session, "amount");
    const transactionCode = sessionString(context.session, "transaction_code");
    if (!receiptFileId || !topupId || !amount || !transactionCode) {
      await context.telegram.sendMessage(chatId, "❌ لطفاً رسید را به‌صورت عکس یا فایل ارسال کنید.");
      return true;
    }
    // Move the request into pending_review.
    await context.db.attachTopupReceipt(context.shop.id, topupId, receiptFileId);
    // Build idempotent owner review callbacks.
    const reviewKeyboard: InlineKeyboardMarkup = {
      inline_keyboard: [[
        { text: "تأیید ✅", callback_data: `topup:a:${topupId}`, style: "success" },
        { text: "رد ❌", callback_data: `topup:r:${topupId}`, style: "danger" },
      ]],
    };
    // Explain exactly which wallet the receipt belongs to.
    const caption = [
      "💳 <b>رسید شارژ جدید</b>",
      `👤 کاربر: <code>${context.user.telegram_user_id}</code>`,
      `💰 مبلغ: <b>${formatToman(amount)}</b>`,
      `🔖 کد: <code>${transactionCode}</code>`,
    ].join("\n");
    // Photos preserve the compact visual review card.
    if (largestPhotoFileId(context.message)) {
      await context.telegram.sendPhoto(context.shop.owner_telegram_id, receiptFileId, caption, reviewKeyboard);
    } else {
      // Documents use the generic method so reply_markup can be attached.
      await context.telegram.call("sendDocument", {
        chat_id: context.shop.owner_telegram_id,
        document: receiptFileId,
        caption,
        parse_mode: "HTML",
        reply_markup: reviewKeyboard,
      });
    }
    // Finish the receipt wizard.
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "✅ رسید ثبت شد و پس از بررسی مدیر، موجودی شما افزایش پیدا می‌کند.", shopMainKeyboard);
    return true;
  }

  // Start an order tracking lookup.
  if (text === BUTTONS.trackOrder) {
    await setCustomerSession(context, "customer_track_order");
    await context.telegram.sendMessage(chatId, "🔎 کد پیگیری سفارش را ارسال کنید:");
    return true;
  }

  // Resolve a tenant order by tracking code.
  if (context.session?.step === "customer_track_order") {
    const order = await context.db.findOrder(context.shop.id, normalizeDigits(text));
    await context.db.clearSession(context.sessionKey);
    if (!order || order.user_id !== context.user.id) {
      await context.telegram.sendMessage(chatId, "❌ سفارشی با این کد برای حساب شما پیدا نشد.", shopMainKeyboard);
    } else {
      await context.telegram.sendMessage(
        chatId,
        [
          "📦 <b>وضعیت سفارش</b>",
          `🔖 کد: <code>${order.tracking_code}</code>`,
          `📌 وضعیت: ${orderStatusLabel(order.status)}`,
          `💰 مبلغ: ${formatToman(order.total)}`,
          `📅 تاریخ: ${formatPersianDateTime(order.created_at)}`,
        ].join("\n"),
        shopMainKeyboard,
      );
    }
    return true;
  }

  // Start a one-message support ticket.
  if (text === BUTTONS.support) {
    await setCustomerSession(context, "customer_support");
    await context.telegram.sendMessage(chatId, "📞 پیام یا فایل خود را برای پشتیبانی ارسال کنید:");
    return true;
  }

  // Forward support content to the configured destination.
  if (context.session?.step === "customer_support") {
    const supportChat = context.shop.settings.support_chat_id;
    if (!supportChat) {
      await context.db.clearSession(context.sessionKey);
      const username = context.shop.settings.support_username;
      const destination = username ? `@${escapeHtml(username.replace(/^@/, ""))}` : "هنوز توسط مدیر تنظیم نشده است";
      await context.telegram.sendMessage(chatId, `اکانت پشتیبانی: ${destination}`, shopMainKeyboard);
      return true;
    }
    // Store the ticket before forwarding its Telegram message.
    await context.db.createSupportMessage(context.shop.id, context.user.id, context.message.message_id);
    // Send a metadata header so the owner can use direct messaging by Telegram id.
    await context.telegram.sendMessage(
      supportChat,
      `📨 پیام پشتیبانی از کاربر <code>${context.user.telegram_user_id}</code>\nنام: ${escapeHtml(context.user.first_name)}`,
    );
    // Preserve the original content and source attribution.
    await context.telegram.forwardMessage(supportChat, chatId, context.message.message_id);
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "✅ پیام شما برای پشتیبانی ارسال شد.", shopMainKeyboard);
    return true;
  }

  // Collect requested information after a manual-delivery purchase.
  if (context.session?.step === "customer_manual_info") {
    const orderId = sessionString(context.session, "order_id");
    const trackingCode = sessionString(context.session, "tracking_code");
    if (!orderId || !text) {
      await context.telegram.sendMessage(chatId, "لطفاً اطلاعات خواسته‌شده را به‌صورت متن ارسال کنید.");
      return true;
    }
    await context.db.updateOrderCustomerInfo(context.shop.id, orderId, text);
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(
      chatId,
      `✅ اطلاعات سفارش ثبت شد.\n🔖 کد پیگیری: <code>${trackingCode ?? "-"}</code>\nمدیر فروشگاه سفارش را تحویل خواهد داد.`,
      shopMainKeyboard,
    );
    // Notify the primary owner with the user's supplied fulfillment data.
    await context.telegram.sendMessage(
      context.shop.owner_telegram_id,
      `🛒 <b>سفارش دستی جدید</b>\n🔖 <code>${trackingCode ?? "-"}</code>\n👤 <code>${context.user.telegram_user_id}</code>\n📝 ${escapeHtml(text)}`,
    );
    return true;
  }

  // No customer route matched this message.
  return false;
}

// Handle one customer inline-button callback.
export async function handleCustomerCallback(context: StoreCallbackContext): Promise<boolean> {
  // Keep callback parsing local and explicit.
  const data = context.callbackData;
  // Main navigation resets abandoned invoice/discount state.
  if (data === "nav:main") {
    await context.db.clearSession(context.sessionKey);
    await showShopHome(context, context.chatId);
    return true;
  }
  // Return to the category catalogue.
  if (data === "nav:products") {
    const categories = await context.db.listCategories(context.shop.id);
    await context.telegram.sendMessage(context.chatId, "📂 دسته‌بندی موردنظر را انتخاب کنید:", categoryCatalogueKeyboard(categories));
    return true;
  }
  // Open all active products in one selected category.
  if (data.startsWith("cat:")) {
    const categoryId = data.slice("cat:".length);
    const products = await context.db.listProducts(context.shop.id, categoryId, true);
    await sendProductList(context, context.chatId, products);
    return true;
  }
  // Reopen a product card from invoice back navigation.
  if (data.startsWith("planback:")) {
    const planId = data.slice("planback:".length);
    const resolved = await context.db.getPlanForShop(context.shop.id, planId);
    if (resolved) await sendProductCard(context, context.chatId, resolved.product);
    return true;
  }
  // Create an invoice preview after selecting a plan.
  if (data.startsWith("buy:")) {
    const planId = data.slice("buy:".length);
    const resolved = await context.db.getPlanForShop(context.shop.id, planId);
    if (!resolved || !resolved.product.is_active || !resolved.plan.is_active) {
      await context.telegram.sendMessage(context.chatId, "❌ این پلن در حال حاضر قابل خرید نیست.");
      return true;
    }
    await setCustomerSession(context, "customer_invoice", { plan_id: planId });
    await context.telegram.sendMessage(context.chatId, invoiceText(resolved.product, resolved.plan), invoiceKeyboard(planId));
    return true;
  }
  // Ask for an optional discount code tied to the current plan.
  if (data.startsWith("discount:")) {
    const planId = data.slice("discount:".length);
    if (!(await context.db.getPlanForShop(context.shop.id, planId))) return true;
    await setCustomerSession(context, "customer_discount", { plan_id: planId });
    await context.telegram.sendMessage(context.chatId, "🎟 کد تخفیف را ارسال کنید:");
    return true;
  }
  // Perform the database-atomic wallet debit and order creation.
  if (data.startsWith("checkout:")) {
    const planId = data.slice("checkout:".length);
    const savedPlanId = sessionString(context.session, "plan_id");
    // Discount state is applied only to the same invoice plan.
    const discountCode = savedPlanId === planId ? sessionString(context.session, "discount_code") : null;
    const result = await context.db.checkout(context.shop.id, context.user.telegram_user_id, planId, discountCode);
    if (!result.ok) {
      // Give a specific recovery path for the two customer-correctable failures.
      if (result.reason === "insufficient_balance") {
        await context.telegram.sendMessage(
          context.chatId,
          `❌ موجودی کافی نیست.\n💰 کسری: <b>${formatToman(result.shortfall ?? 0)}</b>`,
          accountKeyboard,
        );
      } else if (result.reason === "discount_invalid") {
        await context.telegram.sendMessage(context.chatId, "❌ کد تخفیف نامعتبر، منقضی یا تمام‌شده است.");
      } else {
        await context.telegram.sendMessage(context.chatId, "❌ محصول یا پلن دیگر قابل خرید نیست.");
      }
      return true;
    }
    // Clear invoice state after one successful atomic checkout.
    await context.db.clearSession(context.sessionKey);
    // Confirm payment before fulfillment.
    await context.telegram.sendMessage(
      context.chatId,
      `✅ <b>خرید با موفقیت انجام شد.</b>\n🔖 کد پیگیری: <code>${result.tracking_code}</code>\n💰 موجودی جدید: ${formatToman(result.balance_after ?? 0)}`,
    );
    // Automatic products deliver each stored Telegram content item in order.
    if (result.delivery_type === "automatic" && result.order_id) {
      for (const content of result.automatic_contents ?? []) {
        await context.telegram.sendAutomaticContent(context.chatId, content);
      }
      // Mark completion only after every required send has succeeded.
      await context.db.completeOrder(context.shop.id, result.order_id);
      await context.telegram.sendMessage(context.chatId, "✅ تمام محتوای محصول تحویل داده شد.", shopMainKeyboard);
    } else if (result.order_id) {
      // Manual products collect exactly the owner-defined information.
      await setCustomerSession(context, "customer_manual_info", {
        order_id: result.order_id,
        tracking_code: result.tracking_code ?? "",
      });
      await context.telegram.sendMessage(
        context.chatId,
        `📝 برای تحویل سفارش، اطلاعات زیر را ارسال کنید:\n\n${escapeHtml(result.required_customer_info ?? "اطلاعات لازم برای تحویل")}`,
      );
    }
    // Send a best-effort sale report to the configured log channel.
    if (context.shop.settings.log_channel_id) {
      await context.telegram.sendMessage(
        context.shop.settings.log_channel_id,
        `🛒 <b>خرید جدید</b>\n🔖 <code>${result.tracking_code}</code>\n👤 <code>${context.user.telegram_user_id}</code>\n📦 ${escapeHtml(result.product_name ?? "-")} — ${escapeHtml(result.plan_name ?? "-")}\n💰 ${formatToman(result.total ?? 0)}`,
      );
    }
    return true;
  }
  // No customer callback route matched.
  return false;
}

// Handle a discount code text after its inline prompt.
export async function handleCustomerDiscountMessage(context: StoreMessageContext): Promise<boolean> {
  // Only the dedicated session belongs here.
  if (context.session?.step !== "customer_discount") return false;
  // Require a plain text code.
  const code = context.message.text?.trim() ?? "";
  // Recover the invoice plan selected before the prompt.
  const planId = sessionString(context.session, "plan_id");
  // Reject incomplete state without charging anything.
  if (!code || !planId) {
    await context.telegram.sendMessage(context.message.chat.id, "❌ کد تخفیف را به‌صورت متن ارسال کنید.");
    return true;
  }
  // Resolve both the plan and a currently valid preview code.
  const [resolved, discount] = await Promise.all([
    context.db.getPlanForShop(context.shop.id, planId),
    context.db.getValidDiscount(context.shop.id, code),
  ]);
  // Missing records return the user to code input.
  if (!resolved || !discount) {
    await context.telegram.sendMessage(context.message.chat.id, "❌ کد تخفیف نامعتبر یا تمام‌شده است؛ دوباره تلاش کنید.");
    return true;
  }
  // Save the code for the atomic checkout RPC, which validates it again under lock.
  await setCustomerSession(context, "customer_invoice", { plan_id: planId, discount_code: code });
  // Cap the visible amount at the plan price.
  const discountAmount = Math.min(discount.amount, resolved.plan.price);
  // Re-render the invoice with the discount line.
  await context.telegram.sendMessage(
    context.message.chat.id,
    invoiceText(resolved.product, resolved.plan, discountAmount),
    invoiceKeyboard(planId),
  );
  return true;
}
