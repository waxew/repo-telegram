-- =============================================================================
-- Telegram Shop Builder v1
-- =============================================================================
-- Every object uses the telegram_shop_ prefix so this module can safely share
-- the existing ai-panel Supabase project with unrelated applications.

-- This helper refreshes updated_at before a row is changed.
create or replace function public.telegram_shop_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Builder accounts belong to people who create one or more customer bots.
create table if not exists public.telegram_shop_builder_accounts (
  telegram_user_id bigint primary key,
  username text,
  first_name text not null,
  last_name text,
  balance bigint not null default 0 check (balance >= 0),
  referral_code text not null unique,
  referred_by bigint references public.telegram_shop_builder_accounts (telegram_user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row represents one independently branded Telegram storefront.
create table if not exists public.telegram_shop_bots (
  id uuid primary key default gen_random_uuid(),
  owner_telegram_id bigint not null references public.telegram_shop_builder_accounts (telegram_user_id) on delete cascade,
  bot_telegram_id bigint not null unique,
  bot_username text not null unique,
  bot_display_name text not null,
  token_ciphertext text not null,
  token_iv text not null,
  webhook_key uuid not null default gen_random_uuid() unique,
  webhook_secret_hash text not null,
  status text not null default 'trial' check (status in ('trial', 'active', 'expired', 'suspended')),
  trial_ends_at timestamptz not null default (now() + interval '7 days'),
  subscription_ends_at timestamptz,
  settings jsonb not null default jsonb_build_object(
    'start_text', '👋 خوش آمدید.',
    'start_photo_file_id', null,
    'support_username', null,
    'support_chat_id', null,
    'log_channel_id', null,
    'satisfaction_channel_id', null,
    'force_channels', '[]'::jsonb,
    'second_admin_id', null,
    'referral_reward', 20000,
    'payment', jsonb_build_object(
      'card_enabled', true,
      'card_holder', null,
      'card_number', null,
      'zarinpal_enabled', false,
      'zarinpal_merchant_id', null
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Store users are isolated by shop_id even when the same person visits two bots.
create table if not exists public.telegram_shop_users (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.telegram_shop_bots (id) on delete cascade,
  telegram_user_id bigint not null,
  username text,
  first_name text not null,
  last_name text,
  balance bigint not null default 0 check (balance >= 0),
  referred_by uuid references public.telegram_shop_users (id) on delete set null,
  referral_rewarded boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, telegram_user_id)
);

-- Conversation steps make multi-message wizards survive Worker restarts.
create table if not exists public.telegram_shop_sessions (
  session_key text primary key,
  scope text not null check (scope in ('builder', 'store')),
  shop_id uuid references public.telegram_shop_bots (id) on delete cascade,
  telegram_user_id bigint not null,
  step text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Categories form the first level of the storefront catalogue.
create table if not exists public.telegram_shop_categories (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.telegram_shop_bots (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, name)
);

-- Products contain Telegram file_ids, so media can be resent without re-uploading.
create table if not exists public.telegram_shop_products (
  id uuid primary key default gen_random_uuid(),
  public_code bigint generated always as identity unique,
  shop_id uuid not null references public.telegram_shop_bots (id) on delete cascade,
  category_id uuid references public.telegram_shop_categories (id) on delete set null,
  name_fa text not null check (char_length(btrim(name_fa)) between 1 and 160),
  name_en text,
  description text not null default '',
  delivery_type text not null check (delivery_type in ('automatic', 'manual')),
  required_customer_info text,
  automatic_contents jsonb not null default '[]'::jsonb check (jsonb_typeof(automatic_contents) = 'array'),
  image_file_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(image_file_ids) = 'array'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A product can expose any number of named price plans.
create table if not exists public.telegram_shop_plans (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.telegram_shop_products (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  price bigint not null check (price >= 0),
  is_active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Discount codes follow the video's fixed-Toman discount and usage-limit model.
create table if not exists public.telegram_shop_discount_codes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.telegram_shop_bots (id) on delete cascade,
  code text not null,
  amount bigint not null check (amount > 0),
  max_uses integer not null check (max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, code),
  check (used_count <= max_uses)
);

-- Orders retain the charged values and delivery snapshot for later auditing.
create table if not exists public.telegram_shop_orders (
  id uuid primary key default gen_random_uuid(),
  tracking_code text not null unique,
  shop_id uuid not null references public.telegram_shop_bots (id) on delete cascade,
  user_id uuid not null references public.telegram_shop_users (id) on delete restrict,
  product_id uuid not null references public.telegram_shop_products (id) on delete restrict,
  plan_id uuid not null references public.telegram_shop_plans (id) on delete restrict,
  discount_code_id uuid references public.telegram_shop_discount_codes (id) on delete set null,
  subtotal bigint not null check (subtotal >= 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  total bigint not null check (total >= 0),
  status text not null default 'paid' check (status in ('pending', 'paid', 'delivering', 'completed', 'cancelled', 'refunded')),
  customer_info text,
  delivery_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every wallet mutation gets an immutable ledger row.
create table if not exists public.telegram_shop_transactions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.telegram_shop_bots (id) on delete cascade,
  user_id uuid not null references public.telegram_shop_users (id) on delete restrict,
  kind text not null check (kind in ('credit', 'debit', 'refund', 'referral', 'adjustment')),
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  description text,
  reference text,
  created_at timestamptz not null default now()
);

-- Card-to-card receipts wait here until an owner approves or rejects them.
create table if not exists public.telegram_shop_topups (
  id uuid primary key default gen_random_uuid(),
  transaction_code text not null unique,
  shop_id uuid not null references public.telegram_shop_bots (id) on delete cascade,
  user_id uuid not null references public.telegram_shop_users (id) on delete restrict,
  amount bigint not null check (amount > 0),
  method text not null check (method in ('card', 'zarinpal')),
  receipt_file_id text,
  payment_authority text unique,
  payment_ref_id text,
  status text not null default 'awaiting_receipt' check (status in ('awaiting_receipt', 'pending_review', 'approved', 'rejected')),
  reviewed_by bigint,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Support rows keep the relationship between a user message and the admin reply.
create table if not exists public.telegram_shop_support_messages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.telegram_shop_bots (id) on delete cascade,
  user_id uuid not null references public.telegram_shop_users (id) on delete restrict,
  user_message_id bigint not null,
  forwarded_message_id bigint,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Broadcasts are processed in small cron batches to protect webhook latency.
create table if not exists public.telegram_shop_broadcasts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.telegram_shop_bots (id) on delete cascade,
  mode text not null check (mode in ('copy', 'forward')),
  source_chat_id bigint not null,
  source_message_id bigint not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  cursor_created_at timestamptz,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tenant-first indexes keep the most common bot queries selective.
create index if not exists telegram_shop_bots_owner_idx on public.telegram_shop_bots (owner_telegram_id, created_at desc);
create index if not exists telegram_shop_builder_referrer_idx on public.telegram_shop_builder_accounts (referred_by);
create index if not exists telegram_shop_users_shop_created_idx on public.telegram_shop_users (shop_id, created_at desc);
create index if not exists telegram_shop_users_referrer_idx on public.telegram_shop_users (referred_by);
create index if not exists telegram_shop_sessions_stale_idx on public.telegram_shop_sessions (updated_at);
create index if not exists telegram_shop_sessions_shop_idx on public.telegram_shop_sessions (shop_id);
create index if not exists telegram_shop_categories_shop_position_idx on public.telegram_shop_categories (shop_id, position, created_at);
create index if not exists telegram_shop_products_shop_category_idx on public.telegram_shop_products (shop_id, category_id, is_active, created_at desc);
create index if not exists telegram_shop_products_category_idx on public.telegram_shop_products (category_id);
create index if not exists telegram_shop_products_name_fa_idx on public.telegram_shop_products (shop_id, lower(name_fa));
create index if not exists telegram_shop_products_name_en_idx on public.telegram_shop_products (shop_id, lower(name_en));
create index if not exists telegram_shop_plans_product_position_idx on public.telegram_shop_plans (product_id, position, created_at);
create index if not exists telegram_shop_orders_shop_created_idx on public.telegram_shop_orders (shop_id, created_at desc);
create index if not exists telegram_shop_orders_user_created_idx on public.telegram_shop_orders (user_id, created_at desc);
create index if not exists telegram_shop_orders_product_idx on public.telegram_shop_orders (product_id);
create index if not exists telegram_shop_orders_plan_idx on public.telegram_shop_orders (plan_id);
create index if not exists telegram_shop_orders_discount_idx on public.telegram_shop_orders (discount_code_id);
create index if not exists telegram_shop_transactions_user_created_idx on public.telegram_shop_transactions (user_id, created_at desc);
create index if not exists telegram_shop_transactions_shop_idx on public.telegram_shop_transactions (shop_id);
create index if not exists telegram_shop_topups_shop_status_idx on public.telegram_shop_topups (shop_id, status, created_at);
create index if not exists telegram_shop_topups_user_idx on public.telegram_shop_topups (user_id);
create index if not exists telegram_shop_support_shop_idx on public.telegram_shop_support_messages (shop_id);
create index if not exists telegram_shop_support_user_idx on public.telegram_shop_support_messages (user_id);
create index if not exists telegram_shop_broadcasts_queue_idx on public.telegram_shop_broadcasts (status, created_at);
create index if not exists telegram_shop_broadcasts_shop_idx on public.telegram_shop_broadcasts (shop_id);

-- Recreate triggers idempotently so schema.sql can also initialize local databases.
drop trigger if exists telegram_shop_builder_accounts_touch on public.telegram_shop_builder_accounts;
create trigger telegram_shop_builder_accounts_touch before update on public.telegram_shop_builder_accounts for each row execute function public.telegram_shop_touch_updated_at();
drop trigger if exists telegram_shop_bots_touch on public.telegram_shop_bots;
create trigger telegram_shop_bots_touch before update on public.telegram_shop_bots for each row execute function public.telegram_shop_touch_updated_at();
drop trigger if exists telegram_shop_users_touch on public.telegram_shop_users;
create trigger telegram_shop_users_touch before update on public.telegram_shop_users for each row execute function public.telegram_shop_touch_updated_at();
drop trigger if exists telegram_shop_categories_touch on public.telegram_shop_categories;
create trigger telegram_shop_categories_touch before update on public.telegram_shop_categories for each row execute function public.telegram_shop_touch_updated_at();
drop trigger if exists telegram_shop_products_touch on public.telegram_shop_products;
create trigger telegram_shop_products_touch before update on public.telegram_shop_products for each row execute function public.telegram_shop_touch_updated_at();
drop trigger if exists telegram_shop_plans_touch on public.telegram_shop_plans;
create trigger telegram_shop_plans_touch before update on public.telegram_shop_plans for each row execute function public.telegram_shop_touch_updated_at();
drop trigger if exists telegram_shop_discounts_touch on public.telegram_shop_discount_codes;
create trigger telegram_shop_discounts_touch before update on public.telegram_shop_discount_codes for each row execute function public.telegram_shop_touch_updated_at();
drop trigger if exists telegram_shop_orders_touch on public.telegram_shop_orders;
create trigger telegram_shop_orders_touch before update on public.telegram_shop_orders for each row execute function public.telegram_shop_touch_updated_at();
drop trigger if exists telegram_shop_topups_touch on public.telegram_shop_topups;
create trigger telegram_shop_topups_touch before update on public.telegram_shop_topups for each row execute function public.telegram_shop_touch_updated_at();
drop trigger if exists telegram_shop_support_touch on public.telegram_shop_support_messages;
create trigger telegram_shop_support_touch before update on public.telegram_shop_support_messages for each row execute function public.telegram_shop_touch_updated_at();
drop trigger if exists telegram_shop_broadcasts_touch on public.telegram_shop_broadcasts;
create trigger telegram_shop_broadcasts_touch before update on public.telegram_shop_broadcasts for each row execute function public.telegram_shop_touch_updated_at();

-- This transaction-safe RPC debits a wallet and creates an order exactly once.
create or replace function public.telegram_shop_checkout(
  p_shop_id uuid,
  p_telegram_user_id bigint,
  p_plan_id uuid,
  p_discount_code text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user public.telegram_shop_users%rowtype;
  v_product public.telegram_shop_products%rowtype;
  v_plan public.telegram_shop_plans%rowtype;
  v_discount public.telegram_shop_discount_codes%rowtype;
  v_discount_amount bigint := 0;
  v_total bigint;
  v_balance_after bigint;
  v_tracking_code text;
  v_order_id uuid;
  v_referral_reward bigint := 20000;
begin
  select * into v_user
  from public.telegram_shop_users
  where shop_id = p_shop_id and telegram_user_id = p_telegram_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'user_not_found');
  end if;

  select p.* into v_plan
  from public.telegram_shop_plans p
  where p.id = p_plan_id and p.is_active = true;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'plan_not_found');
  end if;

  select p.* into v_product
  from public.telegram_shop_products p
  where p.id = v_plan.product_id and p.shop_id = p_shop_id and p.is_active = true;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;

  if p_discount_code is not null and btrim(p_discount_code) <> '' then
    select * into v_discount
    from public.telegram_shop_discount_codes d
    where d.shop_id = p_shop_id
      and lower(d.code) = lower(btrim(p_discount_code))
      and d.is_active = true
      and d.used_count < d.max_uses
      and (d.expires_at is null or d.expires_at > now())
    for update;

    if not found then
      return jsonb_build_object('ok', false, 'reason', 'discount_invalid');
    end if;

    v_discount_amount := least(v_discount.amount, v_plan.price);
  end if;

  v_total := greatest(0, v_plan.price - v_discount_amount);

  if v_user.balance < v_total then
    return jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_balance',
      'shortfall', v_total - v_user.balance,
      'balance', v_user.balance,
      'total', v_total
    );
  end if;

  v_balance_after := v_user.balance - v_total;
  update public.telegram_shop_users set balance = v_balance_after where id = v_user.id;

  if v_discount.id is not null then
    update public.telegram_shop_discount_codes set used_count = used_count + 1 where id = v_discount.id;
  end if;

  v_tracking_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.telegram_shop_orders (
    tracking_code, shop_id, user_id, product_id, plan_id, discount_code_id,
    subtotal, discount_amount, total, status, delivery_snapshot
  ) values (
    v_tracking_code, p_shop_id, v_user.id, v_product.id, v_plan.id, v_discount.id,
    v_plan.price, v_discount_amount, v_total, 'paid',
    jsonb_build_object(
      'product_name', v_product.name_fa,
      'plan_name', v_plan.name,
      'delivery_type', v_product.delivery_type,
      'automatic_contents', v_product.automatic_contents,
      'required_customer_info', v_product.required_customer_info
    )
  ) returning id into v_order_id;

  if v_total > 0 then
    insert into public.telegram_shop_transactions (
      shop_id, user_id, kind, amount, balance_after, description, reference
    ) values (
      p_shop_id, v_user.id, 'debit', -v_total, v_balance_after,
      'خرید ' || v_product.name_fa || ' - ' || v_plan.name, v_tracking_code
    );
  end if;

  if v_user.referred_by is not null and v_user.referral_rewarded = false then
    select coalesce((settings->>'referral_reward')::bigint, 20000)
    into v_referral_reward
    from public.telegram_shop_bots
    where id = p_shop_id;

    update public.telegram_shop_users
    set balance = balance + v_referral_reward
    where id = v_user.referred_by;

    insert into public.telegram_shop_transactions (
      shop_id, user_id, kind, amount, balance_after, description, reference
    )
    select p_shop_id, u.id, 'referral', v_referral_reward, u.balance,
           'پاداش اولین خرید زیرمجموعه', v_tracking_code
    from public.telegram_shop_users u
    where u.id = v_user.referred_by;

    update public.telegram_shop_users set referral_rewarded = true where id = v_user.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'tracking_code', v_tracking_code,
    'balance_after', v_balance_after,
    'total', v_total,
    'product_name', v_product.name_fa,
    'plan_name', v_plan.name,
    'delivery_type', v_product.delivery_type,
    'automatic_contents', v_product.automatic_contents,
    'required_customer_info', v_product.required_customer_info
  );
end;
$$;

-- Approve a card receipt and credit its wallet in one transaction-safe operation.
create or replace function public.telegram_shop_approve_topup(
  p_shop_id uuid,
  p_topup_id uuid,
  p_reviewer_telegram_id bigint
)
returns public.telegram_shop_topups
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_topup public.telegram_shop_topups%rowtype;
  v_balance_after bigint;
begin
  -- Lock the pending request so two administrator taps cannot credit it twice.
  select * into v_topup
  from public.telegram_shop_topups
  where id = p_topup_id and shop_id = p_shop_id and status = 'pending_review'
  for update;

  -- A missing row means it was invalid or already reviewed.
  if not found then
    return null;
  end if;

  -- Credit the destination wallet and capture its new balance.
  update public.telegram_shop_users
  set balance = balance + v_topup.amount
  where id = v_topup.user_id and shop_id = p_shop_id
  returning balance into v_balance_after;

  -- Refuse to approve a request whose tenant/user relationship is broken.
  if not found then
    raise exception 'Top-up user does not belong to this shop';
  end if;

  -- Add the immutable ledger record before finalizing the request.
  insert into public.telegram_shop_transactions (
    shop_id, user_id, kind, amount, balance_after, description, reference
  ) values (
    p_shop_id, v_topup.user_id, 'credit', v_topup.amount, v_balance_after,
    'تأیید شارژ کیف پول', v_topup.transaction_code
  );

  -- Record who approved the receipt and when it happened.
  update public.telegram_shop_topups
  set status = 'approved', reviewed_by = p_reviewer_telegram_id, reviewed_at = now()
  where id = v_topup.id
  returning * into v_topup;

  -- Return the updated request for a confirmation message.
  return v_topup;
end;
$$;

-- RLS is defense in depth: this bot has no browser-to-database access at all.
alter table public.telegram_shop_builder_accounts enable row level security;
alter table public.telegram_shop_bots enable row level security;
alter table public.telegram_shop_users enable row level security;
alter table public.telegram_shop_sessions enable row level security;
alter table public.telegram_shop_categories enable row level security;
alter table public.telegram_shop_products enable row level security;
alter table public.telegram_shop_plans enable row level security;
alter table public.telegram_shop_discount_codes enable row level security;
alter table public.telegram_shop_orders enable row level security;
alter table public.telegram_shop_transactions enable row level security;
alter table public.telegram_shop_topups enable row level security;
alter table public.telegram_shop_support_messages enable row level security;
alter table public.telegram_shop_broadcasts enable row level security;

-- Public client roles receive no table or sequence permissions.
revoke all on table
  public.telegram_shop_builder_accounts,
  public.telegram_shop_bots,
  public.telegram_shop_users,
  public.telegram_shop_sessions,
  public.telegram_shop_categories,
  public.telegram_shop_products,
  public.telegram_shop_plans,
  public.telegram_shop_discount_codes,
  public.telegram_shop_orders,
  public.telegram_shop_transactions,
  public.telegram_shop_topups,
  public.telegram_shop_support_messages,
  public.telegram_shop_broadcasts
from anon, authenticated;

-- Only the backend secret role can access this module through the Data API.
grant all on table
  public.telegram_shop_builder_accounts,
  public.telegram_shop_bots,
  public.telegram_shop_users,
  public.telegram_shop_sessions,
  public.telegram_shop_categories,
  public.telegram_shop_products,
  public.telegram_shop_plans,
  public.telegram_shop_discount_codes,
  public.telegram_shop_orders,
  public.telegram_shop_transactions,
  public.telegram_shop_topups,
  public.telegram_shop_support_messages,
  public.telegram_shop_broadcasts
to service_role;

grant usage, select on all sequences in schema public to service_role;

-- The checkout RPC is also backend-only and does not bypass RLS on its own.
revoke all on function public.telegram_shop_checkout(uuid, bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.telegram_shop_checkout(uuid, bigint, uuid, text) to service_role;

-- Top-up approval is another backend-only atomic RPC.
revoke all on function public.telegram_shop_approve_topup(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.telegram_shop_approve_topup(uuid, uuid, bigint) to service_role;

-- The timestamp trigger helper is not a public API endpoint.
revoke all on function public.telegram_shop_touch_updated_at() from public, anon, authenticated;
grant execute on function public.telegram_shop_touch_updated_at() to service_role;
