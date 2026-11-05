-- Cocktails with the Local — база данных
-- Скопируйте весь этот файл в Supabase → SQL Editor → New query и нажмите Run.
-- В САМОМ НИЗУ замените email на свой.

create extension if not exists pgcrypto;

-- Гиды (кто может заходить в кабинет гида)
create table if not exists admins (
  email text primary key
);

-- Каталог баров
create table if not exists bars (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  map_url text,
  created_at timestamptz not null default now()
);

-- Экскурсии (у каждой свой маршрут)
create table if not exists tours (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  tour_date date not null default current_date,
  title text,
  bar_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
-- сколько баров маршрута гид уже открыл гостям
alter table tours add column if not exists revealed int not null default 1;

-- Отзывы гостей: один отзыв на гостя на бар в рамках экскурсии
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references tours(id) on delete cascade,
  bar_id uuid not null references bars(id) on delete restrict,
  guest_id uuid not null,
  guest_name text not null,
  rating int not null check (rating between 1 and 5),
  comment text,
  cocktails jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tour_id, bar_id, guest_id)
);

-- ---------- Доступ ----------
alter table admins  enable row level security;
alter table bars    enable row level security;
alter table tours   enable row level security;
alter table reviews enable row level security;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

drop policy if exists "guide bars"    on bars;
drop policy if exists "guide tours"   on tours;
drop policy if exists "guide reviews" on reviews;
create policy "guide bars"    on bars    for all to authenticated using (is_admin()) with check (is_admin());
create policy "guide tours"   on tours   for all to authenticated using (is_admin()) with check (is_admin());
create policy "guide reviews" on reviews for all to authenticated using (is_admin()) with check (is_admin());

-- Гости не читают таблицы напрямую — только через эти функции.

-- Получить экскурсию с барами по коду
create or replace function get_tour(p_code text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', t.id, 'code', t.code, 'date', t.tour_date, 'title', t.title,
    'total', coalesce(array_length(t.bar_ids, 1), 0),
    -- гостям отдаём только бары, которые гид уже открыл
    'bars', coalesce((
      select json_agg(json_build_object('id', b.id, 'name', b.name, 'address', b.address, 'map_url', b.map_url) order by x.ord)
      from unnest(t.bar_ids) with ordinality as x(bid, ord)
      join bars b on b.id = x.bid
      where x.ord <= t.revealed
    ), '[]'::json)
  )
  from tours t
  where upper(t.code) = upper(trim(p_code));
$$;

-- Свои отзывы гостя (guest_id — секретный номер, который хранится у гостя)
create or replace function get_my_reviews(p_tour uuid, p_guest uuid)
returns table (bar_id uuid, guest_name text, rating int, comment text, cocktails jsonb)
language sql stable security definer set search_path = public as $$
  select r.bar_id, r.guest_name, r.rating, r.comment, r.cocktails
  from reviews r where r.tour_id = p_tour and r.guest_id = p_guest;
$$;

-- Сохранить / обновить отзыв
create or replace function save_review(
  p_tour uuid, p_bar uuid, p_guest uuid, p_name text,
  p_rating int, p_comment text, p_cocktails jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from tours where id = p_tour and array_position(bar_ids, p_bar) between 1 and revealed) then
    raise exception 'bar is not open in this tour';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'name required';
  end if;
  if jsonb_typeof(p_cocktails) <> 'array' or jsonb_array_length(p_cocktails) > 20 or length(p_cocktails::text) > 10000 then
    raise exception 'bad cocktails';
  end if;
  insert into reviews (tour_id, bar_id, guest_id, guest_name, rating, comment, cocktails)
  values (p_tour, p_bar, p_guest, left(trim(p_name), 60), p_rating, left(coalesce(p_comment, ''), 2000), p_cocktails)
  on conflict (tour_id, bar_id, guest_id) do update set
    guest_name = excluded.guest_name,
    rating     = excluded.rating,
    comment    = excluded.comment,
    cocktails  = excluded.cocktails,
    updated_at = now();
end;
$$;

grant execute on function get_tour(text) to anon, authenticated;
grant execute on function get_my_reviews(uuid, uuid) to anon, authenticated;
grant execute on function save_review(uuid, uuid, uuid, text, int, text, jsonb) to anon, authenticated;

-- ---------- ВАШ EMAIL ГИДА ----------
-- Замените на email, с которым вы создадите пользователя в Authentication → Users
insert into admins (email) values ('your-email@example.com') on conflict do nothing;
