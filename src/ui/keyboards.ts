// Keyboard builders encode the exact menu hierarchy extracted from the video.

// Import domain objects needed for dynamic catalogue and management buttons.
import type { CategoryRow, DiscountCodeRow, PlanRow, ProductRow, ShopSettings } from "../types/domain";
// Import Telegram reply and inline keyboard shapes.
import type { InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardButton } from "../types/telegram";
// Import every visible button label from one centralized object.
import { BUTTONS } from "./texts";
// formatToman produces readable plan prices.
import { formatToman } from "../lib/format";

// Create a styled reply keyboard while keeping the required Telegram fields fixed.
function replyKeyboard(
  rows: Array<Array<string | ReplyKeyboardButton>>,
  inputFieldPlaceholder?: string,
): ReplyKeyboardMarkup {
  // Return a persistent compact keyboard matching the native Telegram panel.
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: inputFieldPlaceholder,
  };
}

// Create an inline keyboard from callback rows.
function inlineKeyboard(rows: InlineKeyboardMarkup["inline_keyboard"]): InlineKeyboardMarkup {
  // Keep this helper small so each screen can declare only its semantic rows.
  return { inline_keyboard: rows };
}

// Main menu of the central bot-builder.
export const builderMainKeyboard = replyKeyboard([
  [{ text: BUTTONS.buildStore, style: "primary" }],
  [BUTTONS.renew, BUTTONS.myBots],
  [BUTTONS.builderSupport, BUTTONS.builderAccount],
]);

// Choose whether setup is for the owner or a paying customer.
export const buildAudienceKeyboard = replyKeyboard([
  [{ text: BUTTONS.forMyself, style: "primary" }, { text: BUTTONS.forCustomer, style: "primary" }],
  [BUTTONS.back],
]);

// Main customer-facing shop keyboard from the recording.
export const shopMainKeyboard = replyKeyboard([
  [BUTTONS.products, BUTTONS.searchProduct],
  [BUTTONS.customerAccount, BUTTONS.trackOrder],
  [BUTTONS.support],
  [BUTTONS.adminPanel],
]);

// Account screen exposes top-up and back actions.
export const accountKeyboard = replyKeyboard([[BUTTONS.increaseBalance], [BUTTONS.back]]);

// Build the available payment method buttons from shop settings.
export function paymentMethodKeyboard(settings: ShopSettings): ReplyKeyboardMarkup {
  // Add only methods the owner enabled.
  const methods: Array<string | ReplyKeyboardButton> = [];
  // Card-to-card remains a normal native Telegram button.
  if (settings.payment.card_enabled) methods.push({ text: BUTTONS.cardToCard, style: "primary" });
  // ZarinPal appears only after it is configured and enabled.
  if (settings.payment.zarinpal_enabled) methods.push({ text: BUTTONS.zarinpal, style: "primary" });
  // Always keep a way out of the wizard.
  return replyKeyboard([methods.length > 0 ? methods : [BUTTONS.back], [BUTTONS.back]]);
}

// Management panel is an exact two-column hierarchy followed by backup/back.
export const adminMainKeyboard = replyKeyboard([
  [BUTTONS.productManagement, BUTTONS.finance],
  [BUTTONS.stats, BUTTONS.categoryManagement],
  [BUTTONS.userManagement, BUTTONS.messageManagement],
  [BUTTONS.generalManagement, BUTTONS.discounts],
  [BUTTONS.backup, BUTTONS.back],
]);

// Category management starts with add/back while the list itself is inline.
export const categoryManagementKeyboard = replyKeyboard([[BUTTONS.addCategory, BUTTONS.back]]);

// Product management menu from the lower part of the recording.
export const productManagementKeyboard = replyKeyboard([
  [BUTTONS.addProduct],
  [BUTTONS.editProduct],
  [BUTTONS.bulkPrice],
  [BUTTONS.back],
]);

// Delivery selection controls whether purchased content is automatic or manual.
export const deliveryTypeKeyboard = replyKeyboard([
  [{ text: BUTTONS.automaticDelivery, style: "primary" }, { text: BUTTONS.manualDelivery, style: "primary" }],
  [BUTTONS.back],
]);

// Product-content collection ends through a dedicated button.
export const contentCollectionKeyboard = replyKeyboard([[{ text: BUTTONS.doneContents, style: "success" }], [BUTTONS.back]]);

// Product-image collection ends through a dedicated button.
export const imageCollectionKeyboard = replyKeyboard([[{ text: BUTTONS.doneImages, style: "success" }], [BUTTONS.back]]);

// English-name input supports the video's explicit "ندارد" shortcut.
export const optionalEnglishNameKeyboard = replyKeyboard([[BUTTONS.none], [BUTTONS.back]]);

// Manual-delivery required information supports the video's "خیر" shortcut.
export const optionalRequiredInfoKeyboard = replyKeyboard([[BUTTONS.no], [BUTTONS.back]]);

// Adding multiple price plans stops with the word پایان.
export const finishPlansKeyboard = replyKeyboard([[BUTTONS.finish], [BUTTONS.back]]);

// Message management mirrors direct, broadcast, and forwarding modes.
export const messageManagementKeyboard = replyKeyboard([
  [BUTTONS.broadcastMessage, BUTTONS.directMessage],
  [BUTTONS.forwardBroadcast, BUTTONS.back],
]);

// Discount management exposes add and list/delete actions.
export const discountManagementKeyboard = replyKeyboard([
  [BUTTONS.addDiscount],
  [BUTTONS.listDiscounts],
  [BUTTONS.back],
]);

// General management contains all configurable fields shown in the video.
export const generalManagementKeyboard = replyKeyboard([
  [BUTTONS.setStartText, BUTTONS.setStartPhoto],
  [BUTTONS.setForceChannel, BUTTONS.setSatisfactionChannel],
  [BUTTONS.setSupport, BUTTONS.setLogChannel],
  [BUTTONS.setSecondAdmin, BUTTONS.back],
]);

// Finance settings show method switches and their editable identifiers.
export function financeKeyboard(settings: ShopSettings): ReplyKeyboardMarkup {
  // Render the current on/off state directly in the labels.
  const card = `${BUTTONS.cardToggle}: ${settings.payment.card_enabled ? "روشن ✅" : "خاموش ❌"}`;
  // Render the current ZarinPal state in the same format.
  const zarinpal = `${BUTTONS.zarinpalToggle}: ${settings.payment.zarinpal_enabled ? "روشن ✅" : "خاموش ❌"}`;
  // Return the full management keyboard.
  return replyKeyboard([
    [card, zarinpal],
    [BUTTONS.setCardNumber, BUTTONS.setCardHolder],
    [BUTTONS.setMerchant],
    [BUTTONS.back],
  ]);
}

// Bulk price change first selects a catalogue scope.
export const bulkScopeKeyboard = replyKeyboard([
  [BUTTONS.allProducts],
  [BUTTONS.oneProduct, BUTTONS.oneCategory],
  [BUTTONS.back],
]);

// Bulk price change selects increase or decrease.
export const bulkDirectionKeyboard = replyKeyboard([
  [{ text: BUTTONS.increasePrice, style: "success" }, { text: BUTTONS.decreasePrice, style: "danger" }],
  [BUTTONS.back],
]);

// Bulk price change selects percentage or fixed Toman amount.
export const bulkAmountTypeKeyboard = replyKeyboard([
  [{ text: BUTTONS.percent, style: "primary" }, { text: BUTTONS.fixed, style: "primary" }],
  [BUTTONS.back],
]);

// Render catalogue categories as blue inline buttons.
export function categoryCatalogueKeyboard(categories: CategoryRow[]): InlineKeyboardMarkup {
  // One category per row remains readable on narrow phones.
  return inlineKeyboard([
    ...categories.map((category) => [{ text: category.name, callback_data: `cat:${category.id}`, style: "primary" as const }]),
    [{ text: BUTTONS.back, callback_data: "nav:main", style: "danger" }],
  ]);
}

// Render category management rows with edit and delete actions.
export function categoryAdminKeyboard(categories: CategoryRow[]): InlineKeyboardMarkup {
  // Every category receives its own rename and delete controls.
  return inlineKeyboard([
    ...categories.map((category) => [
      { text: `✏️ ${category.name}`, callback_data: `admin:category:rename:${category.id}` },
      { text: "حذف 🗑", callback_data: `admin:category:delete:${category.id}`, style: "danger" as const },
    ]),
  ]);
}

// Render product choices for management or bulk-price selection.
export function productSelectionKeyboard(products: ProductRow[], action: "edit" | "bulk"): InlineKeyboardMarkup {
  // Include product status in the management list.
  return inlineKeyboard(products.map((product) => [{
    text: `${product.is_active ? "✅" : "❌"} ${product.name_fa}`,
    callback_data: `admin:product:${action}:${product.id}`,
    style: product.is_active ? "success" : "danger",
  }]));
}

// Render category choices for product setup and bulk changes.
export function categorySelectionKeyboard(categories: CategoryRow[], callbackPrefix: string): InlineKeyboardMarkup {
  // callbackPrefix lets one visual component serve multiple wizards safely.
  return inlineKeyboard(categories.map((category) => [{
    text: category.name,
    callback_data: `${callbackPrefix}:${category.id}`,
    style: "primary",
  }]));
}

// Render green purchasable plan buttons under one product.
export function planPurchaseKeyboard(product: ProductRow, plans: PlanRow[]): InlineKeyboardMarkup {
  // One plan per row reproduces the wide green product buttons in the video.
  return inlineKeyboard([
    ...plans.map((plan) => [{
      text: `${plan.name} - ${formatToman(plan.price)}`,
      callback_data: `buy:${plan.id}`,
      style: "success" as const,
    }]),
    [{ text: BUTTONS.back, callback_data: product.category_id ? `cat:${product.category_id}` : "nav:products", style: "danger" }],
  ]);
}

// Render invoice actions: discount, checkout, and back.
export function invoiceKeyboard(planId: string): InlineKeyboardMarkup {
  // Callback data stays well below Telegram's 64-byte limit.
  return inlineKeyboard([
    [{ text: "ثبت کد تخفیف 🎟", callback_data: `discount:${planId}` }],
    [{ text: "تأیید و پرداخت نهایی ✅", callback_data: `checkout:${planId}`, style: "success" }],
    [{ text: BUTTONS.back, callback_data: `planback:${planId}`, style: "danger" }],
  ]);
}

// Render discount rows with one destructive delete button each.
export function discountListKeyboard(discounts: DiscountCodeRow[]): InlineKeyboardMarkup {
  // Include remaining usage count in the visible label.
  return inlineKeyboard(discounts.map((discount) => [{
    text: `🗑 ${discount.code} (${discount.used_count}/${discount.max_uses})`,
    callback_data: `admin:discount:delete:${discount.id}`,
    style: "danger",
  }]));
}

// Render the complete edit panel for one product.
export function productEditKeyboard(product: ProductRow): InlineKeyboardMarkup {
  // Use a short local alias so callback strings stay readable.
  const id = product.id;
  // Build the same hierarchy displayed at the end of the reference video.
  return inlineKeyboard([
    [{
      text: `وضعیت: ${product.is_active ? "✅ موجود" : "⛔️ ناموجود"}`,
      callback_data: `admin:product:toggle:${id}`,
      style: product.is_active ? "success" : "danger",
    }],
    [{ text: "لیست/ویرایش پلن‌ها 📋", callback_data: `admin:product:plans:${id}` }],
    [
      { text: "نام انگلیسی ✏️", callback_data: `admin:product:field:name_en:${id}` },
      { text: "نام فارسی ✏️", callback_data: `admin:product:field:name_fa:${id}` },
    ],
    [
      { text: "عکس 🖼", callback_data: `admin:product:field:images:${id}` },
      { text: "توضیحات 📝", callback_data: `admin:product:field:description:${id}` },
    ],
    [{ text: "تغییر دسته‌بندی 📁", callback_data: `admin:product:field:category:${id}` }],
    [{ text: "ویرایش فایل خودکار 🤖", callback_data: `admin:product:field:content:${id}` }],
    [{ text: "افزودن پلن ➕", callback_data: `admin:product:addplan:${id}` }],
    [{ text: "حذف محصول 🗑", callback_data: `admin:product:delete:${id}`, style: "danger" }],
    [{ text: "بازگشت به لیست", callback_data: "admin:product:list" }],
  ]);
}

// Render plan editing buttons for one product.
export function planAdminKeyboard(plans: PlanRow[]): InlineKeyboardMarkup {
  // Each plan opens a focused plan editor.
  return inlineKeyboard(plans.map((plan) => [{
    text: `${plan.is_active ? "✅" : "❌"} ${plan.name} - ${formatToman(plan.price)}`,
    callback_data: `admin:plan:open:${plan.id}`,
    style: plan.is_active ? "success" : "danger",
  }]));
}

// Render actions for one selected plan.
export function planEditKeyboard(plan: PlanRow): InlineKeyboardMarkup {
  // Provide status, price, name, and delete actions shown by the product editor.
  return inlineKeyboard([
    [{
      text: `وضعیت: ${plan.is_active ? "✅ فعال" : "❌ غیرفعال"}`,
      callback_data: `admin:plan:toggle:${plan.id}`,
      style: plan.is_active ? "success" : "danger",
    }],
    [
      { text: "تغییر قیمت 💰", callback_data: `admin:plan:price:${plan.id}` },
      { text: "تغییر نام ✏️", callback_data: `admin:plan:name:${plan.id}` },
    ],
    [{ text: "حذف این پلن 🗑", callback_data: `admin:plan:delete:${plan.id}`, style: "danger" }],
    [{ text: "بازگشت", callback_data: `admin:product:plans:${plan.product_id}` }],
  ]);
}
