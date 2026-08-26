# نگاشت ویدئوی مرجع به سورس

این فایل حاصل بازبینی کامل ویدئوی ۲۳ دقیقه‌ای است و کمک می‌کند هر بخش نمایش‌داده‌شده را در سورس پیدا کنید.

| بخش ویدئو | پیاده‌سازی |
|---|---|
| ساخت ربات در BotFather و دریافت توکن | راهنما و state در `handlers/builder.ts` |
| انتخاب «برای خودم / برای مشتری» | `buildAudienceKeyboard` و جلسه `await_bot_token` |
| اتصال توکن و ساخته‌شدن فروشگاه | `getMe`، AES-GCM، `createShop` و `setWebhook` |
| منوی اصلی مشتری | `shopMainKeyboard` |
| حساب، لینک دعوت، سفارش‌ها و تراکنش‌ها | `customerAccountText` و `handleCustomerMessage` |
| افزایش موجودی کارت‌به‌کارت و رسید | `customer_topup_*` و callbackهای `topup:*` |
| درگاه زرین‌پال | `lib/zarinpal.ts` |
| پشتیبانی | state `customer_support` و تنظیم مقصد پشتیبانی |
| دسته‌بندی محصولات | `showCategories` و callbackهای `admin:category:*` |
| ویزارد کامل افزودن محصول | stateهای `admin_product_*` در `handlers/admin.ts` |
| تحویل خودکار/دستی | `automatic_contents`، `required_customer_info` و checkout |
| عکس‌های محصول و پلن‌های متعدد | `admin_product_images` و `admin_product_plan_*` |
| کارت محصول و فاکتور خرید | `productCaption`، `planPurchaseKeyboard` و `invoiceText` |
| تخفیف و کنترل موجودی | `getValidDiscount` و RPC `telegram_shop_checkout` |
| تنظیم کارت و مرچنت‌کد | `financeKeyboard` و state `admin_setting_text` |
| آمار ربات | `getShopStats` و `statsText` |
| پیام مستقیم، همگانی و فوروارد | stateهای `admin_direct_*`، صف Broadcast و Cron |
| تنظیم متن/عکس شروع | `generalManagementKeyboard` و stateهای تنظیم |
| کانال قفل، رضایت، پشتیبانی، گزارش و ادمین دوم | `ShopSettings` و `admin_setting_text` |
| بکاپ SQL | `getShopBackup` و `createSqlBackup` |
| ویرایش وضعیت، نام، عکس، محتوا و پلن محصول | callbackهای `admin:product:*` و `admin:plan:*` |
| افزایش/کاهش درصدی یا ثابت قیمت | stateهای `admin_bulk_*` و `bulkChangePrices` |

همه callbackها پس از دریافت با `answerCallbackQuery` پاسخ داده می‌شوند تا انیمیشن انتظار تلگرام متوقف شود.

