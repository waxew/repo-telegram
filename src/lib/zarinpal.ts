// ZarinPal payment helpers follow the official v4 request and verify flow.

// Import persistence, tenant, and top-up types used by hosted routes.
import type { Database } from "./database";
import type { ShopBotRow, TopupRow } from "../types/domain";
// Import the dynamic Telegram client for payment notifications.
import type { TelegramClient } from "./telegram";
// Escape response HTML and format Toman values safely.
import { escapeHtml, formatToman, safeErrorMessage } from "./format";

// The official production v4 request endpoint.
const REQUEST_URL = "https://payment.zarinpal.com/pg/v4/payment/request.json";
// The official production v4 verification endpoint.
const VERIFY_URL = "https://payment.zarinpal.com/pg/v4/payment/verify.json";
// Successful authorities are opened through this official gateway prefix.
const START_PAY_URL = "https://payment.zarinpal.com/pg/StartPay/";

// Describe the small common v4 response envelope without trusting remote JSON.
interface ZarinPalEnvelope {
  // data contains success fields when the request is accepted.
  data?: {
    // code 100 means a new successful operation and 101 means already verified.
    code?: number;
    // authority is returned by a payment request.
    authority?: string;
    // ref_id is returned by successful verification.
    ref_id?: number | string;
    // message is safe diagnostic text from the gateway.
    message?: string;
  };
  // errors may be an array or object depending on gateway validation output.
  errors?: unknown;
}

// Render a compact right-to-left browser result page.
function resultPage(title: string, body: string, success: boolean): Response {
  // Use an inline static document with no third-party assets or scripts.
  const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body{margin:0;background:#0f172a;color:#e2e8f0;font-family:Tahoma,Arial,sans-serif;display:grid;place-items:center;min-height:100vh;padding:20px;box-sizing:border-box}
    main{width:min(520px,100%);background:#1e293b;border:1px solid #334155;border-radius:24px;padding:32px;box-shadow:0 24px 70px #02061780;text-align:center}
    .icon{font-size:58px}.status{color:${success ? "#4ade80" : "#fb7185"};font-size:24px;font-weight:700}p{line-height:2;color:#cbd5e1}code{direction:ltr;display:inline-block;background:#0f172a;padding:5px 9px;border-radius:8px}a{display:inline-block;margin-top:14px;color:#fff;background:#229ed9;text-decoration:none;padding:12px 22px;border-radius:12px}
  </style>
</head>
<body><main><div class="icon">${success ? "✅" : "❌"}</div><h1 class="status">${escapeHtml(title)}</h1><p>${body}</p><a href="https://t.me/">بازگشت به تلگرام</a></main></body>
</html>`;
  // Prevent payment result caching in shared browsers/proxies.
  return new Response(html, {
    status: success ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

// POST JSON to ZarinPal and validate the HTTP/JSON envelope.
async function callZarinPal(url: string, payload: Record<string, unknown>): Promise<ZarinPalEnvelope> {
  // Await the official HTTPS request.
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  // Parse the bounded gateway envelope.
  const envelope = (await response.json()) as ZarinPalEnvelope;
  // Reject a non-successful HTTP result before using fields.
  if (!response.ok) throw new Error(`ZarinPal HTTP ${response.status}`);
  // Return the typed envelope for method-specific validation.
  return envelope;
}

// Start or resume one online top-up and redirect the browser to ZarinPal.
export async function startZarinPalPayment(
  request: Request,
  db: Database,
  shop: ShopBotRow,
  topup: TopupRow,
  publicBaseUrl: string,
): Promise<Response> {
  // Require a configured 36-character merchant id and enabled gateway.
  const merchantId = shop.settings.payment.zarinpal_merchant_id;
  if (!shop.settings.payment.zarinpal_enabled || !merchantId) {
    return resultPage("درگاه فعال نیست", "مدیر فروشگاه هنوز زرین‌پال را کامل تنظیم نکرده است.", false);
  }
  // The public link must reference an online request belonging to this shop.
  if (topup.method !== "zarinpal") return resultPage("درخواست نامعتبر", "نوع این درخواست پرداخت آنلاین نیست.", false);
  // Already-approved browser refreshes show success without another gateway call.
  if (topup.status === "approved") {
    return resultPage("پرداخت قبلاً تأیید شده", `کد پیگیری: <code>${escapeHtml(topup.transaction_code)}</code>`, true);
  }
  // An existing authority can safely resume the same payment page.
  if (topup.payment_authority && topup.status === "pending_review") {
    return Response.redirect(`${START_PAY_URL}${encodeURIComponent(topup.payment_authority)}`, 302);
  }
  // Only untouched requests can generate a new authority.
  if (topup.status !== "awaiting_receipt") return resultPage("درخواست قابل پرداخت نیست", "وضعیت این تراکنش اجازه شروع دوباره نمی‌دهد.", false);
  // Build an origin-controlled HTTPS callback that contains no merchant secret.
  const callbackUrl = `${publicBaseUrl.replace(/\/$/, "")}/pay/zarinpal/callback/${shop.webhook_key}/${topup.id}`;
  try {
    // The application stores Toman, while the base official flow expects Rial.
    const envelope = await callZarinPal(REQUEST_URL, {
      merchant_id: merchantId,
      amount: topup.amount * 10,
      callback_url: callbackUrl,
      description: `افزایش موجودی ربات @${shop.bot_username}`,
      metadata: { order_id: topup.transaction_code, auto_verify: false },
    });
    // Require the documented success code and authority.
    if (envelope.data?.code !== 100 || !envelope.data.authority) {
      throw new Error(envelope.data?.message ?? "ZarinPal request rejected");
    }
    // Persist the authority before redirecting, so the callback can be matched.
    await db.setTopupAuthority(shop.id, topup.id, envelope.data.authority);
    // Send the browser to the official hosted payment page.
    return Response.redirect(`${START_PAY_URL}${encodeURIComponent(envelope.data.authority)}`, 302);
  } catch (error) {
    // Show a safe, bounded gateway diagnostic without configuration secrets.
    return resultPage("خطا در ایجاد پرداخت", escapeHtml(safeErrorMessage(error)), false);
  }
}

// Verify the browser callback, atomically credit the wallet, and notify the user.
export async function finishZarinPalPayment(
  request: Request,
  db: Database,
  telegram: TelegramClient,
  shop: ShopBotRow,
  topup: TopupRow,
): Promise<Response> {
  // Read documented callback query parameters.
  const url = new URL(request.url);
  // Status must be exactly OK before calling verify.
  const status = url.searchParams.get("Status");
  // Authority must match the stored request, not just the untrusted query string.
  const authority = url.searchParams.get("Authority");
  // Handle an explicit cancellation without verifying or crediting.
  if (status !== "OK") {
    await db.reviewTopup(shop.id, topup.id, 0, false);
    return resultPage("پرداخت لغو شد", `کد درخواست: <code>${escapeHtml(topup.transaction_code)}</code>`, false);
  }
  // Reject tampered/mismatched callbacks.
  if (!authority || authority !== topup.payment_authority || topup.method !== "zarinpal") {
    return resultPage("پاسخ نامعتبر", "شناسه پرداخت با درخواست ثبت‌شده مطابقت ندارد.", false);
  }
  // Browser refresh after an approved payment remains idempotent.
  if (topup.status === "approved") {
    return resultPage("پرداخت موفق", `شماره پیگیری: <code>${escapeHtml(topup.payment_ref_id ?? topup.transaction_code)}</code>`, true);
  }
  // Require the current configured merchant id for server-to-server verification.
  const merchantId = shop.settings.payment.zarinpal_merchant_id;
  if (!merchantId) return resultPage("تنظیمات ناقص", "مرچنت‌کد فروشگاه در دسترس نیست.", false);
  try {
    // Explicitly verify the exact authority and Rial amount with ZarinPal.
    const envelope = await callZarinPal(VERIFY_URL, {
      merchant_id: merchantId,
      amount: topup.amount * 10,
      authority,
    });
    // Code 100 is newly verified; 101 is already verified and still successful.
    if (envelope.data?.code !== 100 && envelope.data?.code !== 101) {
      throw new Error(envelope.data?.message ?? "ZarinPal verification rejected");
    }
    // Credit the wallet through the same lock-protected, idempotent approval RPC.
    const approved = await db.reviewTopup(shop.id, topup.id, 0, true);
    // Use the external reference when available.
    const reference = String(envelope.data.ref_id ?? topup.transaction_code);
    // Save the reference only after the wallet state is approved.
    await db.setTopupPaymentReference(shop.id, topup.id, reference);
    // Resolve the recipient without exposing the internal UUID publicly.
    const user = approved ? await db.getStoreUserById(shop.id, approved.user_id) : null;
    // Best-effort Telegram notification is awaited before returning the result page.
    if (user) {
      await telegram.sendMessage(
        user.telegram_user_id,
        `✅ پرداخت آنلاین ${formatToman(topup.amount)} تأیید و کیف پول شما شارژ شد.\nشماره پیگیری زرین‌پال: <code>${escapeHtml(reference)}</code>`,
      );
    }
    // Render a browser receipt with the gateway reference.
    return resultPage("پرداخت موفق", `موجودی شما ${formatToman(topup.amount)} افزایش یافت.<br>شماره پیگیری: <code>${escapeHtml(reference)}</code>`, true);
  } catch (error) {
    // Do not reject/credit on an ambiguous gateway error; a safe retry remains possible.
    return resultPage("تأیید پرداخت ناموفق بود", escapeHtml(safeErrorMessage(error)), false);
  }
}
