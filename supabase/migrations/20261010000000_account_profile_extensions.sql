-- Phase 2.1: additive only. No changes to previously applied migration files.
create type public.avatar_provider as enum ('initials', 'gravatar');
alter table public.profiles
  add column professional_role text,
  add column professional_role_public boolean not null default false,
  add column avatar_provider public.avatar_provider not null default 'initials',
  add constraint profiles_professional_role_valid check (
    professional_role is null or (
      pg_catalog.char_length(professional_role) between 1 and 80
      and professional_role = pg_catalog.btrim(professional_role,
        U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\202F\205F\3000')
      and professional_role !~ U&'[\0001-\001F\007F-\009F\200B-\200F\2028-\202E\2060-\206F\FEFF]'
    )
  ),
  add constraint profiles_professional_role_visibility check (
    professional_role is not null or not professional_role_public
  );

grant update (professional_role, professional_role_public, avatar_provider)
  on public.profiles to authenticated;
-- Existing own-row RLS and protected ID/timestamp/staff grants remain unchanged.

create or replace function mednerds_private.prepare_profile()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.display_name ~ U&'[\0001-\001F\007F-\009F\200B-\200F\2028-\202E\2060-\206F\FEFF]'
    or new.professional_role ~ U&'[\0001-\001F\007F-\009F\200B-\200F\2028-\202E\2060-\206F\FEFF]' then
    raise check_violation using message = 'Invalid profile text';
  end if;
  new.display_name := nullif(pg_catalog.btrim(new.display_name,
    U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\202F\205F\3000'), '');
  new.professional_role := nullif(pg_catalog.regexp_replace(pg_catalog.btrim(new.professional_role,
    U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\202F\205F\3000'),
    U&'[\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\202F\205F\3000]+', ' ', 'g'), '');
  if new.professional_role is null then new.professional_role_public := false; end if;
  if tg_op = 'INSERT' then
    new.created_at := pg_catalog.clock_timestamp();
    new.updated_at := new.created_at;
  else
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    new.updated_at := case when row(new.display_name, new.professional_role,
      new.professional_role_public, new.avatar_provider) is distinct from
      row(old.display_name, old.professional_role, old.professional_role_public, old.avatar_provider)
      then pg_catalog.clock_timestamp() else old.updated_at end;
  end if;
  return new;
end;
$$;
revoke all on function mednerds_private.prepare_profile() from public, anon, authenticated;

-- Controlled document releases; not exposed through the public Data API.
create table mednerds_private.account_legal_releases (
  terms_version text not null,
  privacy_notice_version text not null,
  is_current boolean not null default false,
  gravatar_enabled boolean not null default false,
  primary key (terms_version, privacy_notice_version),
  check (terms_version ~ '^sha256:[0-9a-f]{64}$'),
  check (privacy_notice_version ~ '^sha256:[0-9a-f]{64}$')
);
create unique index account_legal_one_current
  on mednerds_private.account_legal_releases (is_current) where is_current;
alter table mednerds_private.account_legal_releases enable row level security;
revoke all on mednerds_private.account_legal_releases from public, anon, authenticated;

create table public.account_legal_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_notice_version text not null,
  accepted_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (user_id, terms_version, privacy_notice_version),
  foreign key (terms_version, privacy_notice_version)
    references mednerds_private.account_legal_releases (terms_version, privacy_notice_version)
);
alter table public.account_legal_acceptances enable row level security;
revoke all on public.account_legal_acceptances from public, anon, authenticated;
grant select on public.account_legal_acceptances to authenticated;
grant all on public.account_legal_acceptances to service_role;
create policy legal_read_own on public.account_legal_acceptances
  for select to authenticated using ((select auth.uid()) = user_id);

-- Only public configuration and the caller's own acceptance state are returned.
create function public.get_account_legal_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare current_release mednerds_private.account_legal_releases%rowtype;
begin
  select * into current_release from mednerds_private.account_legal_releases where is_current;
  return pg_catalog.jsonb_build_object(
    'registration_enabled', found,
    'terms_version', current_release.terms_version,
    'privacy_notice_version', current_release.privacy_notice_version,
    'gravatar_enabled', coalesce(current_release.gravatar_enabled, false),
    'accepted', exists (select 1 from public.account_legal_acceptances a
      where a.user_id = (select auth.uid()) and a.terms_version = current_release.terms_version
        and a.privacy_notice_version = current_release.privacy_notice_version));
end;
$$;

create function public.record_account_legal_acceptance(
  requested_terms_version text, requested_privacy_notice_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare identity uuid := (select auth.uid());
acceptance public.account_legal_acceptances%rowtype;
begin
  if identity is null or not exists (select 1 from auth.users u
    where u.id = identity and u.email_confirmed_at is not null) then
    raise insufficient_privilege using message = 'Verified account required';
  end if;
  -- The active release is server-controlled; no caller-supplied user ID or date.
  perform 1 from mednerds_private.account_legal_releases
    where is_current and terms_version = requested_terms_version
      and privacy_notice_version = requested_privacy_notice_version for share;
  if not found then raise invalid_parameter_value using message = 'Document release changed'; end if;
  insert into public.account_legal_acceptances (user_id, terms_version, privacy_notice_version)
    values (identity, requested_terms_version, requested_privacy_notice_version)
    on conflict (user_id, terms_version, privacy_notice_version) do nothing;
  select * into acceptance from public.account_legal_acceptances
    where user_id = identity and terms_version = requested_terms_version
      and privacy_notice_version = requested_privacy_notice_version;
  return pg_catalog.to_jsonb(acceptance);
end;
$$;
revoke all on function public.get_account_legal_state(),
  public.record_account_legal_acceptance(text, text) from public, anon, authenticated;
grant execute on function public.get_account_legal_state() to anon, authenticated;
grant execute on function public.record_account_legal_acceptance(text, text) to authenticated;

-- Existing text snapshots accepted by the operator for development and testing.
-- IDs are SHA-256 of UTF-8 MDX with LF newlines (no BOM), not invented dates.
-- Review/update the texts before public launch; this is not a public-launch approval.
insert into mednerds_private.account_legal_releases
  (terms_version, privacy_notice_version, is_current, gravatar_enabled)
values (
  'sha256:ed251cd66a339075f9a4fdaa59117e0a29c5aef2f88dd7198cd72b1cfab68784',
  'sha256:774a62462adf957c65d479c2ea0f7521dbd2e43925766e0709ffeff5d7114187',
  true, true
);
