-- Phase 2.2. Prepare locally; apply only after review and isolated/Staging tests.
begin;

-- One bounded, short-lived intent per account; no OTPs, emails or tokens stored.
create table mednerds_private.account_deletion_intents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  challenge_id uuid not null unique default pg_catalog.gen_random_uuid(),
  session_id uuid not null references auth.sessions(id) on delete cascade,
  requested_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null default (pg_catalog.clock_timestamp() + interval '5 minutes'),
  ready boolean not null default false,
  consumed_at timestamptz
);
alter table mednerds_private.account_deletion_intents enable row level security;
revoke all on mednerds_private.account_deletion_intents from public, anon, authenticated, service_role;

create function public.account_deletion_begin(target_user uuid, target_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare challenge uuid;
begin
  if not exists (select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = target_session and u.id = target_user and u.email_confirmed_at is not null) then
    return pg_catalog.jsonb_build_object('status', 'not_authenticated');
  end if;
  if exists (select 1 from public.staff_accounts where user_id = target_user and role = 'admin')
    and (select count(*) from public.staff_accounts where role = 'admin') <= 1 then
    return pg_catalog.jsonb_build_object('status', 'last_admin');
  end if;
  insert into mednerds_private.account_deletion_intents (user_id, session_id)
    values (target_user, target_session)
    on conflict (user_id) do update set
      challenge_id = pg_catalog.gen_random_uuid(), session_id = excluded.session_id,
      requested_at = excluded.requested_at, expires_at = excluded.expires_at,
      ready = false, consumed_at = null
    where account_deletion_intents.requested_at < pg_catalog.clock_timestamp() - interval '60 seconds'
    returning challenge_id into challenge;
  if challenge is null then return pg_catalog.jsonb_build_object('status', 'rate_limited'); end if;
  return pg_catalog.jsonb_build_object('status', 'created', 'challenge_id', challenge);
end;
$$;

-- Only activate an intent AFTER a fresh email OTP was successfully requested.
create function public.account_deletion_ready(target_user uuid, target_session uuid, challenge uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update mednerds_private.account_deletion_intents i set ready = true
    where i.user_id = target_user and i.session_id = target_session and i.challenge_id = challenge
      and i.expires_at > pg_catalog.clock_timestamp() and i.consumed_at is null
      and exists (select 1 from auth.sessions where id = target_session and user_id = target_user);
  return found;
end;
$$;

-- Atomic one-attempt claim BEFORE OTP verification. Retries need a new intent/code.
create function public.account_deletion_claim(target_user uuid, target_session uuid, challenge uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update mednerds_private.account_deletion_intents i set consumed_at = pg_catalog.clock_timestamp()
    where i.user_id = target_user and i.session_id = target_session and i.challenge_id = challenge
      and i.ready and i.expires_at > pg_catalog.clock_timestamp() and i.consumed_at is null
      and exists (select 1 from auth.sessions where id = target_session and user_id = target_user);
  return found;
end;
$$;

-- Recheck expiry/live original session after the server's OTP verification.
create function public.account_deletion_authorize(target_user uuid, target_session uuid, challenge uuid)
returns boolean language sql volatile security definer set search_path = '' as $$
  select exists (select 1 from mednerds_private.account_deletion_intents i
    join auth.sessions s on s.id = i.session_id and s.user_id = i.user_id
    where i.user_id = target_user and i.session_id = target_session and i.challenge_id = challenge
      and i.ready and i.consumed_at is not null and i.expires_at > pg_catalog.clock_timestamp());
$$;

revoke all on function public.account_deletion_begin(uuid, uuid),
  public.account_deletion_ready(uuid, uuid, uuid), public.account_deletion_claim(uuid, uuid, uuid),
  public.account_deletion_authorize(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.account_deletion_begin(uuid, uuid),
  public.account_deletion_ready(uuid, uuid, uuid), public.account_deletion_claim(uuid, uuid, uuid),
  public.account_deletion_authorize(uuid, uuid, uuid)
  to service_role;

-- Serialize role writes/cascades while checking the actual DELETE transaction.
-- A preflight count in an Edge Function alone would race with another deletion.
create function mednerds_private.protect_last_account_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  lock table public.staff_accounts in share row exclusive mode;
  if exists (select 1 from public.staff_accounts where user_id = old.id and role = 'admin')
    and (select count(*) from public.staff_accounts where role = 'admin') <= 1 then
    raise exception using errcode = 'P0001', message = 'Last administrator cannot be deleted';
  end if;
  return old;
end;
$$;
revoke all on function mednerds_private.protect_last_account_admin()
  from public, anon, authenticated, service_role;
create trigger mednerds_protect_last_admin before delete on auth.users
  for each row execute function mednerds_private.protect_last_account_admin();

commit;
