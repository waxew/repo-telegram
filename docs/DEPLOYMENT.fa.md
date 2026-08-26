# نصب و انتشار قدم‌به‌قدم

## پیش‌نیازها

- Node.js 24 یا جدیدتر
- حساب Cloudflare با Workers فعال
- پروژه Supabase
- یک ربات مرکزی ساخته‌شده در `@BotFather`
- دامنه پیش‌فرض `workers.dev` یا دامنه HTTPS متصل به Worker

## ۱. نصب و تست

```bash
npm install
npm run check
npm run build
```

## ۲. دیتابیس Supabase

مهاجرت‌ها در `supabase/migrations` قرار دارند. روی یک پروژه جدید آن‌ها را به ترتیب اعمال کنید. فایل `supabase/schema.sql` نیز نسخه‌ی کامل و idempotent طرح است.

در پروژه‌ای که این سورس برای آن ساخته شد، مهاجرت‌های `telegram_shop_v1` و `telegram_shop_foreign_key_indexes` قبلاً با موفقیت اعمال شده‌اند.

از بخش Project Settings > Data API این دو مقدار را بردارید:

- Project URL برای `SUPABASE_URL`
- کلید backend با پیشوند `sb_secret_` برای `SUPABASE_SECRET_KEY`

کلید secret را هرگز در کد یا Telegram نفرستید.

## ۳. ساخت رازهای محلی

```bash
npm run secrets:generate
```

خروجی شامل `BUILDER_WEBHOOK_SECRET` و `TOKEN_ENCRYPTION_KEY` است. آن‌ها را در Password Manager نگه دارید.

## ۴. تنظیم Cloudflare Secrets

```bash
npx wrangler login
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put BUILDER_BOT_TOKEN
npx wrangler secret put BUILDER_WEBHOOK_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put PUBLIC_BASE_URL
```

برای `PUBLIC_BASE_URL` آدرس نهایی مانند `https://repo-telegram.example.workers.dev` را بدون `/` انتهایی وارد کنید.

## ۵. انتشار Worker

```bash
npm run deploy
```

بعد از انتشار، این آدرس باید JSON سلامت برگرداند:

```text
https://YOUR-WORKER/health
```

## ۶. ثبت وبهوک ربات‌ساز مرکزی

سه متغیر زیر را فقط برای اجرای محلی اسکریپت export کنید:

```bash
export BUILDER_BOT_TOKEN='توکن واقعی'
export BUILDER_WEBHOOK_SECRET='secret تولیدشده'
export PUBLIC_BASE_URL='https://YOUR-WORKER'
npm run webhook:builder
```

اسکریپت توکن/secret را چاپ نمی‌کند و فقط نتیجه موفق را نشان می‌دهد.

## ۷. ساخت اولین فروشگاه

1. ربات مرکزی را Start کنید.
2. «ساخت ربات فروشگاه» را بزنید.
3. حالت خودم/مشتری را انتخاب کنید.
4. در BotFather یک ربات تازه بسازید.
5. توکن را در ربات‌ساز بفرستید.
6. ربات ساخته‌شده را باز و Start کنید.
7. وارد پنل مدیریت شوید، دسته و محصول بسازید.
8. تنظیم کارت، پشتیبانی و کانال گزارش را کامل کنید.

## ۸. زرین‌پال

در ربات فروشگاه وارد پنل مدیریت > بخش مالی شوید، مرچنت‌کد را ثبت و زرین‌پال را روشن کنید. Callback به‌صورت خودکار با آدرس Worker ساخته می‌شود. مبلغ داخلی برنامه تومان است و برای جریان پایه رسمی زرین‌پال به ریال تبدیل می‌شود.

## ۹. توسعه محلی

```bash
cp .dev.vars.example .dev.vars
npm run dev
```

Telegram فقط وبهوک HTTPS عمومی را می‌پذیرد؛ برای تست webhook محلی باید URL امن tunnel یا Worker preview داشته باشید. هیچ secret محلی را commit نکنید.

## ۱۰. خطاهای رایج

- `401 Unauthorized`: secret وبهوک ثبت‌شده با Cloudflare یکسان نیست.
- خطای decrypt: `TOKEN_ENCRYPTION_KEY` تغییر کرده یا Base64 آن دقیقاً ۳۲ بایت نیست.
- کار نکردن عضویت اجباری: ربات را در کانال مدیر کنید تا `getChatMember` مجاز باشد.
- پیام مستقیم نرسید: کاربر باید قبلاً ربات فروشگاه را Start کرده باشد.
- زرین‌پال خطا می‌دهد: مرچنت‌کد، دامنه Callback و وضعیت پذیرندگی را بررسی کنید.

