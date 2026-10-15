-- Members (Settings > Members; src/lib/members/): site visitors with an account and a membership level,
-- for members-only pages and blocks and member ticket prices. A member is an auth user with a row here
-- (their profile stays role 'viewer': no admin access). Admins add and manage them (/admin/members/);
-- visitors can sign up when the settings allow it.
create table public.members (
  user_id uuid primary key references auth.users on delete cascade,
  email text not null default '',
  name text not null default '',
  -- A level's id from settings.site.members.levels.
  level text not null default '',
  -- pending: signed up, waiting for an admin; active; suspended.
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  -- The membership lapses after this day (null: never).
  expires_on date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index members_status on public.members (status, level);

create trigger members_touch before update on public.members
  for each row execute function public.touch_updated_at();

alter table public.members enable row level security;
-- A member reads their own row; editors read all (the attendee list, member prices); admins manage them.
create policy "members own or editor read" on public.members for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_editor()));
create policy "members admin write" on public.members for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.members to authenticated, service_role;

-- Whether the signed-in user is an active member (of one of `levels`, a JSON array of level ids; none
-- or empty: any level), while Members is on (Settings > Members).
create or replace function public.member_can(levels jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = auth.uid() and m.status = 'active'
      and coalesce((select s.value->'members'->>'enabled' from public.settings s where s.key = 'site'), '') = 'true'
      and (m.expires_on is null or m.expires_on >= current_date)
      and (levels is null or jsonb_typeof(levels) <> 'array' or jsonb_array_length(levels) = 0 or levels ? m.level)
  );
$$;
grant execute on function public.member_can(jsonb) to anon, authenticated, service_role;

-- Members-only entries (fields.access.members = true; fields.access.levels: the levels that may see
-- them, none for any) are hidden from everyone else, so their content and text can't be read through
-- the API either. Editors see everything.
drop policy "entries public read" on public.entries;
create policy "entries public read" on public.entries for select
  using (
    (status = 'publish' and (coalesce(fields->'access'->>'members', '') <> 'true' or public.member_can(fields->'access'->'levels')))
    or (select public.is_editor())
  );

-- What anyone may know of a members-only entry, for its page's sign-in prompt: its address, title,
-- excerpt, featured image, template, search settings and who may see it. Never its content or fields.
create or replace function public.members_entry(p_types text[], p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'type', e.type, 'slug', e.slug, 'title', e.title, 'title_rendered', e.title_rendered,
    'excerpt', e.excerpt, 'excerpt_rendered', e.excerpt_rendered, 'status', e.status, 'template', e.template,
    'parent_id', e.parent_id, 'menu_order', e.menu_order, 'featured_media_id', e.featured_media_id,
    'published_at', e.published_at, 'updated_at', e.updated_at,
    'fields', jsonb_build_object('access', e.fields->'access', 'seo', e.fields->'seo')
  )
  from public.entries e
  where e.status = 'publish' and e.type = any(p_types) and e.slug = p_slug and e.fields->'access'->>'members' = 'true'
  order by array_position(p_types, e.type)
  limit 1;
$$;
grant execute on function public.members_entry(text[], text) to anon, authenticated, service_role;

-- The member who placed a ticket order (member prices and members-only tickets), if any.
alter table public.ticket_orders add column member_id uuid references auth.users on delete set null;

create or replace function public.ticket_order_create(p_order jsonb, p_limits jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry bigint := (p_order->>'entry_id')::bigint;
  v_occurrence text := coalesce(p_order->>'occurrence', '');
  v_taken jsonb;
  v_all bigint;
  v_want bigint;
  v_item jsonb;
  v_limit bigint;
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('tickets:' || v_entry || ':' || v_occurrence, 0));
  select coalesce(jsonb_object_agg(s.type, s.quantity), '{}'::jsonb), coalesce(sum(s.quantity), 0)
    into v_taken, v_all from public.ticket_sold(v_entry, v_occurrence) s;
  select coalesce(sum((i->>'quantity')::int), 0) into v_want from jsonb_array_elements(p_order->'items') i;
  for v_item in select * from jsonb_array_elements(p_order->'items') loop
    v_limit := nullif(p_limits->'types'->>(v_item->>'type'), '')::bigint;
    if v_limit is not null and coalesce((v_taken->>(v_item->>'type'))::bigint, 0) + (v_item->>'quantity')::int > v_limit then
      return jsonb_build_object('ok', false, 'type', v_item->>'type', 'left', greatest(v_limit - coalesce((v_taken->>(v_item->>'type'))::bigint, 0), 0));
    end if;
  end loop;
  v_limit := nullif(p_limits->>'total', '')::bigint;
  if v_limit is not null and v_all + v_want > v_limit then
    return jsonb_build_object('ok', false, 'left', greatest(v_limit - v_all, 0));
  end if;
  insert into public.ticket_orders (token, code, entry_id, occurrence, event_title, page, member_id, status, provider, name, email, phone, address, answers, items, quantity, amount, currency, expires_at, paid_at)
  values (
    p_order->>'token', p_order->>'code', v_entry, v_occurrence, coalesce(p_order->>'event_title', ''), coalesce(p_order->>'page', ''),
    nullif(p_order->>'member_id', '')::uuid,
    p_order->>'status', p_order->>'provider', p_order->>'name', p_order->>'email', coalesce(p_order->>'phone', ''),
    nullif(p_order->'address', 'null'::jsonb), coalesce(p_order->'answers', '{}'::jsonb), p_order->'items',
    v_want, (p_order->>'amount')::int, coalesce(p_order->>'currency', 'usd'),
    nullif(p_order->>'expires_at', '')::timestamptz, nullif(p_order->>'paid_at', '')::timestamptz
  )
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
