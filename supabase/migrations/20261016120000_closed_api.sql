-- The database API answers editors only. Visitors and signed-in accounts that aren't editors (members,
-- sign-ups) get nothing from it: the site reads on the server with the service key (siteDb in
-- src/lib/supabase.ts) and decides itself what a visitor may see (published entries, members' access:
-- the Loader's scope, src/lib/data.ts). Editors keep their access through the policies that check
-- is_editor() / is_admin().

-- Anonymous requests: no tables, sequences or functions of ours, now or later.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- Reads that were open to anyone become editors' (each table's editor policy already covers reading,
-- except settings, which only admins write).
drop policy "entries public read" on public.entries;
drop policy "entry_terms public read" on public.entry_terms;
drop policy "terms public read" on public.terms;
drop policy "templates public read" on public.templates;
drop policy "media public read" on public.media;
drop policy "redirects public read" on public.redirects;
drop policy "forms public read" on public.forms;
drop policy "settings public read" on public.settings;
create policy "settings editor read" on public.settings for select to authenticated using ((select public.is_editor()));

-- Profiles: editors read them (the middleware finds a signed-in person's role this way: anyone else
-- reads nothing, so isn't an editor) and only editors rename themselves.
drop policy "own profile readable" on public.profiles;
create policy "profiles editor read" on public.profiles for select to authenticated using ((select public.is_editor()));
drop policy "profiles self update name" on public.profiles;
create policy "profiles self update name" on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select public.is_editor()))
  with check (id = (select auth.uid()) and role = (select public.own_role()));

-- Functions: the server's own (service key) aren't callable through the API. Policies call is_editor,
-- is_admin and own_role, so signed-in requests keep those; they only ever answer about the caller.
revoke execute on function public.not_found_hit(text, text) from public, anon, authenticated;
revoke execute on function public.redirect_hit(bigint) from public, anon, authenticated;
revoke execute on function public.ticket_order_status(text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_editor() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.own_role() from public, anon;
-- entry_body_text runs inside the trigger as the person saving, so editors keep it.
revoke execute on function public.entry_body_text(json) from public, anon;
revoke execute on function public.entries_body_text() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
-- Tickets taken: the editor's canvas asks for them. With the caller's own rights, the orders' policy
-- answers editors and no one else (the server's service key reads all).
alter function public.ticket_sold(bigint, text) security invoker;
revoke execute on function public.ticket_sold(bigint, text) from public, anon;
