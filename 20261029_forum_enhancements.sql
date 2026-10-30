alter table public.posts
  add column if not exists post_type text not null default 'discussion',
  add column if not exists tags text[] not null default '{}',
  add column if not exists accepted_answer_comment_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.posts'::regclass
      and conname = 'posts_post_type_check'
  ) then
    alter table public.posts
      add constraint posts_post_type_check
      check (post_type in ('question', 'knowledge', 'resource', 'discussion'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.posts'::regclass
      and conname = 'posts_tags_limit_check'
  ) then
    alter table public.posts
      add constraint posts_tags_limit_check
      check (cardinality(tags) <= 10);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.posts'::regclass
      and conname = 'posts_accepted_answer_comment_id_fkey'
  ) then
    alter table public.posts
      add constraint posts_accepted_answer_comment_id_fkey
      foreign key (accepted_answer_comment_id)
      references public.comments(id) on delete set null;
  end if;
end
$$;

drop index if exists public.posts_search_idx;
alter table public.posts drop column if exists search_document;
create or replace function public.tags_to_text(text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select pg_catalog.array_to_string($1, ' ') $$;

alter table public.posts
  add column search_document tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || public.tags_to_text(tags))
  ) stored;
create index posts_search_idx on public.posts using gin (search_document);
create index if not exists posts_type_feed_idx
  on public.posts (post_type, created_at desc)
  where status = 'published';

grant update (post_type, tags) on public.posts to authenticated;

create or replace function public.protect_post_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at
     or new.id is distinct from old.id
     or new.vote_count is distinct from old.vote_count
     or new.comment_count is distinct from old.comment_count
     or new.reaction_count is distinct from old.reaction_count then
    raise exception 'System-managed post fields cannot be changed';
  end if;
  if new.title is distinct from old.title
     or new.content is distinct from old.content
     or new.category_id is distinct from old.category_id
     or new.post_type is distinct from old.post_type
     or new.tags is distinct from old.tags
     or new.status is distinct from old.status then
    if not public.has_staff_role() and old.created_at + interval '30 minutes' <= now() then
      raise exception 'POST_EDIT_WINDOW_EXPIRED';
    end if;
    if not public.has_staff_role() and new.status is distinct from old.status then
      raise exception 'Only moderators may change post status';
    end if;
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create or replace function public.set_accepted_answer(p_post_id uuid, p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_email_verified() then
    raise exception 'A verified session is required';
  end if;
  if not exists (
    select 1 from public.posts p
    where p.id = p_post_id
      and p.author_id = auth.uid()
      and p.post_type = 'question'
      and p.status = 'published'
  ) then
    raise exception 'Only the question author may select an answer';
  end if;
  if p_comment_id is not null and not exists (
    select 1 from public.comments c
    where c.id = p_comment_id
      and c.post_id = p_post_id
      and c.parent_id is null
  ) then
    raise exception 'The selected answer must be a top-level comment on this question';
  end if;
  update public.posts
  set accepted_answer_comment_id = p_comment_id
  where id = p_post_id;
end;
$$;

revoke all on function public.set_accepted_answer(uuid, uuid) from public, anon;
grant execute on function public.set_accepted_answer(uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
