-- Обновление: общий фотоальбом вечера + общий рейтинг баров для гостей.
-- Скопируйте весь файл в Supabase → SQL Editor → New query и нажмите Run (один раз).

-- ---------- Рейтинг: гостям — только открытые бары + средняя оценка всех гостей ----------
create or replace function get_tour(p_code text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', t.id, 'code', t.code, 'date', t.tour_date, 'title', t.title,
    'total', coalesce(array_length(t.bar_ids, 1), 0),
    'bars', coalesce((
      select json_agg(json_build_object(
        'id', b.id, 'name', b.name, 'address', b.address, 'map_url', b.map_url,
        'avg', s.avg, 'count', s.cnt
      ) order by x.ord)
      from unnest(t.bar_ids) with ordinality as x(bid, ord)
      join bars b on b.id = x.bid
      left join lateral (
        select round(avg(r.rating)::numeric, 1) as avg, count(*) as cnt
        from reviews r where r.bar_id = b.id
      ) s on true
      where x.ord <= t.revealed
    ), '[]'::json)
  )
  from tours t
  where upper(t.code) = upper(trim(p_code));
$$;

-- ---------- Фотоальбом ----------
create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references tours(id) on delete cascade,
  guest_id uuid,               -- пусто, если фото загрузил гид
  author_name text not null,
  path text not null unique,   -- путь файла в хранилище tour-photos
  created_at timestamptz not null default now()
);
alter table photos enable row level security;
drop policy if exists "guide photos" on photos;
create policy "guide photos" on photos for all to authenticated using (is_admin()) with check (is_admin());

-- Загружать фото можно в день экскурсии и ещё 3 дня после
create or replace function photo_upload_allowed(p_folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tours where id::text = p_folder and tour_date >= current_date - 3);
$$;

create or replace function add_photo(p_tour uuid, p_guest uuid, p_name text, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not photo_upload_allowed(p_tour::text) then raise exception 'album is closed'; end if;
  if p_path not like p_tour::text || '/%' then raise exception 'bad path'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name required'; end if;
  if (select count(*) from photos where tour_id = p_tour) >= 300 then raise exception 'too many photos'; end if;
  insert into photos (tour_id, guest_id, author_name, path) values (p_tour, p_guest, left(trim(p_name), 60), p_path);
end;
$$;

create or replace function get_photos(p_tour uuid, p_guest uuid)
returns table (id uuid, author_name text, path text, created_at timestamptz, mine boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.author_name, p.path, p.created_at, (p.guest_id = p_guest)
  from photos p where p.tour_id = p_tour order by p.created_at desc;
$$;

create or replace function delete_my_photo(p_id uuid, p_guest uuid) returns void
language sql security definer set search_path = public as $$
  delete from photos where id = p_id and guest_id = p_guest;
$$;

grant execute on function photo_upload_allowed(text) to anon, authenticated;
grant execute on function add_photo(uuid, uuid, text, text) to anon, authenticated;
grant execute on function get_photos(uuid, uuid) to anon, authenticated;
grant execute on function delete_my_photo(uuid, uuid) to anon, authenticated;

-- Хранилище: смотреть по ссылке могут все, загружать — участники идущей экскурсии и гид
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tour-photos', 'tour-photos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "upload tour photos" on storage.objects;
drop policy if exists "guide deletes tour photos" on storage.objects;
create policy "upload tour photos" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'tour-photos' and (public.photo_upload_allowed((storage.foldername(name))[1]) or public.is_admin()));
create policy "guide deletes tour photos" on storage.objects for delete to authenticated
  using (bucket_id = 'tour-photos' and public.is_admin());
