// Administrator handlers implement the complete in-chat management panel.

// Import shared message and callback contexts.
import type { StoreCallbackContext, StoreMessageContext } from "./context";
// Import persisted wizard and product-content shapes.
import type { AutomaticContent, ConversationSessionRow, JsonValue, ProductRow } from "../types/domain";
// Import file extraction, validation, formatting, and channel helpers.
import {
  channelUrl,
  escapeHtml,
  extractAutomaticContent,
  formatPersianDateTime,
  formatToman,
  largestPhotoFileId,
  normalizeChatReference,
  parsePositiveInteger,
} from "../lib/format";
// Build a restorable tenant-only SQL export.
import { createSqlBackup } from "../lib/backup";
// Import exact visible button labels and report rendering.
import { BUTTONS, productCaption, statsText } from "../ui/texts";
// Import every management keyboard used by the reference hierarchy.
import {
  adminMainKeyboard,
  bulkAmountTypeKeyboard,
  bulkDirectionKeyboard,
  bulkScopeKeyboard,
  categoryAdminKeyboard,
  categoryManagementKeyboard,
  categorySelectionKeyboard,
  contentCollectionKeyboard,
  deliveryTypeKeyboard,
  discountListKeyboard,
  discountManagementKeyboard,
  financeKeyboard,
  finishPlansKeyboard,
  generalManagementKeyboard,
  imageCollectionKeyboard,
  messageManagementKeyboard,
  optionalEnglishNameKeyboard,
  optionalRequiredInfoKeyboard,
  planAdminKeyboard,
  planEditKeyboard,
  productEditKeyboard,
  productManagementKeyboard,
  productSelectionKeyboard,
  shopMainKeyboard,
} from "../ui/keyboards";

// Read one string from a JSON session value.
function dataString(session: ConversationSessionRow | null, key: string): string | null {
  // Retrieve the stored JSON value.
  const value = session?.data[key];
  // Accept only a real string.
  return typeof value === "string" ? value : null;
}

// Read one number from a JSON session value.
function dataNumber(session: ConversationSessionRow | null, key: string): number | null {
  // Retrieve the stored JSON value.
  const value = session?.data[key];
  // Accept only a safe integer.
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

// Read an array of plain strings from JSON session data.
function dataStrings(session: ConversationSessionRow | null, key: string): string[] {
  // Retrieve the possible array.
  const value = session?.data[key];
  // Filter unexpected members rather than trusting an assertion.
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// Read automatic-delivery objects from JSON session data.
function dataContents(session: ConversationSessionRow | null): AutomaticContent[] {
  // Retrieve the possible content array.
  const value = session?.data.automatic_contents;
  // An absent or non-array value represents no content yet.
  if (!Array.isArray(value)) return [];
  // Reconstruct typed content objects instead of asserting arbitrary JSON.
  return value.flatMap((item): AutomaticContent[] => {
    // JSON primitives cannot be content objects.
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    // Read the discriminating kind through the JSON object type.
    const kind = item.kind;
    // Reject kinds unsupported by TelegramClient.
    if (typeof kind !== "string" || !["text", "photo", "document", "video", "audio", "voice"].includes(kind)) return [];
    // Copy only known optional string fields.
    return [{
      kind: kind as AutomaticContent["kind"],
      ...(typeof item.text === "string" ? { text: item.text } : {}),
      ...(typeof item.file_id === "string" ? { file_id: item.file_id } : {}),
      ...(typeof item.caption === "string" ? { caption: item.caption } : {}),
      ...(typeof item.file_name === "string" ? { file_name: item.file_name } : {}),
    }];
  });
}

// Read `{name, price}` plan drafts from JSON session data.
function dataPlans(session: ConversationSessionRow | null): Array<{ name: string; price: number }> {
  // Retrieve the possible array.
  const value = session?.data.plans;
  // Reject a missing or malformed top-level value.
  if (!Array.isArray(value)) return [];
  // Validate both properties of every plan object.
  return value.flatMap((item) => {
    // Reject null, primitives, and arrays.
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    // Pull JSON object fields.
    const name = item.name;
    // Pull the numeric amount field.
    const price = item.price;
    // Keep only valid plan drafts.
    return typeof name === "string" && typeof price === "number" ? [{ name, price }] : [];
  });
}

// Persist an administrator wizard step with common tenant metadata.
async function setAdminSession(
  context: StoreMessageContext | StoreCallbackContext,
  step: string,
  data: Record<string, JsonValue> = {},
): Promise<void> {
  // Store the full state so a Worker restart does not lose the wizard.
  await context.db.setSession({
    session_key: context.sessionKey,
    scope: "store",
    shop_id: context.shop.id,
    telegram_user_id: context.user.telegram_user_id,
    step,
    data,
  });
}

// Show the main administrator menu.
export async function showAdminHome(context: StoreMessageContext | StoreCallbackContext, chatId: number): Promise<void> {
  // Include the active bot name as visual confirmation of the managed tenant.
  await context.telegram.sendMessage(
    chatId,
    `👨‍💼 <b>پنل مدیریت @${escapeHtml(context.shop.bot_username)}</b>\n\nبخش موردنظر را انتخاب کنید:`,
    adminMainKeyboard,
  );
}

// Show category management plus its dynamic delete/rename list.
async function showCategories(context: StoreMessageContext | StoreCallbackContext, chatId: number): Promise<void> {
  // Read tenant categories in configured order.
  const categories = await context.db.listCategories(context.shop.id);
  // Send the reply-keyboard section header.
  await context.telegram.sendMessage(chatId, "📂 <b>مدیریت دسته‌بندی‌ها</b>", categoryManagementKeyboard);
  // Send an inline row for every existing category.
  if (categories.length > 0) {
    await context.telegram.sendMessage(chatId, "برای ویرایش یا حذف انتخاب کنید:", categoryAdminKeyboard(categories));
  }
}

// Show the product list used by the edit/delete screen.
async function showProductEditorList(context: StoreMessageContext | StoreCallbackContext, chatId: number): Promise<void> {
  // Load active and inactive products for administration.
  const products = await context.db.listProducts(context.shop.id);
  // Explain an empty shop without attaching an empty keyboard.
  if (products.length === 0) {
    await context.telegram.sendMessage(chatId, "هنوز محصولی ثبت نشده است.", productManagementKeyboard);
    return;
  }
  // Render availability status directly in each inline button.
  await context.telegram.sendMessage(chatId, "📦 محصول موردنظر را انتخاب کنید:", productSelectionKeyboard(products, "edit"));
}

// Open one complete product editor card.
async function showProductEditor(
  context: StoreMessageContext | StoreCallbackContext,
  chatId: number,
  product: ProductRow,
): Promise<void> {
  // Reuse the customer caption so presentation remains consistent.
  const text = `${productCaption(product)}\n\n🔢 کد عمومی: <code>${product.public_code}</code>`;
  // Use the first product image when configured.
  const photo = product.image_file_ids[0];
  // Send either a photo editor or text fallback.
  if (photo) await context.telegram.sendPhoto(chatId, photo, text, productEditKeyboard(product));
  else await context.telegram.sendMessage(chatId, text, productEditKeyboard(product));
}

// Move a new-product wizard from delivery content to category selection.
async function askNewProductCategory(context: StoreMessageContext, data: Record<string, JsonValue>): Promise<void> {
  // Require at least one existing category, matching the reference workflow.
  const categories = await context.db.listCategories(context.shop.id);
  // Ask the owner to create a category if none exist.
  if (categories.length === 0) {
    await context.telegram.sendMessage(context.message.chat.id, "❌ ابتدا از بخش مدیریت دسته‌ها یک دسته‌بندی بسازید.", productManagementKeyboard);
    await context.db.clearSession(context.sessionKey);
    return;
  }
  // Preserve all draft fields while waiting for an inline selection.
  await setAdminSession(context, "admin_product_category", data);
  // Render one category per blue inline button.
  await context.telegram.sendMessage(
    context.message.chat.id,
    "📂 دسته‌بندی محصول را انتخاب کنید:",
    categorySelectionKeyboard(categories, "admin:newproduct:category"),
  );
}

// Finalize a fully validated product draft and all of its price plans.
async function finishNewProduct(context: StoreMessageContext): Promise<void> {
  // Read all required string fields from durable state.
  const nameFa = dataString(context.session, "name_fa");
  const description = dataString(context.session, "description");
  const deliveryType = dataString(context.session, "delivery_type");
  // Read nullable/optional fields.
  const nameEn = dataString(context.session, "name_en");
  const requiredInfo = dataString(context.session, "required_customer_info");
  const categoryId = dataString(context.session, "category_id");
  // Read array draft fields.
  const contents = dataContents(context.session);
  const images = dataStrings(context.session, "image_file_ids");
  const plans = dataPlans(context.session);
  // Refuse incomplete state instead of creating a broken catalogue row.
  if (!nameFa || description === null || !categoryId || !deliveryType || plans.length === 0) {
    await context.telegram.sendMessage(context.message.chat.id, "❌ اطلاعات محصول ناقص است؛ لطفاً فرایند افزودن را دوباره انجام دهید.", productManagementKeyboard);
    await context.db.clearSession(context.sessionKey);
    return;
  }
  // Insert the product presentation and fulfillment definition.
  const product = await context.db.createProduct({
    shop_id: context.shop.id,
    category_id: categoryId,
    name_fa: nameFa,
    name_en: nameEn,
    description,
    delivery_type: deliveryType === "automatic" ? "automatic" : "manual",
    required_customer_info: requiredInfo,
    automatic_contents: contents,
    image_file_ids: images,
    is_active: true,
  });
  // Insert plans sequentially so their visible order matches the wizard.
  for (const plan of plans) await context.db.createPlan(product.id, plan.name, plan.price);
  // Clear all partial product data after success.
  await context.db.clearSession(context.sessionKey);
  // Return a concise confirmation and product-management navigation.
  await context.telegram.sendMessage(
    context.message.chat.id,
    `✅ محصول «${escapeHtml(product.name_fa)}» با ${plans.length} پلن ثبت شد.`,
    productManagementKeyboard,
  );
}

// Handle one administrator message; return true when consumed.
export async function handleAdminMessage(context: StoreMessageContext): Promise<boolean> {
  // Non-administrators never enter this module.
  if (!context.isAdmin) return false;
  // Normalize optional button/message text.
  const text = context.message.text?.trim() ?? "";
  // Keep a local destination alias.
  const chatId = context.message.chat.id;

  // The explicit panel button always starts a clean management session.
  if (text === BUTTONS.adminPanel) {
    await context.db.clearSession(context.sessionKey);
    await showAdminHome(context, chatId);
    return true;
  }

  // Back cancels any wizard; from a submenu it returns to admin, otherwise to the shop.
  if (text === BUTTONS.back) {
    // Any persisted admin state means the user was inside a management subsection/wizard.
    const hadAdminState = context.session?.step.startsWith("admin_") ?? false;
    // Cancel partial form data before navigating.
    await context.db.clearSession(context.sessionKey);
    if (hadAdminState) {
      await showAdminHome(context, chatId);
    } else if (context.shop.settings.start_photo_file_id) {
      await context.telegram.sendPhoto(
        chatId,
        context.shop.settings.start_photo_file_id,
        context.shop.settings.start_text,
        shopMainKeyboard,
      );
    } else {
      await context.telegram.sendMessage(chatId, context.shop.settings.start_text, shopMainKeyboard);
    }
    return true;
  }

  // Complete any active administrator wizard before considering normal menu labels.
  if (context.session?.step === "admin_category_add") {
    if (!text || text.length > 80) {
      await context.telegram.sendMessage(chatId, "❌ نام دسته باید بین ۱ تا ۸۰ نویسه باشد.");
      return true;
    }
    await context.db.createCategory(context.shop.id, text);
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "✅ دسته‌بندی اضافه شد.", categoryManagementKeyboard);
    await showCategories(context, chatId);
    return true;
  }

  // Apply a category rename selected through an inline button.
  if (context.session?.step === "admin_category_rename") {
    const categoryId = dataString(context.session, "category_id");
    if (!categoryId || !text || text.length > 80) {
      await context.telegram.sendMessage(chatId, "❌ نام معتبر ارسال کنید.");
      return true;
    }
    await context.db.updateCategory(context.shop.id, categoryId, text);
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "✅ نام دسته تغییر کرد.", categoryManagementKeyboard);
    return true;
  }

  // New product: Persian display name.
  if (context.session?.step === "admin_product_name_fa") {
    if (!text || text.length > 160) {
      await context.telegram.sendMessage(chatId, "❌ نام فارسی باید بین ۱ تا ۱۶۰ نویسه باشد.");
      return true;
    }
    await setAdminSession(context, "admin_product_name_en", { name_fa: text });
    await context.telegram.sendMessage(chatId, "نام انگلیسی محصول را بفرستید یا «ندارد» را انتخاب کنید:", optionalEnglishNameKeyboard);
    return true;
  }

  // New product: optional English name.
  if (context.session?.step === "admin_product_name_en") {
    const nameFa = dataString(context.session, "name_fa");
    if (!nameFa || (!text && text !== BUTTONS.none)) return true;
    await setAdminSession(context, "admin_product_description", {
      ...context.session.data,
      name_en: text === BUTTONS.none ? null : text,
    });
    await context.telegram.sendMessage(chatId, "📝 توضیحات کامل محصول را ارسال کنید:");
    return true;
  }

  // New product: customer-facing description.
  if (context.session?.step === "admin_product_description") {
    if (!text) {
      await context.telegram.sendMessage(chatId, "❌ توضیحات را به‌صورت متن ارسال کنید.");
      return true;
    }
    await setAdminSession(context, "admin_product_delivery", { ...context.session.data, description: text });
    await context.telegram.sendMessage(chatId, "نوع تحویل محصول را انتخاب کنید:", deliveryTypeKeyboard);
    return true;
  }

  // New product: automatic or manual fulfillment choice.
  if (context.session?.step === "admin_product_delivery") {
    if (text === BUTTONS.automaticDelivery) {
      await setAdminSession(context, "admin_product_contents", {
        ...context.session.data,
        delivery_type: "automatic",
        automatic_contents: [],
        required_customer_info: null,
      });
      await context.telegram.sendMessage(
        chatId,
        "🤖 متن یا فایل‌های قابل تحویل را یکی‌یکی بفرستید؛ در پایان دکمه ثبت را بزنید.",
        contentCollectionKeyboard,
      );
      return true;
    }
    if (text === BUTTONS.manualDelivery) {
      await setAdminSession(context, "admin_product_required_info", {
        ...context.session.data,
        delivery_type: "manual",
        automatic_contents: [],
      });
      await context.telegram.sendMessage(
        chatId,
        "چه اطلاعاتی بعد از خرید از مشتری دریافت شود؟ (مثلاً شماره تماس) یا «خیر» را بزنید:",
        optionalRequiredInfoKeyboard,
      );
      return true;
    }
    await context.telegram.sendMessage(chatId, "لطفاً نوع تحویل را از دکمه‌ها انتخاب کنید.", deliveryTypeKeyboard);
    return true;
  }

  // New product: collect reusable Telegram content for automatic fulfillment.
  if (context.session?.step === "admin_product_contents") {
    const contents = dataContents(context.session);
    if (text === BUTTONS.doneContents) {
      if (contents.length === 0) {
        await context.telegram.sendMessage(chatId, "❌ حداقل یک متن یا فایل محصول ارسال کنید.", contentCollectionKeyboard);
        return true;
      }
      await askNewProductCategory(context, { ...context.session.data, automatic_contents: contents as unknown as JsonValue });
      return true;
    }
    // Convert this message into one supported delivery item.
    const content = extractAutomaticContent(context.message);
    if (!content) {
      await context.telegram.sendMessage(chatId, "❌ این نوع پیام پشتیبانی نمی‌شود؛ متن، عکس، ویدئو، صدا یا فایل بفرستید.");
      return true;
    }
    // Append the item without losing other product draft fields.
    const nextContents = [...contents, content];
    await setAdminSession(context, "admin_product_contents", {
      ...context.session.data,
      automatic_contents: nextContents as unknown as JsonValue,
    });
    await context.telegram.sendMessage(chatId, `✅ محتوا شماره ${nextContents.length} ذخیره شد.`, contentCollectionKeyboard);
    return true;
  }

  // New product: manual fulfillment instructions.
  if (context.session?.step === "admin_product_required_info") {
    if (!text) {
      await context.telegram.sendMessage(chatId, "❌ متن یا دکمه «خیر» را ارسال کنید.");
      return true;
    }
    await askNewProductCategory(context, {
      ...context.session.data,
      required_customer_info: text === BUTTONS.no ? "اطلاعات تماس یا توضیحات لازم" : text,
    });
    return true;
  }

  // New product: collect up to ten catalogue photos.
  if (context.session?.step === "admin_product_images") {
    const images = dataStrings(context.session, "image_file_ids");
    if (text === BUTTONS.doneImages) {
      await setAdminSession(context, "admin_product_plan_name", {
        ...context.session.data,
        image_file_ids: images,
        plans: [],
      });
      await context.telegram.sendMessage(chatId, "📅 نام پلن اول را ارسال کنید (مثلاً یک‌ماهه):", finishPlansKeyboard);
      return true;
    }
    const photo = largestPhotoFileId(context.message);
    if (!photo) {
      await context.telegram.sendMessage(chatId, "❌ فقط عکس بفرستید یا دکمه ثبت را بزنید.", imageCollectionKeyboard);
      return true;
    }
    if (images.length >= 10) {
      await context.telegram.sendMessage(chatId, "حداکثر ۱۰ عکس ثبت می‌شود؛ دکمه ثبت را بزنید.", imageCollectionKeyboard);
      return true;
    }
    const nextImages = [...images, photo];
    await setAdminSession(context, "admin_product_images", { ...context.session.data, image_file_ids: nextImages });
    await context.telegram.sendMessage(chatId, `✅ عکس ${nextImages.length} از ۱۰ ذخیره شد.`, imageCollectionKeyboard);
    return true;
  }

  // New product: repeatedly collect a plan name until پایان.
  if (context.session?.step === "admin_product_plan_name") {
    const plans = dataPlans(context.session);
    if (text === BUTTONS.finish) {
      if (plans.length === 0) {
        await context.telegram.sendMessage(chatId, "❌ حداقل یک پلن قیمت ثبت کنید.", finishPlansKeyboard);
        return true;
      }
      await finishNewProduct(context);
      return true;
    }
    if (!text) {
      await context.telegram.sendMessage(chatId, "نام پلن را بفرستید یا «پایان» را بزنید.");
      return true;
    }
    await setAdminSession(context, "admin_product_plan_price", { ...context.session.data, pending_plan_name: text });
    await context.telegram.sendMessage(chatId, "💰 قیمت این پلن را به تومان و فقط با عدد بفرستید:");
    return true;
  }

  // New product: pair a validated price with the pending plan name.
  if (context.session?.step === "admin_product_plan_price") {
    const price = parsePositiveInteger(text);
    const name = dataString(context.session, "pending_plan_name");
    if (!price || !name) {
      await context.telegram.sendMessage(chatId, "❌ قیمت معتبر و بزرگ‌تر از صفر بفرستید.");
      return true;
    }
    const plans = [...dataPlans(context.session), { name, price }];
    const nextData: Record<string, JsonValue> = { ...context.session.data, plans: plans as unknown as JsonValue };
    delete nextData.pending_plan_name;
    await setAdminSession(context, "admin_product_plan_name", nextData);
    await context.telegram.sendMessage(chatId, `✅ پلن ${plans.length} ثبت شد. نام پلن بعدی را بفرستید یا «پایان» را بزنید.`, finishPlansKeyboard);
    return true;
  }

  // Generic text editing for an existing product field.
  if (context.session?.step === "admin_product_edit_text") {
    const productId = dataString(context.session, "product_id");
    const field = dataString(context.session, "field");
    if (!productId || !field || (!text && field !== "name_en")) return true;
    // Whitelist mutable text fields to avoid arbitrary database patches.
    const patch = field === "name_fa"
      ? { name_fa: text }
      : field === "name_en"
        ? { name_en: text === BUTTONS.none ? null : text }
        : field === "description"
          ? { description: text }
          : null;
    if (!patch) return true;
    const product = await context.db.updateProduct(context.shop.id, productId, patch);
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "✅ مشخصات محصول ویرایش شد.", productManagementKeyboard);
    await showProductEditor(context, chatId, product);
    return true;
  }

  // Replace existing product photos with a new set.
  if (context.session?.step === "admin_product_edit_images") {
    const productId = dataString(context.session, "product_id");
    const images = dataStrings(context.session, "image_file_ids");
    if (!productId) return true;
    if (text === BUTTONS.doneImages) {
      const product = await context.db.updateProduct(context.shop.id, productId, { image_file_ids: images });
      await context.db.clearSession(context.sessionKey);
      await context.telegram.sendMessage(chatId, "✅ تصاویر محصول جایگزین شد.", productManagementKeyboard);
      await showProductEditor(context, chatId, product);
      return true;
    }
    const photo = largestPhotoFileId(context.message);
    if (!photo || images.length >= 10) {
      await context.telegram.sendMessage(chatId, "عکس معتبر بفرستید (حداکثر ۱۰) یا ثبت را بزنید.", imageCollectionKeyboard);
      return true;
    }
    await setAdminSession(context, "admin_product_edit_images", {
      ...context.session.data,
      image_file_ids: [...images, photo],
    });
    await context.telegram.sendMessage(chatId, `✅ عکس ${images.length + 1} ذخیره شد.`, imageCollectionKeyboard);
    return true;
  }

  // Replace existing automatic-delivery content.
  if (context.session?.step === "admin_product_edit_contents") {
    const productId = dataString(context.session, "product_id");
    const contents = dataContents(context.session);
    if (!productId) return true;
    if (text === BUTTONS.doneContents) {
      if (contents.length === 0) {
        await context.telegram.sendMessage(chatId, "حداقل یک محتوا ارسال کنید.", contentCollectionKeyboard);
        return true;
      }
      const product = await context.db.updateProduct(context.shop.id, productId, {
        automatic_contents: contents,
        delivery_type: "automatic",
      });
      await context.db.clearSession(context.sessionKey);
      await context.telegram.sendMessage(chatId, "✅ محتوای تحویل خودکار جایگزین شد.", productManagementKeyboard);
      await showProductEditor(context, chatId, product);
      return true;
    }
    const content = extractAutomaticContent(context.message);
    if (!content) {
      await context.telegram.sendMessage(chatId, "نوع پیام پشتیبانی نمی‌شود.");
      return true;
    }
    await setAdminSession(context, "admin_product_edit_contents", {
      ...context.session.data,
      automatic_contents: [...contents, content] as unknown as JsonValue,
    });
    await context.telegram.sendMessage(chatId, `✅ محتوا شماره ${contents.length + 1} ذخیره شد.`, contentCollectionKeyboard);
    return true;
  }

  // Add a new plan to an existing product: name step.
  if (context.session?.step === "admin_plan_add_name") {
    const productId = dataString(context.session, "product_id");
    if (!productId || !text) return true;
    await setAdminSession(context, "admin_plan_add_price", { product_id: productId, plan_name: text });
    await context.telegram.sendMessage(chatId, "💰 قیمت پلن را به تومان بفرستید:");
    return true;
  }

  // Add a new plan to an existing product: price step.
  if (context.session?.step === "admin_plan_add_price") {
    const productId = dataString(context.session, "product_id");
    const name = dataString(context.session, "plan_name");
    const price = parsePositiveInteger(text);
    if (!productId || !name || !price) {
      await context.telegram.sendMessage(chatId, "❌ قیمت معتبر بفرستید.");
      return true;
    }
    await context.db.createPlan(productId, name, price);
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "✅ پلن جدید ثبت شد.", productManagementKeyboard);
    return true;
  }

  // Edit an existing plan name or price.
  if (context.session?.step === "admin_plan_edit") {
    const planId = dataString(context.session, "plan_id");
    const field = dataString(context.session, "field");
    if (!planId || !field) return true;
    if (field === "price") {
      const price = parsePositiveInteger(text);
      if (!price) {
        await context.telegram.sendMessage(chatId, "❌ قیمت معتبر بفرستید.");
        return true;
      }
      await context.db.updatePlan(context.shop.id, planId, { price });
    } else if (field === "name" && text) {
      await context.db.updatePlan(context.shop.id, planId, { name: text });
    } else return true;
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "✅ پلن ویرایش شد.", productManagementKeyboard);
    return true;
  }

  // Bulk price workflow: direction.
  if (context.session?.step === "admin_bulk_direction") {
    const direction = text === BUTTONS.increasePrice ? "increase" : text === BUTTONS.decreasePrice ? "decrease" : null;
    if (!direction) {
      await context.telegram.sendMessage(chatId, "افزایش یا کاهش را انتخاب کنید.", bulkDirectionKeyboard);
      return true;
    }
    await setAdminSession(context, "admin_bulk_amount_type", { ...context.session.data, direction });
    await context.telegram.sendMessage(chatId, "نوع مقدار تغییر را انتخاب کنید:", bulkAmountTypeKeyboard);
    return true;
  }

  // Bulk price workflow: fixed amount or percentage.
  if (context.session?.step === "admin_bulk_amount_type") {
    const amountType = text === BUTTONS.percent ? "percent" : text === BUTTONS.fixed ? "fixed" : null;
    if (!amountType) {
      await context.telegram.sendMessage(chatId, "نوع مبلغ را از دکمه‌ها انتخاب کنید.", bulkAmountTypeKeyboard);
      return true;
    }
    await setAdminSession(context, "admin_bulk_amount", { ...context.session.data, amount_type: amountType });
    await context.telegram.sendMessage(chatId, amountType === "percent" ? "درصد تغییر را فقط با عدد بفرستید:" : "مبلغ تغییر را به تومان بفرستید:");
    return true;
  }

  // Bulk price workflow: execute the selected update.
  if (context.session?.step === "admin_bulk_amount") {
    const amount = parsePositiveInteger(text);
    const selectorKind = dataString(context.session, "selector_kind");
    const selectorId = dataString(context.session, "selector_id");
    const direction = dataString(context.session, "direction");
    const amountType = dataString(context.session, "amount_type");
    if (!amount || !selectorKind || !direction || !amountType) {
      await context.telegram.sendMessage(chatId, "❌ مقدار مثبت و معتبر ارسال کنید.");
      return true;
    }
    const selector = selectorKind === "all"
      ? { kind: "all" as const }
      : selectorKind === "category" && selectorId
        ? { kind: "category" as const, id: selectorId }
        : selectorKind === "product" && selectorId
          ? { kind: "product" as const, id: selectorId }
          : null;
    if (!selector || (direction !== "increase" && direction !== "decrease") || (amountType !== "fixed" && amountType !== "percent")) return true;
    const changed = await context.db.bulkChangePrices(context.shop.id, selector, direction, amountType, amount);
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, `✅ قیمت ${changed} پلن تغییر کرد.`, productManagementKeyboard);
    return true;
  }

  // Create discount code: code step.
  if (context.session?.step === "admin_discount_code") {
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(text)) {
      await context.telegram.sendMessage(chatId, "❌ کد باید ۲ تا ۴۰ نویسه انگلیسی/عدد باشد.");
      return true;
    }
    await setAdminSession(context, "admin_discount_amount", { code: text });
    await context.telegram.sendMessage(chatId, "💰 مبلغ ثابت تخفیف را به تومان ارسال کنید:");
    return true;
  }

  // Create discount code: amount step.
  if (context.session?.step === "admin_discount_amount") {
    const amount = parsePositiveInteger(text);
    const code = dataString(context.session, "code");
    if (!amount || !code) {
      await context.telegram.sendMessage(chatId, "❌ مبلغ معتبر بفرستید.");
      return true;
    }
    await setAdminSession(context, "admin_discount_limit", { code, amount });
    await context.telegram.sendMessage(chatId, "🔢 حداکثر تعداد استفاده را ارسال کنید:");
    return true;
  }

  // Create discount code: usage-limit step.
  if (context.session?.step === "admin_discount_limit") {
    const maxUses = parsePositiveInteger(text);
    const amount = dataNumber(context.session, "amount");
    const code = dataString(context.session, "code");
    if (!maxUses || !amount || !code) {
      await context.telegram.sendMessage(chatId, "❌ تعداد استفاده معتبر بفرستید.");
      return true;
    }
    await context.db.createDiscount(context.shop.id, code, amount, maxUses);
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "✅ کد تخفیف ثبت شد.", discountManagementKeyboard);
    return true;
  }

  // Direct message: collect target Telegram id/@username.
  if (context.session?.step === "admin_direct_target") {
    const target = normalizeChatReference(text);
    if (!target) {
      await context.telegram.sendMessage(chatId, "❌ آیدی عددی یا @username معتبر ارسال کنید.");
      return true;
    }
    await setAdminSession(context, "admin_direct_content", { target });
    await context.telegram.sendMessage(chatId, "✉️ حالا پیام یا فایل موردنظر را ارسال کنید:");
    return true;
  }

  // Direct message: copy the complete source message to the selected chat.
  if (context.session?.step === "admin_direct_content") {
    const target = dataString(context.session, "target");
    if (!target) return true;
    await context.telegram.copyMessage(target, chatId, context.message.message_id);
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "✅ پیام مستقیم ارسال شد.", messageManagementKeyboard);
    return true;
  }

  // Broadcast/forward: enqueue the source message for cron delivery.
  if (context.session?.step === "admin_broadcast_content") {
    const mode = dataString(context.session, "mode");
    if (mode !== "copy" && mode !== "forward") return true;
    const job = await context.db.createBroadcast(context.shop.id, mode, chatId, context.message.message_id);
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(
      chatId,
      `✅ پیام در صف ارسال همگانی قرار گرفت.\nشناسه صف: <code>${job.id}</code>`,
      messageManagementKeyboard,
    );
    return true;
  }

  // General/finance fields share a whitelisted text-setting wizard.
  if (context.session?.step === "admin_setting_text") {
    const field = dataString(context.session, "field");
    if (!field) return true;
    if (field === "start_text" && text) {
      await context.db.updateShopSettings(context.shop, { start_text: text });
    } else if (field === "support_username") {
      const username = text === BUTTONS.none ? null : text.replace(/^@/, "");
      if (username && !/^[A-Za-z0-9_]{5,32}$/.test(username)) {
        await context.telegram.sendMessage(chatId, "❌ یوزرنیم معتبر مانند @example ارسال کنید.");
        return true;
      }
      await context.db.updateShopSettings(context.shop, { support_username: username });
    } else if (["support_chat_id", "log_channel_id", "satisfaction_channel_id"].includes(field)) {
      const reference = text === BUTTONS.none ? null : normalizeChatReference(text);
      if (text !== BUTTONS.none && !reference) {
        await context.telegram.sendMessage(chatId, "❌ @username یا شناسه عددی معتبر ارسال کنید.");
        return true;
      }
      await context.db.updateShopSettings(context.shop, { [field]: reference });
    } else if (field === "second_admin_id") {
      const value = text === BUTTONS.none ? null : normalizeChatReference(text);
      if (value && !/^\d+$/.test(value)) {
        await context.telegram.sendMessage(chatId, "❌ شناسه عددی تلگرام ادمین دوم را ارسال کنید.");
        return true;
      }
      await context.db.updateShopSettings(context.shop, { second_admin_id: value });
    } else if (field === "card_holder" && text) {
      await context.db.updateShopSettings(context.shop, { payment: { card_holder: text } });
    } else if (field === "card_number") {
      const cardNumber = text.replace(/[\s-]/g, "");
      if (!/^\d{16}$/.test(cardNumber)) {
        await context.telegram.sendMessage(chatId, "❌ شماره کارت باید ۱۶ رقم باشد.");
        return true;
      }
      await context.db.updateShopSettings(context.shop, { payment: { card_number: cardNumber } });
    } else if (field === "zarinpal_merchant_id") {
      if (!/^[A-Za-z0-9-]{20,50}$/.test(text)) {
        await context.telegram.sendMessage(chatId, "❌ مرچنت‌کد معتبر زرین‌پال را ارسال کنید.");
        return true;
      }
      await context.db.updateShopSettings(context.shop, { payment: { zarinpal_merchant_id: text } });
    } else return true;
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "✅ تنظیمات ذخیره شد.", generalManagementKeyboard);
    return true;
  }

  // Set/remove the start image from an incoming Telegram photo.
  if (context.session?.step === "admin_start_photo") {
    const photo = largestPhotoFileId(context.message);
    if (!photo && text !== BUTTONS.none) {
      await context.telegram.sendMessage(chatId, "❌ یک عکس ارسال کنید یا «ندارد» را بزنید.", optionalEnglishNameKeyboard);
      return true;
    }
    await context.db.updateShopSettings(context.shop, { start_photo_file_id: photo });
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, photo ? "✅ عکس استارت ذخیره شد." : "✅ عکس استارت حذف شد.", generalManagementKeyboard);
    return true;
  }

  // Add or clear a forced-membership channel.
  if (context.session?.step === "admin_force_channel") {
    if (text === BUTTONS.none) {
      await context.db.updateShopSettings(context.shop, { force_channels: [] });
    } else {
      // Accept @channel|عنوان|https://t.me/channel, with the latter two optional.
      const [rawId = "", rawTitle, rawUrl] = text.split("|").map((part) => part.trim());
      const chatReference = normalizeChatReference(rawId);
      if (!chatReference) {
        await context.telegram.sendMessage(chatId, "❌ قالب معتبر: <code>@channel|عنوان کانال|https://t.me/channel</code>");
        return true;
      }
      const title = rawTitle || chatReference;
      const url = rawUrl || channelUrl(chatReference);
      if (!url || !/^https:\/\//i.test(url)) {
        await context.telegram.sendMessage(chatId, "❌ برای کانال خصوصی لینک HTTPS را نیز در بخش سوم بفرستید.");
        return true;
      }
      await context.db.updateShopSettings(context.shop, {
        force_channels: [...context.shop.settings.force_channels, { chat_id: chatReference, title, url }],
      });
    }
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "✅ تنظیم کانال قفل ذخیره شد.", generalManagementKeyboard);
    return true;
  }

  // Category management menu entry.
  if (text === BUTTONS.categoryManagement) {
    await context.db.clearSession(context.sessionKey);
    await showCategories(context, chatId);
    return true;
  }

  // Start category creation.
  if (text === BUTTONS.addCategory) {
    await setAdminSession(context, "admin_category_add");
    await context.telegram.sendMessage(chatId, "نام دسته‌بندی جدید را ارسال کنید:", categoryManagementKeyboard);
    return true;
  }

  // Product management menu entry.
  if (text === BUTTONS.productManagement) {
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "📦 <b>مدیریت محصولات</b>", productManagementKeyboard);
    return true;
  }

  // Start the complete new-product wizard.
  if (text === BUTTONS.addProduct) {
    await setAdminSession(context, "admin_product_name_fa");
    await context.telegram.sendMessage(chatId, "نام فارسی محصول را ارسال کنید:", productManagementKeyboard);
    return true;
  }

  // Open product selection for editing/deletion.
  if (text === BUTTONS.editProduct) {
    await context.db.clearSession(context.sessionKey);
    await showProductEditorList(context, chatId);
    return true;
  }

  // Start bulk price scope selection.
  if (text === BUTTONS.bulkPrice) {
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "📈 محدوده تغییر قیمت را انتخاب کنید:", bulkScopeKeyboard);
    return true;
  }

  // Apply bulk change to all products after selecting a direction.
  if (text === BUTTONS.allProducts) {
    await setAdminSession(context, "admin_bulk_direction", { selector_kind: "all" });
    await context.telegram.sendMessage(chatId, "افزایش یا کاهش قیمت؟", bulkDirectionKeyboard);
    return true;
  }

  // Choose a particular product for bulk plan-price changes.
  if (text === BUTTONS.oneProduct) {
    const products = await context.db.listProducts(context.shop.id);
    if (products.length === 0) {
      await context.telegram.sendMessage(chatId, "محصولی ثبت نشده است.", productManagementKeyboard);
    } else {
      await context.telegram.sendMessage(chatId, "محصول را انتخاب کنید:", productSelectionKeyboard(products, "bulk"));
    }
    return true;
  }

  // Choose a category for bulk plan-price changes.
  if (text === BUTTONS.oneCategory) {
    const categories = await context.db.listCategories(context.shop.id);
    await context.telegram.sendMessage(chatId, "دسته را انتخاب کنید:", categorySelectionKeyboard(categories, "admin:bulk:category"));
    return true;
  }

  // Open finance configuration with visible switch states.
  if (text === BUTTONS.finance) {
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "💰 <b>تنظیمات مالی</b>", financeKeyboard(context.shop.settings));
    return true;
  }

  // Toggle card payment from its dynamic state label.
  if (text.startsWith(`${BUTTONS.cardToggle}:`)) {
    const shop = await context.db.updateShopSettings(context.shop, {
      payment: { card_enabled: !context.shop.settings.payment.card_enabled },
    });
    await context.telegram.sendMessage(chatId, "✅ وضعیت کارت‌به‌کارت تغییر کرد.", financeKeyboard(shop.settings));
    return true;
  }

  // Toggle ZarinPal from its dynamic state label.
  if (text.startsWith(`${BUTTONS.zarinpalToggle}:`)) {
    const shop = await context.db.updateShopSettings(context.shop, {
      payment: { zarinpal_enabled: !context.shop.settings.payment.zarinpal_enabled },
    });
    await context.telegram.sendMessage(chatId, "✅ وضعیت زرین‌پال تغییر کرد.", financeKeyboard(shop.settings));
    return true;
  }

  // Start one finance text-field edit.
  if ([BUTTONS.setCardHolder, BUTTONS.setCardNumber, BUTTONS.setMerchant].includes(text as never)) {
    const field = text === BUTTONS.setCardHolder ? "card_holder" : text === BUTTONS.setCardNumber ? "card_number" : "zarinpal_merchant_id";
    await setAdminSession(context, "admin_setting_text", { field });
    await context.telegram.sendMessage(chatId, "مقدار جدید را ارسال کنید:");
    return true;
  }

  // Show live database-backed bot statistics.
  if (text === BUTTONS.stats) {
    const stats = await context.db.getShopStats(context.shop.id);
    await context.telegram.sendMessage(chatId, statsText(stats), adminMainKeyboard);
    return true;
  }

  // Show a bounded user-management list.
  if (text === BUTTONS.userManagement) {
    const users = await context.db.listStoreUsers(context.shop.id, 100);
    const lines = users.length > 0
      ? users.map((user, index) => `${index + 1}. <code>${user.telegram_user_id}</code> — ${escapeHtml(user.first_name)} — ${formatToman(user.balance)}`)
      : ["هنوز کاربری وارد ربات نشده است."];
    await context.telegram.sendMessage(chatId, ["👥 <b>کاربران فروشگاه</b>", "", ...lines].join("\n"), adminMainKeyboard);
    return true;
  }

  // Open message management.
  if (text === BUTTONS.messageManagement) {
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "📬 <b>مدیریت پیام‌ها</b>", messageManagementKeyboard);
    return true;
  }

  // Start direct-message target collection.
  if (text === BUTTONS.directMessage) {
    await setAdminSession(context, "admin_direct_target");
    await context.telegram.sendMessage(chatId, "شناسه عددی یا @username مقصد را ارسال کنید:");
    return true;
  }

  // Start a copied broadcast message.
  if (text === BUTTONS.broadcastMessage) {
    await setAdminSession(context, "admin_broadcast_content", { mode: "copy" });
    await context.telegram.sendMessage(chatId, "پیام/فایل همگانی را ارسال کنید:");
    return true;
  }

  // Start a forwarded broadcast message.
  if (text === BUTTONS.forwardBroadcast) {
    await setAdminSession(context, "admin_broadcast_content", { mode: "forward" });
    await context.telegram.sendMessage(chatId, "پیامی را که باید با منبع اصلی فوروارد شود ارسال کنید:");
    return true;
  }

  // Open discount management.
  if (text === BUTTONS.discounts) {
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "🎟 <b>مدیریت کدهای تخفیف</b>", discountManagementKeyboard);
    return true;
  }

  // Start a fixed-value discount wizard.
  if (text === BUTTONS.addDiscount) {
    await setAdminSession(context, "admin_discount_code");
    await context.telegram.sendMessage(chatId, "کد تخفیف انگلیسی را ارسال کنید:");
    return true;
  }

  // List codes with destructive inline delete buttons.
  if (text === BUTTONS.listDiscounts) {
    const discounts = await context.db.listDiscounts(context.shop.id);
    if (discounts.length === 0) await context.telegram.sendMessage(chatId, "کد تخفیفی ثبت نشده است.", discountManagementKeyboard);
    else await context.telegram.sendMessage(chatId, "کد موردنظر برای حذف را انتخاب کنید:", discountListKeyboard(discounts));
    return true;
  }

  // Open general presentation/routing settings.
  if (text === BUTTONS.generalManagement) {
    await context.db.clearSession(context.sessionKey);
    await context.telegram.sendMessage(chatId, "⚙️ <b>مدیریت عمومی</b>", generalManagementKeyboard);
    return true;
  }

  // Start one simple general setting wizard.
  if ([
    BUTTONS.setStartText,
    BUTTONS.setSatisfactionChannel,
    BUTTONS.setSupport,
    BUTTONS.setLogChannel,
    BUTTONS.setSecondAdmin,
  ].includes(text as never)) {
    const field = text === BUTTONS.setStartText
      ? "start_text"
      : text === BUTTONS.setSatisfactionChannel
        ? "satisfaction_channel_id"
        : text === BUTTONS.setSupport
          ? "support_username"
          : text === BUTTONS.setLogChannel
            ? "log_channel_id"
            : "second_admin_id";
    await setAdminSession(context, "admin_setting_text", { field });
    await context.telegram.sendMessage(chatId, "مقدار جدید را ارسال کنید؛ برای حذف «ندارد ❌» را بفرستید:", optionalEnglishNameKeyboard);
    return true;
  }

  // Start start-photo upload/removal.
  if (text === BUTTONS.setStartPhoto) {
    await setAdminSession(context, "admin_start_photo");
    await context.telegram.sendMessage(chatId, "عکس جدید را بفرستید یا «ندارد» را انتخاب کنید:", optionalEnglishNameKeyboard);
    return true;
  }

  // Start forced-channel configuration.
  if (text === BUTTONS.setForceChannel) {
    await setAdminSession(context, "admin_force_channel");
    await context.telegram.sendMessage(
      chatId,
      "کانال را با قالب زیر بفرستید:\n<code>@channel|عنوان کانال|https://t.me/channel</code>\nبرای پاک‌کردن همه کانال‌ها «ندارد ❌» را بزنید.",
      optionalEnglishNameKeyboard,
    );
    return true;
  }

  // Generate and upload a restorable tenant SQL backup.
  if (text === BUTTONS.backup) {
    const tables = await context.db.getShopBackup(context.shop.id);
    const sql = createSqlBackup(context.shop.id, tables);
    const date = new Date().toISOString().slice(0, 10);
    await context.telegram.sendDocumentBytes(
      chatId,
      `telegram-shop-${context.shop.bot_username}-${date}.sql`,
      sql,
      `📥 بکاپ فروشگاه @${context.shop.bot_username}\n${formatPersianDateTime()}`,
    );
    return true;
  }

  // No administrator route matched.
  return false;
}

// Handle administrator inline callbacks.
export async function handleAdminCallback(context: StoreCallbackContext): Promise<boolean> {
  // Reject management callbacks from non-admin users.
  if (!context.isAdmin) return false;
  // Keep the callback string local.
  const data = context.callbackData;

  // Rename one category through a follow-up text step.
  if (data.startsWith("admin:category:rename:")) {
    const categoryId = data.slice("admin:category:rename:".length);
    await setAdminSession(context, "admin_category_rename", { category_id: categoryId });
    await context.telegram.sendMessage(context.chatId, "نام جدید دسته را ارسال کنید:");
    return true;
  }

  // Delete one category while products safely become uncategorized.
  if (data.startsWith("admin:category:delete:")) {
    const categoryId = data.slice("admin:category:delete:".length);
    await context.db.deleteCategory(context.shop.id, categoryId);
    await context.telegram.sendMessage(context.chatId, "✅ دسته حذف شد؛ محصولات آن حذف نشدند.", categoryManagementKeyboard);
    return true;
  }

  // Finish new-product category selection and begin image upload.
  if (data.startsWith("admin:newproduct:category:")) {
    if (context.session?.step !== "admin_product_category") return true;
    const categoryId = data.slice("admin:newproduct:category:".length);
    await setAdminSession(context, "admin_product_images", {
      ...context.session.data,
      category_id: categoryId,
      image_file_ids: [],
    });
    await context.telegram.sendMessage(context.chatId, "🖼 تا ۱۰ عکس محصول بفرستید؛ سپس دکمه ثبت را بزنید.", imageCollectionKeyboard);
    return true;
  }

  // Open one selected product editor.
  if (data.startsWith("admin:product:edit:")) {
    const productId = data.slice("admin:product:edit:".length);
    const product = await context.db.getProduct(context.shop.id, productId);
    if (product) await showProductEditor(context, context.chatId, product);
    return true;
  }

  // Return to the product selector.
  if (data === "admin:product:list") {
    await showProductEditorList(context, context.chatId);
    return true;
  }

  // Toggle product availability.
  if (data.startsWith("admin:product:toggle:")) {
    const productId = data.slice("admin:product:toggle:".length);
    const product = await context.db.getProduct(context.shop.id, productId);
    if (product) {
      const updated = await context.db.updateProduct(context.shop.id, product.id, { is_active: !product.is_active });
      await showProductEditor(context, context.chatId, updated);
    }
    return true;
  }

  // Open text-field editing for an existing product.
  if (data.startsWith("admin:product:field:")) {
    const parts = data.split(":");
    const field = parts[3];
    const productId = parts[4];
    if (!field || !productId) return true;
    if (["name_fa", "name_en", "description"].includes(field)) {
      await setAdminSession(context, "admin_product_edit_text", { product_id: productId, field });
      await context.telegram.sendMessage(
        context.chatId,
        field === "name_en" ? "مقدار جدید یا «ندارد» را ارسال کنید:" : "مقدار جدید را ارسال کنید:",
        field === "name_en" ? optionalEnglishNameKeyboard : undefined,
      );
    } else if (field === "images") {
      await setAdminSession(context, "admin_product_edit_images", { product_id: productId, image_file_ids: [] });
      await context.telegram.sendMessage(context.chatId, "عکس‌های جایگزین را بفرستید و سپس ثبت را بزنید:", imageCollectionKeyboard);
    } else if (field === "content") {
      await setAdminSession(context, "admin_product_edit_contents", { product_id: productId, automatic_contents: [] });
      await context.telegram.sendMessage(context.chatId, "محتوای جایگزین را بفرستید و سپس ثبت را بزنید:", contentCollectionKeyboard);
    } else if (field === "category") {
      const categories = await context.db.listCategories(context.shop.id);
      await context.telegram.sendMessage(
        context.chatId,
        "دسته جدید را انتخاب کنید:",
        categorySelectionKeyboard(categories, `admin:product:setcategory:${productId}`),
      );
    }
    return true;
  }

  // Apply an existing product's new category.
  if (data.startsWith("admin:product:setcategory:")) {
    const parts = data.split(":");
    const productId = parts[3];
    const categoryId = parts[4];
    if (productId && categoryId) {
      const product = await context.db.updateProduct(context.shop.id, productId, { category_id: categoryId });
      await context.telegram.sendMessage(context.chatId, "✅ دسته محصول تغییر کرد.");
      await showProductEditor(context, context.chatId, product);
    }
    return true;
  }

  // Start adding a plan to a selected product.
  if (data.startsWith("admin:product:addplan:")) {
    const productId = data.slice("admin:product:addplan:".length);
    await setAdminSession(context, "admin_plan_add_name", { product_id: productId });
    await context.telegram.sendMessage(context.chatId, "نام پلن جدید را ارسال کنید:");
    return true;
  }

  // Permanently delete a selected product and cascading plans.
  if (data.startsWith("admin:product:delete:")) {
    const productId = data.slice("admin:product:delete:".length);
    await context.db.deleteProduct(context.shop.id, productId);
    await context.telegram.sendMessage(context.chatId, "✅ محصول و پلن‌های آن حذف شد.", productManagementKeyboard);
    return true;
  }

  // List every plan for one product.
  if (data.startsWith("admin:product:plans:")) {
    const productId = data.slice("admin:product:plans:".length);
    const plans = await context.db.listPlans(productId);
    if (plans.length === 0) await context.telegram.sendMessage(context.chatId, "این محصول پلنی ندارد.");
    else await context.telegram.sendMessage(context.chatId, "پلن موردنظر را انتخاب کنید:", planAdminKeyboard(plans));
    return true;
  }

  // Open a focused plan editor after proving tenant ownership.
  if (data.startsWith("admin:plan:open:")) {
    const planId = data.slice("admin:plan:open:".length);
    const resolved = await context.db.getPlanForShop(context.shop.id, planId);
    if (resolved) await context.telegram.sendMessage(context.chatId, `📅 <b>${escapeHtml(resolved.plan.name)}</b>\n💰 ${formatToman(resolved.plan.price)}`, planEditKeyboard(resolved.plan));
    return true;
  }

  // Toggle a plan's availability.
  if (data.startsWith("admin:plan:toggle:")) {
    const planId = data.slice("admin:plan:toggle:".length);
    const resolved = await context.db.getPlanForShop(context.shop.id, planId);
    if (resolved) {
      const plan = await context.db.updatePlan(context.shop.id, planId, { is_active: !resolved.plan.is_active });
      if (plan) await context.telegram.sendMessage(context.chatId, "✅ وضعیت پلن تغییر کرد.", planEditKeyboard(plan));
    }
    return true;
  }

  // Start a plan name/price edit.
  if (data.startsWith("admin:plan:name:") || data.startsWith("admin:plan:price:")) {
    const field = data.startsWith("admin:plan:name:") ? "name" : "price";
    const planId = data.slice(`admin:plan:${field}:`.length);
    await setAdminSession(context, "admin_plan_edit", { plan_id: planId, field });
    await context.telegram.sendMessage(context.chatId, field === "price" ? "قیمت جدید را به تومان بفرستید:" : "نام جدید پلن را بفرستید:");
    return true;
  }

  // Delete a plan after tenant relationship verification.
  if (data.startsWith("admin:plan:delete:")) {
    const planId = data.slice("admin:plan:delete:".length);
    await context.db.deletePlan(context.shop.id, planId);
    await context.telegram.sendMessage(context.chatId, "✅ پلن حذف شد.", productManagementKeyboard);
    return true;
  }

  // Select one product for a bulk price change.
  if (data.startsWith("admin:product:bulk:")) {
    const productId = data.slice("admin:product:bulk:".length);
    await setAdminSession(context, "admin_bulk_direction", { selector_kind: "product", selector_id: productId });
    await context.telegram.sendMessage(context.chatId, "افزایش یا کاهش قیمت؟", bulkDirectionKeyboard);
    return true;
  }

  // Select one category for a bulk price change.
  if (data.startsWith("admin:bulk:category:")) {
    const categoryId = data.slice("admin:bulk:category:".length);
    await setAdminSession(context, "admin_bulk_direction", { selector_kind: "category", selector_id: categoryId });
    await context.telegram.sendMessage(context.chatId, "افزایش یا کاهش قیمت؟", bulkDirectionKeyboard);
    return true;
  }

  // Delete a discount code selected from its list.
  if (data.startsWith("admin:discount:delete:")) {
    const discountId = data.slice("admin:discount:delete:".length);
    await context.db.deleteDiscount(context.shop.id, discountId);
    await context.telegram.sendMessage(context.chatId, "✅ کد تخفیف حذف شد.", discountManagementKeyboard);
    return true;
  }

  // Review a card-to-card receipt exactly once.
  if (data.startsWith("topup:a:") || data.startsWith("topup:r:")) {
    const approve = data.startsWith("topup:a:");
    const topupId = data.slice("topup:x:".length);
    const topup = await context.db.reviewTopup(context.shop.id, topupId, context.user.telegram_user_id, approve);
    if (!topup || (topup.status !== "approved" && topup.status !== "rejected")) {
      await context.telegram.sendMessage(context.chatId, "این درخواست قبلاً بررسی شده یا معتبر نیست.");
      return true;
    }
    const topupUser = await context.db.getStoreUserById(context.shop.id, topup.user_id);
    await context.telegram.sendMessage(context.chatId, approve ? "✅ رسید تأیید و کیف پول شارژ شد." : "❌ رسید رد شد.");
    if (topupUser) {
      await context.telegram.sendMessage(
        topupUser.telegram_user_id,
        approve
          ? `✅ شارژ ${formatToman(topup.amount)} با کد <code>${topup.transaction_code}</code> تأیید شد.`
          : `❌ رسید شارژ با کد <code>${topup.transaction_code}</code> رد شد.`,
      );
    }
    return true;
  }

  // No administrator callback route matched.
  return false;
}
