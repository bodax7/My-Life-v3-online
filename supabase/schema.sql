-- MyLife — Supabase schema (run ONCE in: Supabase dashboard -> SQL Editor -> New query -> paste -> Run)
-- Safe to re-run on a project that already has the old version (adds the column / replaces policies).
-- Model: one generic "records" table (every app record is a JSON row) + per-row "readers" list enforced by Row Level Security.

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'MyLife',
  join_code text not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('admin','member')),
  name text not null default '',
  email text,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)                      -- one household per person
);

create table if not exists public.records (
  household_id uuid not null references public.households(id) on delete cascade,
  store text not null,
  id text not null,
  data jsonb,
  readers uuid[] not null default '{}',
  all_members boolean not null default false,   -- household-wide record: every member (even future ones) may read/write it
  deleted boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  primary key (household_id, store, id)
);
alter table public.records add column if not exists all_members boolean not null default false;
create index if not exists records_pull_idx on public.records (household_id, updated_at);

-- membership check (SECURITY DEFINER so policies on other tables can use it without recursion)
create or replace function public.is_member(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.household_id = h and m.user_id = auth.uid());
$$;

create or replace function public.records_stamp() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists records_stamp on public.records;
create trigger records_stamp before insert or update on public.records for each row execute function public.records_stamp();

alter table public.households enable row level security;
alter table public.members    enable row level security;
alter table public.records    enable row level security;

drop policy if exists households_select on public.households;
create policy households_select on public.households for select to authenticated using (public.is_member(id));

drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated using (public.is_member(household_id));
drop policy if exists members_update_self on public.members;
create policy members_update_self on public.members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- records: you can only see / change rows that are household-wide (all_members) or whose "readers" list contains you
drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated
  using (public.is_member(household_id) and (all_members or auth.uid() = any(readers)));
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
  with check (public.is_member(household_id) and (all_members or auth.uid() = any(readers)));
drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (public.is_member(household_id) and (all_members or auth.uid() = any(readers)))
  with check (public.is_member(household_id) and (all_members or auth.uid() = any(readers)));
-- (no DELETE policy: deletions are soft, via deleted = true)

-- create a household (caller becomes admin)
create or replace function public.create_household(p_name text, p_display text)
returns json language plpgsql security definer set search_path = public as $$
declare hid uuid; code text; em text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'ALREADY_IN_HOUSEHOLD'; end if;
  code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into households(name, join_code, created_by) values (coalesce(nullif(trim(p_name), ''), 'MyLife'), code, auth.uid()) returning id into hid;
  select email into em from auth.users where id = auth.uid();
  insert into members(household_id, user_id, role, name, email) values (hid, auth.uid(), 'admin', coalesce(nullif(trim(p_display), ''), 'admin'), em);
  return json_build_object('household_id', hid, 'role', 'admin', 'code', code);
end $$;

-- join with a code (max 4 members)
create or replace function public.join_household(p_code text, p_display text)
returns json language plpgsql security definer set search_path = public as $$
declare h households; em text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'ALREADY_IN_HOUSEHOLD'; end if;
  select * into h from households where join_code = upper(trim(p_code));
  if not found then raise exception 'BAD_CODE'; end if;
  if (select count(*) from members where household_id = h.id) >= 4 then raise exception 'HOUSEHOLD_FULL'; end if;
  select email into em from auth.users where id = auth.uid();
  insert into members(household_id, user_id, role, name, email) values (h.id, auth.uid(), 'member', coalesce(nullif(trim(p_display), ''), 'member'), em);
  return json_build_object('household_id', h.id, 'role', 'member');
end $$;

-- my household + members (single round trip)
create or replace function public.my_household()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'household_id', m.household_id, 'role', m.role, 'name', h.name,
    'code', case when m.role = 'admin' then h.join_code else null end,
    'members', (select coalesce(json_agg(json_build_object('user_id', x.user_id, 'role', x.role, 'name', x.name, 'email', x.email) order by x.joined_at), '[]'::json) from members x where x.household_id = m.household_id))
  from members m join households h on h.id = m.household_id where m.user_id = auth.uid();
$$;

revoke all on function public.create_household(text,text), public.join_household(text,text), public.my_household() from public, anon;
grant execute on function public.create_household(text,text), public.join_household(text,text), public.my_household(), public.is_member(uuid) to authenticated;
revoke all on public.households, public.members, public.records from anon, authenticated;   -- drop Supabase's broad default grants, then grant only what is needed
grant select on public.households, public.members to authenticated;
grant update (name) on public.members to authenticated;
grant select, insert, update on public.records to authenticated;

-- file storage (private bucket "files"; object path = <household_id>/<file id>)
insert into storage.buckets (id, name, public) values ('files', 'files', false) on conflict (id) do nothing;
drop policy if exists files_insert on storage.objects;
create policy files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists files_update on storage.objects;
create policy files_update on storage.objects for update to authenticated
  using (bucket_id = 'files' and public.is_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'files' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists files_select on storage.objects;
create policy files_select on storage.objects for select to authenticated
  using (bucket_id = 'files' and exists (
    select 1 from public.records r
    where r.household_id = ((storage.foldername(name))[1])::uuid and r.store = 'files'
      and r.id = storage.filename(name) and (r.all_members or auth.uid() = any(r.readers))));
drop policy if exists files_delete on storage.objects;
create policy files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and public.is_member(((storage.foldername(name))[1])::uuid));
