# امنیت پروژه

## رازهای لازم

- `BUILDER_BOT_TOKEN`: توکن ربات‌ساز مرکزی
- `BUILDER_WEBHOOK_SECRET`: secret header همان وبهوک
- `TOKEN_ENCRYPTION_KEY`: کلید ۳۲ بایتی Base64 برای AES-256
- `SUPABASE_SECRET_KEY`: کلید محرمانه‌ی فقط سرور Supabase

این مقادیر فقط با `wrangler secret put` یا `.dev.vars` محلی تنظیم می‌شوند. فایل `.dev.vars` و `.env` در `.gitignore` هستند.

## توکن ربات‌های مشتری

توکن ابتدا با `getMe` اعتبارسنجی و سپس با AES-GCM و IV تصادفی رمز می‌شود. دیتابیس فقط `token_ciphertext` و `token_iv` را دارد. بدون `TOKEN_ENCRYPTION_KEY` محیط Cloudflare، مقدار قابل استفاده نیست.

اگر کلید رمزنگاری را عوض کنید، توکن‌های قبلی دیگر decrypt نمی‌شوند. برای rotation باید ابتدا ابزار re-encryption نوشته شود یا کاربران توکن‌ها را دوباره ثبت کنند.

## وبهوک

وبهوک مرکزی secret را مستقیم با مقدار محیطی و مقایسه constant-time بررسی می‌کند. هر فروشگاه secret متفاوت دارد و فقط SHA-256 آن در دیتابیس است. UUID مسیر وبهوک نیز لایه‌ی دوم غیرقابل‌حدس است.

## دسترسی مدیر

مجوز مدیریت فقط با Telegram numeric user id مالک یا `second_admin_id` تعیین می‌شود. Username قابل تغییر است و برای authorization استفاده نمی‌شود.

## عملیات مالی

موجودی و شارژ با قفل ردیفی PostgreSQL تغییر می‌کنند. Callback مرورگر زرین‌پال به‌تنهایی قابل اعتماد نیست؛ سرور Authority، مبلغ و نتیجه Verify را با API رسمی کنترل می‌کند.

## توصیه عملیاتی

- توکن نمایش‌داده‌شده در ویدئو یا اسکرین‌شات را استفاده نکنید؛ در BotFather آن را revoke کنید.
- Cloudflare و Supabase را با MFA محافظت کنید.
- secretها را در GitHub Issues، لاگ، عکس یا پیام عمومی نفرستید.
- برای تولید production از کلیدهای خروجی `npm run secrets:generate` استفاده کنید.
- گزارش‌های Cloudflare را برای خطاهای webhook و Broadcast پایش کنید.

