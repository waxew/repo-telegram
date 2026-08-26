// Domain types mirror the telegram_shop_* tables and JSON settings in Supabase.

// JSON-compatible values are safe to persist inside Supabase jsonb columns.
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// The supported lifecycle values intentionally match the database constraint.
export type ShopStatus = "trial" | "active" | "expired" | "suspended";

// PaymentSettings controls the two payment methods shown in the reference bot.
export interface PaymentSettings {
  // card_enabled exposes card-to-card top-up.
  card_enabled: boolean;
  // card_holder is printed in payment instructions.
  card_holder: string | null;
  // card_number is never used as an application secret, but stays server-side.
  card_number: string | null;
  // zarinpal_enabled exposes the online gateway button.
  zarinpal_enabled: boolean;
  // zarinpal_merchant_id is configured by the shop owner.
  zarinpal_merchant_id: string | null;
}

// ForceChannel represents one channel that users must join before shopping.
export interface ForceChannel {
  // chat_id can be a numeric channel id or an @username accepted by Telegram.
  chat_id: string;
  // title is the human-readable button label.
  title: string;
  // url opens the channel from the membership warning.
  url: string;
}

// ShopSettings contains all owner-configurable presentation and routing values.
export interface ShopSettings {
  // start_text appears after /start.
  start_text: string;
  // start_photo_file_id points at Telegram-hosted media and can be removed.
  start_photo_file_id: string | null;
  // support_username can be used when no support group is configured.
  support_username: string | null;
  // support_chat_id receives forwarded support messages.
  support_chat_id: string | null;
  // log_channel_id receives order and system reports.
  log_channel_id: string | null;
  // satisfaction_channel_id is a configurable social-proof destination.
  satisfaction_channel_id: string | null;
  // force_channels contains all required memberships.
  force_channels: ForceChannel[];
  // second_admin_id grants the same management menu to one collaborator.
  second_admin_id: string | null;
  // referral_reward is credited after a referred user's first paid order.
  referral_reward: number;
  // payment contains card and ZarinPal switches and identifiers.
  payment: PaymentSettings;
}

// BuilderAccountRow represents a user of the central shop-builder bot.
export interface BuilderAccountRow {
  telegram_user_id: number;
  username: string | null;
  first_name: string;
  last_name: string | null;
  balance: number;
  referral_code: string;
  referred_by: number | null;
  created_at: string;
  updated_at: string;
}

// ShopBotRow contains encrypted credentials and public bot metadata.
export interface ShopBotRow {
  id: string;
  owner_telegram_id: number;
  bot_telegram_id: number;
  bot_username: string;
  bot_display_name: string;
  token_ciphertext: string;
  token_iv: string;
  webhook_key: string;
  webhook_secret_hash: string;
  status: ShopStatus;
  trial_ends_at: string;
  subscription_ends_at: string | null;
  settings: ShopSettings;
  created_at: string;
  updated_at: string;
}

// StoreUserRow is one user inside one tenant shop.
export interface StoreUserRow {
  id: string;
  shop_id: string;
  telegram_user_id: number;
  username: string | null;
  first_name: string;
  last_name: string | null;
  balance: number;
  referred_by: string | null;
  referral_rewarded: boolean;
  created_at: string;
  last_seen_at: string;
  updated_at: string;
}

// ConversationSessionRow persists a state-machine step and its partial form data.
export interface ConversationSessionRow {
  session_key: string;
  scope: "builder" | "store";
  shop_id: string | null;
  telegram_user_id: number;
  step: string;
  data: Record<string, JsonValue>;
  updated_at: string;
}

// CategoryRow is one catalogue category.
export interface CategoryRow {
  id: string;
  shop_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

// AutomaticContent describes media that Telegram can resend after payment.
export interface AutomaticContent {
  // kind selects the correct Telegram send method.
  kind: "text" | "photo" | "document" | "video" | "audio" | "voice";
  // text exists for text-only delivery items.
  text?: string;
  // file_id exists for Telegram-hosted media.
  file_id?: string;
  // caption is preserved for uploaded media.
  caption?: string;
  // file_name is retained for a clearer backup.
  file_name?: string;
}

// ProductRow is the complete catalogue product configuration.
export interface ProductRow {
  id: string;
  public_code: number;
  shop_id: string;
  category_id: string | null;
  name_fa: string;
  name_en: string | null;
  description: string;
  delivery_type: "automatic" | "manual";
  required_customer_info: string | null;
  automatic_contents: AutomaticContent[];
  image_file_ids: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// PlanRow is one purchasable variation of a product.
export interface PlanRow {
  id: string;
  product_id: string;
  name: string;
  price: number;
  is_active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

// DiscountCodeRow follows fixed-value discount codes from the video.
export interface DiscountCodeRow {
  id: string;
  shop_id: string;
  code: string;
  amount: number;
  max_uses: number;
  used_count: number;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// OrderRow supports tracking, statistics, support, and backups.
export interface OrderRow {
  id: string;
  tracking_code: string;
  shop_id: string;
  user_id: string;
  product_id: string;
  plan_id: string;
  discount_code_id: string | null;
  subtotal: number;
  discount_amount: number;
  total: number;
  status: "pending" | "paid" | "delivering" | "completed" | "cancelled" | "refunded";
  customer_info: string | null;
  delivery_snapshot: Record<string, JsonValue>;
  created_at: string;
  updated_at: string;
}

// TransactionRow is one immutable wallet-ledger entry shown in the account card.
export interface TransactionRow {
  // id is the database primary key.
  id: string;
  // shop_id keeps transactions isolated between tenant bots.
  shop_id: string;
  // user_id points at the affected storefront wallet.
  user_id: string;
  // kind explains why the balance changed.
  kind: "credit" | "debit" | "refund" | "referral" | "adjustment";
  // amount is positive for credits and negative for debits.
  amount: number;
  // balance_after records the wallet balance immediately after the change.
  balance_after: number;
  // description is the owner/user-facing ledger explanation.
  description: string | null;
  // reference normally contains an order or top-up tracking code.
  reference: string | null;
  // created_at orders the recent transaction list.
  created_at: string;
}

// TopupRow represents one card or payment-gateway wallet request.
export interface TopupRow {
  // id is the private database identifier.
  id: string;
  // transaction_code is the short code shared with the user and owner.
  transaction_code: string;
  // shop_id identifies the tenant storefront.
  shop_id: string;
  // user_id identifies the wallet being charged.
  user_id: string;
  // amount is stored in whole Toman.
  amount: number;
  // method distinguishes card receipts from online gateway requests.
  method: "card" | "zarinpal";
  // receipt_file_id lets the owner inspect the Telegram-hosted image/document.
  receipt_file_id: string | null;
  // payment_authority stores the verified ZarinPal request authority.
  payment_authority: string | null;
  // payment_ref_id stores the final gateway reference number after verification.
  payment_ref_id: string | null;
  // status captures the complete review lifecycle.
  status: "awaiting_receipt" | "pending_review" | "approved" | "rejected";
  // reviewed_by records the Telegram id of the approving administrator.
  reviewed_by: number | null;
  // reviewed_at records when the decision was made.
  reviewed_at: string | null;
  // created_at supports chronological administration and backups.
  created_at: string;
  // updated_at changes after receipt upload or review.
  updated_at: string;
}

// CheckoutResult is returned atomically by the database checkout function.
export interface CheckoutResult {
  ok: boolean;
  reason?: "user_not_found" | "plan_not_found" | "product_not_found" | "discount_invalid" | "insufficient_balance";
  shortfall?: number;
  balance?: number;
  total?: number;
  order_id?: string;
  tracking_code?: string;
  balance_after?: number;
  product_name?: string;
  plan_name?: string;
  delivery_type?: "automatic" | "manual";
  automatic_contents?: AutomaticContent[];
  required_customer_info?: string | null;
}

// BroadcastRow is a queued message processed by the cron handler.
export interface BroadcastRow {
  id: string;
  shop_id: string;
  mode: "copy" | "forward";
  source_chat_id: number;
  source_message_id: number;
  status: "queued" | "running" | "completed" | "failed";
  cursor_created_at: string | null;
  sent_count: number;
  failed_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

// ShopStats groups the figures displayed in the management panel.
export interface ShopStats {
  totalUsers: number;
  usersThisMonth: number;
  buyers: number;
  totalSales: number;
  salesThisMonth: number;
  totalTopups: number;
}
