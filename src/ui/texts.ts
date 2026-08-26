// Centralized Persian copy reproduces the wording and emoji hierarchy in the video.

// Import formatting helpers so amounts and dates look consistent everywhere.
import { escapeHtml, formatPersianDateTime, formatToman } from "../lib/format";
// Import domain rows used by dynamic text builders.
import type { BuilderAccountRow, OrderRow, PlanRow, ProductRow, ShopBotRow, ShopStats, StoreUserRow } from "../types/domain";

// BUTTONS is the single source of truth for visible reply-keyboard text.
export const BUTTONS = {
  // Central builder navigation.
  buildStore: "ساخت ربات فروشگاه ➕",
  renew: "تمدید اشتراک 💎",
  myBots: "ربات‌های من 📂",
  builderAccount: "حساب کاربری 👤",
  builderSupport: "پشتیبانی 📞",
  forMyself: "برای خودم 👤",
  forCustomer: "برای مشتری 🤝",

  // Customer storefront navigation.
  products: "محصولات 🛍",
  searchProduct: "جستجوی محصول 🔍",
  customerAccount: "حساب کاربری 👤",
  trackOrder: "پیگیری سفارش 🔎",
  support: "پشتیبانی 📞",
  adminPanel: "پنل مدیریت 👨‍💼",
  increaseBalance: "افزایش موجودی 💳",
  cardToCard: "کارت به کارت 💳",
  zarinpal: "شارژ آنلاین (زرین پال) 💳",

  // Shared navigation and wizard actions.
  back: "بازگشت 🔙",
  finish: "پایان",
  none: "ندارد ❌",
  no: "خیر",
  doneContents: "ثبت و اتمام محتواها ✅",
  doneImages: "کافیه / ثبت ✅",

  // Main administration panel.
  finance: "بخش مالی 💰",
  productManagement: "مدیریت محصولات 📦",
  categoryManagement: "مدیریت دسته‌ها 📂",
  stats: "آمار ربات 📊",
  messageManagement: "مدیریت پیام‌ها 📬",
  userManagement: "مدیریت کاربران 👥",
  discounts: "کدهای تخفیف 🎟",
  generalManagement: "مدیریت عمومی ⚙️",
  backup: "دریافت بکاپ 📥",

  // Category management.
  addCategory: "افزودن دسته ➕",

  // Product management.
  addProduct: "افزودن محصول جدید ➕",
  editProduct: "ویرایش / حذف محصول ✏️",
  bulkPrice: "تغییر قیمت همگانی 📈",
  automaticDelivery: "تحویل خودکار 🤖",
  manualDelivery: "تحویل دستی 👨‍💼",
  allProducts: "همه محصولات 🌐",
  oneProduct: "یک محصول خاص 📦",
  oneCategory: "یک دسته‌بندی خاص 📂",
  increasePrice: "افزایش قیمت ⬆️",
  decreasePrice: "کاهش قیمت ⬇️",
  percent: "٪ درصدی",
  fixed: "مبلغ ثابت 💰",

  // Message management.
  directMessage: "پیام مستقیم ✉️",
  broadcastMessage: "پیام همگانی 📣",
  forwardBroadcast: "فوروارد همگانی 📣",

  // Discount management.
  addDiscount: "افزودن کد تخفیف ➕",
  listDiscounts: "لیست / حذف کدهای تخفیف 📜",

  // General management.
  setStartPhoto: "تنظیم عکس استارت 🖼",
  setStartText: "تنظیم متن استارت 📝",
  setSatisfactionChannel: "تنظیم کانال رضایت 📣",
  setForceChannel: "تنظیم کانال قفل 📣",
  setSupport: "تنظیم اکانت پشتیبانی 👤",
  setLogChannel: "تنظیم کانال گزارشات log",
  setSecondAdmin: "تنظیم ادمین دوم 👨‍💼",

  // Finance management.
  cardToggle: "کارت",
  zarinpalToggle: "زرین پال",
  setCardHolder: "نام دارنده 👤",
  setCardNumber: "شماره کارت 💳",
  setMerchant: "تغییر مرچنت کد 🔑",
} as const;

// Explain how a builder creates a BotFather token.
export const BOTFATHER_GUIDE = [
  "🤖 <b>راهنمای دریافت توکن و ساخت ربات:</b>",
  "",
  "1️⃣ وارد ربات @BotFather شوید و Start بزنید.",
  "2️⃣ دستور /newbot را بفرستید.",
  "3️⃣ یک نام فارسی بفرستید.",
  "4️⃣ یک یوزرنیم انگلیسی بفرستید (با کلمه bot در انتها).",
  "5️⃣ توکن دریافتی (مثلاً ABC:123...) را اینجا ارسال کنید.",
].join("\n");

// Describe the two creation modes shown before the token guide.
export const BUILD_AUDIENCE_TEXT = [
  "🤖 <b>این ربات را برای چه کسی می‌سازید؟</b>",
  "",
  "👤 <b>برای خودم:</b> راه‌اندازی رایگان + ۷ روز تست (سپس پرداخت اشتراک ماهانه)",
  "🤝 <b>برای مشتری:</b> هزینه راه‌اندازی + ۳۰ روز اشتراک اولیه (سپس تمدید اشتراک)",
].join("\n");

// Create the central builder account card.
export function builderAccountText(account: BuilderAccountRow, bots: ShopBotRow[]): string {
  // Find the nearest active/trial expiration date for a useful summary.
  const nearestExpiry = bots
    .map((bot) => bot.subscription_ends_at ?? bot.trial_ends_at)
    .sort()[0];
  // Render the reference bot's account fields.
  return [
    "👤 <b>حساب کاربری شما</b>",
    "",
    `🆔 شناسه کاربری: <code>${account.telegram_user_id}</code>`,
    `🤖 ربات‌های ساخته‌شده: <b>${bots.length}</b> عدد`,
    `💰 موجودی: <b>${formatToman(account.balance)}</b>`,
    nearestExpiry ? `💎 نزدیک‌ترین پایان اشتراک: ${formatPersianDateTime(nearestExpiry)}` : "💎 هنوز رباتی ساخته نشده است.",
  ].join("\n");
}

// Render the storefront user's account, referral, order, and transaction summary.
export function customerAccountText(
  shop: ShopBotRow,
  user: StoreUserRow,
  orders: OrderRow[],
  transactionLines: string[],
): string {
  // Build a deep link that attributes a new user's first purchase.
  const referralLink = `https://t.me/${shop.bot_username}?start=${user.telegram_user_id}`;
  // Convert recent orders to compact lines.
  const orderLines = orders.length > 0
    ? orders.map((order) => `• <code>${order.tracking_code}</code> — ${formatToman(order.total)}`)
    : ["-"];
  // Use a dash when no transaction exists.
  const transactions = transactionLines.length > 0 ? transactionLines : ["-"];
  // Compose the same visible hierarchy used in the reference recording.
  return [
    "👤 <b>اطلاعات حساب شما</b>",
    "",
    `💰 موجودی: <b>${formatToman(user.balance)}</b>`,
    "",
    "🔗 <b>لینک اختصاصی شما:</b>",
    `<code>${referralLink}</code>`,
    "",
    "🎁 <b>طرح درآمدزایی ویژه:</b>",
    "دوستت رو دعوت کن! 😍",
    `به ازای هر دوستی که با لینک بالا دعوت کنی و اولین خریدش را انجام بده، مبلغ <b>${formatToman(shop.settings.referral_reward)}</b> اعتبار رایگان هدیه می‌گیری.`,
    "",
    "🛒 <b>۵ سفارش آخر:</b>",
    ...orderLines,
    "",
    "💳 <b>۵ تراکنش آخر:</b>",
    ...transactions,
  ].join("\n");
}

// Render one product caption above its colored plan buttons.
export function productCaption(product: ProductRow): string {
  // Status follows the exact موجود/ناموجود visual cue.
  const status = product.is_active ? "✅ موجود" : "⛔️ ناموجود";
  // Avoid an empty description line while keeping the same layout.
  const description = product.description.trim() || "بدون توضیحات";
  // Escape owner-entered values because the message uses HTML parse mode.
  return [
    `📦 <b>${escapeHtml(product.name_fa)}</b>`,
    "",
    `📝 ${escapeHtml(description)}`,
    "",
    `📦 وضعیت: <b>${status}</b>`,
  ].join("\n");
}

// Render the invoice shown after a plan button is pressed.
export function invoiceText(product: ProductRow, plan: PlanRow, discountAmount = 0): string {
  // Calculate the final value without crossing below zero.
  const total = Math.max(0, plan.price - discountAmount);
  // Present product, plan, and amount as a compact purchase summary.
  return [
    "🧾 <b>فاکتور خرید</b>",
    "",
    `📦 محصول: ${escapeHtml(product.name_fa)}`,
    `📅 پلن: ${escapeHtml(plan.name)}`,
    `💰 قیمت: ${formatToman(plan.price)}`,
    ...(discountAmount > 0 ? [`🎟 تخفیف: ${formatToman(discountAmount)}`] : []),
    `✅ مبلغ نهایی: <b>${formatToman(total)}</b>`,
  ].join("\n");
}

// Render the management statistics screen.
export function statsText(stats: ShopStats): string {
  // Use the current Jalali date and Tehran time like the reference report.
  return [
    "📊 <b>آمار و گزارش عملکرد ربات</b>",
    "",
    "👥 <b>کاربران:</b>",
    `• کل کاربران: ${stats.totalUsers} نفر`,
    `• ورودی‌های این ماه: ${stats.usersThisMonth} نفر`,
    `• خریداران: ${stats.buyers} نفر`,
    "",
    "💰 <b>مالی و فروش:</b>",
    `• فروش کل محصولات: ${formatToman(stats.totalSales)}`,
    `• فروش همین ماه: ${formatToman(stats.salesThisMonth)}`,
    `• کل شارژ انجام‌شده: ${formatToman(stats.totalTopups)}`,
    "",
    `📅 تاریخ گزارش: ${formatPersianDateTime()}`,
  ].join("\n");
}

// Map internal order statuses to readable Persian labels.
export function orderStatusLabel(status: OrderRow["status"]): string {
  // A complete lookup avoids exposing internal English values.
  return {
    pending: "در انتظار پرداخت",
    paid: "پرداخت‌شده",
    delivering: "در حال تحویل",
    completed: "تکمیل‌شده",
    cancelled: "لغوشده",
    refunded: "بازپرداخت‌شده",
  }[status];
}
