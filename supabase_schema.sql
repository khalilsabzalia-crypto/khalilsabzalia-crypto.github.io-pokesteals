-- PokéSteals database schema. Matches the live Supabase project (checked Nov 13, 2026).
-- Safe to run on a new project or an older one: every statement is "if not exists".

create table if not exists listings(
  id bigserial primary key,
  source text not null, external_id text not null,
  title text, price numeric, shipping numeric default 0, url text, image text,
  seller text, seller_reviews int, seller_rating numeric, photos int default 1,
  category text, market numeric, market_src text, discount numeric, score int,
  flags jsonb default '[]', suspicious boolean default false,
  first_seen timestamptz default now(), last_seen timestamptz default now(),
  unique(source, external_id)
);
-- columns added after the first version (no-ops if they already exist)
alter table listings
  add column if not exists condition text,        -- Vinted condition text, e.g. "Very good"
  add column if not exists cond_tier text,        -- nm / lp / mp / hp / dmg (our mapping)
  add column if not exists listed_at timestamptz, -- exact upload time (only when the product page was opened)
  add column if not exists listed_after timestamptz, -- estimate: listed after the previous scan
  add column if not exists prices jsonb,          -- estimated value per condition
  add column if not exists profit numeric,        -- estimated profit after fees
  add column if not exists match text,            -- how the card was identified ("number")
  add column if not exists hints jsonb default '[]',
  add column if not exists unaware boolean default false,
  add column if not exists detailed boolean default false,
  add column if not exists description text;
create index if not exists idx_listings_score on listings(score desc nulls last);

create table if not exists market_prices(  -- price cache; keys look like v2:<name>|<number>/<total>|<year>|<set>
  keyword text primary key, price numeric not null, updated timestamptz default now()
);
create table if not exists scans(
  id bigserial primary key, at timestamptz default now(), ok boolean, found int, added int, message text
);
create table if not exists usage(          -- Apify credit snapshot (one row, id = 1)
  id int primary key, used numeric not null, limit_usd numeric not null, cycle_end timestamptz, updated timestamptz default now()
);
create table if not exists settings(       -- auto-scan pause switch (one row, id = 1)
  id int primary key, paused boolean not null default false, updated timestamptz default now()
);
insert into settings(id, paused) values (1, false) on conflict (id) do nothing;
create table if not exists triggers(       -- scan-button cooldown log (used only by the scan-now Edge Function)
  id bigserial primary key, at timestamptz default now()
);

-- Security: the public website key may only READ listings, scans, usage and settings.
-- market_prices and triggers have no public policy. Writes use the service key (GitHub secret / Edge Function).
alter table listings enable row level security;
alter table market_prices enable row level security;
alter table scans enable row level security;
alter table usage enable row level security;
alter table settings enable row level security;
alter table triggers enable row level security;
drop policy if exists "public read listings" on listings; create policy "public read listings" on listings for select to anon using (true);
drop policy if exists "public read scans" on scans;       create policy "public read scans" on scans for select to anon using (true);
drop policy if exists "public read usage" on usage;       create policy "public read usage" on usage for select to anon using (true);
drop policy if exists "public read settings" on settings; create policy "public read settings" on settings for select to anon using (true);
