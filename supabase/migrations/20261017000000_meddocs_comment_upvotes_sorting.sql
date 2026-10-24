-- Additive: no existing comment, revision or moderation record is rewritten.
begin;

create table mednerds_private.meddocs_comment_upvotes (
  comment_id uuid not null references mednerds_private.meddocs_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (comment_id,user_id)
);
create index comment_upvotes_user on mednerds_private.meddocs_comment_upvotes(user_id);
alter table mednerds_private.meddocs_comment_upvotes owner to postgres;
alter table mednerds_private.meddocs_comment_upvotes enable row level security;
revoke all on mednerds_private.meddocs_comment_upvotes from public,anon,authenticated,service_role;
create index comment_roots_publication on mednerds_private.meddocs_comments(article_id,first_published_at,id)
  where parent_id is null and first_published_at is not null;

-- Idempotent desired state, not a toggle: retries cannot accidentally undo a vote.
-- Identity/session/setup and root/target locks follow the existing mutation order.
create function public.meddocs_comment_upvote(target_comment uuid, voted boolean)
returns jsonb language plpgsql volatile security definer set search_path=''
  set statement_timeout='5s' set lock_timeout='2s' as $$
declare identity uuid; c mednerds_private.meddocs_comments; total bigint;
begin
  identity:=mednerds_private.comment_identity(true);
  if voted is null then raise exception using errcode='P0001',message='invalid_request'; end if;
  select * into c from mednerds_private.meddocs_comments where id=target_comment;
  if not found then raise exception using errcode='P0001',message='forbidden'; end if;
  perform mednerds_private.comment_article(c.article_id,true);
  if c.parent_id is not null then
    perform 1 from mednerds_private.meddocs_comments where id=c.parent_id for update;
    if not exists(select 1 from mednerds_private.meddocs_comments where id=c.parent_id
      and visibility='active' and published_revision_id is not null) then
      raise exception using errcode='P0001',message='forbidden';
    end if;
  end if;
  select * into c from mednerds_private.meddocs_comments where id=target_comment for update;
  if not found or c.author_id=identity or c.visibility<>'active'
    or not mednerds_private.comment_is_public(c) or not exists(
      select 1 from mednerds_private.meddocs_comment_revisions r
      where r.id=c.published_revision_id and r.status='approved' and r.body is not null) then
    raise exception using errcode='P0001',message='forbidden';
  end if;
  if voted then
    insert into mednerds_private.meddocs_comment_upvotes values(c.id,identity) on conflict do nothing;
  else
    delete from mednerds_private.meddocs_comment_upvotes where comment_id=c.id and user_id=identity;
  end if;
  select count(*) into total from mednerds_private.meddocs_comment_upvotes where comment_id=c.id;
  return pg_catalog.jsonb_build_object('id',c.id,'upvote_count',total,'has_upvoted',voted);
end;
$$;

-- Counts and personal state are aggregated in one set, never one vote query per row.
-- Keyset cursors include the selected order and score; public root order is global.
-- Scores are live, not a frozen snapshot: external votes can move rows between pages.
create function mednerds_private.comment_voted_page(
  target_article uuid,target_root uuid,cursor jsonb,page_size integer,sort_order text)
returns jsonb language plpgsql volatile set search_path='' as $$
declare article mednerds_private.meddocs_articles; viewer uuid:=auth.uid();
  cap integer:=least(greatest(coalesce(page_size,10),1),20); result jsonb; next_cursor jsonb;
begin
  if sort_order is null or sort_order not in ('newest','oldest','helpful') then
    raise exception using errcode='P0001',message='invalid_request';
  end if;
  if cursor is not null and (pg_catalog.jsonb_typeof(cursor)<>'object'
    or cursor->>'order' is distinct from sort_order or cursor->>'at' is null or cursor->>'id' is null
    or pg_catalog.jsonb_typeof(cursor->'votes') is distinct from 'number'
    or (cursor->>'votes') !~ '^[0-9]+$') then
    raise exception using errcode='P0001',message='invalid_request';
  end if;
  article:=mednerds_private.comment_article(target_article);
  if target_root is not null and not exists(select 1 from mednerds_private.meddocs_comments c
    where c.id=target_root and c.article_id=target_article and c.parent_id is null and mednerds_private.comment_is_public(c)) then
    raise exception using errcode='P0001',message='article_unavailable';
  end if;
  with candidates as materialized (
    select c as entry,c.id,c.first_published_at as stamp,
      c.visibility='active' and c.published_revision_id is not null as visible_body
    from mednerds_private.meddocs_comments c where c.article_id=target_article
      and c.parent_id is not distinct from target_root and mednerds_private.comment_is_public(c)
  ), scores as (
    select c.id,count(v.user_id) as votes,coalesce(bool_or(v.user_id=viewer),false) as voted
    from candidates c left join mednerds_private.meddocs_comment_upvotes v on v.comment_id=c.id and c.visible_body
    group by c.id
  ), ranked as (
    select c.*,s.votes,s.voted from candidates c join scores s using(id)
    where cursor is null
      or (sort_order='oldest' and (c.stamp,c.id)>((cursor->>'at')::timestamptz,(cursor->>'id')::uuid))
      or (sort_order='newest' and (c.stamp,c.id)<((cursor->>'at')::timestamptz,(cursor->>'id')::uuid))
      or (sort_order='helpful' and (s.votes,c.stamp,c.id)<((cursor->>'votes')::bigint,(cursor->>'at')::timestamptz,(cursor->>'id')::uuid))
    order by case when sort_order='helpful' then s.votes end desc,
      case when sort_order='oldest' then c.stamp end asc,
      case when sort_order<>'oldest' then c.stamp end desc,
      case when sort_order='oldest' then c.id end asc,
      case when sort_order<>'oldest' then c.id end desc
    limit cap+1
  ), numbered as (
    select r.*,row_number() over(order by case when sort_order='helpful' then votes end desc,
      case when sort_order='oldest' then stamp end asc,case when sort_order<>'oldest' then stamp end desc,
      case when sort_order='oldest' then id end asc,case when sort_order<>'oldest' then id end desc) as position from ranked r
  ), shown as (select * from numbered where position<=cap)
  select coalesce((select pg_catalog.jsonb_agg(mednerds_private.comment_public(s.entry)
    || pg_catalog.jsonb_build_object('first_published_at',s.stamp,'upvote_count',s.votes,'has_upvoted',s.voted,
      'can_upvote',coalesce(viewer is not null and (s.entry).author_id is distinct from viewer
        and s.visible_body and article.state='published' and article.comments_enabled
        and (target_root is null or exists(select 1 from mednerds_private.meddocs_comments p
          where p.id=target_root and p.visibility='active' and p.published_revision_id is not null)),false))
    order by s.position) from shown s),'[]'::jsonb),
    case when (select count(*) from numbered)>cap then (select pg_catalog.jsonb_build_object(
      'at',stamp,'id',id,'votes',votes,'order',sort_order) from shown order by position desc limit 1) end
    into result,next_cursor;
  return pg_catalog.jsonb_build_object('items',result,'next_cursor',next_cursor,'article',
    pg_catalog.jsonb_build_object('state',article.state,'can_write',article.state='published' and article.comments_enabled));
end;
$$;

-- Replace the old signature to avoid ambiguous PostgREST overloads with defaults.
drop function public.meddocs_comments_list(uuid,jsonb,integer);
create function public.meddocs_comments_list(target_article uuid,cursor jsonb default null,
  page_size integer default 10,sort_order text default 'newest')
returns jsonb language sql volatile security definer set search_path='' set statement_timeout='5s' set lock_timeout='2s' as $$
  select mednerds_private.comment_voted_page(target_article,null,cursor,page_size,sort_order);
$$;
create or replace function public.meddocs_comment_replies(target_article uuid,target_root uuid,cursor jsonb default null,page_size integer default 10)
returns jsonb language sql volatile security definer set search_path='' set statement_timeout='5s' set lock_timeout='2s' as $$
  select mednerds_private.comment_voted_page(target_article,target_root,cursor,page_size,'oldest');
$$;

alter function mednerds_private.comment_voted_page(uuid,uuid,jsonb,integer,text) owner to postgres;
alter function public.meddocs_comment_upvote(uuid,boolean) owner to postgres;
alter function public.meddocs_comments_list(uuid,jsonb,integer,text) owner to postgres;
alter function public.meddocs_comment_replies(uuid,uuid,jsonb,integer) owner to postgres;
revoke all on function mednerds_private.comment_voted_page(uuid,uuid,jsonb,integer,text),
  public.meddocs_comment_upvote(uuid,boolean),public.meddocs_comments_list(uuid,jsonb,integer,text),
  public.meddocs_comment_replies(uuid,uuid,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.meddocs_comments_list(uuid,jsonb,integer,text),
  public.meddocs_comment_replies(uuid,uuid,jsonb,integer) to anon,authenticated;
grant execute on function public.meddocs_comment_upvote(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
