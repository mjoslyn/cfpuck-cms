-- Accounts move from Supabase Auth (auth.users) to the site's own tables, read and written by Better
-- Auth (src/lib/auth): users, their sessions, their sign-in methods (accounts: a password, as bcrypt
-- from Supabase or scrypt once changed) and one-time values (verifications: password links). Every
-- account keeps its id, so profiles, members, authors and orders still point at it. Land this with the
-- code that uses it (CORE.md, Changing stored content): accounts made by the old code after it runs
-- aren't copied.

create table public.users (
  id uuid primary key,
  email text not null unique,
  name text not null default '',
  email_verified boolean not null default false,
  image text,
  -- The open invitation (src/lib/admin/invite.ts): its random value, cleared once a password is set.
  invite text,
  invited_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sessions (
  id text primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sessions_user_id_idx on public.sessions (user_id);

create table public.accounts (
  id text primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  account_id text not null,
  provider_id text not null,
  password text,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index accounts_user_id_idx on public.accounts (user_id);

create table public.verifications (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index verifications_identifier_idx on public.verifications (identifier);

-- Passwords and sessions are the server's alone: row security with no policies closes them to the
-- database API, whatever the grants.
alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.accounts enable row level security;
alter table public.verifications enable row level security;
revoke all on public.users, public.sessions, public.accounts, public.verifications from anon, authenticated;

-- The accounts as they are, with their passwords (bcrypt; Better Auth checks them and rehashes on
-- the next sign-in) and open invitations.
insert into public.users (id, email, name, email_verified, invite, invited_at, last_sign_in_at, created_at, updated_at)
select u.id, lower(u.email), coalesce(u.raw_user_meta_data->>'name', ''), u.email_confirmed_at is not null,
  u.raw_app_meta_data->>'invite', u.invited_at, u.last_sign_in_at, u.created_at, coalesce(u.updated_at, u.created_at)
from auth.users u
where u.email is not null and u.deleted_at is null;

insert into public.accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
select gen_random_uuid()::text, u.id, u.id::text, 'credential', u.encrypted_password, u.created_at, coalesce(u.updated_at, u.created_at)
from auth.users u
join public.users p on p.id = u.id
where coalesce(u.encrypted_password, '') <> '';

-- References to accounts point at the new table; ones to accounts that weren't copied are cleared.
delete from public.profiles where id not in (select id from public.users);
delete from public.members where user_id not in (select id from public.users);
update public.revisions set author_id = null where author_id not in (select id from public.users);
update public.compose_sessions set author_id = null where author_id not in (select id from public.users);
update public.compose_jobs set author_id = null where author_id not in (select id from public.users);
update public.ticket_orders set member_id = null where member_id not in (select id from public.users);
update public.campaigns set created_by = null where created_by not in (select id from public.users);
update public.campaigns set sent_by = null where sent_by not in (select id from public.users);
update public.campaigns set approved_by = null where approved_by not in (select id from public.users);

alter table public.profiles drop constraint profiles_id_fkey,
  add constraint profiles_id_fkey foreign key (id) references public.users (id) on delete cascade;
alter table public.members drop constraint members_user_id_fkey,
  add constraint members_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade;
alter table public.revisions drop constraint revisions_author_id_fkey,
  add constraint revisions_author_id_fkey foreign key (author_id) references public.users (id) on delete set null;
alter table public.compose_sessions drop constraint compose_sessions_author_id_fkey,
  add constraint compose_sessions_author_id_fkey foreign key (author_id) references public.users (id) on delete set null;
alter table public.compose_jobs drop constraint compose_jobs_author_id_fkey,
  add constraint compose_jobs_author_id_fkey foreign key (author_id) references public.users (id) on delete set null;
alter table public.ticket_orders drop constraint ticket_orders_member_id_fkey,
  add constraint ticket_orders_member_id_fkey foreign key (member_id) references public.users (id) on delete set null;
alter table public.campaigns drop constraint campaigns_created_by_fkey,
  add constraint campaigns_created_by_fkey foreign key (created_by) references public.users (id) on delete set null;
alter table public.campaigns drop constraint campaigns_sent_by_fkey,
  add constraint campaigns_sent_by_fkey foreign key (sent_by) references public.users (id) on delete set null;
alter table public.campaigns drop constraint campaigns_approved_by_fkey,
  add constraint campaigns_approved_by_fkey foreign key (approved_by) references public.users (id) on delete set null;

-- Profiles are made by the site when it makes an account (src/lib/auth), no longer by a trigger on
-- Supabase Auth's users; who is waiting for a password is the site's question too.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.awaiting_password();
