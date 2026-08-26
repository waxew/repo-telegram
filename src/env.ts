// Worker environment bindings are declared in one place for type-safe deployment.

// Env lists only configuration read by the Cloudflare Worker at runtime.
export interface Env {
  // SUPABASE_URL is the HTTPS project endpoint, never a database password.
  SUPABASE_URL: string;
  // SUPABASE_SECRET_KEY is the backend-only sb_secret_ key (legacy service_role also works).
  SUPABASE_SECRET_KEY: string;
  // BUILDER_BOT_TOKEN belongs to the single central shop-builder bot.
  BUILDER_BOT_TOKEN: string;
  // BUILDER_WEBHOOK_SECRET authenticates Telegram requests to the central webhook.
  BUILDER_WEBHOOK_SECRET: string;
  // TOKEN_ENCRYPTION_KEY is a Base64-encoded 32-byte AES key for customer tokens.
  TOKEN_ENCRYPTION_KEY: string;
  // PUBLIC_BASE_URL is the deployed Worker origin without a trailing slash.
  PUBLIC_BASE_URL: string;
  // BUILDER_SUPPORT_USERNAME optionally routes central builder support requests.
  BUILDER_SUPPORT_USERNAME?: string;
}
