-- Preserve existing identities and names; retrying this backfill is harmless.
insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;
