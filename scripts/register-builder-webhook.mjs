// This one-time Node script registers the central builder webhook with Telegram.

// Read required values from the shell/CI environment; never hardcode secrets.
const token = process.env.BUILDER_BOT_TOKEN;
// The deployed Worker origin contains no trailing slash.
const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
// Telegram will echo this value in every builder webhook request.
const secret = process.env.BUILDER_WEBHOOK_SECRET;

// Stop with actionable names when configuration is incomplete.
if (!token || !baseUrl || !secret) {
  throw new Error("Set BUILDER_BOT_TOKEN, PUBLIC_BASE_URL, and BUILDER_WEBHOOK_SECRET first.");
}

// Register the official HTTPS webhook through Telegram Bot API.
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  // Telegram accepts a JSON POST body.
  method: "POST",
  // Declare request encoding.
  headers: { "content-type": "application/json" },
  // Restrict delivered updates to those implemented by this project.
  body: JSON.stringify({
    url: `${baseUrl}/telegram/builder`,
    secret_token: secret,
    allowed_updates: ["message", "callback_query", "my_chat_member"],
    drop_pending_updates: false,
  }),
});

// Parse Telegram's normal response envelope.
const result = await response.json();
// Fail CI/local setup when Telegram rejects the registration.
if (!response.ok || !result.ok) throw new Error(`Telegram rejected setWebhook: ${result.description ?? response.status}`);
// Print only a success message; token and secret never enter logs.
console.log("Builder webhook registered successfully.");
