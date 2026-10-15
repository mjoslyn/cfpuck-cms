-- The page an order was placed on, or a waitlist joined on (a Tickets block can sit on any page, not
-- only the event's own), so the buyer comes back there and their emails link there. '': the event's own.
alter table public.ticket_orders add column page text not null default '';
alter table public.ticket_waitlist add column page text not null default '';

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
  insert into public.ticket_orders (token, code, entry_id, occurrence, event_title, page, status, provider, name, email, phone, address, answers, items, quantity, amount, currency, expires_at, paid_at)
  values (
    p_order->>'token', p_order->>'code', v_entry, v_occurrence, coalesce(p_order->>'event_title', ''), coalesce(p_order->>'page', ''),
    p_order->>'status', p_order->>'provider', p_order->>'name', p_order->>'email', coalesce(p_order->>'phone', ''),
    nullif(p_order->'address', 'null'::jsonb), coalesce(p_order->'answers', '{}'::jsonb), p_order->'items',
    v_want, (p_order->>'amount')::int, coalesce(p_order->>'currency', 'usd'),
    nullif(p_order->>'expires_at', '')::timestamptz, nullif(p_order->>'paid_at', '')::timestamptz
  )
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
