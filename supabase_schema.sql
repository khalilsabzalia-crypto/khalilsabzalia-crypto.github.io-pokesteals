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
create index if not exists idx_listings_score on listings(score desc nulls last);
create table if not exists market_prices(keyword text primary key, price numeric not null, updated timestamptz default now());
create table if not exists scans(id bigserial primary key, at timestamptz default now(), ok boolean, found int, added int, message text);

-- Public dashboard may only READ listings and scans. Writes need the service key (GitHub secret).
alter table listings enable row level security;
alter table scans enable row level security;
alter table market_prices enable row level security;
create policy "public read listings" on listings for select to anon using (true);
create policy "public read scans" on scans for select to anon using (true);
