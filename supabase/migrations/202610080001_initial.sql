-- 家庭药箱：首版数据结构、RLS 与原子库存操作
-- 在 Supabase SQL Editor 中整份执行，或使用 Supabase CLI 迁移。

create extension if not exists pgcrypto;

create type public.patient_role as enum ('viewer', 'editor', 'owner');
create type public.stock_operation_kind as enum ('receive', 'adjust', 'transfer', 'loss', 'undo');
create type public.schedule_pattern as enum ('daily', 'alternate', 'weekdays');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  owner_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.patient_role not null default 'viewer',
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete set null,
  owner_user_id uuid not null references auth.users(id),
  display_name text not null check (char_length(display_name) between 1 and 40),
  is_private boolean not null default true,
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now()
);

create table public.patient_permissions (
  patient_id uuid not null references public.patients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.patient_role not null,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key (patient_id, user_id)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (patient_id, name)
);

create table public.patient_location_history (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  location_id uuid not null references public.locations(id),
  effective_from timestamptz not null,
  actor_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (patient_id, effective_from)
);

create table public.medicines (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  specification text not null default '',
  unit_name text not null check (char_length(unit_name) between 1 and 12),
  units_per_box numeric(14,3) not null check (units_per_box > 0),
  unit_precision smallint not null default 0 check (unit_precision between 0 and 3),
  safety_units numeric(14,3) not null default 0 check (safety_units >= 0),
  reserve_units numeric(14,3) not null default 0 check (reserve_units >= 0),
  procurement_lead_days integer not null default 7 check (procurement_lead_days between 0 and 365),
  consume_location_id uuid references public.locations(id),
  version bigint not null default 1,
  notes text not null default '',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.medicine_batches (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid not null references public.medicines(id) on delete cascade,
  received_at date not null default current_date,
  expires_on date,
  note text not null default '',
  created_at timestamptz not null default now(),
  check (expires_on is null or expires_on >= received_at)
);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid not null references public.medicines(id) on delete cascade,
  effective_from date not null,
  effective_to date,
  pattern public.schedule_pattern not null default 'daily',
  days_of_week smallint[] not null default '{}',
  interval_days integer not null default 1 check (interval_days between 1 and 365),
  morning numeric(12,3) not null default 0 check (morning >= 0),
  noon numeric(12,3) not null default 0 check (noon >= 0),
  evening numeric(12,3) not null default 0 check (evening >= 0),
  bedtime numeric(12,3) not null default 0 check (bedtime >= 0),
  location_id uuid references public.locations(id),
  paused boolean not null default false,
  actor_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (morning + noon + evening + bedtime >= 0)
);

create table public.stock_operations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  medicine_id uuid not null references public.medicines(id) on delete cascade,
  kind public.stock_operation_kind not null,
  actor_user_id uuid not null references auth.users(id),
  occurred_at timestamptz not null default now(),
  reason text not null default '',
  idempotency_key text not null,
  package_size_snapshot numeric(14,3),
  version_before bigint not null,
  metadata jsonb not null default '{}',
  reverses_operation_id uuid references public.stock_operations(id),
  reversed_by uuid references public.stock_operations(id),
  created_at timestamptz not null default now(),
  unique (actor_user_id, idempotency_key)
);

create table public.stock_entries (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.stock_operations(id) on delete cascade,
  location_id uuid not null references public.locations(id),
  batch_id uuid references public.medicine_batches(id),
  delta_units numeric(14,3) not null check (delta_units <> 0),
  created_at timestamptz not null default now()
);

create table public.patient_invitations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  email text not null,
  role public.patient_role not null check (role <> 'owner'),
  status public.invitation_status not null default 'pending',
  invited_by uuid not null references auth.users(id),
  accepted_by uuid references auth.users(id),
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

create table public.mutation_requests (
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  action text not null check (char_length(action) between 1 and 80),
  result_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (actor_user_id,idempotency_key)
);
create unique index patient_invitation_pending_unique on public.patient_invitations(patient_id, lower(email)) where status = 'pending';
create index stock_operations_medicine_time on public.stock_operations(medicine_id, occurred_at desc);
create index stock_entries_operation_location on public.stock_entries(operation_id, location_id);
create index schedules_medicine_dates on public.schedules(medicine_id, effective_from, effective_to);
create index patient_location_effective on public.patient_location_history(patient_id, effective_from desc);

create or replace function public.role_rank(p_role public.patient_role)
returns integer language sql immutable as $$ select case p_role when 'owner' then 3 when 'editor' then 2 else 1 end $$;

create or replace function public.has_patient_role(p_patient_id uuid, p_required public.patient_role default 'viewer')
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.patient_permissions pp
    where pp.patient_id = p_patient_id and pp.user_id = auth.uid()
      and public.role_rank(pp.role) >= public.role_rank(p_required)
  );
$$;

create or replace function public.patient_for_medicine(p_medicine_id uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.patient_id from public.medicines m
  where m.id = p_medicine_id and public.has_patient_role(m.patient_id, 'viewer')
$$;

create or replace function public.medicine_local_date(p_medicine_id uuid,p_at timestamptz default now())
returns date language sql stable security definer set search_path = public, pg_temp as $$
  select (p_at at time zone p.timezone)::date
  from public.medicines m join public.patients p on p.id=m.patient_id
  where m.id=p_medicine_id
$$;

create or replace function public.consumption_location_at(p_medicine_id uuid,p_at timestamptz default now())
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(s.location_id,(
    select h.location_id from public.patient_location_history h
    where h.patient_id=m.patient_id and h.effective_from<=p_at
    order by h.effective_from desc limit 1
  ))
  from public.medicines m
  join public.patients p on p.id=m.patient_id
  join public.schedules s on s.medicine_id=m.id and not s.paused
    and s.effective_from<=(p_at at time zone p.timezone)::date
    and (s.effective_to is null or s.effective_to>=(p_at at time zone p.timezone)::date)
  where m.id=p_medicine_id
  order by s.effective_from desc limit 1
$$;

create or replace function public.is_household_member(p_household_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.household_members where household_id=p_household_id and user_id=auth.uid())
$$;

create or replace function public.begin_mutation(p_action text,p_idempotency_key text)
returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_action text; v_result uuid;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key)<1 or char_length(p_idempotency_key)>200 then raise exception '无效的幂等键'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_idempotency_key,0));
  select action,result_id into v_action,v_result from public.mutation_requests
  where actor_user_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found and v_action<>p_action then raise exception '幂等键已用于其他操作'; end if;
  return v_result;
end $$;

create or replace function public.complete_mutation(p_action text,p_idempotency_key text,p_result_id uuid)
returns void language sql volatile security definer set search_path = public, pg_temp as $$
  insert into public.mutation_requests(actor_user_id,idempotency_key,action,result_id)
  values(auth.uid(),p_idempotency_key,p_action,p_result_id)
  on conflict(actor_user_id,idempotency_key) do nothing
$$;

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.patients enable row level security;
alter table public.patient_permissions enable row level security;
alter table public.locations enable row level security;
alter table public.patient_location_history enable row level security;
alter table public.medicines enable row level security;
alter table public.medicine_batches enable row level security;
alter table public.schedules enable row level security;
alter table public.stock_operations enable row level security;
alter table public.stock_entries enable row level security;
alter table public.patient_invitations enable row level security;
alter table public.mutation_requests enable row level security;

create policy profiles_self_select on public.profiles for select to authenticated using (user_id = auth.uid() or exists (select 1 from public.patient_permissions mine join public.patient_permissions theirs using(patient_id) where mine.user_id = auth.uid() and theirs.user_id = profiles.user_id));
create policy profiles_self_update on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy patient_read on public.patients for select to authenticated using (public.has_patient_role(id, 'viewer'));
create policy permission_read on public.patient_permissions for select to authenticated using (public.has_patient_role(patient_id, 'viewer'));
create policy location_read on public.locations for select to authenticated using (public.has_patient_role(patient_id, 'viewer'));
create policy location_history_read on public.patient_location_history for select to authenticated using (public.has_patient_role(patient_id, 'viewer'));
create policy medicine_read on public.medicines for select to authenticated using (public.has_patient_role(patient_id, 'viewer'));
create policy batch_read on public.medicine_batches for select to authenticated using (public.has_patient_role(public.patient_for_medicine(medicine_id), 'viewer'));
create policy schedule_read on public.schedules for select to authenticated using (public.has_patient_role(public.patient_for_medicine(medicine_id), 'viewer'));
create policy operation_read on public.stock_operations for select to authenticated using (public.has_patient_role(patient_id, 'viewer'));
create policy entry_read on public.stock_entries for select to authenticated using (exists (select 1 from public.stock_operations o where o.id = operation_id and public.has_patient_role(o.patient_id, 'viewer')));
create policy invitation_owner_read on public.patient_invitations for select to authenticated using (public.has_patient_role(patient_id, 'owner') or (lower(email) = lower(coalesce(auth.jwt()->>'email','')) and status = 'pending'));
create policy household_read on public.households for select to authenticated using (exists (select 1 from public.household_members hm where hm.household_id = id and hm.user_id = auth.uid()));
create policy household_member_read on public.household_members for select to authenticated using (public.is_household_member(household_id));

-- 写入全部通过下方 SECURITY DEFINER 函数完成；普通客户端没有表级写策略。

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles(user_id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''), split_part(coalesce(new.email,'用户'),'@',1)),40))
  on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

insert into public.profiles(user_id,display_name)
select u.id,left(coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'),''),split_part(coalesce(u.email,'用户'),'@',1)),40)
from auth.users u
on conflict(user_id) do nothing;

create or replace function public.planned_dose_events(
  p_medicine_id uuid,p_location_id uuid,p_from timestamptz,p_to timestamptz
) returns table(dose_at timestamptz,amount numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with context as (
    select m.patient_id, p.timezone
    from public.medicines m join public.patients p on p.id = m.patient_id where m.id = p_medicine_id
  ), doses as (
    select slot.amount,
      instant.dose_at,
      coalesce(s.location_id, (
        select h.location_id from public.patient_location_history h
        where h.patient_id = c.patient_id and h.effective_from <= instant.dose_at
        order by h.effective_from desc limit 1
      )) resolved_location
    from public.schedules s join context c on true
    cross join lateral (
      select bounds.start_date + offsets.day_offset as dose_date
      from (values (
        greatest(s.effective_from,(p_from at time zone c.timezone)::date-1),
        least(coalesce(s.effective_to,(p_to at time zone c.timezone)::date),(p_to at time zone c.timezone)::date)
      )) bounds(start_date,end_date)
      cross join lateral generate_series(0,bounds.end_date-bounds.start_date) offsets(day_offset)
    ) day
    cross join lateral (values (time '07:00',s.morning),(time '12:00',s.noon),(time '18:00',s.evening),(time '22:00',s.bedtime)) slot(dose_time,amount)
    cross join lateral (select (day.dose_date + slot.dose_time) at time zone c.timezone as dose_at) instant
    where s.medicine_id = p_medicine_id and not s.paused and slot.amount > 0
      and day.dose_date between s.effective_from and coalesce(s.effective_to,day.dose_date)
      and (s.pattern = 'daily' or (s.pattern = 'alternate' and mod(day.dose_date-s.effective_from,s.interval_days)=0)
        or (s.pattern = 'weekdays' and extract(isodow from day.dose_date)::smallint = any(s.days_of_week)))
  )
  select doses.dose_at,doses.amount from doses
  where resolved_location=p_location_id and doses.dose_at>p_from and doses.dose_at<=p_to
  order by doses.dose_at
$$;

create or replace function public.planned_consumption(
  p_medicine_id uuid,p_location_id uuid,p_from timestamptz,p_to timestamptz
) returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(e.amount),0) from public.planned_dose_events(p_medicine_id,p_location_id,p_from,p_to) e
$$;

create or replace function public.stock_at(p_medicine_id uuid, p_location_id uuid, p_at timestamptz default now())
returns numeric language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_anchor_time timestamptz;
  v_anchor_units numeric;
  v_cursor timestamptz;
  v_balance numeric := 0;
  v_event record;
begin
  select o.occurred_at, (o.metadata->>'actualUnits')::numeric into v_anchor_time, v_anchor_units
  from public.stock_operations o
  where o.medicine_id=p_medicine_id and (o.metadata->>'locationId')::uuid=p_location_id
    and o.kind='adjust' and o.occurred_at<=p_at
    and (o.reversed_by is null or exists(select 1 from public.stock_operations u where u.id=o.reversed_by and u.occurred_at>p_at))
  order by o.occurred_at desc,o.version_before desc limit 1;

  if v_anchor_time is not null then
    v_balance := greatest(0, v_anchor_units);
    v_cursor := v_anchor_time;
  end if;

  for v_event in
    select o.id, o.occurred_at, o.created_at, sum(e.delta_units) delta_units
    from public.stock_operations o
    join public.stock_entries e on e.operation_id=o.id
    where o.medicine_id=p_medicine_id and e.location_id=p_location_id and o.occurred_at<=p_at
      and (v_anchor_time is null or o.occurred_at>v_anchor_time)
      and not (o.kind='adjust' and exists(select 1 from public.stock_operations u where u.id=o.reversed_by and u.occurred_at<=p_at))
      and not (o.kind='undo' and exists(select 1 from public.stock_operations original where original.id=o.reverses_operation_id and original.kind='adjust'))
    group by o.id,o.occurred_at,o.created_at
    order by o.occurred_at,o.created_at,o.id
  loop
    if v_cursor is not null then
      v_balance := greatest(0, v_balance-public.planned_consumption(p_medicine_id,p_location_id,v_cursor,v_event.occurred_at));
    end if;
    v_balance := greatest(0, v_balance+v_event.delta_units);
    v_cursor := v_event.occurred_at;
  end loop;

  if v_cursor is null then return 0; end if;
  return greatest(0, v_balance-public.planned_consumption(p_medicine_id,p_location_id,v_cursor,p_at));
end $$;

create or replace function public.batch_remaining_at(p_medicine_id uuid, p_location_id uuid, p_at timestamptz default now())
returns table(batch_id uuid, expires_on date, remaining_units numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_anchor_time timestamptz;
  v_start_time timestamptz;
  v_unbatched numeric:=0;
  v_ids uuid[]:='{}';
  v_expiries date[]:='{}';
  v_amounts numeric[]:='{}';
  v_event record;
  v_index integer;
  v_candidate integer;
  v_i integer;
  v_remaining numeric;
  v_take numeric;
begin
  select o.occurred_at,(o.metadata->>'actualUnits')::numeric
  into v_anchor_time,v_unbatched
  from public.stock_operations o
  where o.medicine_id=p_medicine_id and o.kind='adjust'
    and (o.metadata->>'locationId')::uuid=p_location_id and o.occurred_at<=p_at
    and (o.reversed_by is null or exists(select 1 from public.stock_operations u where u.id=o.reversed_by and u.occurred_at>p_at))
  order by o.occurred_at desc,o.version_before desc limit 1;

  if v_anchor_time is not null then
    v_start_time:=v_anchor_time;
    v_unbatched:=greatest(0,coalesce(v_unbatched,0));
  else
    select min(o.occurred_at) into v_start_time
    from public.stock_operations o join public.stock_entries e on e.operation_id=o.id
    where o.medicine_id=p_medicine_id and e.location_id=p_location_id and e.delta_units>0 and o.occurred_at<=p_at;
  end if;
  if v_start_time is null then return; end if;

  for v_event in
    select o.occurred_at event_at,0 event_order,o.version_before event_seq,e.batch_id,b.expires_on,e.delta_units,0::numeric dose_units
    from public.stock_operations o
    join public.stock_entries e on e.operation_id=o.id
    left join public.medicine_batches b on b.id=e.batch_id
    where o.medicine_id=p_medicine_id and e.location_id=p_location_id and o.occurred_at<=p_at
      and ((v_anchor_time is not null and o.occurred_at>v_anchor_time)
        or (v_anchor_time is null and o.occurred_at>=v_start_time))
      and not (o.kind='adjust' and exists(select 1 from public.stock_operations u where u.id=o.reversed_by and u.occurred_at<=p_at))
      and not (o.kind='undo' and exists(select 1 from public.stock_operations original where original.id=o.reverses_operation_id and original.kind='adjust'))
    union all
    select d.dose_at,1,0::bigint,null::uuid,null::date,0::numeric,d.amount
    from public.planned_dose_events(p_medicine_id,p_location_id,v_start_time,p_at) d
    order by event_at,event_order,event_seq
  loop
    if v_event.event_order=0 then
      if v_event.batch_id is null then
        v_unbatched:=greatest(0,v_unbatched+v_event.delta_units);
      else
        v_index:=array_position(v_ids,v_event.batch_id);
        if v_index is null then
          v_ids:=array_append(v_ids,v_event.batch_id);
          v_expiries:=array_append(v_expiries,v_event.expires_on);
          v_amounts:=array_append(v_amounts,greatest(0,v_event.delta_units));
        else
          v_amounts[v_index]:=greatest(0,v_amounts[v_index]+v_event.delta_units);
        end if;
      end if;
    else
      v_remaining:=v_event.dose_units;
      while v_remaining>0 loop
        v_candidate:=null;
        if coalesce(array_length(v_ids,1),0)>0 then
          for v_i in 1..array_length(v_ids,1) loop
            if v_amounts[v_i]>0 and (v_expiries[v_i] is null or v_expiries[v_i]>=public.medicine_local_date(p_medicine_id,v_event.event_at))
              and (v_candidate is null or (v_expiries[v_candidate] is null and v_expiries[v_i] is not null)
                or (v_expiries[v_i] is not null and v_expiries[v_candidate] is not null and v_expiries[v_i]<v_expiries[v_candidate])) then
              v_candidate:=v_i;
            end if;
          end loop;
        end if;
        exit when v_candidate is null;
        v_take:=least(v_remaining,v_amounts[v_candidate]);
        v_amounts[v_candidate]:=v_amounts[v_candidate]-v_take;
        v_remaining:=v_remaining-v_take;
      end loop;
      if v_remaining>0 then v_unbatched:=greatest(0,v_unbatched-v_remaining); end if;
    end if;
  end loop;

  return query
  select v_ids[g.i],v_expiries[g.i],v_amounts[g.i]
  from generate_subscripts(v_ids,1) as g(i)
  where v_amounts[g.i]>0
  union all
  select null::uuid,null::date,v_unbatched where v_unbatched>0;
end $$;

create or replace function public.batch_units_by_expiry(
  p_medicine_id uuid,p_location_id uuid,p_from_date date,p_to_date date,p_at timestamptz default now()
) returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(r.remaining_units),0)
  from public.batch_remaining_at(p_medicine_id,p_location_id,p_at) r
  where r.expires_on is not null
    and (p_from_date is null or r.expires_on>=p_from_date)
    and (p_to_date is null or r.expires_on<=p_to_date)
$$;

create or replace function public.available_stock_at(p_medicine_id uuid,p_location_id uuid,p_at timestamptz default now())
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(r.remaining_units),0)
  from public.batch_remaining_at(p_medicine_id,p_location_id,p_at) r
  where r.expires_on is null or r.expires_on>=public.medicine_local_date(p_medicine_id,p_at)
$$;

create or replace function public.api_my_spaces()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.display_name,'role',pp.role,'isPrivate',p.is_private,
    'currentLocationId',(select h.location_id from public.patient_location_history h where h.patient_id=p.id and h.effective_from<=now() order by h.effective_from desc limit 1),
    'locations',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name) order by l.sort_order,l.created_at),'[]'::jsonb) from public.locations l where l.patient_id=p.id and l.archived_at is null)
  ) order by p.created_at),'[]'::jsonb)
  from public.patients p join public.patient_permissions pp on pp.patient_id=p.id where pp.user_id=auth.uid()
$$;

create or replace function public.api_patient_dashboard(p_patient_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  if not public.has_patient_role(p_patient_id,'viewer') then raise exception '没有权限查看这个用药空间'; end if;
  select jsonb_build_object(
    'space',(select x from jsonb_array_elements(public.api_my_spaces()) x where x->>'id'=p_patient_id::text limit 1),
    'medicines',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'name',m.name,'specification',m.specification,'unitName',m.unit_name,'unitsPerBox',m.units_per_box,
      'precision',m.unit_precision,'safetyUnits',m.safety_units,'reserveUnits',m.reserve_units,'version',m.version,
      'consumeLocationId',(select s.location_id from public.schedules s where s.medicine_id=m.id and not s.paused and s.effective_from<=public.medicine_local_date(m.id,now()) and (s.effective_to is null or s.effective_to>=public.medicine_local_date(m.id,now())) order by s.effective_from desc limit 1),'dailyDose',coalesce((select s.morning+s.noon+s.evening+s.bedtime from public.schedules s where s.medicine_id=m.id and not s.paused and s.effective_from<=public.medicine_local_date(m.id,now()) and (s.effective_to is null or s.effective_to>=public.medicine_local_date(m.id,now())) order by s.effective_from desc limit 1),0),
      'expiringUnits',coalesce((select sum(public.batch_units_by_expiry(m.id,l.id,public.medicine_local_date(m.id,now()),public.medicine_local_date(m.id,now())+30,now())) from public.locations l where l.patient_id=p_patient_id and l.archived_at is null),0),
      'predictionReason',case
        when not exists(select 1 from public.schedules s where s.medicine_id=m.id and not s.paused and s.effective_from<=public.medicine_local_date(m.id,now()) and (s.effective_to is null or s.effective_to>=public.medicine_local_date(m.id,now()))) then '尚未设置当前用量'
        when public.consumption_location_at(m.id,now()) is null then '尚未设置消耗地点或当前所在地'
        when exists(select 1 from public.schedules s where s.medicine_id=m.id and not s.paused and s.effective_from<=public.medicine_local_date(m.id,now()) and (s.effective_to is null or s.effective_to>=public.medicine_local_date(m.id,now())) and s.pattern<>'daily') then '隔日或指定星期计划暂不显示精确天数'
        else null end,
      'locations',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'units',round(public.available_stock_at(m.id,l.id,now()),m.unit_precision),
        'confirmedAt',(select o.occurred_at from public.stock_operations o where o.medicine_id=m.id and (o.metadata->>'locationId')::uuid=l.id and o.kind='adjust' and o.reversed_by is null order by o.occurred_at desc,o.version_before desc limit 1),
        'daysLeft',case when l.id=public.consumption_location_at(m.id,now()) and coalesce((select s.morning+s.noon+s.evening+s.bedtime from public.schedules s where s.medicine_id=m.id and not s.paused and s.pattern='daily' and s.effective_from<=public.medicine_local_date(m.id,now()) and (s.effective_to is null or s.effective_to>=public.medicine_local_date(m.id,now())) order by s.effective_from desc limit 1),0)>0 then floor(public.available_stock_at(m.id,l.id,now())/(select s.morning+s.noon+s.evening+s.bedtime from public.schedules s where s.medicine_id=m.id and not s.paused and s.pattern='daily' and s.effective_from<=public.medicine_local_date(m.id,now()) and (s.effective_to is null or s.effective_to>=public.medicine_local_date(m.id,now())) order by s.effective_from desc limit 1)) else null end
      ) order by l.sort_order),'[]'::jsonb) from public.locations l where l.patient_id=p_patient_id and l.archived_at is null)
    ) order by m.created_at) from public.medicines m where m.patient_id=p_patient_id and m.archived_at is null),'[]'::jsonb),
    'operations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'medicineId',o.medicine_id,'medicineName',m.name,'kind',o.kind,
      'description',coalesce(nullif(o.metadata->>'description',''),case o.kind when 'receive' then '增加库存' when 'adjust' then '修改数量' when 'transfer' then '地点调拨' when 'loss' then '记录减少' else '撤销操作' end),
      'occurredAt',o.occurred_at,'actorName',coalesce(pr.display_name,'家庭成员'),'canUndo',(o.reversed_by is null and o.kind<>'undo' and m.version=o.version_before+1)) order by o.occurred_at desc)
      from (select * from public.stock_operations where patient_id=p_patient_id order by occurred_at desc limit 60) o join public.medicines m on m.id=o.medicine_id left join public.profiles pr on pr.user_id=o.actor_user_id),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('userId',pp.user_id,'displayName',coalesce(pr.display_name,'家庭成员'),'role',pp.role) order by public.role_rank(pp.role) desc) from public.patient_permissions pp left join public.profiles pr on pr.user_id=pp.user_id where pp.patient_id=p_patient_id),'[]'::jsonb),
    'invitations',case when public.has_patient_role(p_patient_id,'owner') then coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'expiresAt',i.expires_at,'status',i.status)) from public.patient_invitations i where i.patient_id=p_patient_id and i.status='pending'),'[]'::jsonb) else '[]'::jsonb end
  ) into v_result;
  return v_result;
end $$;

create or replace function public.api_create_patient(p_payload jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_patient uuid; v_location uuid; v_existing uuid;
begin
  v_existing:=public.begin_mutation('create_patient',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  if nullif(trim(p_payload->>'name'),'') is null then raise exception '请输入用药人称呼'; end if;
  if not exists(select 1 from pg_timezone_names where name=coalesce(nullif(p_payload->>'timezone',''),'Asia/Shanghai')) then raise exception '无效的时区'; end if;
  insert into public.patients(owner_user_id,display_name,timezone) values(auth.uid(),trim(p_payload->>'name'),coalesce(nullif(p_payload->>'timezone',''),'Asia/Shanghai')) returning id into v_patient;
  insert into public.patient_permissions(patient_id,user_id,role,granted_by) values(v_patient,auth.uid(),'owner',auth.uid());
  insert into public.locations(patient_id,name) values(v_patient,coalesce(nullif(trim(p_payload->>'locationName'),''),'家里')) returning id into v_location;
  insert into public.patient_location_history(patient_id,location_id,effective_from,actor_user_id) values(v_patient,v_location,now(),auth.uid());
  perform public.complete_mutation('create_patient',p_idempotency_key,v_patient);
  return v_patient;
end $$;

create or replace function public.api_add_medicine(p_payload jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_patient uuid:=(p_payload->>'patientId')::uuid; v_medicine uuid; v_operation uuid; v_batch uuid; v_existing uuid; v_units numeric:=coalesce((p_payload->>'initialUnits')::numeric,0); v_daily numeric:=coalesce((p_payload->>'dailyDose')::numeric,0); v_location uuid:=(p_payload->>'locationId')::uuid; v_precision smallint:=coalesce((p_payload->>'precision')::smallint,0);
begin
  if not public.has_patient_role(v_patient,'editor') then raise exception '没有修改权限'; end if;
  v_existing:=public.begin_mutation('add_medicine',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  if v_units<0 or round(v_units,v_precision)<>v_units then raise exception '数量格式不正确'; end if;
  if v_precision<0 or v_precision>3 or round((p_payload->>'unitsPerBox')::numeric,v_precision)<>(p_payload->>'unitsPerBox')::numeric then raise exception '包装数量精度不正确'; end if;
  if v_daily<0 or round(v_daily,v_precision)<>v_daily then raise exception '每日用量精度不正确'; end if;
  if round(coalesce((p_payload->>'safetyUnits')::numeric,0),v_precision)<>coalesce((p_payload->>'safetyUnits')::numeric,0)
    or round(coalesce((p_payload->>'reserveUnits')::numeric,0),v_precision)<>coalesce((p_payload->>'reserveUnits')::numeric,0) then raise exception '提醒数量精度不正确'; end if;
  if not exists(select 1 from public.locations where id=v_location and patient_id=v_patient) then raise exception '存放地点不属于这个用药空间'; end if;
  insert into public.medicines(patient_id,name,specification,unit_name,units_per_box,unit_precision,safety_units,reserve_units)
  values(v_patient,trim(p_payload->>'name'),coalesce(p_payload->>'specification',''),coalesce(nullif(p_payload->>'unitName',''),'粒'),(p_payload->>'unitsPerBox')::numeric,coalesce((p_payload->>'precision')::smallint,0),coalesce((p_payload->>'safetyUnits')::numeric,0),coalesce((p_payload->>'reserveUnits')::numeric,0)) returning id into v_medicine;
  if v_units>0 then
    insert into public.medicine_batches(medicine_id,received_at,expires_on,note)
    values(v_medicine,public.medicine_local_date(v_medicine,now()),null,'初始库存') returning id into v_batch;
    insert into public.stock_operations(patient_id,medicine_id,kind,actor_user_id,idempotency_key,package_size_snapshot,version_before,metadata)
    values(v_patient,v_medicine,'receive',auth.uid(),p_idempotency_key,(p_payload->>'unitsPerBox')::numeric,0,jsonb_build_object('description','初始库存录入')) returning id into v_operation;
    insert into public.stock_entries(operation_id,location_id,batch_id,delta_units) values(v_operation,v_location,v_batch,v_units);
  end if;
  if v_daily>0 then
    insert into public.schedules(medicine_id,effective_from,pattern,morning,actor_user_id) values(v_medicine,public.medicine_local_date(v_medicine,now()),'daily',v_daily,auth.uid());
  end if;
  perform public.complete_mutation('add_medicine',p_idempotency_key,v_medicine);
  return v_medicine;
end $$;

create or replace function public.api_stock_change(p_action text, p_payload jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_patient uuid:=(p_payload->>'patientId')::uuid; v_med public.medicines%rowtype; v_operation uuid; v_existing uuid; v_units numeric:=(p_payload->>'units')::numeric; v_location uuid; v_from uuid; v_to uuid; v_before numeric; v_delta numeric; v_batch uuid; v_remaining numeric; v_take numeric; v_batch_row record;
begin
  v_existing:=public.begin_mutation('stock_'||coalesce(p_action,''),p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  select * into v_med from public.medicines where id=(p_payload->>'medicineId')::uuid and patient_id=v_patient for update;
  if not found or not public.has_patient_role(v_patient,'editor') then raise exception '没有修改权限'; end if;
  if v_units<0 or round(v_units,v_med.unit_precision)<>v_units then raise exception '数量格式不正确'; end if;
  if not (p_payload ? 'expectedVersion') or (p_payload->>'expectedVersion')::bigint<>v_med.version then raise exception '库存刚被家人修改，请刷新后再试'; end if;
  if p_action in ('adjust','receive','loss') then
    v_location:=(p_payload->>'locationId')::uuid;
    if not exists(select 1 from public.locations where id=v_location and patient_id=v_patient) then raise exception '存放地点不正确'; end if;
    v_before:=public.available_stock_at(v_med.id,v_location,now());
    v_delta:=case p_action when 'adjust' then v_units-v_before when 'receive' then v_units else -v_units end;
    if p_action<>'adjust' and v_units<=0 then raise exception '数量必须大于零'; end if;
    if v_before+v_delta<0 then raise exception '现有数量不足'; end if;
    insert into public.stock_operations(patient_id,medicine_id,kind,actor_user_id,reason,idempotency_key,package_size_snapshot,version_before,metadata)
    values(v_patient,v_med.id,p_action::public.stock_operation_kind,auth.uid(),coalesce(p_payload->>'reason',''),p_idempotency_key,v_med.units_per_box,v_med.version,
      jsonb_build_object('locationId',v_location,'actualUnits',case when p_action='adjust' then v_units else null end,'beforeUnits',v_before,'description',case p_action when 'adjust' then '数量已修改为 '||v_units||v_med.unit_name when 'receive' then '增加 '||v_units||v_med.unit_name else '减少 '||v_units||v_med.unit_name end)) returning id into v_operation;
    if p_action='receive' then
      insert into public.medicine_batches(medicine_id,received_at,expires_on,note)
      values(v_med.id,coalesce(nullif(p_payload->>'receivedAt','')::date,public.medicine_local_date(v_med.id,now())),nullif(p_payload->>'expiresOn','')::date,coalesce(p_payload->>'reason',''))
      returning id into v_batch;
    end if;
    if p_action='loss' then
      v_remaining:=v_units;
      for v_batch_row in select * from public.batch_remaining_at(v_med.id,v_location,now()) where expires_on is null or expires_on>=public.medicine_local_date(v_med.id,now()) order by expires_on nulls last,batch_id loop
        exit when v_remaining<=0;
        v_take:=least(v_remaining,v_batch_row.remaining_units);
        if v_take>0 then
          insert into public.stock_entries(operation_id,location_id,batch_id,delta_units) values(v_operation,v_location,v_batch_row.batch_id,-v_take);
          v_remaining:=v_remaining-v_take;
        end if;
      end loop;
      if v_remaining>0 then insert into public.stock_entries(operation_id,location_id,delta_units) values(v_operation,v_location,-v_remaining); end if;
    elsif v_delta<>0 then
      insert into public.stock_entries(operation_id,location_id,batch_id,delta_units) values(v_operation,v_location,v_batch,v_delta);
    end if;
  elsif p_action='transfer' then
    v_from:=(p_payload->>'fromLocationId')::uuid; v_to:=(p_payload->>'toLocationId')::uuid;
    if v_from=v_to or not exists(select 1 from public.locations where id=v_from and patient_id=v_patient) or not exists(select 1 from public.locations where id=v_to and patient_id=v_patient) then raise exception '请选择两个不同的正确地点'; end if;
    if v_units<=0 or public.available_stock_at(v_med.id,v_from,now())<v_units then raise exception '来源地点数量不足'; end if;
    insert into public.stock_operations(patient_id,medicine_id,kind,actor_user_id,idempotency_key,package_size_snapshot,version_before,metadata)
    values(v_patient,v_med.id,'transfer',auth.uid(),p_idempotency_key,v_med.units_per_box,v_med.version,jsonb_build_object('description','地点调拨 '||v_units||v_med.unit_name)) returning id into v_operation;
    v_remaining:=v_units;
    for v_batch_row in select * from public.batch_remaining_at(v_med.id,v_from,now()) where expires_on is null or expires_on>=public.medicine_local_date(v_med.id,now()) order by expires_on nulls last,batch_id loop
      exit when v_remaining<=0;
      v_take:=least(v_remaining,v_batch_row.remaining_units);
      if v_take>0 then
        insert into public.stock_entries(operation_id,location_id,batch_id,delta_units)
        values(v_operation,v_from,v_batch_row.batch_id,-v_take),(v_operation,v_to,v_batch_row.batch_id,v_take);
        v_remaining:=v_remaining-v_take;
      end if;
    end loop;
    if v_remaining>0 then
      insert into public.stock_entries(operation_id,location_id,delta_units)
      values(v_operation,v_from,-v_remaining),(v_operation,v_to,v_remaining);
    end if;
  else raise exception '不支持的库存操作'; end if;
  update public.medicines set version=version+1,updated_at=now() where id=v_med.id;
  perform public.complete_mutation('stock_'||p_action,p_idempotency_key,v_operation);
  return v_operation;
end $$;

create or replace function public.api_undo_operation(p_operation_id uuid, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old public.stock_operations%rowtype; v_new uuid; v_existing uuid; v_entry record; v_current_version bigint; v_physical numeric;
begin
  v_existing:=public.begin_mutation('undo_operation',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  select * into v_old from public.stock_operations where id=p_operation_id for update;
  if not found or not public.has_patient_role(v_old.patient_id,'editor') then raise exception '没有撤销权限'; end if;
  if v_old.reversed_by is not null or v_old.kind='undo' then raise exception '这项操作已经撤销'; end if;
  select version into v_current_version from public.medicines where id=v_old.medicine_id for update;
  if v_current_version<>v_old.version_before+1 then raise exception '之后已有其他操作，请直接使用“修改数量”纠正'; end if;
  insert into public.stock_operations(patient_id,medicine_id,kind,actor_user_id,idempotency_key,package_size_snapshot,version_before,reverses_operation_id,metadata)
  select patient_id,medicine_id,'undo',auth.uid(),p_idempotency_key,package_size_snapshot,v_current_version,id,
    jsonb_build_object('description','已撤销：'||coalesce(metadata->>'description','原操作'))
  from public.stock_operations where id=p_operation_id returning id into v_new;
  if v_old.kind<>'adjust' then
    for v_entry in select * from public.stock_entries where operation_id=v_old.id loop
      if v_entry.delta_units>0 then
        select coalesce(sum(r.remaining_units),0) into v_physical
        from public.batch_remaining_at(v_old.medicine_id,v_entry.location_id,now()) r
        where r.batch_id is not distinct from v_entry.batch_id;
        if v_physical<v_entry.delta_units then
          raise exception '这批库存已有消耗，不能直接撤销，请使用“修改数量”纠正';
        end if;
      end if;
      insert into public.stock_entries(operation_id,location_id,batch_id,delta_units)
      values(v_new,v_entry.location_id,v_entry.batch_id,-v_entry.delta_units);
    end loop;
  end if;
  update public.stock_operations set reversed_by=v_new where id=v_old.id;
  update public.medicines set version=version+1,updated_at=now() where id=v_old.medicine_id;
  perform public.complete_mutation('undo_operation',p_idempotency_key,v_new);
  return v_new;
end $$;

create or replace function public.api_set_schedule(p_payload jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_patient uuid:=(p_payload->>'patientId')::uuid; v_medicine uuid:=(p_payload->>'medicineId')::uuid; v_start date:=(p_payload->>'effectiveFrom')::date; v_today date; v_next_start date; v_id uuid; v_existing uuid; v_med public.medicines%rowtype; v_schedule_location uuid:=nullif(p_payload->>'locationId','')::uuid; v_daily numeric:=coalesce((p_payload->>'dailyDose')::numeric,0);
begin
  if not public.has_patient_role(v_patient,'editor') then raise exception '没有修改权限'; end if;
  v_existing:=public.begin_mutation('set_schedule',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  select * into v_med from public.medicines where id=v_medicine and patient_id=v_patient for update;
  if not found then raise exception '没有修改权限'; end if;
  v_today:=public.medicine_local_date(v_medicine,now());
  if not (p_payload ? 'expectedVersion') or (p_payload->>'expectedVersion')::bigint<>v_med.version then raise exception '药品设置刚被家人修改，请刷新后再试'; end if;
  if v_schedule_location is not null and not exists(select 1 from public.locations where id=v_schedule_location and patient_id=v_patient and archived_at is null) then raise exception '消耗地点不属于这个用药空间'; end if;
  if round(coalesce((p_payload->>'morning')::numeric,v_daily),v_med.unit_precision)<>coalesce((p_payload->>'morning')::numeric,v_daily)
    or round(coalesce((p_payload->>'noon')::numeric,0),v_med.unit_precision)<>coalesce((p_payload->>'noon')::numeric,0)
    or round(coalesce((p_payload->>'evening')::numeric,0),v_med.unit_precision)<>coalesce((p_payload->>'evening')::numeric,0)
    or round(coalesce((p_payload->>'bedtime')::numeric,0),v_med.unit_precision)<>coalesce((p_payload->>'bedtime')::numeric,0)
    or round(coalesce((p_payload->>'unitsPerBox')::numeric,v_med.units_per_box),v_med.unit_precision)<>coalesce((p_payload->>'unitsPerBox')::numeric,v_med.units_per_box)
    or round(coalesce((p_payload->>'safetyUnits')::numeric,v_med.safety_units),v_med.unit_precision)<>coalesce((p_payload->>'safetyUnits')::numeric,v_med.safety_units)
    or round(coalesce((p_payload->>'reserveUnits')::numeric,v_med.reserve_units),v_med.unit_precision)<>coalesce((p_payload->>'reserveUnits')::numeric,v_med.reserve_units) then
    raise exception '用量或库存设置的小数精度不正确';
  end if;
  if v_start<v_today then raise exception '新设置不能从过去生效，以免改写已确认的历史'; end if;
  if v_start=v_today and exists(select 1 from public.schedules where medicine_id=v_medicine and effective_from<=v_today and (effective_to is null or effective_to>=v_today)) then raise exception '已有用量计划请从明天或更晚开始调整，以免改变今天早些时候的结果'; end if;
  select min(effective_from) into v_next_start from public.schedules where medicine_id=v_medicine and effective_from>v_start;
  update public.schedules set effective_to=v_start-1 where medicine_id=v_medicine and effective_from<v_start and (effective_to is null or effective_to>=v_start);
  delete from public.schedules where medicine_id=v_medicine and effective_from=v_start;
  insert into public.schedules(medicine_id,effective_from,effective_to,pattern,interval_days,morning,noon,evening,bedtime,location_id,actor_user_id)
  values(v_medicine,v_start,case when v_next_start is null then null else v_next_start-1 end,(p_payload->>'pattern')::public.schedule_pattern,case when p_payload->>'pattern'='alternate' then 2 else 1 end,coalesce((p_payload->>'morning')::numeric,v_daily),coalesce((p_payload->>'noon')::numeric,0),coalesce((p_payload->>'evening')::numeric,0),coalesce((p_payload->>'bedtime')::numeric,0),v_schedule_location,auth.uid()) returning id into v_id;
  update public.medicines set
    units_per_box=coalesce((p_payload->>'unitsPerBox')::numeric,units_per_box),
    safety_units=coalesce((p_payload->>'safetyUnits')::numeric,safety_units),
    reserve_units=coalesce((p_payload->>'reserveUnits')::numeric,reserve_units),
    version=version+1,updated_at=now()
  where id=v_medicine;
  perform public.complete_mutation('set_schedule',p_idempotency_key,v_id);
  return v_id;
end $$;

create or replace function public.api_set_current_location(p_payload jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_patient uuid:=(p_payload->>'patientId')::uuid; v_location uuid:=(p_payload->>'locationId')::uuid; v_effective timestamptz:=(p_payload->>'effectiveFrom')::timestamptz; v_id uuid; v_existing uuid;
begin
  if not public.has_patient_role(v_patient,'editor') or not exists(select 1 from public.locations where id=v_location and patient_id=v_patient) then raise exception '没有修改权限'; end if;
  v_existing:=public.begin_mutation('set_current_location',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  if v_effective<now()-interval '10 minutes' then raise exception '地点切换不能从过去生效，以免改变历史消耗'; end if;
  perform m.id from public.medicines m where m.patient_id=v_patient order by m.id for update;
  insert into public.patient_location_history(patient_id,location_id,effective_from,actor_user_id) values(v_patient,v_location,v_effective,auth.uid()) returning id into v_id;
  perform public.complete_mutation('set_current_location',p_idempotency_key,v_id);
  return v_id;
end $$;

create or replace function public.api_add_location(p_payload jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_patient uuid:=(p_payload->>'patientId')::uuid; v_id uuid; v_existing uuid;
begin
  if not public.has_patient_role(v_patient,'editor') then raise exception '没有修改权限'; end if;
  v_existing:=public.begin_mutation('add_location',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  if nullif(trim(p_payload->>'name'),'') is null then raise exception '请输入地点名称'; end if;
  insert into public.locations(patient_id,name,sort_order)
  values(v_patient,trim(p_payload->>'name'),coalesce((select max(sort_order)+1 from public.locations where patient_id=v_patient),0))
  returning id into v_id;
  perform public.complete_mutation('add_location',p_idempotency_key,v_id);
  return v_id;
end $$;

create or replace function public.api_invite_member(p_payload jsonb,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_patient uuid:=(p_payload->>'patientId')::uuid; v_id uuid; v_existing uuid; v_email text:=lower(trim(p_payload->>'email'));
begin
  if not public.has_patient_role(v_patient,'owner') then raise exception '只有空间主人可以邀请家人'; end if;
  v_existing:=public.begin_mutation('invite_member',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  if v_email is null or v_email='' or v_email!~*'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception '邮箱格式不正确'; end if;
  if (p_payload->>'role') not in ('viewer','editor') then raise exception '邀请角色不正确'; end if;
  if exists(select 1 from public.patient_permissions pp join auth.users u on u.id=pp.user_id where pp.patient_id=v_patient and lower(u.email)=v_email) then raise exception '该账号已经是此空间成员'; end if;
  update public.patient_invitations set status='revoked' where patient_id=v_patient and lower(email)=v_email and status='pending' and expires_at<=now();
  insert into public.patient_invitations(patient_id,email,role,invited_by) values(v_patient,v_email,(p_payload->>'role')::public.patient_role,auth.uid()) returning id into v_id;
  perform public.complete_mutation('invite_member',p_idempotency_key,v_id);
  return v_id;
end $$;

create or replace function public.api_my_invitations()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'patientName',p.display_name,'invitedBy',coalesce(pr.display_name,'家人'),'role',i.role,'expiresAt',i.expires_at)),'[]'::jsonb)
  from public.patient_invitations i join public.patients p on p.id=i.patient_id left join public.profiles pr on pr.user_id=i.invited_by
  where i.status='pending' and i.expires_at>now() and lower(i.email)=lower(coalesce(auth.jwt()->>'email',''))
$$;

create or replace function public.api_accept_invite(p_invitation_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_invite public.patient_invitations%rowtype;
begin
  if p_accept is null then raise exception '请选择接受或拒绝邀请'; end if;
  select * into v_invite from public.patient_invitations where id=p_invitation_id for update;
  if found and v_invite.status='accepted' and v_invite.accepted_by=auth.uid() and p_accept then return; end if;
  if found and v_invite.status='revoked' and lower(v_invite.email)=lower(coalesce(auth.jwt()->>'email','')) and not p_accept then return; end if;
  if not found or v_invite.status<>'pending' or v_invite.expires_at<=now() or lower(v_invite.email)<>lower(coalesce(auth.jwt()->>'email','')) then raise exception '邀请无效或已过期'; end if;
  if p_accept then
    if exists(select 1 from public.patient_permissions where patient_id=v_invite.patient_id and user_id=auth.uid() and role='owner') then raise exception '空间主人不能通过邀请修改自己的权限'; end if;
    insert into public.patient_permissions(patient_id,user_id,role,granted_by)
    values(v_invite.patient_id,auth.uid(),v_invite.role,v_invite.invited_by)
    on conflict(patient_id,user_id) do update set
      role=case when public.role_rank(excluded.role)>public.role_rank(patient_permissions.role) then excluded.role else patient_permissions.role end,
      granted_by=excluded.granted_by,granted_at=now();
    update public.patient_invitations set status='accepted',accepted_by=auth.uid() where id=p_invitation_id;
  else update public.patient_invitations set status='revoked' where id=p_invitation_id; end if;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant select on public.profiles,public.patients,public.patient_permissions,public.locations,public.patient_location_history,public.medicines,public.medicine_batches,public.schedules,public.stock_operations,public.stock_entries,public.patient_invitations,public.households,public.household_members to authenticated;
grant execute on function public.has_patient_role(uuid,public.patient_role), public.patient_for_medicine(uuid), public.is_household_member(uuid) to authenticated;
grant execute on function public.api_my_spaces(), public.api_patient_dashboard(uuid), public.api_create_patient(jsonb,text), public.api_add_medicine(jsonb,text), public.api_stock_change(text,jsonb,text), public.api_undo_operation(uuid,text), public.api_set_schedule(jsonb,text), public.api_set_current_location(jsonb,text), public.api_add_location(jsonb,text), public.api_invite_member(jsonb,text), public.api_my_invitations(), public.api_accept_invite(uuid,boolean) to authenticated;
