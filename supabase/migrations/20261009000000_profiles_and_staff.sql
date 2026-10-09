-- No real identities or role assignments. Apply through a reviewed migration.
create schema if not exists mednerds_private;
revoke all on schema mednerds_private from public, anon, authenticated;

create type public.staff_role as enum ('author', 'admin');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint profiles_display_name_valid check (
    display_name is null or (
      pg_catalog.char_length(display_name) between 2 and 60
      and display_name = pg_catalog.btrim(display_name,
        U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\202F\205F\3000')
      and display_name !~ U&'[\0001-\001F\007F-\009F\200B-\200F\2028-\202E\2060-\206F\FEFF]'
    )
  )
);

create table public.staff_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.staff_role not null,
  author_slug text,
  created_at timestamptz not null default pg_catalog.now(),
  constraint staff_author_slug_valid check (
    author_slug is null or (
      pg_catalog.char_length(author_slug) between 1 and 100
      and author_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    )
  )
);

alter table public.profiles enable row level security;
alter table public.staff_accounts enable row level security;

-- Remove legacy/default table grants before selectively exposing columns.
revoke all on table public.profiles, public.staff_accounts from public, anon, authenticated;
grant select on table public.profiles, public.staff_accounts to authenticated;
grant update (display_name) on public.profiles to authenticated;
-- Privileged maintenance only; never use this credential in browser code.
grant all on table public.profiles, public.staff_accounts to service_role;

create policy profiles_read_own on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy staff_read_own on public.staff_accounts
  for select to authenticated using ((select auth.uid()) = user_id);
-- No INSERT/DELETE policies on profiles and no write policies on staff_accounts.
-- Even an application admin uses the same restricted authenticated DB role.

create function mednerds_private.prepare_profile()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Reject controls before trimming; do not silently accept multiline/bidi names.
  if new.display_name ~ U&'[\0001-\001F\007F-\009F\200B-\200F\2028-\202E\2060-\206F\FEFF]' then
    raise check_violation using message = 'Invalid display name';
  end if;
  new.display_name := nullif(pg_catalog.btrim(new.display_name,
    U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\202F\205F\3000'), '');
  if tg_op = 'INSERT' then
    new.created_at := pg_catalog.clock_timestamp();
    new.updated_at := new.created_at;
  else
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    new.updated_at := case when new.display_name is distinct from old.display_name
      then pg_catalog.clock_timestamp() else old.updated_at end;
  end if;
  return new;
end;
$$;

create trigger profiles_prepare before insert or update on public.profiles
  for each row execute function mednerds_private.prepare_profile();

-- The Auth service cannot write profiles itself; this narrowly scoped definer can.
create function mednerds_private.create_auth_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id)
    on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function mednerds_private.prepare_profile(), mednerds_private.create_auth_profile()
  from public, anon, authenticated;

create trigger mednerds_auth_user_created after insert on auth.users
  for each row execute function mednerds_private.create_auth_profile();
