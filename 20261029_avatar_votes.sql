alter table public.posts
  add column if not exists vote_count integer not null default 0 check (vote_count >= 0);

create index if not exists posts_frontpage_idx
  on public.posts (vote_count desc, created_at desc)
  where status = 'published';

create table if not exists public.post_votes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_votes_post_idx
  on public.post_votes (post_id, created_at desc);

create or replace function public.maintain_post_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_post uuid;
begin
  affected_post := coalesce(new.post_id, old.post_id);
  if tg_table_name = 'comments' then
    update public.posts set comment_count = (
      select count(*)::integer from public.comments where post_id = affected_post
    ) where id = affected_post;
  elsif tg_table_name = 'reactions' then
    update public.posts set reaction_count = (
      select count(*)::integer from public.reactions where post_id = affected_post
    ) where id = affected_post;
  else
    update public.posts set vote_count = (
      select count(*)::integer from public.post_votes where post_id = affected_post
    ) where id = affected_post;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists maintain_post_vote_count on public.post_votes;
create trigger maintain_post_vote_count
  after insert or delete on public.post_votes
  for each row execute function public.maintain_post_counts();

with vote_counts as (
  select post_id, count(*)::integer as total
  from public.post_votes
  group by post_id
)
update public.posts p
set vote_count = coalesce(v.total, 0)
from (
  select posts.id, vote_counts.total
  from public.posts
  left join vote_counts on vote_counts.post_id = posts.id
) v
where p.id = v.id
  and p.vote_count is distinct from coalesce(v.total, 0);

alter table public.post_votes enable row level security;
grant select on public.post_votes to anon, authenticated;
grant insert, delete on public.post_votes to authenticated;

drop policy if exists "Votes on published posts are readable" on public.post_votes;
create policy "Votes on published posts are readable"
  on public.post_votes for select to anon, authenticated
  using (exists (
    select 1 from public.posts p
    where p.id = post_id and p.status = 'published'
  ));

drop policy if exists "Verified members vote for other members' posts" on public.post_votes;
create policy "Verified members vote for other members' posts"
  on public.post_votes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_email_verified()
    and exists (
      select 1 from public.posts p
      where p.id = post_id
        and p.status = 'published'
        and p.author_id <> (select auth.uid())
    )
  );

drop policy if exists "Members remove their own post vote" on public.post_votes;
create policy "Members remove their own post vote"
  on public.post_votes for delete to authenticated
  using (user_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('forum-avatars', 'forum-avatars', true, 10485760, array['image/png', 'image/jpeg'])
on conflict (id) do update
set public = true,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/png', 'image/jpeg'];

drop policy if exists "Public can read profile avatars" on storage.objects;
create policy "Public can read profile avatars"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'forum-avatars');

drop policy if exists "Verified members upload their own avatar" on storage.objects;
create policy "Verified members upload their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'forum-avatars'
    and public.is_email_verified()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Verified members replace their own avatar" on storage.objects;
create policy "Verified members replace their own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'forum-avatars'
    and public.is_email_verified()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'forum-avatars'
    and public.is_email_verified()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Members delete their own avatar" on storage.objects;
create policy "Members delete their own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'forum-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

notify pgrst, 'reload schema';
