-- Accounts waiting to set a password (the Users and Members screens' "invited" rows, and who Resend
-- invitation may go to): an open invitation (`app_metadata.invite`, src/lib/admin/invite.ts, cleared when
-- they set a password), or an invited account with no password at all. Opening Supabase Auth's own
-- invitation link gives an account a random password, so that alone doesn't show who set one.
-- Server only (service key): auth.users isn't the API's to read.
create or replace function public.awaiting_password()
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u
  where u.raw_app_meta_data ->> 'invite' is not null
     or (u.invited_at is not null and coalesce(u.encrypted_password, '') = '');
$$;

revoke all on function public.awaiting_password() from public, anon, authenticated;
grant execute on function public.awaiting_password() to service_role;
