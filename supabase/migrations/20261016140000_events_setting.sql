-- Events became an optional feature (Settings > Events, settings.site.events.enabled; src/lib/events/on.ts),
-- off until an admin turns it on. A site that already has events keeps them on.
--
-- An event now sells tickets while it has ticket types; the per-event switch (fields.tickets.enabled) is
-- gone. Events whose switch was off keep their ticket types, marked "no longer offered" (hidden), so they
-- don't start selling; the switch is removed from every event and from unpublished changes kept aside.
insert into public.settings (key, value)
select 'site', jsonb_build_object('events', jsonb_build_object('enabled', true))
where exists (select 1 from public.entries where type = 'event')
on conflict (key) do update set value = public.settings.value || jsonb_build_object('events', jsonb_build_object('enabled', true));

-- An event's tickets without the switch.
create function pg_temp.without_switch(t jsonb) returns jsonb language sql immutable as $$
  select (t - 'enabled') || case
    when coalesce((t->>'enabled')::boolean, false) then '{}'::jsonb
    else jsonb_build_object('types', coalesce((
      select jsonb_agg(x.v || '{"hidden": true}'::jsonb order by x.i)
      from jsonb_array_elements(case when jsonb_typeof(t->'types') = 'array' then t->'types' else '[]'::jsonb end) with ordinality as x(v, i)
      where jsonb_typeof(x.v) = 'object'
    ), '[]'::jsonb))
  end
$$;

alter table public.entries disable trigger entries_touch;
update public.entries
set fields = jsonb_set(fields, '{tickets}', pg_temp.without_switch(fields->'tickets'))
where type = 'event' and jsonb_typeof(fields->'tickets') = 'object' and fields->'tickets' ? 'enabled';
alter table public.entries enable trigger entries_touch;

update public.entry_drafts
set draft = jsonb_set(draft, '{entry,fields,tickets}', pg_temp.without_switch(draft->'entry'->'fields'->'tickets'))
where jsonb_typeof(draft->'entry'->'fields'->'tickets') = 'object' and draft->'entry'->'fields'->'tickets' ? 'enabled';
