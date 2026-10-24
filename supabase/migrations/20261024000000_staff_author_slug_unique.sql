-- DB-01: preserve the original profiles/staff migration and record uniqueness here.
-- Production already has this index; IF NOT EXISTS preserves it without rebuilding.
create unique index if not exists staff_accounts_author_slug_unique
  on public.staff_accounts (author_slug)
  where author_slug is not null;
