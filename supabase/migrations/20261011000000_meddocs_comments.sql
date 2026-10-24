-- Phase 3B. Additive, local preparation only. Empty catalog / disabled writes by default.
-- Review DEFINER owner rights and run isolated pgTAP/concurrency tests before activation.
begin;

create table mednerds_private.meddocs_articles (
  id uuid primary key,
  locale text not null check (locale = 'de'),
  canonical_path text not null check (canonical_path ~ '^/meddocs/[a-z0-9/-]+/$' and canonical_path !~ '//'),
  author_slugs text[] not null default '{}',
  state text not null default 'unpublished' check (state in ('published','archived','unpublished')),
  comments_enabled boolean not null default false,
  check (not comments_enabled or state='published'),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(locale, canonical_path)
);
create table mednerds_private.meddocs_comments (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  article_id uuid not null references mednerds_private.meddocs_articles(id) on delete restrict,
  author_id uuid references auth.users(id) on delete set null,
  client_request_id uuid not null,
  parent_id uuid,
  reply_to_id uuid,
  visibility text not null default 'active' check (visibility in ('active','hidden','withdrawn')),
  published_revision_id uuid,
  revision_number integer not null default 0 check (revision_number >= 0),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  first_published_at timestamptz,
  edited_at timestamptz,
  unique(article_id,id),
  unique(author_id,client_request_id),
  check (parent_id is distinct from id and reply_to_id is distinct from id),
  check ((parent_id is null) = (reply_to_id is null)),
  check (published_revision_id is null or first_published_at is not null),
  check (visibility<>'active' or first_published_at is null or published_revision_id is not null),
  check (visibility<>'withdrawn' or published_revision_id is null),
  foreign key(article_id,parent_id) references mednerds_private.meddocs_comments(article_id,id) on delete restrict,
  foreign key(article_id,reply_to_id) references mednerds_private.meddocs_comments(article_id,id) on delete restrict
);
create table mednerds_private.meddocs_comment_revisions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  comment_id uuid not null references mednerds_private.meddocs_comments(id) on delete cascade,
  number integer not null check (number > 0),
  client_request_id uuid not null,
  body text,
  status text not null check (status in ('pending','approved','rejected','superseded')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  reason_code text check (reason_code in ('spam','off_topic','sensitive_data','other')),
  redacted_at timestamptz,
  check ((body is null) = (redacted_at is not null)),
  check (body is null or (pg_catalog.char_length(body) between 1 and 4000
    and pg_catalog.octet_length(body) <= 16384 and body ~ '[^[:space:]]'
    and body !~ U&'[\0001-\0008\000B\000C\000E-\001F\007F-\009F\200B-\200F\2028-\202E\2060-\206F\FEFF]')),
  check ((status in ('approved','rejected')) = (decided_at is not null)),
  unique(comment_id,number), unique(comment_id,client_request_id), unique(comment_id,id)
);
alter table mednerds_private.meddocs_comments add constraint comment_published_revision_fk
  foreign key(id,published_revision_id) references mednerds_private.meddocs_comment_revisions(comment_id,id)
  deferrable initially deferred;
create table mednerds_private.meddocs_comment_moderation_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  comment_id uuid not null references mednerds_private.meddocs_comments(id) on delete cascade,
  revision_id uuid,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('approve','reject','hide','restore','redact')),
  reason_code text check (reason_code in ('spam','off_topic','sensitive_data','other')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(comment_id,revision_id) references mednerds_private.meddocs_comment_revisions(comment_id,id) on delete restrict
);
create table mednerds_private.meddocs_comment_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  short_window_started_at timestamptz not null,
  short_count integer not null check (short_count between 0 and 3),
  day date not null,
  day_count integer not null check (day_count between 0 and 20)
);
create unique index comment_one_pending on mednerds_private.meddocs_comment_revisions(comment_id) where status='pending';
create index comment_roots_page on mednerds_private.meddocs_comments(article_id,created_at,id) where parent_id is null and first_published_at is not null;
create index comment_replies_page on mednerds_private.meddocs_comments(article_id,parent_id,created_at,id);
create index comment_owner on mednerds_private.meddocs_comments(author_id,created_at,id);
create index comment_pending_page on mednerds_private.meddocs_comment_revisions(created_at,id) where status='pending';
create index comment_events_page on mednerds_private.meddocs_comment_moderation_events(comment_id,created_at,id);
create index comment_event_actor on mednerds_private.meddocs_comment_moderation_events(actor_id) where actor_id is not null;
create index comment_revision_moderator on mednerds_private.meddocs_comment_revisions(decided_by) where decided_by is not null;

alter table mednerds_private.meddocs_articles enable row level security;
alter table mednerds_private.meddocs_comments enable row level security;
alter table mednerds_private.meddocs_comment_revisions enable row level security;
alter table mednerds_private.meddocs_comment_moderation_events enable row level security;
alter table mednerds_private.meddocs_comment_limits enable row level security;
alter table mednerds_private.meddocs_articles owner to postgres;
alter table mednerds_private.meddocs_comments owner to postgres;
alter table mednerds_private.meddocs_comment_revisions owner to postgres;
alter table mednerds_private.meddocs_comment_moderation_events owner to postgres;
alter table mednerds_private.meddocs_comment_limits owner to postgres;
revoke all on table mednerds_private.meddocs_articles, mednerds_private.meddocs_comments,
  mednerds_private.meddocs_comment_revisions, mednerds_private.meddocs_comment_moderation_events,
  mednerds_private.meddocs_comment_limits from public,anon,authenticated,service_role;
-- No browser policies. Privileged migrations/explicit operator tooling own catalog maintenance.

create function mednerds_private.comment_valid_name(name text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(pg_catalog.char_length(name) between 2 and 60
    and name = pg_catalog.btrim(name,U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\202F\205F\3000')
    and name !~ U&'[\0001-\001F\007F-\009F\200B-\200F\2028-\202E\2060-\206F\FEFF]',false);
$$;

create function mednerds_private.comment_setup(identity uuid)
returns void language plpgsql volatile set search_path='' as $$
begin
  perform 1 from public.profiles where user_id=identity and mednerds_private.comment_valid_name(display_name) for share;
  if not found then raise exception using errcode='P0001',message='profile_required'; end if;
  perform 1 from mednerds_private.account_legal_releases r join public.account_legal_acceptances a
    on a.terms_version=r.terms_version and a.privacy_notice_version=r.privacy_notice_version
    where r.is_current and a.user_id=identity for share of r,a;
  if not found then raise exception using errcode='P0001',message='legal_required'; end if;
end;
$$;

-- Auth is supplied by verified PostgREST JWTs, not client parameters. Hold gates until commit.
create function mednerds_private.comment_identity(require_setup boolean default false, require_admin boolean default false)
returns uuid language plpgsql volatile set search_path='' as $$
declare identity uuid := auth.uid(); session uuid;
begin
  if identity is null then raise exception using errcode='P0001',message='authentication_required'; end if;
  perform 1 from auth.users where id=identity and email_confirmed_at is not null
    and not coalesce(is_anonymous,false) for share;
  if not found then raise exception using errcode='P0001',message='authentication_required'; end if;
  begin session := (auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then raise exception using errcode='P0001',message='authentication_required'; end;
  perform 1 from auth.sessions where id=session and user_id=identity
    and (not_after is null or not_after > pg_catalog.clock_timestamp()) for share;
  if not found then raise exception using errcode='P0001',message='authentication_required'; end if;
  if require_setup then perform mednerds_private.comment_setup(identity); end if;
  if require_admin then
    perform 1 from public.staff_accounts where user_id=identity and role='admin' for share;
    if not found then raise exception using errcode='P0001',message='forbidden'; end if;
  end if;
  return identity;
end;
$$;

create function mednerds_private.comment_article(target uuid, writing boolean default false)
returns mednerds_private.meddocs_articles language plpgsql volatile set search_path='' as $$
declare article mednerds_private.meddocs_articles;
begin
  select * into article from mednerds_private.meddocs_articles where id=target for share;
  if not found or article.state='unpublished' or (writing and (article.state<>'published' or not article.comments_enabled)) then
    raise exception using errcode='P0001',message='article_unavailable';
  end if;
  return article;
end;
$$;

-- Preliminary authorization before private target lookup. Do NOT lock staff yet:
-- moderation must acquire target Auth locks before profile/legal/staff/comment locks.
-- comment_moderation_target performs the final locked admin/setup check before mutation.
create function mednerds_private.comment_moderator_identity()
returns uuid language plpgsql volatile set search_path='' as $$
declare identity uuid := mednerds_private.comment_identity();
begin
  if not exists(select 1 from public.staff_accounts where user_id=identity and role='admin') then
    raise exception using errcode='P0001',message='forbidden';
  end if;
  return identity;
end;
$$;

create function mednerds_private.comment_quota(identity uuid)
returns void language plpgsql volatile set search_path='' as $$
declare stamp timestamptz := pg_catalog.clock_timestamp(); limits mednerds_private.meddocs_comment_limits; utc_day date;
begin
  utc_day := (stamp at time zone 'UTC')::date;
  insert into mednerds_private.meddocs_comment_limits values(identity,stamp,0,utc_day,0) on conflict(user_id) do nothing;
  select * into limits from mednerds_private.meddocs_comment_limits where user_id=identity for update;
  if stamp >= limits.short_window_started_at + interval '60 seconds' then limits.short_count:=0; limits.short_window_started_at:=stamp; end if;
  if limits.day<>utc_day then limits.day:=utc_day; limits.day_count:=0; end if;
  if limits.short_count>=3 or limits.day_count>=20 then raise exception using errcode='P0001',message='rate_limited'; end if;
  update mednerds_private.meddocs_comment_limits set short_window_started_at=limits.short_window_started_at,
    short_count=limits.short_count+1,day=limits.day,day_count=limits.day_count+1 where user_id=identity;
end;
$$;

create function mednerds_private.comment_body(raw text)
returns text language plpgsql immutable set search_path='' as $$
declare body text := pg_catalog.btrim(raw,E' \t\r\n');
begin
  if body is null or pg_catalog.char_length(body) not between 1 and 4000 or pg_catalog.octet_length(body)>16384
    or body !~ '[^[:space:]]' or body ~ U&'[\0001-\0008\000B\000C\000E-\001F\007F-\009F\200B-\200F\2028-\202E\2060-\206F\FEFF]' then
    raise exception using errcode='P0001',message='invalid_body';
  end if;
  return body;
end;
$$;

-- Immutable structural identity plus root-only parents eliminate cycles and cross-thread replies.
create function mednerds_private.comment_structure()
returns trigger language plpgsql security definer set search_path='' as $$
declare root mednerds_private.meddocs_comments; target mednerds_private.meddocs_comments;
begin
  if tg_op='UPDATE' and (new.article_id,new.parent_id,new.reply_to_id,new.id,new.client_request_id,new.created_at)
    is distinct from (old.article_id,old.parent_id,old.reply_to_id,old.id,old.client_request_id,old.created_at) then
    raise check_violation using message='Immutable comment identity';
  end if;
  if tg_op='UPDATE' and new.author_id is distinct from old.author_id and new.author_id is not null then
    raise check_violation using message='Immutable comment author';
  end if;
  if new.parent_id is not null then
    select * into root from mednerds_private.meddocs_comments where id=new.parent_id and article_id=new.article_id;
    select * into target from mednerds_private.meddocs_comments where id=new.reply_to_id and article_id=new.article_id;
    if root.id is null or root.parent_id is not null or target.id is null or coalesce(target.parent_id,target.id)<>root.id then
      raise check_violation using message='Invalid thread';
    end if;
  end if;
  return new;
end;
$$;
create trigger comment_structure before insert or update on mednerds_private.meddocs_comments
  for each row execute function mednerds_private.comment_structure();

create function mednerds_private.comment_pointer()
returns trigger language plpgsql security definer set search_path='' as $$
declare pointer uuid;
begin
  select published_revision_id into pointer from mednerds_private.meddocs_comments where id=new.id;
  if pointer is not null and not exists(select 1 from mednerds_private.meddocs_comment_revisions
    where id=pointer and comment_id=new.id and status='approved' and body is not null) then
    raise check_violation using message='Invalid published revision';
  end if;
  return null;
end;
$$;
create constraint trigger comment_pointer after insert or update on mednerds_private.meddocs_comments
  deferrable initially deferred for each row execute function mednerds_private.comment_pointer();

create function mednerds_private.comment_revision_immutable()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status<>'pending' and new.status<>old.status then
    raise check_violation using message='Immutable revision decision';
  end if;
  if (new.id,new.comment_id,new.number,new.client_request_id,new.created_at) is distinct from
    (old.id,old.comment_id,old.number,old.client_request_id,old.created_at)
    or (new.body is distinct from old.body and not(new.body is null and new.redacted_at is not null)) then
    raise check_violation using message='Immutable revision';
  end if;
  if new.body is null and exists(select 1 from mednerds_private.meddocs_comments where published_revision_id=new.id) then
    raise check_violation using message='Clear publication before redaction';
  end if;
  return new;
end;
$$;
create trigger comment_revision_immutable before update on mednerds_private.meddocs_comment_revisions
  for each row execute function mednerds_private.comment_revision_immutable();

create function mednerds_private.comment_is_public(c mednerds_private.meddocs_comments)
returns boolean language sql stable set search_path='' as $$
  select c.first_published_at is not null and c.visibility<>'hidden'
    and exists(select 1 from mednerds_private.meddocs_articles a where a.id=c.article_id and a.state in ('published','archived'))
    and (c.parent_id is null or exists(select 1 from mednerds_private.meddocs_comments p
      where p.id=c.parent_id and p.visibility<>'hidden' and p.first_published_at is not null));
$$;

create function mednerds_private.comment_public(c mednerds_private.meddocs_comments)
returns jsonb language sql stable set search_path='' as $$
  select pg_catalog.jsonb_build_object('id',c.id,'article_id',c.article_id,'parent_id',c.parent_id,'reply_to_id',c.reply_to_id,
    'body',case when c.visibility='active' then r.body end,'visibility',c.visibility,
    'display_name',case when c.visibility='withdrawn' then case when c.author_id is null then 'Gelöschter Account' else 'Beitrag entfernt' end
      when mednerds_private.comment_valid_name(p.display_name) then p.display_name else 'Nutzerkonto' end,
    'role',case when c.visibility='active' then s.role::text end,
    'author_slug',case when c.visibility='active' then s.author_slug end,
    'professional_role',case when c.visibility='active' and p.professional_role_public then p.professional_role end,
    'created_at',c.created_at,'edited_at',c.edited_at,'version',c.version,
    'reply_count',(select count(*) from mednerds_private.meddocs_comments reply where reply.parent_id=c.id and mednerds_private.comment_is_public(reply)))
  from (select 1) seed left join public.profiles p on p.user_id=c.author_id
    left join public.staff_accounts s on s.user_id=c.author_id
    left join mednerds_private.meddocs_comment_revisions r on r.id=c.published_revision_id and r.status='approved' and r.body is not null;
$$;

create function mednerds_private.comment_page(target_article uuid,target_root uuid,cursor jsonb,page_size integer)
returns jsonb language plpgsql volatile set search_path='' as $$
declare article mednerds_private.meddocs_articles; cap integer:=least(greatest(coalesce(page_size,10),1),20); result jsonb; next_cursor jsonb;
begin
  article:=mednerds_private.comment_article(target_article);
  if target_root is not null and not exists(select 1 from mednerds_private.meddocs_comments c
    where c.id=target_root and c.article_id=target_article and c.parent_id is null and mednerds_private.comment_is_public(c)) then
    raise exception using errcode='P0001',message='article_unavailable';
  end if;
  with page as (select c as entry,c.created_at,c.id from mednerds_private.meddocs_comments c where c.article_id=target_article
    and c.parent_id is not distinct from target_root and c.first_published_at is not null and mednerds_private.comment_is_public(c)
    -- UI explicitly says Chronologisch / oldest first; replies use the same order.
    -- The UUID is the deterministic tie-breaker and is carried in the exclusive cursor.
    and (cursor is null or (c.created_at,c.id)>((cursor->>'at')::timestamptz,(cursor->>'id')::uuid))
    order by c.created_at,c.id limit cap+1), shown as (select * from page order by created_at,id limit cap)
  select coalesce((select pg_catalog.jsonb_agg(mednerds_private.comment_public(s.entry) order by s.created_at,s.id) from shown s),'[]'::jsonb),
    case when (select count(*) from page)>cap then (select pg_catalog.jsonb_build_object('at',created_at,'id',id) from shown order by created_at desc,id desc limit 1) end
    into result,next_cursor;
  return pg_catalog.jsonb_build_object('items',result,'next_cursor',next_cursor,'article',
    pg_catalog.jsonb_build_object('state',article.state,'can_write',article.state='published' and article.comments_enabled));
end;
$$;
create function public.meddocs_comments_list(target_article uuid,cursor jsonb default null,page_size integer default 10)
returns jsonb language sql volatile security definer set search_path='' set statement_timeout='5s' set lock_timeout='2s' as $$
  select mednerds_private.comment_page(target_article,null,cursor,page_size);
$$;
create function public.meddocs_comment_replies(target_article uuid,target_root uuid,cursor jsonb default null,page_size integer default 10)
returns jsonb language sql volatile security definer set search_path='' set statement_timeout='5s' set lock_timeout='2s' as $$
  select mednerds_private.comment_page(target_article,target_root,cursor,page_size);
$$;

create function mednerds_private.comment_result(c mednerds_private.meddocs_comments)
returns jsonb language sql stable set search_path='' as $$
  select pg_catalog.jsonb_build_object('id',c.id,'version',c.version,'status',r.status)
    from mednerds_private.meddocs_comment_revisions r where r.comment_id=c.id order by r.number desc limit 1;
$$;

create function public.meddocs_comment_create(target_article uuid,body text,request_id uuid,reply_to uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' set statement_timeout='5s' set lock_timeout='2s' as $$
declare identity uuid; text_body text; existing mednerds_private.meddocs_comments; c mednerds_private.meddocs_comments;
  target mednerds_private.meddocs_comments; root mednerds_private.meddocs_comments; rev uuid; is_admin boolean;
begin
  identity:=mednerds_private.comment_identity(true); text_body:=mednerds_private.comment_body(body);
  if request_id is null then raise exception using errcode='P0001',message='invalid_request'; end if;
  perform mednerds_private.comment_article(target_article,true);
  -- Per-account quota lock also serializes idempotent concurrent create retries.
  insert into mednerds_private.meddocs_comment_limits values(identity,pg_catalog.clock_timestamp(),0,(pg_catalog.clock_timestamp() at time zone 'UTC')::date,0)
    on conflict(user_id) do nothing;
  perform 1 from mednerds_private.meddocs_comment_limits where user_id=identity for update;
  select * into existing from mednerds_private.meddocs_comments where author_id=identity and client_request_id=request_id;
  if found then
    if existing.article_id<>target_article or existing.reply_to_id is distinct from reply_to or existing.visibility='withdrawn'
      or not exists(select 1 from mednerds_private.meddocs_comment_revisions where comment_id=existing.id and number=1 and meddocs_comment_revisions.body=text_body) then
      raise exception using errcode='P0001',message='conflict';
    end if;
    return mednerds_private.comment_result(existing);
  end if;
  perform mednerds_private.comment_quota(identity);
  if reply_to is not null then
    select * into target from mednerds_private.meddocs_comments where id=reply_to and article_id=target_article;
    if not found then raise exception using errcode='P0001',message='invalid_reply'; end if;
    select * into root from mednerds_private.meddocs_comments where id=coalesce(target.parent_id,target.id) for update;
    select * into target from mednerds_private.meddocs_comments where id=reply_to for update;
    if not mednerds_private.comment_is_public(target) or target.visibility<>'active' or target.published_revision_id is null
      or root.visibility<>'active' then raise exception using errcode='P0001',message='invalid_reply'; end if;
  end if;
  select role='admin' into is_admin from public.staff_accounts where user_id=identity for share;
  insert into mednerds_private.meddocs_comments(article_id,author_id,client_request_id,parent_id,reply_to_id,revision_number)
    values(target_article,identity,request_id,root.id,reply_to,1) returning * into c;
  insert into mednerds_private.meddocs_comment_revisions(comment_id,number,client_request_id,body,status,decided_at,decided_by)
    values(c.id,1,request_id,text_body,case when coalesce(is_admin,false) then 'approved' else 'pending' end,
      case when is_admin then pg_catalog.clock_timestamp() end,case when is_admin then identity end) returning id into rev;
  if is_admin then
    update mednerds_private.meddocs_comments set published_revision_id=rev,first_published_at=pg_catalog.clock_timestamp() where id=c.id returning * into c;
    insert into mednerds_private.meddocs_comment_moderation_events(comment_id,revision_id,actor_id,action) values(c.id,rev,identity,'approve');
  end if;
  return mednerds_private.comment_result(c);
end;
$$;

create function public.meddocs_comment_edit(target_comment uuid,body text,expected_version bigint,request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' set statement_timeout='5s' set lock_timeout='2s' as $$
declare identity uuid; text_body text; c mednerds_private.meddocs_comments; prior mednerds_private.meddocs_comment_revisions;
begin
  identity:=mednerds_private.comment_identity(true); text_body:=mednerds_private.comment_body(body);
  if request_id is null then raise exception using errcode='P0001',message='invalid_request'; end if;
  select * into c from mednerds_private.meddocs_comments where id=target_comment and author_id=identity;
  if not found then raise exception using errcode='P0001',message='forbidden'; end if;
  perform mednerds_private.comment_article(c.article_id,true);
  insert into mednerds_private.meddocs_comment_limits values(identity,pg_catalog.clock_timestamp(),0,(pg_catalog.clock_timestamp() at time zone 'UTC')::date,0)
    on conflict(user_id) do nothing;
  perform 1 from mednerds_private.meddocs_comment_limits where user_id=identity for update;
  -- Root before reply: a concurrent root hide cannot silently accept a new revision.
  if c.parent_id is not null then
    perform 1 from mednerds_private.meddocs_comments where id=c.parent_id and visibility='active' for update;
    if not found then raise exception using errcode='P0001',message='conflict'; end if;
  end if;
  select * into c from mednerds_private.meddocs_comments where id=target_comment and author_id=identity for update;
  if c.visibility<>'active' then raise exception using errcode='P0001',message='conflict'; end if;
  select * into prior from mednerds_private.meddocs_comment_revisions where comment_id=c.id and client_request_id=request_id;
  if found then
    if prior.body is distinct from text_body then raise exception using errcode='P0001',message='conflict'; end if;
    return mednerds_private.comment_result(c);
  end if;
  if c.version is distinct from expected_version then raise exception using errcode='P0001',message='conflict'; end if;
  perform mednerds_private.comment_quota(identity);
  update mednerds_private.meddocs_comment_revisions set status='superseded' where comment_id=c.id and status='pending';
  insert into mednerds_private.meddocs_comment_revisions(comment_id,number,client_request_id,body,status)
    values(c.id,c.revision_number+1,request_id,text_body,'pending');
  -- Even admin edits need moderation; old publication is unchanged.
  update mednerds_private.meddocs_comments set revision_number=revision_number+1,version=version+1 where id=c.id returning * into c;
  return mednerds_private.comment_result(c);
end;
$$;

-- One scrub path for owner withdrawal and the actual auth.users DELETE transaction.
create function mednerds_private.comment_scrub(target_comment uuid,remove_identity boolean)
returns void language plpgsql volatile set search_path='' as $$
begin
  update mednerds_private.meddocs_comments set published_revision_id=null,visibility='withdrawn',version=version+1,
    author_id=case when remove_identity then null else author_id end where id=target_comment;
  delete from mednerds_private.meddocs_comment_moderation_events where comment_id=target_comment;
  delete from mednerds_private.meddocs_comment_revisions where comment_id=target_comment;
  delete from mednerds_private.meddocs_comments c where c.id=target_comment and c.first_published_at is null
    and not exists(select 1 from mednerds_private.meddocs_comments reply where reply.parent_id=c.id or reply.reply_to_id=c.id);
end;
$$;

create function public.meddocs_comment_withdraw(target_comment uuid,expected_version bigint)
returns jsonb language plpgsql volatile security definer set search_path='' set statement_timeout='5s' set lock_timeout='2s' as $$
declare identity uuid; c mednerds_private.meddocs_comments;
begin
  identity:=mednerds_private.comment_identity();
  select * into c from mednerds_private.meddocs_comments where id=target_comment and author_id=identity for update;
  if not found then raise exception using errcode='P0001',message='forbidden'; end if;
  if c.visibility='withdrawn' then return pg_catalog.jsonb_build_object('id',c.id,'version',c.version,'status','withdrawn'); end if;
  if c.version is distinct from expected_version then raise exception using errcode='P0001',message='conflict'; end if;
  perform mednerds_private.comment_scrub(c.id,false);
  return pg_catalog.jsonb_build_object('id',c.id,'version',c.version+1,'status','withdrawn');
end;
$$;

create function mednerds_private.comment_private(c mednerds_private.meddocs_comments)
returns jsonb language sql stable set search_path='' as $$
  select pg_catalog.jsonb_build_object('id',c.id,'article_id',c.article_id,'parent_id',c.parent_id,'reply_to_id',c.reply_to_id,
    'version',c.version,'visibility',c.visibility,'created_at',c.created_at,'edited_at',c.edited_at,
    'canonical_path',a.canonical_path,'article_state',a.state,
    'published_body',published.body,'revision_id',latest.id,'body',latest.body,'status',coalesce(latest.status,'withdrawn'),
    'reason_code',latest.reason_code,'display_name',case when c.visibility='withdrawn' then 'Beitrag entfernt' else coalesce(p.display_name,'Nutzerkonto') end)
  from mednerds_private.meddocs_articles a left join public.profiles p on p.user_id=c.author_id
    left join mednerds_private.meddocs_comment_revisions published on published.id=c.published_revision_id
    left join lateral (select r.* from mednerds_private.meddocs_comment_revisions r where r.comment_id=c.id order by r.number desc limit 1) latest on true
  where a.id=c.article_id;
$$;
create function public.meddocs_comments_mine(target_article uuid default null,cursor jsonb default null,page_size integer default 10)
returns jsonb language plpgsql volatile security definer set search_path='' set statement_timeout='5s' set lock_timeout='2s' as $$
declare identity uuid; cap integer:=least(greatest(coalesce(page_size,10),1),20); items jsonb; next_cursor jsonb;
begin
  identity:=mednerds_private.comment_identity();
  with page as (select c as entry,c.created_at,c.id from mednerds_private.meddocs_comments c where c.author_id=identity
    and (target_article is null or c.article_id=target_article)
    and (cursor is null or (c.created_at,c.id)>((cursor->>'at')::timestamptz,(cursor->>'id')::uuid)) order by c.created_at,c.id limit cap+1),
    shown as (select * from page order by created_at,id limit cap)
  select coalesce((select pg_catalog.jsonb_agg(mednerds_private.comment_private(s.entry) order by s.created_at,s.id) from shown s),'[]'::jsonb),
    case when (select count(*) from page)>cap then (select pg_catalog.jsonb_build_object('at',created_at,'id',id) from shown order by created_at desc,id desc limit 1) end into items,next_cursor;
  return pg_catalog.jsonb_build_object('items',items,'next_cursor',next_cursor);
end;
$$;

create function public.meddocs_comment_queue(mode text default 'pending',cursor jsonb default null,page_size integer default 10)
returns jsonb language plpgsql volatile security definer set search_path='' set statement_timeout='5s' set lock_timeout='2s' as $$
declare cap integer:=least(greatest(coalesce(page_size,10),1),20); items jsonb; next_cursor jsonb;
begin
  perform mednerds_private.comment_identity(false,true);
  if mode not in ('pending','published','hidden') or mode is null then raise exception using errcode='P0001',message='invalid_request'; end if;
  with page as (select c as entry,c.created_at,c.id from mednerds_private.meddocs_comments c where
    ((mode='pending' and c.visibility='active' and exists(select 1 from mednerds_private.meddocs_comment_revisions r where r.comment_id=c.id and r.status='pending'))
      or (mode='published' and c.visibility='active' and c.published_revision_id is not null)
      or (mode='hidden' and c.visibility='hidden'))
    and (cursor is null or (c.created_at,c.id)>((cursor->>'at')::timestamptz,(cursor->>'id')::uuid)) order by c.created_at,c.id limit cap+1),
    shown as (select * from page order by created_at,id limit cap)
  select coalesce((select pg_catalog.jsonb_agg(mednerds_private.comment_private(s.entry) order by s.created_at,s.id) from shown s),'[]'::jsonb),
    case when (select count(*) from page)>cap then (select pg_catalog.jsonb_build_object('at',created_at,'id',id) from shown order by created_at desc,id desc limit 1) end into items,next_cursor;
  return pg_catalog.jsonb_build_object('items',items,'next_cursor',next_cursor);
end;
$$;

-- Freeze actor/session first, then involved Auth rows BEFORE any staff/profile/comment lock.
create function mednerds_private.comment_moderation_target(target_comment uuid,expected_version bigint,require_author_setup boolean default false)
returns mednerds_private.meddocs_comments language plpgsql volatile set search_path='' as $$
declare c mednerds_private.meddocs_comments; target_author uuid;
begin
  perform mednerds_private.comment_moderator_identity();
  select author_id into target_author from mednerds_private.meddocs_comments where id=target_comment;
  perform 1 from auth.users where id in (auth.uid(),target_author) order by id for share;
  perform mednerds_private.comment_identity(true,true);
  if require_author_setup then
    if target_author is null then raise exception using errcode='P0001',message='conflict'; end if;
    perform 1 from auth.users where id=target_author and email_confirmed_at is not null and not coalesce(is_anonymous,false);
    if not found then raise exception using errcode='P0001',message='conflict'; end if;
    perform mednerds_private.comment_setup(target_author);
  end if;
  select * into c from mednerds_private.meddocs_comments where id=target_comment;
  if not found then raise exception using errcode='P0001',message='forbidden'; end if;
  if require_author_setup then perform mednerds_private.comment_article(c.article_id,true); end if;
  if c.parent_id is not null then
    perform 1 from mednerds_private.meddocs_comments where id=c.parent_id for update;
    if require_author_setup and not exists(select 1 from mednerds_private.meddocs_comments where id=c.parent_id and visibility='active' and first_published_at is not null) then
      raise exception using errcode='P0001',message='conflict';
    end if;
  end if;
  select * into c from mednerds_private.meddocs_comments where id=target_comment for update;
  if c.version is distinct from expected_version then raise exception using errcode='P0001',message='conflict'; end if;
  return c;
end;
$$;

create function public.meddocs_comment_decide(target_revision uuid,decision text,expected_version bigint,reason text default null)
returns jsonb language plpgsql volatile security definer set search_path='' set statement_timeout='5s' set lock_timeout='2s' as $$
declare c mednerds_private.meddocs_comments; target uuid; identity uuid;
begin
  if decision not in ('approve','reject') or decision is null or (reason is not null and reason not in ('spam','off_topic','sensitive_data','other')) then
    raise exception using errcode='P0001',message='invalid_request'; end if;
  -- Authenticate before target lookup; unavailable targets share one non-disclosing error.
  perform mednerds_private.comment_moderator_identity();
  select comment_id into target from mednerds_private.meddocs_comment_revisions where id=target_revision;
  if target is null then raise exception using errcode='P0001',message='forbidden'; end if;
  c:=mednerds_private.comment_moderation_target(target,expected_version,decision='approve'); identity:=auth.uid();
  if c.visibility<>'active' then raise exception using errcode='P0001',message='conflict'; end if;
  update mednerds_private.meddocs_comment_revisions set status=case when decision='approve' then 'approved' else 'rejected' end,
    decided_at=pg_catalog.clock_timestamp(),decided_by=identity,reason_code=reason
    where id=target_revision and comment_id=c.id and status='pending' and body is not null;
  if not found then raise exception using errcode='P0001',message='conflict'; end if;
  update mednerds_private.meddocs_comments set version=version+1,
    published_revision_id=case when decision='approve' then target_revision else published_revision_id end,
    edited_at=case when decision='approve' and first_published_at is not null then pg_catalog.clock_timestamp() else edited_at end,
    first_published_at=case when decision='approve' then coalesce(first_published_at,pg_catalog.clock_timestamp()) else first_published_at end
    where id=c.id returning * into c;
  insert into mednerds_private.meddocs_comment_moderation_events(comment_id,revision_id,actor_id,action,reason_code)
    values(c.id,target_revision,identity,decision,reason);
  return mednerds_private.comment_result(c);
end;
$$;

create function public.meddocs_comment_visibility(target_comment uuid,action text,expected_version bigint,reason text default null)
returns jsonb language plpgsql volatile security definer set search_path='' set statement_timeout='5s' set lock_timeout='2s' as $$
declare c mednerds_private.meddocs_comments;
begin
  if action not in ('hide','restore') or action is null or (reason is not null and reason not in ('spam','off_topic','sensitive_data','other')) then
    raise exception using errcode='P0001',message='invalid_request'; end if;
  c:=mednerds_private.comment_moderation_target(target_comment,expected_version,action='restore');
  if c.visibility='withdrawn' or (action='restore' and c.published_revision_id is null) then raise exception using errcode='P0001',message='conflict'; end if;
  update mednerds_private.meddocs_comments set visibility=case when action='hide' then 'hidden' else 'active' end,version=version+1 where id=c.id returning * into c;
  insert into mednerds_private.meddocs_comment_moderation_events(comment_id,actor_id,action,reason_code) values(c.id,auth.uid(),action,reason);
  return pg_catalog.jsonb_build_object('id',c.id,'version',c.version,'status',c.visibility);
end;
$$;

create function public.meddocs_comment_redact(target_revision uuid,expected_version bigint,reason text default 'sensitive_data')
returns jsonb language plpgsql volatile security definer set search_path='' set statement_timeout='5s' set lock_timeout='2s' as $$
declare c mednerds_private.meddocs_comments; target uuid;
begin
  perform mednerds_private.comment_moderator_identity();
  if reason not in ('spam','off_topic','sensitive_data','other') or reason is null then raise exception using errcode='P0001',message='invalid_request'; end if;
  select comment_id into target from mednerds_private.meddocs_comment_revisions where id=target_revision;
  if target is null then raise exception using errcode='P0001',message='forbidden'; end if;
  c:=mednerds_private.comment_moderation_target(target,expected_version);
  update mednerds_private.meddocs_comments set version=version+1,
    published_revision_id=case when published_revision_id=target_revision then null else published_revision_id end,
    visibility=case when published_revision_id=target_revision then 'hidden' else visibility end where id=c.id returning * into c;
  update mednerds_private.meddocs_comment_revisions set body=null,redacted_at=pg_catalog.clock_timestamp(),reason_code=reason,
    status=case when status='pending' then 'rejected' else status end,
    decided_at=case when status='pending' then pg_catalog.clock_timestamp() else decided_at end,
    decided_by=case when status='pending' then auth.uid() else decided_by end where id=target_revision and body is not null;
  if not found then raise exception using errcode='P0001',message='conflict'; end if;
  insert into mednerds_private.meddocs_comment_moderation_events(comment_id,revision_id,actor_id,action,reason_code) values(c.id,target_revision,auth.uid(),'redact',reason);
  return pg_catalog.jsonb_build_object('id',c.id,'version',c.version,'status',c.visibility);
end;
$$;

create function public.meddocs_comment_audit(target_comment uuid,cursor jsonb default null,page_size integer default 10)
returns jsonb language plpgsql volatile security definer set search_path='' set statement_timeout='5s' set lock_timeout='2s' as $$
declare cap integer:=least(greatest(coalesce(page_size,10),1),20); items jsonb; next_cursor jsonb;
begin
  perform mednerds_private.comment_identity(false,true);
  if not exists(select 1 from mednerds_private.meddocs_comments where id=target_comment) then raise exception using errcode='P0001',message='forbidden'; end if;
  with records as (
    select r.created_at,r.id,pg_catalog.jsonb_build_object('kind','revision','id',r.id,'number',r.number,'body',r.body,
      'status',r.status,'created_at',r.created_at,'decided_at',r.decided_at,'actor_id',r.decided_by,'reason_code',r.reason_code,'redacted_at',r.redacted_at) as item
      from mednerds_private.meddocs_comment_revisions r where r.comment_id=target_comment
    union all select e.created_at,e.id,pg_catalog.jsonb_build_object('kind','event','id',e.id,'action',e.action,'created_at',e.created_at,
      'actor_id',e.actor_id,'reason_code',e.reason_code,'revision_id',e.revision_id) from mednerds_private.meddocs_comment_moderation_events e where e.comment_id=target_comment
  ), page as (select * from records where cursor is null or (created_at,id)>((cursor->>'at')::timestamptz,(cursor->>'id')::uuid) order by created_at,id limit cap+1),
    shown as (select * from page order by created_at,id limit cap)
  select coalesce((select pg_catalog.jsonb_agg(item order by created_at,id) from shown),'[]'::jsonb),
    case when (select count(*) from page)>cap then (select pg_catalog.jsonb_build_object('at',created_at,'id',id) from shown order by created_at desc,id desc limit 1) end into items,next_cursor;
  return pg_catalog.jsonb_build_object('items',items,'next_cursor',next_cursor);
end;
$$;

create function mednerds_private.scrub_deleted_account_comments()
returns trigger language plpgsql security definer set search_path='' as $$
declare comment_id uuid;
begin
  -- The existing last-admin guard sorts before this trigger. All changes roll back together.
  -- Match create/edit/moderation: roots BEFORE replies, then deterministic UUID order.
  -- Otherwise DELETE could lock an owned reply while another request holds its owned root.
  for comment_id in select id from mednerds_private.meddocs_comments where author_id=old.id
    order by (parent_id is not null),coalesce(parent_id,id),id for update loop
    perform mednerds_private.comment_scrub(comment_id,true);
  end loop;
  update mednerds_private.meddocs_comment_revisions set decided_by=null where decided_by=old.id;
  update mednerds_private.meddocs_comment_moderation_events set actor_id=null where actor_id=old.id;
  return old;
end;
$$;
create trigger mednerds_z_scrub_meddocs_comments before delete on auth.users
  for each row execute function mednerds_private.scrub_deleted_account_comments();

-- Explicit operator-only catalog RPC; never called by a build or a browser.
-- New published entries remain disabled; existing archived/unpublished entries never auto-reactivate.
create function public.meddocs_articles_sync(manifest jsonb)
returns integer language plpgsql volatile security definer set search_path='' set statement_timeout='10s' set lock_timeout='2s' as $$
declare item jsonb; total integer:=0; seen uuid[]:='{}'; seen_paths text[]:='{}'; target uuid;
begin
  if pg_catalog.jsonb_typeof(manifest) is distinct from 'array' then raise invalid_parameter_value; end if;
  if pg_catalog.jsonb_array_length(manifest)>5000 then raise invalid_parameter_value; end if;
  for item in select value from pg_catalog.jsonb_array_elements(manifest) loop
    if pg_catalog.jsonb_typeof(item) is distinct from 'object' then raise invalid_parameter_value; end if;
    if item - array['id','locale','canonical_path','author_slugs','state','comments_enabled'] <> '{}'::jsonb
      or pg_catalog.jsonb_typeof(item->'id') is distinct from 'string'
      or (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(item->'locale') is distinct from 'string' or item->>'locale'<>'de'
      or pg_catalog.jsonb_typeof(item->'canonical_path') is distinct from 'string'
      or (item->>'canonical_path') !~ '^/meddocs/[a-z0-9/-]+/$' or (item->>'canonical_path') ~ '//'
      or pg_catalog.jsonb_typeof(item->'state') is distinct from 'string' or item->>'state' not in ('published','unpublished')
      or item->'comments_enabled' is distinct from 'false'::jsonb
      or pg_catalog.jsonb_typeof(item->'author_slugs') is distinct from 'array' then raise invalid_parameter_value; end if;
    if pg_catalog.jsonb_array_length(item->'author_slugs')=0 or exists(
      select 1 from pg_catalog.jsonb_array_elements(item->'author_slugs') as slugs(value)
      where pg_catalog.jsonb_typeof(value) is distinct from 'string' or (value #>> '{}') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ) then raise invalid_parameter_value; end if;
    target:=(item->>'id')::uuid;
    if target=any(seen) or item->>'canonical_path'=any(seen_paths) then raise invalid_parameter_value; end if;
    seen:=pg_catalog.array_append(seen,target);
    seen_paths:=pg_catalog.array_append(seen_paths,item->>'canonical_path');
    insert into mednerds_private.meddocs_articles(id,locale,canonical_path,author_slugs,state)
      values(target,item->>'locale',item->>'canonical_path',array(select pg_catalog.jsonb_array_elements_text(item->'author_slugs')),item->>'state')
      on conflict(id) do update set canonical_path=excluded.canonical_path,author_slugs=excluded.author_slugs,
        state=case when excluded.state='unpublished' then 'unpublished' else meddocs_articles.state end,
        comments_enabled=case when excluded.state='unpublished' then false else meddocs_articles.comments_enabled end,
        updated_at=pg_catalog.clock_timestamp();
    total:=total+1;
  end loop;
  -- Upsert ONLY supplied IDs. Empty/partial manifests never disable omitted articles.
  -- Explicit unpublished entries still disable that article; archive/reactivation is operator-only.
  return total;
end;
$$;

-- Maintenance only. Retain status/audit, remove rejected/superseded texts after 30 days.
create function public.meddocs_comments_retention()
returns integer language plpgsql volatile security definer set search_path='' as $$
declare removed integer;
begin
  update mednerds_private.meddocs_comment_revisions set body=null,redacted_at=pg_catalog.clock_timestamp()
    where status in ('rejected','superseded') and body is not null
      and coalesce(decided_at,created_at)<pg_catalog.clock_timestamp()-interval '30 days';
  get diagnostics removed=row_count;
  return removed;
end;
$$;

-- Match existing migration ownership, rather than silently adding roles/policies on old tables.
-- Private helpers cannot be executed directly by PUBLIC, browsers or service_role.
do $$ declare signature text; begin
  -- Fixed allowlist: never transfer ownership of unrelated/prefix-matching functions.
  for signature in select pg_catalog.unnest(array[
    'mednerds_private.comment_valid_name(text)', 'mednerds_private.comment_setup(uuid)',
    'mednerds_private.comment_identity(boolean,boolean)', 'mednerds_private.comment_article(uuid,boolean)',
    'mednerds_private.comment_moderator_identity()',
    'mednerds_private.comment_quota(uuid)', 'mednerds_private.comment_body(text)',
    'mednerds_private.comment_structure()', 'mednerds_private.comment_pointer()', 'mednerds_private.comment_revision_immutable()',
    'mednerds_private.comment_is_public(mednerds_private.meddocs_comments)', 'mednerds_private.comment_public(mednerds_private.meddocs_comments)',
    'mednerds_private.comment_page(uuid,uuid,jsonb,integer)', 'mednerds_private.comment_result(mednerds_private.meddocs_comments)',
    'mednerds_private.comment_scrub(uuid,boolean)', 'mednerds_private.comment_private(mednerds_private.meddocs_comments)',
    'mednerds_private.comment_moderation_target(uuid,bigint,boolean)', 'mednerds_private.scrub_deleted_account_comments()',
    'public.meddocs_comments_list(uuid,jsonb,integer)', 'public.meddocs_comment_replies(uuid,uuid,jsonb,integer)',
    'public.meddocs_comments_mine(uuid,jsonb,integer)', 'public.meddocs_comment_create(uuid,text,uuid,uuid)',
    'public.meddocs_comment_edit(uuid,text,bigint,uuid)', 'public.meddocs_comment_withdraw(uuid,bigint)',
    'public.meddocs_comment_queue(text,jsonb,integer)', 'public.meddocs_comment_decide(uuid,text,bigint,text)',
    'public.meddocs_comment_visibility(uuid,text,bigint,text)', 'public.meddocs_comment_redact(uuid,bigint,text)',
    'public.meddocs_comment_audit(uuid,jsonb,integer)', 'public.meddocs_articles_sync(jsonb)', 'public.meddocs_comments_retention()'
  ]) loop
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role',signature::pg_catalog.regprocedure);
    execute pg_catalog.format('alter function %s owner to postgres',signature::pg_catalog.regprocedure);
  end loop;
end $$;
grant execute on function public.meddocs_comments_list(uuid,jsonb,integer),public.meddocs_comment_replies(uuid,uuid,jsonb,integer) to anon,authenticated;
grant execute on function public.meddocs_comments_mine(uuid,jsonb,integer),public.meddocs_comment_create(uuid,text,uuid,uuid),
  public.meddocs_comment_edit(uuid,text,bigint,uuid),public.meddocs_comment_withdraw(uuid,bigint),public.meddocs_comment_queue(text,jsonb,integer),
  public.meddocs_comment_decide(uuid,text,bigint,text),public.meddocs_comment_visibility(uuid,text,bigint,text),
  public.meddocs_comment_redact(uuid,bigint,text),public.meddocs_comment_audit(uuid,jsonb,integer) to authenticated;
grant execute on function public.meddocs_articles_sync(jsonb),public.meddocs_comments_retention() to service_role;

commit;
