-- Cover every foreign key used by tenant cleanup and join queries.
create index if not exists telegram_shop_builder_referrer_idx on public.telegram_shop_builder_accounts (referred_by);
create index if not exists telegram_shop_users_referrer_idx on public.telegram_shop_users (referred_by);
create index if not exists telegram_shop_sessions_shop_idx on public.telegram_shop_sessions (shop_id);
create index if not exists telegram_shop_products_category_idx on public.telegram_shop_products (category_id);
create index if not exists telegram_shop_orders_product_idx on public.telegram_shop_orders (product_id);
create index if not exists telegram_shop_orders_plan_idx on public.telegram_shop_orders (plan_id);
create index if not exists telegram_shop_orders_discount_idx on public.telegram_shop_orders (discount_code_id);
create index if not exists telegram_shop_transactions_shop_idx on public.telegram_shop_transactions (shop_id);
create index if not exists telegram_shop_topups_user_idx on public.telegram_shop_topups (user_id);
create index if not exists telegram_shop_support_shop_idx on public.telegram_shop_support_messages (shop_id);
create index if not exists telegram_shop_support_user_idx on public.telegram_shop_support_messages (user_id);
create index if not exists telegram_shop_broadcasts_shop_idx on public.telegram_shop_broadcasts (shop_id);
