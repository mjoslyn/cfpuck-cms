-- Members (Settings > Members; src/lib/members/): site visitors with an account and a membership level,
-- for members-only pages and blocks and member ticket prices (members-only entries: fields.access, which
-- the site's loader enforces; the database API is closed to everyone but editors, *_closed_api.sql). A member is an auth user with a row here
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
-- Editors read them (the attendee list, member prices); admins manage them. Members themselves don't
-- reach the database: the server reads their row with the service key (src/lib/members/viewer.ts).
create policy "members editor read" on public.members for select to authenticated
  using ((select public.is_editor()));
create policy "members admin write" on public.members for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.members to authenticated, service_role;

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
