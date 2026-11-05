-- Обновление: «секретный маршрут» — гости видят только бары, которые открыл гид.
-- Скопируйте весь файл в Supabase → SQL Editor → New query и нажмите Run (один раз).

alter table tours add column if not exists revealed int not null default 1;

create or replace function get_tour(p_code text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', t.id, 'code', t.code, 'date', t.tour_date, 'title', t.title,
    'total', coalesce(array_length(t.bar_ids, 1), 0),
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
