-- Follow-up to the installed Phase-3B migration. No comment or account data is deleted.
-- This RPC now consumes a COMPLETE deployment manifest, never a partial catalog update.
begin;

create or replace function public.meddocs_articles_sync(manifest jsonb)
returns integer language plpgsql volatile security definer set search_path=''
set statement_timeout='10s' set lock_timeout='2s' as $$
declare item jsonb; total integer:=0; seen uuid[]:='{}'; seen_paths text[]:='{}'; target uuid;
begin
  if pg_catalog.jsonb_typeof(manifest) is distinct from 'array'
    or pg_catalog.jsonb_array_length(manifest) not between 1 and 5000 then
    raise invalid_parameter_value;
  end if;
  -- Serialize complete deployments; comment RPCs retain their existing row locks.
  lock table mednerds_private.meddocs_articles in share row exclusive mode;
  for item in select value from pg_catalog.jsonb_array_elements(manifest) loop
    if pg_catalog.jsonb_typeof(item) is distinct from 'object' then raise invalid_parameter_value; end if;
    if item - array['id','locale','canonical_path','author_slugs','state','comments_enabled'] <> '{}'::jsonb
      or pg_catalog.jsonb_typeof(item->'id') is distinct from 'string'
      or (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(item->'locale') is distinct from 'string' or item->>'locale'<>'de'
      or pg_catalog.jsonb_typeof(item->'canonical_path') is distinct from 'string'
      or (item->>'canonical_path') !~ '^/meddocs/[a-z0-9/-]+/$' or (item->>'canonical_path') ~ '//'
      or pg_catalog.jsonb_typeof(item->'state') is distinct from 'string' or item->>'state' not in ('published','unpublished')
      or pg_catalog.jsonb_typeof(item->'comments_enabled') is distinct from 'boolean'
      or (
        item->>'state' = 'unpublished'
        and item->'comments_enabled' is distinct from 'false'::jsonb
      )
      or pg_catalog.jsonb_typeof(item->'author_slugs') is distinct from 'array' then raise invalid_parameter_value; end if;
    if (item->>'state'='published' and pg_catalog.jsonb_array_length(item->'author_slugs')=0) or exists(
      select 1 from pg_catalog.jsonb_array_elements(item->'author_slugs') as slugs(value)
      where pg_catalog.jsonb_typeof(value) is distinct from 'string' or (value #>> '{}') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ) then raise invalid_parameter_value; end if;
    target:=(item->>'id')::uuid;
    if target=any(seen) or item->>'canonical_path'=any(seen_paths) then raise invalid_parameter_value; end if;
    seen:=pg_catalog.array_append(seen,target);
    seen_paths:=pg_catalog.array_append(seen_paths,item->>'canonical_path');
    insert into mednerds_private.meddocs_articles(id,locale,canonical_path,author_slugs,state,comments_enabled)
      values(target,item->>'locale',item->>'canonical_path',array(select pg_catalog.jsonb_array_elements_text(item->'author_slugs')),
        item->>'state',(item->>'comments_enabled')::boolean)
      on conflict(id) do update set canonical_path=excluded.canonical_path,author_slugs=excluded.author_slugs,
        -- An intentional operator archive remains read-only until explicitly unarchived.
        state=case when meddocs_articles.state='archived' and excluded.state='published' then 'archived' else excluded.state end,
        comments_enabled=excluded.comments_enabled and meddocs_articles.state<>'archived',
        updated_at=pg_catalog.clock_timestamp()
      where row(meddocs_articles.canonical_path,meddocs_articles.author_slugs,meddocs_articles.state,meddocs_articles.comments_enabled)
        is distinct from row(excluded.canonical_path,excluded.author_slugs,
          case when meddocs_articles.state='archived' and excluded.state='published' then 'archived' else excluded.state end,
          excluded.comments_enabled and meddocs_articles.state<>'archived');
    total:=total+1;
  end loop;
  -- Removed routes, drafts and opt-outs become unavailable; retain all thread/revision/audit IDs.
  update mednerds_private.meddocs_articles set state='unpublished',comments_enabled=false,updated_at=pg_catalog.clock_timestamp()
    where not (id=any(seen)) and (state<>'unpublished' or comments_enabled);
  return total;
end;
$$;

alter function public.meddocs_articles_sync(jsonb) owner to postgres;
revoke all on function public.meddocs_articles_sync(jsonb) from public,anon,authenticated;
grant execute on function public.meddocs_articles_sync(jsonb) to service_role;
commit;
