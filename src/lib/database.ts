// Supabase repository methods centralize tenant filters and error handling.

// Use the official server-side JavaScript client with a backend-only secret key.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// Import all rows returned by the telegram_shop_* tables.
import type {
  BroadcastRow,
  BuilderAccountRow,
  CategoryRow,
  CheckoutResult,
  ConversationSessionRow,
  DiscountCodeRow,
  JsonValue,
  OrderRow,
  PlanRow,
  ProductRow,
  ShopBotRow,
  ShopSettings,
  ShopStats,
  StoreUserRow,
  TopupRow,
  TransactionRow,
} from "../types/domain";
// Telegram user fields are used by account upserts.
import type { TelegramUser } from "../types/telegram";
// referralCodeFor creates the builder account's stable invite code.
import { referralCodeFor } from "./format";

// DatabaseError keeps low-level query failures distinguishable in logs.
export class DatabaseError extends Error {
  // Create a controlled error without exposing request secrets.
  constructor(message: string) {
    // Initialize the native Error class.
    super(message);
    // Set a useful error name for structured logs.
    this.name = "DatabaseError";
  }
}

// Throw once for any failed Supabase operation.
function ensureNoError(error: { message: string } | null, context: string): void {
  // A null error means the operation succeeded.
  if (!error) return;
  // Prefix the public database message with the failed operation.
  throw new DatabaseError(`${context}: ${error.message}`);
}

// Database is created per Worker request; it does not retain cross-request state.
export class Database {
  // Keep the Supabase client private to enforce repository-level tenant filtering.
  readonly #client: SupabaseClient;

  // Create a server-only client without session persistence or token refresh.
  constructor(url: string, secretKey: string) {
    // The secret key stays inside the Worker environment and bypasses RLS intentionally.
    this.#client = createClient(url, secretKey, {
      // No end-user Supabase Auth session is involved in a Telegram webhook.
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      // Identify this backend in Supabase request logs.
      global: { headers: { "x-client-info": "repo-telegram-worker/1.0.0" } },
    });
  }

  // Insert or refresh one central builder account.
  async upsertBuilderAccount(user: TelegramUser, referredBy?: number | null): Promise<BuilderAccountRow> {
    // Read an existing account so a later deep link cannot replace its first referrer.
    const existing = await this.getBuilderAccount(user.id);
    // Include mutable Telegram profile fields but never use username for authorization.
    const payload = {
      telegram_user_id: user.id,
      username: user.username ?? null,
      first_name: user.first_name,
      last_name: user.last_name ?? null,
      referral_code: referralCodeFor(user.id),
      // Only a first insert can meaningfully use a referrer; the follow-up update preserves it.
      ...(!existing && referredBy ? { referred_by: referredBy } : {}),
    };
    // Upsert by the stable Telegram id.
    const { data, error } = await this.#client
      .from("telegram_shop_builder_accounts")
      .upsert(payload, { onConflict: "telegram_user_id" })
      .select("*")
      .single();
    // Stop on a database failure.
    ensureNoError(error, "upsert builder account");
    // The single() contract guarantees a row after a successful upsert.
    return data as BuilderAccountRow;
  }

  // Read one builder account by Telegram id.
  async getBuilderAccount(telegramUserId: number): Promise<BuilderAccountRow | null> {
    // maybeSingle represents an absent account as null rather than an error.
    const { data, error } = await this.#client
      .from("telegram_shop_builder_accounts")
      .select("*")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    // Report unexpected query failures.
    ensureNoError(error, "get builder account");
    // Preserve the nullable result.
    return data as BuilderAccountRow | null;
  }

  // Count all bots owned by one builder account.
  async countOwnerShops(ownerTelegramId: number): Promise<number> {
    // head:true avoids downloading rows when only a count is needed.
    const { count, error } = await this.#client
      .from("telegram_shop_bots")
      .select("id", { count: "exact", head: true })
      .eq("owner_telegram_id", ownerTelegramId);
    // Validate the count query.
    ensureNoError(error, "count owner shops");
    // Supabase can return null when a count header is unavailable.
    return count ?? 0;
  }

  // List a builder account's bots newest-first.
  async listOwnerShops(ownerTelegramId: number): Promise<ShopBotRow[]> {
    // Apply the owner filter before ordering.
    const { data, error } = await this.#client
      .from("telegram_shop_bots")
      .select("*")
      .eq("owner_telegram_id", ownerTelegramId)
      .order("created_at", { ascending: false });
    // Surface any query error.
    ensureNoError(error, "list owner shops");
    // Cast the validated row array to the domain shape.
    return (data ?? []) as ShopBotRow[];
  }

  // Insert a validated and encrypted customer bot.
  async createShop(input: {
    ownerTelegramId: number;
    botTelegramId: number;
    botUsername: string;
    botDisplayName: string;
    tokenCiphertext: string;
    tokenIv: string;
    webhookSecretHash: string;
    trialDays: number;
  }): Promise<ShopBotRow> {
    // Convert camelCase application fields to database snake_case fields.
    const payload = {
      owner_telegram_id: input.ownerTelegramId,
      bot_telegram_id: input.botTelegramId,
      bot_username: input.botUsername,
      bot_display_name: input.botDisplayName,
      token_ciphertext: input.tokenCiphertext,
      token_iv: input.tokenIv,
      webhook_secret_hash: input.webhookSecretHash,
      // The reference flow gives self builds 7 days and customer builds 30 days.
      trial_ends_at: new Date(Date.now() + input.trialDays * 86_400_000).toISOString(),
    };
    // Insert and return generated ids, timestamps, and settings.
    const { data, error } = await this.#client.from("telegram_shop_bots").insert(payload).select("*").single();
    // Unique bot ids and usernames are enforced in PostgreSQL.
    ensureNoError(error, "create shop");
    // Return the complete tenant record.
    return data as ShopBotRow;
  }

  // Remove a newly created tenant when Telegram rejects webhook registration.
  async deleteShop(ownerTelegramId: number, shopId: string): Promise<void> {
    // Require both the generated id and immutable owner id for the cleanup.
    const { error } = await this.#client
      .from("telegram_shop_bots")
      .delete()
      .eq("id", shopId)
      .eq("owner_telegram_id", ownerTelegramId);
    // Surface cleanup failures for operational logs.
    ensureNoError(error, "delete shop");
  }

  // Read one shop by its unguessable public webhook path component.
  async getShopByWebhookKey(webhookKey: string): Promise<ShopBotRow | null> {
    // Only the exact unique key can resolve a tenant.
    const { data, error } = await this.#client
      .from("telegram_shop_bots")
      .select("*")
      .eq("webhook_key", webhookKey)
      .maybeSingle();
    // Validate the lookup.
    ensureNoError(error, "get shop by webhook key");
    // Return null for an unknown path.
    return data as ShopBotRow | null;
  }

  // Read a shop by its internal UUID.
  async getShopById(shopId: string): Promise<ShopBotRow | null> {
    // id is the primary key and needs no owner filter at this internal boundary.
    const { data, error } = await this.#client.from("telegram_shop_bots").select("*").eq("id", shopId).maybeSingle();
    // Validate the lookup.
    ensureNoError(error, "get shop by id");
    // Preserve nullable semantics.
    return data as ShopBotRow | null;
  }

  // Merge one or more owner settings without discarding unrelated configuration.
  async updateShopSettings(
    shop: ShopBotRow,
    patch: Omit<Partial<ShopSettings>, "payment"> & { payment?: Partial<ShopSettings["payment"]> },
  ): Promise<ShopBotRow> {
    // Merge nested payment settings separately when the patch contains them.
    const settings: ShopSettings = {
      ...shop.settings,
      ...patch,
      payment: { ...shop.settings.payment, ...(patch.payment ?? {}) },
    };
    // Update only this tenant's settings column.
    const { data, error } = await this.#client
      .from("telegram_shop_bots")
      .update({ settings })
      .eq("id", shop.id)
      .select("*")
      .single();
    // Validate the update.
    ensureNoError(error, "update shop settings");
    // Return the refreshed row for immediate use.
    return data as ShopBotRow;
  }

  // Read a persisted conversation wizard.
  async getSession(sessionKey: string): Promise<ConversationSessionRow | null> {
    // Sessions are addressed by a complete builder/store namespace key.
    const { data, error } = await this.#client
      .from("telegram_shop_sessions")
      .select("*")
      .eq("session_key", sessionKey)
      .maybeSingle();
    // Validate the lookup.
    ensureNoError(error, "get session");
    // Return null when no wizard is active.
    return data as ConversationSessionRow | null;
  }

  // Start or advance a conversation wizard.
  async setSession(input: Omit<ConversationSessionRow, "updated_at">): Promise<void> {
    // Upsert makes every step transition one atomic row write.
    const { error } = await this.#client
      .from("telegram_shop_sessions")
      .upsert(input, { onConflict: "session_key" });
    // Stop if the transition could not be persisted.
    ensureNoError(error, "set session");
  }

  // Clear a wizard after completion or an explicit back action.
  async clearSession(sessionKey: string): Promise<void> {
    // Delete exactly one namespaced session.
    const { error } = await this.#client.from("telegram_shop_sessions").delete().eq("session_key", sessionKey);
    // Validate the cleanup.
    ensureNoError(error, "clear session");
  }

  // Insert or refresh one storefront user while preserving wallet data.
  async upsertStoreUser(shopId: string, user: TelegramUser, referrerTelegramId?: number | null): Promise<StoreUserRow> {
    // Look up the existing record so a later /start never replaces its referrer.
    const existing = await this.getStoreUser(shopId, user.id);
    // Resolve an optional referrer inside the same tenant only for a new user.
    const referrer = !existing && referrerTelegramId && referrerTelegramId !== user.id
      ? await this.getStoreUser(shopId, referrerTelegramId)
      : null;
    // Build the profile refresh payload.
    const payload = {
      shop_id: shopId,
      telegram_user_id: user.id,
      username: user.username ?? null,
      first_name: user.first_name,
      last_name: user.last_name ?? null,
      last_seen_at: new Date().toISOString(),
      // Only a first insert receives the resolved same-shop referrer.
      ...(!existing && referrer ? { referred_by: referrer.id } : {}),
    };
    // Upsert by the compound tenant/user unique key.
    const { data, error } = await this.#client
      .from("telegram_shop_users")
      .upsert(payload, { onConflict: "shop_id,telegram_user_id" })
      .select("*")
      .single();
    // Validate the profile write.
    ensureNoError(error, "upsert store user");
    // Return the row containing the preserved balance.
    return data as StoreUserRow;
  }

  // Read one user inside one tenant.
  async getStoreUser(shopId: string, telegramUserId: number): Promise<StoreUserRow | null> {
    // Both filters are required for tenant isolation.
    const { data, error } = await this.#client
      .from("telegram_shop_users")
      .select("*")
      .eq("shop_id", shopId)
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    // Validate the lookup.
    ensureNoError(error, "get store user");
    // Preserve nullable semantics.
    return data as StoreUserRow | null;
  }

  // Read a storefront user by internal UUID for top-up administration.
  async getStoreUserById(shopId: string, userId: string): Promise<StoreUserRow | null> {
    // Apply both tenant and user ids so callback data cannot cross shops.
    const { data, error } = await this.#client
      .from("telegram_shop_users")
      .select("*")
      .eq("shop_id", shopId)
      .eq("id", userId)
      .maybeSingle();
    // Validate the lookup.
    ensureNoError(error, "get store user by id");
    // Return null for a missing or cross-tenant row.
    return data as StoreUserRow | null;
  }

  // List storefront users for management, broadcasts, or backup.
  async listStoreUsers(shopId: string, limit = 100): Promise<StoreUserRow[]> {
    // Cap one response to protect Worker memory and Supabase response size.
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    // Order newest users first in the management view.
    const { data, error } = await this.#client
      .from("telegram_shop_users")
      .select("*")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false })
      .limit(safeLimit);
    // Validate the list query.
    ensureNoError(error, "list store users");
    // Return a stable array.
    return (data ?? []) as StoreUserRow[];
  }

  // List categories in their configured order.
  async listCategories(shopId: string): Promise<CategoryRow[]> {
    // Tenant filtering is mandatory on catalogue reads.
    const { data, error } = await this.#client
      .from("telegram_shop_categories")
      .select("*")
      .eq("shop_id", shopId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    // Validate the query.
    ensureNoError(error, "list categories");
    // Return the ordered categories.
    return (data ?? []) as CategoryRow[];
  }

  // Add one category to a shop.
  async createCategory(shopId: string, name: string): Promise<CategoryRow> {
    // Append after existing categories by using their current count as position.
    const position = (await this.listCategories(shopId)).length;
    // Insert the tenant-scoped category.
    const { data, error } = await this.#client
      .from("telegram_shop_categories")
      .insert({ shop_id: shopId, name: name.trim(), position })
      .select("*")
      .single();
    // PostgreSQL also prevents duplicate names inside one shop.
    ensureNoError(error, "create category");
    // Return the generated UUID.
    return data as CategoryRow;
  }

  // Delete one category only when it belongs to the active shop.
  async deleteCategory(shopId: string, categoryId: string): Promise<void> {
    // Product foreign keys become null instead of deleting products.
    const { error } = await this.#client
      .from("telegram_shop_categories")
      .delete()
      .eq("shop_id", shopId)
      .eq("id", categoryId);
    // Validate the deletion.
    ensureNoError(error, "delete category");
  }

  // Rename one category without affecting its products or position.
  async updateCategory(shopId: string, categoryId: string, name: string): Promise<CategoryRow | null> {
    // Both ids enforce tenant ownership at the mutation boundary.
    const { data, error } = await this.#client
      .from("telegram_shop_categories")
      .update({ name: name.trim() })
      .eq("shop_id", shopId)
      .eq("id", categoryId)
      .select("*")
      .maybeSingle();
    // Validate uniqueness and length constraints.
    ensureNoError(error, "update category");
    // Return the refreshed category or null for an unknown callback id.
    return data as CategoryRow | null;
  }

  // List products, optionally restricted to one category.
  async listProducts(shopId: string, categoryId?: string, activeOnly = false): Promise<ProductRow[]> {
    // Start with the mandatory tenant filter.
    let query = this.#client.from("telegram_shop_products").select("*").eq("shop_id", shopId);
    // Apply a category filter when the caller selected one.
    if (categoryId) query = query.eq("category_id", categoryId);
    // Customer catalogue views hide unavailable products.
    if (activeOnly) query = query.eq("is_active", true);
    // Newer products appear first like the reference flow.
    const { data, error } = await query.order("created_at", { ascending: false }).limit(200);
    // Validate the list query.
    ensureNoError(error, "list products");
    // Return a bounded product list.
    return (data ?? []) as ProductRow[];
  }

  // Search Persian and English product names inside one shop.
  async searchProducts(shopId: string, term: string): Promise<ProductRow[]> {
    // Fetch a bounded active catalogue and normalize names in application code.
    const products = await this.listProducts(shopId, undefined, true);
    // Persian lowercasing is harmless and English lowercasing is required.
    const needle = term.trim().toLocaleLowerCase("fa-IR");
    // Limit results so one search cannot flood a chat.
    return products
      .filter((product) => product.name_fa.toLocaleLowerCase("fa-IR").includes(needle)
        || product.name_en?.toLocaleLowerCase("en-US").includes(needle))
      .slice(0, 20);
  }

  // Read one product by UUID and prove it belongs to the active tenant.
  async getProduct(shopId: string, productId: string): Promise<ProductRow | null> {
    // Both shop and product ids are required.
    const { data, error } = await this.#client
      .from("telegram_shop_products")
      .select("*")
      .eq("shop_id", shopId)
      .eq("id", productId)
      .maybeSingle();
    // Validate the lookup.
    ensureNoError(error, "get product");
    // Return null for a cross-tenant or missing id.
    return data as ProductRow | null;
  }

  // Resolve a deep-link public product code.
  async getProductByPublicCode(shopId: string, publicCode: number): Promise<ProductRow | null> {
    // The shop filter prevents another tenant's deep link from leaking a product.
    const { data, error } = await this.#client
      .from("telegram_shop_products")
      .select("*")
      .eq("shop_id", shopId)
      .eq("public_code", publicCode)
      .maybeSingle();
    // Validate the lookup.
    ensureNoError(error, "get product by public code");
    // Preserve nullable semantics.
    return data as ProductRow | null;
  }

  // Insert the non-price portion of a completed product wizard.
  async createProduct(input: Omit<ProductRow, "id" | "public_code" | "created_at" | "updated_at">): Promise<ProductRow> {
    // Insert all product presentation and delivery fields at once.
    const { data, error } = await this.#client.from("telegram_shop_products").insert(input).select("*").single();
    // Validate database constraints.
    ensureNoError(error, "create product");
    // Return the generated public deep-link code.
    return data as ProductRow;
  }

  // Update one product inside the active tenant.
  async updateProduct(shopId: string, productId: string, patch: Partial<ProductRow>): Promise<ProductRow> {
    // Strip immutable identifiers and timestamps from an arbitrary domain patch.
    const { id: _id, shop_id: _shopId, public_code: _publicCode, created_at: _createdAt, updated_at: _updatedAt, ...mutable } = patch;
    // Apply both tenant and product filters.
    const { data, error } = await this.#client
      .from("telegram_shop_products")
      .update(mutable)
      .eq("shop_id", shopId)
      .eq("id", productId)
      .select("*")
      .single();
    // Validate the update.
    ensureNoError(error, "update product");
    // Return the refreshed product.
    return data as ProductRow;
  }

  // Permanently delete one tenant product and its cascading plans.
  async deleteProduct(shopId: string, productId: string): Promise<void> {
    // The tenant predicate protects against cross-shop callback ids.
    const { error } = await this.#client
      .from("telegram_shop_products")
      .delete()
      .eq("shop_id", shopId)
      .eq("id", productId);
    // Validate the deletion.
    ensureNoError(error, "delete product");
  }

  // List all plans belonging to one product.
  async listPlans(productId: string, activeOnly = false): Promise<PlanRow[]> {
    // Start with the product foreign key.
    let query = this.#client.from("telegram_shop_plans").select("*").eq("product_id", productId);
    // Customer product cards show active plans only.
    if (activeOnly) query = query.eq("is_active", true);
    // Preserve the owner's configured plan order.
    const { data, error } = await query.order("position", { ascending: true }).order("created_at", { ascending: true });
    // Validate the query.
    ensureNoError(error, "list plans");
    // Return a stable plan array.
    return (data ?? []) as PlanRow[];
  }

  // Read a plan and confirm its product belongs to the active shop.
  async getPlanForShop(shopId: string, planId: string): Promise<{ plan: PlanRow; product: ProductRow } | null> {
    // Fetch the plan first by its primary key.
    const { data, error } = await this.#client.from("telegram_shop_plans").select("*").eq("id", planId).maybeSingle();
    // Validate the plan lookup.
    ensureNoError(error, "get plan");
    // A missing plan cannot produce a product.
    if (!data) return null;
    // Confirm the parent product's tenant.
    const product = await this.getProduct(shopId, (data as PlanRow).product_id);
    // Reject cross-tenant plan ids.
    if (!product) return null;
    // Return both records for invoice rendering.
    return { plan: data as PlanRow, product };
  }

  // Add a named plan to a product.
  async createPlan(productId: string, name: string, price: number): Promise<PlanRow> {
    // Append after existing plans.
    const position = (await this.listPlans(productId)).length;
    // Insert the validated amount and label.
    const { data, error } = await this.#client
      .from("telegram_shop_plans")
      .insert({ product_id: productId, name: name.trim(), price, position })
      .select("*")
      .single();
    // Validate the insert.
    ensureNoError(error, "create plan");
    // Return the generated plan id.
    return data as PlanRow;
  }

  // Update a single plan after confirming its product tenant.
  async updatePlan(shopId: string, planId: string, patch: Partial<PlanRow>): Promise<PlanRow | null> {
    // Reuse the tenant-safe relationship check.
    const resolved = await this.getPlanForShop(shopId, planId);
    // Unknown or cross-tenant plans are ignored safely.
    if (!resolved) return null;
    // Remove immutable fields from the update payload.
    const { id: _id, product_id: _productId, created_at: _createdAt, updated_at: _updatedAt, ...mutable } = patch;
    // Update by the verified primary key.
    const { data, error } = await this.#client.from("telegram_shop_plans").update(mutable).eq("id", planId).select("*").single();
    // Validate the update.
    ensureNoError(error, "update plan");
    // Return the refreshed row.
    return data as PlanRow;
  }

  // Delete a plan after confirming its tenant relationship.
  async deletePlan(shopId: string, planId: string): Promise<void> {
    // Reject a cross-tenant callback id.
    if (!(await this.getPlanForShop(shopId, planId))) return;
    // Delete the verified plan.
    const { error } = await this.#client.from("telegram_shop_plans").delete().eq("id", planId);
    // Validate the deletion.
    ensureNoError(error, "delete plan");
  }

  // Apply a fixed or percentage price change to selected products.
  async bulkChangePrices(
    shopId: string,
    selector: { kind: "all" } | { kind: "category"; id: string } | { kind: "product"; id: string },
    direction: "increase" | "decrease",
    amountType: "fixed" | "percent",
    amount: number,
  ): Promise<number> {
    // Resolve tenant products according to the owner's selection.
    const products = selector.kind === "category"
      ? await this.listProducts(shopId, selector.id)
      : selector.kind === "product"
        ? [await this.getProduct(shopId, selector.id)].filter((product): product is ProductRow => product !== null)
        : await this.listProducts(shopId);
    // Track how many plans were changed for the confirmation message.
    let changed = 0;
    // Update each product's plans sequentially to avoid a large outbound burst.
    for (const product of products) {
      // Read all active and inactive plans because management changes both.
      const plans = await this.listPlans(product.id);
      // Update every plan with a non-negative result.
      for (const plan of plans) {
        // Calculate a fixed delta or rounded percentage delta.
        const delta = amountType === "percent" ? Math.round((plan.price * amount) / 100) : amount;
        // Decreases never cross below zero.
        const price = direction === "increase" ? plan.price + delta : Math.max(0, plan.price - delta);
        // Await every database mutation before continuing.
        await this.updatePlan(shopId, plan.id, { price });
        // Increment the confirmation count.
        changed += 1;
      }
    }
    // Return the number of affected plans.
    return changed;
  }

  // Create one fixed-value discount code.
  async createDiscount(shopId: string, code: string, amount: number, maxUses: number): Promise<DiscountCodeRow> {
    // Normalize surrounding whitespace while preserving owner-selected case for display.
    const { data, error } = await this.#client
      .from("telegram_shop_discount_codes")
      .insert({ shop_id: shopId, code: code.trim(), amount, max_uses: maxUses })
      .select("*")
      .single();
    // Database uniqueness prevents duplicate codes in one shop.
    ensureNoError(error, "create discount");
    // Return the code record.
    return data as DiscountCodeRow;
  }

  // List discount codes newest-first.
  async listDiscounts(shopId: string): Promise<DiscountCodeRow[]> {
    // Apply the tenant filter before ordering.
    const { data, error } = await this.#client
      .from("telegram_shop_discount_codes")
      .select("*")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false });
    // Validate the query.
    ensureNoError(error, "list discounts");
    // Return a stable array.
    return (data ?? []) as DiscountCodeRow[];
  }

  // Resolve an active fixed-value discount for invoice preview.
  async getValidDiscount(shopId: string, code: string): Promise<DiscountCodeRow | null> {
    // Query by tenant and a case-insensitive exact code.
    const { data, error } = await this.#client
      .from("telegram_shop_discount_codes")
      .select("*")
      .eq("shop_id", shopId)
      .ilike("code", code.trim())
      .eq("is_active", true)
      .maybeSingle();
    // Validate the Data API request.
    ensureNoError(error, "get valid discount");
    // Enforce usage and expiration in application code for the preview only;
    // the checkout RPC repeats these checks atomically.
    const discount = data as DiscountCodeRow | null;
    if (!discount || discount.used_count >= discount.max_uses) return null;
    if (discount.expires_at && new Date(discount.expires_at).getTime() <= Date.now()) return null;
    // Return the still-valid preview row.
    return discount;
  }

  // Delete a discount code inside the active tenant.
  async deleteDiscount(shopId: string, discountId: string): Promise<void> {
    // Both identifiers protect the mutation boundary.
    const { error } = await this.#client
      .from("telegram_shop_discount_codes")
      .delete()
      .eq("shop_id", shopId)
      .eq("id", discountId);
    // Validate the deletion.
    ensureNoError(error, "delete discount");
  }

  // Atomically charge a wallet and create an order through the secured RPC.
  async checkout(shopId: string, telegramUserId: number, planId: string, discountCode?: string | null): Promise<CheckoutResult> {
    // The database function locks the wallet row and validates tenant ownership.
    const { data, error } = await this.#client.rpc("telegram_shop_checkout", {
      p_shop_id: shopId,
      p_telegram_user_id: telegramUserId,
      p_plan_id: planId,
      p_discount_code: discountCode ?? null,
    });
    // Validate the RPC call itself; business failures are returned in data.ok.
    ensureNoError(error, "checkout");
    // Return the function's JSON result.
    return data as CheckoutResult;
  }

  // List the five most recent orders for an account card.
  async listRecentOrders(userId: string, limit = 5): Promise<OrderRow[]> {
    // Query by the internal user UUID so another tenant's rows cannot match.
    const { data, error } = await this.#client
      .from("telegram_shop_orders")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 20));
    // Validate the query.
    ensureNoError(error, "list recent orders");
    // Return a stable array.
    return (data ?? []) as OrderRow[];
  }

  // List the most recent immutable wallet ledger entries for an account card.
  async listRecentTransactions(userId: string, limit = 5): Promise<TransactionRow[]> {
    // The internal user UUID is already tenant-specific.
    const { data, error } = await this.#client
      .from("telegram_shop_transactions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 20));
    // Fail explicitly rather than presenting a partial financial history.
    ensureNoError(error, "list recent transactions");
    // Return a stable typed array.
    return (data ?? []) as TransactionRow[];
  }

  // Find one order by tracking code inside one shop.
  async findOrder(shopId: string, trackingCode: string): Promise<OrderRow | null> {
    // Normalize codes to uppercase because generated codes use uppercase.
    const { data, error } = await this.#client
      .from("telegram_shop_orders")
      .select("*")
      .eq("shop_id", shopId)
      .eq("tracking_code", trackingCode.trim().toUpperCase())
      .maybeSingle();
    // Validate the lookup.
    ensureNoError(error, "find order");
    // Return null when no code matches.
    return data as OrderRow | null;
  }

  // Create a card or gateway top-up request.
  async createTopup(shopId: string, userId: string, amount: number, method: "card" | "zarinpal"): Promise<{ id: string; transaction_code: string }> {
    // A short random code is easy to reference in support and logs.
    const transactionCode = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    // Insert the pending request.
    const { data, error } = await this.#client
      .from("telegram_shop_topups")
      .insert({ shop_id: shopId, user_id: userId, amount, method, transaction_code: transactionCode })
      .select("id,transaction_code")
      .single();
    // Validate the insert.
    ensureNoError(error, "create topup");
    // Return only fields needed by the chat flow.
    return data as { id: string; transaction_code: string };
  }

  // Attach a Telegram receipt file id and queue the top-up for review.
  async attachTopupReceipt(shopId: string, topupId: string, receiptFileId: string): Promise<void> {
    // Apply both tenant and request identifiers.
    const { error } = await this.#client
      .from("telegram_shop_topups")
      .update({ receipt_file_id: receiptFileId, status: "pending_review" })
      .eq("shop_id", shopId)
      .eq("id", topupId);
    // Validate the update.
    ensureNoError(error, "attach topup receipt");
  }

  // Find a tenant top-up by its public short transaction code.
  async findTopup(shopId: string, transactionCode: string): Promise<TopupRow | null> {
    // Both filters prevent a code from another shop being reviewed here.
    const { data, error } = await this.#client
      .from("telegram_shop_topups")
      .select("*")
      .eq("shop_id", shopId)
      .eq("transaction_code", transactionCode.trim().toUpperCase())
      .maybeSingle();
    // Validate the lookup.
    ensureNoError(error, "find topup");
    // Preserve null when the code does not exist.
    return data as TopupRow | null;
  }

  // Read one tenant top-up by its internal id for a hosted payment page.
  async getTopupById(shopId: string, topupId: string): Promise<TopupRow | null> {
    // Both identifiers keep public payment paths tenant-scoped.
    const { data, error } = await this.#client
      .from("telegram_shop_topups")
      .select("*")
      .eq("shop_id", shopId)
      .eq("id", topupId)
      .maybeSingle();
    // Validate the lookup.
    ensureNoError(error, "get topup by id");
    // Preserve null for an invalid link.
    return data as TopupRow | null;
  }

  // Store the ZarinPal authority and move the request into verification state.
  async setTopupAuthority(shopId: string, topupId: string, authority: string): Promise<void> {
    // Only an untouched online request may receive an authority.
    const { error } = await this.#client
      .from("telegram_shop_topups")
      .update({ payment_authority: authority, status: "pending_review" })
      .eq("shop_id", shopId)
      .eq("id", topupId)
      .eq("method", "zarinpal")
      .eq("status", "awaiting_receipt");
    // Validate the state transition.
    ensureNoError(error, "set topup authority");
  }

  // Store the external payment reference after the atomic wallet credit.
  async setTopupPaymentReference(shopId: string, topupId: string, reference: string): Promise<void> {
    // This metadata update is safe after approval because the credit RPC is idempotent.
    const { error } = await this.#client
      .from("telegram_shop_topups")
      .update({ payment_ref_id: reference })
      .eq("shop_id", shopId)
      .eq("id", topupId)
      .eq("method", "zarinpal")
      .eq("status", "approved");
    // Validate persistence of the gateway reference.
    ensureNoError(error, "set topup payment reference");
  }

  // Apply an owner top-up decision and credit the wallet exactly once.
  async reviewTopup(shopId: string, topupId: string, reviewerTelegramId: number, approve: boolean): Promise<TopupRow | null> {
    // Read the tenant request before deciding whether it can still be reviewed.
    const { data: currentData, error: currentError } = await this.#client
      .from("telegram_shop_topups")
      .select("*")
      .eq("shop_id", shopId)
      .eq("id", topupId)
      .maybeSingle();
    // Validate the read.
    ensureNoError(currentError, "read topup for review");
    // Missing or already-reviewed requests are deliberately idempotent.
    const current = currentData as TopupRow | null;
    if (!current || current.status !== "pending_review") return current;
    // Rejecting requires only a status transition.
    if (!approve) {
      const { data, error } = await this.#client
        .from("telegram_shop_topups")
        .update({ status: "rejected", reviewed_by: reviewerTelegramId, reviewed_at: new Date().toISOString() })
        .eq("id", current.id)
        .eq("status", "pending_review")
        .select("*")
        .maybeSingle();
      // Validate the rejection.
      ensureNoError(error, "reject topup");
      // Return the refreshed row or null after a concurrent decision.
      return data as TopupRow | null;
    }
    // A single SQL RPC is used for approval to avoid double-credit races.
    const { data, error } = await this.#client.rpc("telegram_shop_approve_topup", {
      p_shop_id: shopId,
      p_topup_id: current.id,
      p_reviewer_telegram_id: reviewerTelegramId,
    });
    // Validate the atomic function call.
    ensureNoError(error, "approve topup");
    // A null result means another request completed the review first.
    return data as TopupRow | null;
  }

  // Save information requested for a manually delivered order.
  async updateOrderCustomerInfo(shopId: string, orderId: string, customerInfo: string): Promise<void> {
    // Mark the paid order as waiting for an administrator to deliver it.
    const { error } = await this.#client
      .from("telegram_shop_orders")
      .update({ customer_info: customerInfo.trim(), status: "delivering" })
      .eq("shop_id", shopId)
      .eq("id", orderId)
      .eq("status", "paid");
    // Validate the tenant-scoped mutation.
    ensureNoError(error, "update order customer info");
  }

  // Mark an automatically delivered order as complete after all sends succeed.
  async completeOrder(shopId: string, orderId: string): Promise<void> {
    // Only paid/delivering orders can advance to completed.
    const { error } = await this.#client
      .from("telegram_shop_orders")
      .update({ status: "completed" })
      .eq("shop_id", shopId)
      .eq("id", orderId)
      .in("status", ["paid", "delivering"]);
    // Validate the tenant-scoped status transition.
    ensureNoError(error, "complete order");
  }

  // Save a support message mapping before forwarding to the support chat.
  async createSupportMessage(shopId: string, userId: string, userMessageId: number): Promise<string> {
    // Insert the new open ticket.
    const { data, error } = await this.#client
      .from("telegram_shop_support_messages")
      .insert({ shop_id: shopId, user_id: userId, user_message_id: userMessageId })
      .select("id")
      .single();
    // Validate the insert.
    ensureNoError(error, "create support message");
    // Return the UUID for future reply mapping.
    return (data as { id: string }).id;
  }

  // Queue a broadcast; the cron handler performs the actual fan-out.
  async createBroadcast(
    shopId: string,
    mode: "copy" | "forward",
    sourceChatId: number,
    sourceMessageId: number,
  ): Promise<BroadcastRow> {
    // Store the source message reference rather than duplicating its media.
    const { data, error } = await this.#client
      .from("telegram_shop_broadcasts")
      .insert({ shop_id: shopId, mode, source_chat_id: sourceChatId, source_message_id: sourceMessageId })
      .select("*")
      .single();
    // Validate the queue insert.
    ensureNoError(error, "create broadcast");
    // Return the queued job.
    return data as BroadcastRow;
  }

  // Read the oldest queued or running broadcast.
  async getNextBroadcast(): Promise<BroadcastRow | null> {
    // Process only one job per cron invocation to keep execution bounded.
    const { data, error } = await this.#client
      .from("telegram_shop_broadcasts")
      .select("*")
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    // Validate the queue lookup.
    ensureNoError(error, "get next broadcast");
    // Return null when no broadcast is waiting.
    return data as BroadcastRow | null;
  }

  // Read the next chronological batch of users for a broadcast.
  async listBroadcastBatch(shopId: string, after: string | null, limit = 25): Promise<StoreUserRow[]> {
    // Start with a deterministic tenant and timestamp order.
    let query = this.#client
      .from("telegram_shop_users")
      .select("*")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: true })
      .limit(Math.min(Math.max(limit, 1), 50));
    // Continue after the previous batch cursor.
    if (after) query = query.gt("created_at", after);
    // Execute the bounded query.
    const { data, error } = await query;
    // Validate the read.
    ensureNoError(error, "list broadcast batch");
    // Return the chronological users.
    return (data ?? []) as StoreUserRow[];
  }

  // Persist broadcast progress or completion.
  async updateBroadcast(broadcastId: string, patch: Partial<BroadcastRow>): Promise<void> {
    // Remove immutable identity and timestamp fields.
    const { id: _id, shop_id: _shopId, created_at: _createdAt, updated_at: _updatedAt, ...mutable } = patch;
    // Update only the selected job.
    const { error } = await this.#client.from("telegram_shop_broadcasts").update(mutable).eq("id", broadcastId);
    // Validate the progress write.
    ensureNoError(error, "update broadcast");
  }

  // Calculate the statistics shown in the management panel.
  async getShopStats(shopId: string): Promise<ShopStats> {
    // Start of the current UTC month is sufficient for consistent server reporting.
    const monthStart = new Date();
    // Move to the first day at midnight UTC.
    monthStart.setUTCDate(1);
    // Clear the time portion.
    monthStart.setUTCHours(0, 0, 0, 0);
    // Run independent aggregate reads concurrently.
    const [usersResult, monthUsersResult, ordersResult, monthOrdersResult, topupsResult] = await Promise.all([
      this.#client.from("telegram_shop_users").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
      this.#client.from("telegram_shop_users").select("id", { count: "exact", head: true }).eq("shop_id", shopId).gte("created_at", monthStart.toISOString()),
      this.#client.from("telegram_shop_orders").select("user_id,total").eq("shop_id", shopId).in("status", ["paid", "delivering", "completed"]),
      this.#client.from("telegram_shop_orders").select("total").eq("shop_id", shopId).in("status", ["paid", "delivering", "completed"]).gte("created_at", monthStart.toISOString()),
      this.#client.from("telegram_shop_topups").select("amount").eq("shop_id", shopId).eq("status", "approved"),
    ]);
    // Validate each aggregate query before using partial data.
    ensureNoError(usersResult.error, "count shop users");
    ensureNoError(monthUsersResult.error, "count monthly users");
    ensureNoError(ordersResult.error, "sum orders");
    ensureNoError(monthOrdersResult.error, "sum monthly orders");
    ensureNoError(topupsResult.error, "sum topups");
    // Convert order rows to a typed numeric shape.
    const orders = (ordersResult.data ?? []) as Array<{ user_id: string; total: number }>;
    // Convert monthly rows to a numeric shape.
    const monthOrders = (monthOrdersResult.data ?? []) as Array<{ total: number }>;
    // Convert top-up rows to a numeric shape.
    const topups = (topupsResult.data ?? []) as Array<{ amount: number }>;
    // Build the management summary.
    return {
      totalUsers: usersResult.count ?? 0,
      usersThisMonth: monthUsersResult.count ?? 0,
      buyers: new Set(orders.map((order) => order.user_id)).size,
      totalSales: orders.reduce((sum, order) => sum + order.total, 0),
      salesThisMonth: monthOrders.reduce((sum, order) => sum + order.total, 0),
      totalTopups: topups.reduce((sum, topup) => sum + topup.amount, 0),
    };
  }

  // Export every tenant-owned table needed for a restorable backup.
  async getShopBackup(shopId: string): Promise<Record<string, JsonValue[]>> {
    // Resolve the owning builder so the restored bot foreign key has its parent row.
    const shop = await this.getShopById(shopId);
    // An unknown shop cannot produce a backup.
    if (!shop) return {};
    // Read only the one builder account referenced by this tenant.
    const { data: builderData, error: builderError } = await this.#client
      .from("telegram_shop_builder_accounts")
      .select("*")
      .eq("telegram_user_id", shop.owner_telegram_id);
    // Validate the parent-row lookup.
    ensureNoError(builderError, "backup telegram_shop_builder_accounts");
    // Direct tenant tables all expose shop_id.
    const directTables = [
      "telegram_shop_bots",
      "telegram_shop_users",
      "telegram_shop_sessions",
      "telegram_shop_categories",
      "telegram_shop_products",
      "telegram_shop_discount_codes",
      "telegram_shop_orders",
      "telegram_shop_transactions",
      "telegram_shop_topups",
      "telegram_shop_support_messages",
      "telegram_shop_broadcasts",
    ] as const;
    // Read all direct tables concurrently; the bot's own backup remains tenant-scoped.
    const directResults = await Promise.all(directTables.map(async (table) => {
      // Query rows belonging to this shop only.
      const tenantColumn = table === "telegram_shop_bots" ? "id" : "shop_id";
      // Filter the bot table by id and every other direct table by shop_id.
      const { data, error } = await this.#client.from(table).select("*").eq(tenantColumn, shopId);
      // Validate each table read.
      ensureNoError(error, `backup ${table}`);
      // Return a named tuple for Object.fromEntries.
      return [table, (data ?? []) as JsonValue[]] as const;
    }));
    // Plans do not have shop_id, so resolve them through this shop's product ids.
    const products = (directResults.find(([table]) => table === "telegram_shop_products")?.[1] ?? []) as Array<{ id?: JsonValue }>;
    // Extract only string UUIDs.
    const productIds = products.map((product) => product.id).filter((id): id is string => typeof id === "string");
    // Avoid PostgREST's empty in() edge case.
    const plans = productIds.length > 0
      ? await this.#client.from("telegram_shop_plans").select("*").in("product_id", productIds)
      : { data: [], error: null };
    // Validate the indirect query.
    ensureNoError(plans.error, "backup telegram_shop_plans");
    // Convert direct tuples to a lookup while preserving rows.
    const direct = Object.fromEntries(directResults) as Record<string, JsonValue[]>;
    // Return tables in foreign-key-safe restore order.
    return {
      telegram_shop_builder_accounts: (builderData ?? []) as JsonValue[],
      telegram_shop_bots: direct.telegram_shop_bots ?? [],
      telegram_shop_users: direct.telegram_shop_users ?? [],
      telegram_shop_sessions: direct.telegram_shop_sessions ?? [],
      telegram_shop_categories: direct.telegram_shop_categories ?? [],
      telegram_shop_products: direct.telegram_shop_products ?? [],
      telegram_shop_plans: (plans.data ?? []) as JsonValue[],
      telegram_shop_discount_codes: direct.telegram_shop_discount_codes ?? [],
      telegram_shop_orders: direct.telegram_shop_orders ?? [],
      telegram_shop_transactions: direct.telegram_shop_transactions ?? [],
      telegram_shop_topups: direct.telegram_shop_topups ?? [],
      telegram_shop_support_messages: direct.telegram_shop_support_messages ?? [],
      telegram_shop_broadcasts: direct.telegram_shop_broadcasts ?? [],
    };
  }
}
