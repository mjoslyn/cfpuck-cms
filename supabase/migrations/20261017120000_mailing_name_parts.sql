-- Contacts' first and last names kept apart (merge tags {first_name} and {last_name}, segments, exports).
-- Existing names are split at the first space; `name` becomes the two joined, made by the database.
alter table public.contacts
  add column first_name text not null default '',
  add column last_name text not null default '';

alter table public.contacts disable trigger contacts_touch;
update public.contacts
   set first_name = coalesce(substring(btrim(name) from '^\S+'), ''),
       last_name = btrim(regexp_replace(btrim(name), '^\S+', ''))
 where btrim(name) <> '';
alter table public.contacts enable trigger contacts_touch;

alter table public.contacts drop column name;
alter table public.contacts add column name text generated always as (btrim(first_name || ' ' || last_name)) stored;
