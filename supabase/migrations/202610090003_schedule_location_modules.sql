begin;

-- 只追加修正记录，不改写原所在地历史、库存流水或既有用药计划。
create table if not exists public.location_override_revisions (
  id uuid primary key default gen_random_uuid(),
  change_group_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  local_date date not null,
  dose_slot text,
  medicine_id uuid references public.medicines(id),
  location_id uuid references public.locations(id),
  previous_location_id uuid references public.locations(id),
  previous_revision_id uuid references public.location_override_revisions(id),
  is_cleared boolean not null default false,
  actor_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (dose_slot is null or dose_slot in ('morning','noon','evening','bedtime')),
  check ((dose_slot is null and medicine_id is null) or dose_slot is not null),
  check (is_cleared or location_id is not null)
);

create index if not exists location_override_patient_date
  on public.location_override_revisions(patient_id,local_date,created_at desc,id desc);
create index if not exists location_override_medicine_date
  on public.location_override_revisions(medicine_id,local_date,created_at desc,id desc)
  where medicine_id is not null;

alter table public.location_override_revisions enable row level security;
drop policy if exists location_override_read on public.location_override_revisions;
create policy location_override_read on public.location_override_revisions for select to authenticated
using (public.has_patient_role(patient_id,'viewer'));
revoke all on public.location_override_revisions from anon, authenticated;
grant select on public.location_override_revisions to authenticated;

create or replace function public.resolve_dose_location(
  p_patient_id uuid,
  p_medicine_id uuid,
  p_local_date date,
  p_dose_slot text,
  p_location_at timestamptz,
  p_schedule_location uuid
) returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  with medicine_override as (
    select r.location_id,r.is_cleared
    from public.location_override_revisions r
    where r.patient_id=p_patient_id and r.local_date=p_local_date
      and r.dose_slot=p_dose_slot and r.medicine_id=p_medicine_id
    order by r.created_at desc,r.id desc limit 1
  ), slot_override as (
    select r.location_id,r.is_cleared
    from public.location_override_revisions r
    where r.patient_id=p_patient_id and r.local_date=p_local_date
      and r.dose_slot=p_dose_slot and r.medicine_id is null
    order by r.created_at desc,r.id desc limit 1
  ), day_override as (
    select r.location_id,r.is_cleared
    from public.location_override_revisions r
    where r.patient_id=p_patient_id and r.local_date=p_local_date and r.dose_slot is null
    order by r.created_at desc,r.id desc limit 1
  )
  select coalesce(
    (select case when is_cleared then null else location_id end from medicine_override),
    (select case when is_cleared then null else location_id end from slot_override),
    (select case when is_cleared then null else location_id end from day_override),
    p_schedule_location,
    (select h.location_id from public.patient_location_history h
      where h.patient_id=p_patient_id and h.effective_from<=p_location_at
      order by h.effective_from desc,h.id desc limit 1)
  )
$$;

-- 用药日按用药人当地零点划分；内部固定时段保证日内盘点/入库后的后续剂量仍会扣减，用户无需填写具体钟点。
create or replace function public.planned_dose_events(
  p_medicine_id uuid,p_location_id uuid,p_from timestamptz,p_to timestamptz
) returns table(dose_at timestamptz,amount numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with context as (
    select m.patient_id,p.timezone
    from public.medicines m join public.patients p on p.id=m.patient_id
    where m.id=p_medicine_id
  ), doses as (
    select slot.amount,
      ((day.dose_date+slot.location_time) at time zone c.timezone) as dose_at,
      public.resolve_dose_location(
        c.patient_id,p_medicine_id,day.dose_date,slot.slot_name,
        ((day.dose_date+slot.location_time) at time zone c.timezone),active_schedule.location_id
      ) as resolved_location
    from context c
    cross join lateral (
      select bounds.start_date+offsets.day_offset as dose_date
      from (values (
        (p_from at time zone c.timezone)::date,
        (p_to at time zone c.timezone)::date
      )) bounds(start_date,end_date)
      cross join lateral generate_series(0,greatest(0,bounds.end_date-bounds.start_date)) offsets(day_offset)
    ) day
    join lateral (
      select s.effective_from,s.pattern,s.interval_days,s.days_of_week,s.paused,
        s.morning,s.noon,s.evening,s.bedtime,s.location_id
      from public.schedules s
      where s.medicine_id=p_medicine_id
        and day.dose_date between s.effective_from and coalesce(s.effective_to,day.dose_date)
      order by s.effective_from desc,s.created_at desc,s.id desc
      limit 1
    ) active_schedule on true
    cross join lateral (values
      ('morning',time '07:00',active_schedule.morning),
      ('noon',time '12:00',active_schedule.noon),
      ('evening',time '18:00',active_schedule.evening),
      ('bedtime',time '22:00',active_schedule.bedtime)
    ) slot(slot_name,location_time,amount)
    where not active_schedule.paused and slot.amount>0
      and (active_schedule.pattern='daily'
        or (active_schedule.pattern='alternate' and mod(day.dose_date-active_schedule.effective_from,active_schedule.interval_days)=0)
        or (active_schedule.pattern='weekdays' and extract(isodow from day.dose_date)::smallint=any(active_schedule.days_of_week)))
  )
  select doses.dose_at,doses.amount from doses
  where doses.resolved_location=p_location_id and doses.dose_at>p_from and doses.dose_at<=p_to
  order by doses.dose_at
$$;

create or replace function public.api_schedule_overview(p_patient_id uuid,p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_timezone text; v_date date; v_result jsonb;
begin
  if not public.has_patient_role(p_patient_id,'viewer') then raise exception '没有权限查看这个用药空间'; end if;
  select timezone into v_timezone from public.patients where id=p_patient_id;
  v_date:=coalesce(p_date,(now() at time zone v_timezone)::date);
  select jsonb_build_object(
    'timezone',v_timezone,'localDate',v_date,
    'plans',coalesce(jsonb_agg(jsonb_build_object(
      'medicineId',m.id,'medicineName',m.name,'unitName',m.unit_name,'version',m.version,
      'scheduleId',s.id,'effectiveFrom',s.effective_from,'effectiveTo',s.effective_to,
      'pattern',coalesce(s.pattern,'daily'::public.schedule_pattern),
      'daysOfWeek',coalesce(to_jsonb(s.days_of_week),'[]'::jsonb),
      'morning',coalesce(s.morning,0),'noon',coalesce(s.noon,0),
      'evening',coalesce(s.evening,0),'bedtime',coalesce(s.bedtime,0),
      'locationId',s.location_id,'paused',coalesce(s.paused,false),
      'isDoseDay',case when s.id is null or s.paused then false else
        (s.pattern='daily' or (s.pattern='alternate' and mod(v_date-s.effective_from,s.interval_days)=0)
          or (s.pattern='weekdays' and extract(isodow from v_date)::smallint=any(s.days_of_week))) end,
      'upcoming',case when next_schedule.id is null then null else jsonb_build_object(
        'scheduleId',next_schedule.id,'effectiveFrom',next_schedule.effective_from,'effectiveTo',next_schedule.effective_to,
        'pattern',next_schedule.pattern,'daysOfWeek',to_jsonb(next_schedule.days_of_week),
        'morning',next_schedule.morning,'noon',next_schedule.noon,'evening',next_schedule.evening,'bedtime',next_schedule.bedtime,
        'locationId',next_schedule.location_id,'paused',next_schedule.paused
      ) end
    ) order by m.created_at,m.id),'[]'::jsonb)
  ) into v_result
  from public.medicines m
  left join lateral (
    select current_schedule.* from public.schedules current_schedule
    where current_schedule.medicine_id=m.id
      and v_date between current_schedule.effective_from and coalesce(current_schedule.effective_to,v_date)
    order by current_schedule.effective_from desc,current_schedule.created_at desc,current_schedule.id desc limit 1
  ) s on true
  left join lateral (
    select future_schedule.* from public.schedules future_schedule
    where future_schedule.medicine_id=m.id and future_schedule.effective_from>v_date
    order by future_schedule.effective_from,future_schedule.created_at desc,future_schedule.id desc limit 1
  ) next_schedule on true
  where m.patient_id=p_patient_id and m.archived_at is null;
  return v_result;
end $$;

create or replace function public.api_day_plan(p_patient_id uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_timezone text; v_result jsonb;
begin
  if not public.has_patient_role(p_patient_id,'viewer') then raise exception '没有权限查看这个用药空间'; end if;
  if p_date is null then raise exception '请选择日期'; end if;
  select timezone into v_timezone from public.patients where id=p_patient_id;
  with active_plans as (
    select m.id medicine_id,m.name medicine_name,m.unit_name,
      s.effective_from,s.pattern,s.days_of_week,s.interval_days,s.morning,s.noon,s.evening,s.bedtime,s.location_id,s.paused
    from public.medicines m
    join lateral (
      select current_schedule.* from public.schedules current_schedule
      where current_schedule.medicine_id=m.id
        and p_date between current_schedule.effective_from and coalesce(current_schedule.effective_to,p_date)
      order by current_schedule.effective_from desc,current_schedule.created_at desc,current_schedule.id desc limit 1
    ) s on true
    where m.patient_id=p_patient_id and m.archived_at is null and not s.paused
      and (s.pattern='daily' or (s.pattern='alternate' and mod(p_date-s.effective_from,s.interval_days)=0)
        or (s.pattern='weekdays' and extract(isodow from p_date)::smallint=any(s.days_of_week)))
  ), doses as (
    select p.medicine_id,p.medicine_name,p.unit_name,slot.slot_name,slot.location_time,slot.amount,p.location_id
    from active_plans p
    cross join lateral (values
      ('morning',time '07:00',p.morning),('noon',time '12:00',p.noon),
      ('evening',time '18:00',p.evening),('bedtime',time '22:00',p.bedtime)
    ) slot(slot_name,location_time,amount)
    where slot.amount>0
  )
  select jsonb_build_object('date',p_date,'timezone',v_timezone,'doses',coalesce(jsonb_agg(jsonb_build_object(
    'medicineId',d.medicine_id,'medicineName',d.medicine_name,'unitName',d.unit_name,
    'slot',d.slot_name,'amount',d.amount,
    'normalLocationId',coalesce(d.location_id,(select h.location_id from public.patient_location_history h
      where h.patient_id=p_patient_id and h.effective_from<=((p_date+d.location_time) at time zone v_timezone)
      order by h.effective_from desc,h.id desc limit 1)),
    'resolvedLocationId',public.resolve_dose_location(p_patient_id,d.medicine_id,p_date,d.slot_name,
      ((p_date+d.location_time) at time zone v_timezone),d.location_id)
  ) order by case d.slot_name when 'morning' then 1 when 'noon' then 2 when 'evening' then 3 else 4 end,d.medicine_name),'[]'::jsonb))
  into v_result from doses d;
  return v_result;
end $$;

create or replace function public.api_location_calendar(p_patient_id uuid,p_month_start date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_timezone text; v_start date; v_end date; v_result jsonb;
begin
  if not public.has_patient_role(p_patient_id,'viewer') then raise exception '没有权限查看这个用药空间'; end if;
  if p_month_start is null then raise exception '请选择月份'; end if;
  select timezone into v_timezone from public.patients where id=p_patient_id;
  v_start:=date_trunc('month',p_month_start)::date;
  v_end:=(v_start+interval '1 month'-interval '1 day')::date;
  with days as (
    select v_start+offsets.day_offset as local_date
    from generate_series(0,v_end-v_start) offsets(day_offset)
  ), calendar as (
    select d.local_date,
      coalesce(case when day_change.is_cleared then null else day_change.location_id end,normal_location.location_id) location_id,
      day_change.id is not null and not day_change.is_cleared as is_override,
      day_change.id is not null as was_corrected,
      day_change.created_at corrected_at,day_change.actor_user_id,day_change.previous_location_id,
      exists(select 1 from public.patient_location_history h
        where h.patient_id=p_patient_id
          and h.effective_from>(d.local_date::timestamp at time zone v_timezone)
          and h.effective_from<((d.local_date+1)::timestamp at time zone v_timezone)) as is_mixed,
      exists(select 1 from (
        select distinct on (r.dose_slot,r.medicine_id) r.is_cleared
        from public.location_override_revisions r
        where r.patient_id=p_patient_id and r.local_date=d.local_date and r.dose_slot is not null
        order by r.dose_slot,r.medicine_id,r.created_at desc,r.id desc
      ) latest where not latest.is_cleared) as has_dose_override
    from days d
    left join lateral (
      select r.id,r.location_id,r.previous_location_id,r.is_cleared,r.created_at,r.actor_user_id
      from public.location_override_revisions r
      where r.patient_id=p_patient_id and r.local_date=d.local_date and r.dose_slot is null
      order by r.created_at desc,r.id desc limit 1
    ) day_change on true
    left join lateral (
      select h.location_id from public.patient_location_history h
      where h.patient_id=p_patient_id
        and h.effective_from<=((d.local_date+time '12:00') at time zone v_timezone)
      order by h.effective_from desc,h.id desc limit 1
    ) normal_location on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'date',c.local_date,'locationId',c.location_id,'locationName',l.name,
    'isOverride',c.is_override,'wasCorrected',c.was_corrected,
    'isMixed',c.is_mixed,'hasDoseOverride',c.has_dose_override,
    'correctedAt',c.corrected_at,'correctedBy',pr.display_name,'previousLocationName',previous_location.name
  ) order by c.local_date),'[]'::jsonb) into v_result
  from calendar c left join public.locations l on l.id=c.location_id
  left join public.locations previous_location on previous_location.id=c.previous_location_id
  left join public.profiles pr on pr.user_id=c.actor_user_id;
  return v_result;
end $$;

create or replace function public.api_set_day_location_overrides(p_payload jsonb,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient uuid:=(p_payload->>'patientId')::uuid;
  v_from date:=(p_payload->>'dateFrom')::date;
  v_to date:=coalesce(nullif(p_payload->>'dateTo','')::date,v_from);
  v_location uuid:=nullif(p_payload->>'locationId','')::uuid;
  v_clear boolean:=coalesce((p_payload->>'clear')::boolean,false);
  v_group uuid:=gen_random_uuid(); v_existing uuid; v_timezone text;
begin
  if not public.has_patient_role(v_patient,'editor') then raise exception '没有修改权限'; end if;
  v_existing:=public.begin_mutation('set_day_location_overrides',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  if v_from is null or v_to is null then raise exception '请选择日期'; end if;
  if v_to<v_from or v_to-v_from>365 then raise exception '日期范围应在 1 到 366 天之间'; end if;
  if not v_clear and (v_location is null or not exists(select 1 from public.locations where id=v_location and patient_id=v_patient and archived_at is null)) then raise exception '地点不属于这个用药空间'; end if;
  select timezone into v_timezone from public.patients where id=v_patient;
  perform pg_advisory_xact_lock(hashtextextended(v_patient::text||':location-overrides',0));
  perform m.id from public.medicines m where m.patient_id=v_patient order by m.id for update;
  insert into public.location_override_revisions(change_group_id,patient_id,local_date,location_id,previous_location_id,previous_revision_id,is_cleared,actor_user_id)
  select v_group,v_patient,days.local_date,case when v_clear then null else v_location end,
    coalesce(case when previous.is_cleared then null else previous.location_id end,normal_location.location_id),previous.id,v_clear,auth.uid()
  from (select v_from+offsets.day_offset as local_date from generate_series(0,v_to-v_from) offsets(day_offset)) days
  left join lateral (
    select r.id,r.location_id,r.is_cleared from public.location_override_revisions r
    where r.patient_id=v_patient and r.local_date=days.local_date and r.dose_slot is null
    order by r.created_at desc,r.id desc limit 1
  ) previous on true
  left join lateral (
    select h.location_id from public.patient_location_history h
    where h.patient_id=v_patient and h.effective_from<=((days.local_date+time '12:00') at time zone v_timezone)
    order by h.effective_from desc,h.id desc limit 1
  ) normal_location on true;
  perform public.complete_mutation('set_day_location_overrides',p_idempotency_key,v_group);
  return v_group;
end $$;

create or replace function public.api_set_dose_location_overrides(p_payload jsonb,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient uuid:=(p_payload->>'patientId')::uuid;
  v_date date:=(p_payload->>'date')::date;
  v_assignments jsonb:=coalesce(p_payload->'assignments','[]'::jsonb);
  v_clear_all boolean:=coalesce((p_payload->>'clearAll')::boolean,false);
  v_group uuid:=gen_random_uuid(); v_existing uuid; v_item jsonb;
  v_slot text; v_medicine uuid; v_location uuid; v_clear boolean; v_timezone text;
  v_previous_location uuid; v_previous_revision uuid; v_schedule_location uuid; v_location_time time;
begin
  if not public.has_patient_role(v_patient,'editor') then raise exception '没有修改权限'; end if;
  v_existing:=public.begin_mutation('set_dose_location_overrides',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  if v_date is null then raise exception '请选择日期'; end if;
  if jsonb_typeof(v_assignments)<>'array' or jsonb_array_length(v_assignments)>500 then raise exception '时段调整内容不正确'; end if;
  if not v_clear_all and jsonb_array_length(v_assignments)=0 then raise exception '请至少选择一项调整'; end if;
  if not v_clear_all and exists(
    select 1 from jsonb_array_elements(v_assignments) a
    group by a->>'slot',coalesce(a->>'medicineId','') having count(*)>1
  ) then raise exception '同一药品和时段不能重复设置'; end if;
  select timezone into v_timezone from public.patients where id=v_patient;
  perform pg_advisory_xact_lock(hashtextextended(v_patient::text||':location-overrides',0));
  perform m.id from public.medicines m where m.patient_id=v_patient order by m.id for update;
  if v_clear_all then
    insert into public.location_override_revisions(change_group_id,patient_id,local_date,dose_slot,medicine_id,previous_location_id,previous_revision_id,is_cleared,actor_user_id)
    select v_group,v_patient,v_date,latest.dose_slot,latest.medicine_id,latest.location_id,latest.id,true,auth.uid()
    from (
      select distinct on (r.dose_slot,r.medicine_id) r.id,r.dose_slot,r.medicine_id,r.location_id,r.is_cleared
      from public.location_override_revisions r
      where r.patient_id=v_patient and r.local_date=v_date and r.dose_slot is not null
      order by r.dose_slot,r.medicine_id,r.created_at desc,r.id desc
    ) latest where not latest.is_cleared;
  else
    for v_item in select value from jsonb_array_elements(v_assignments) loop
      v_slot:=v_item->>'slot';
      v_medicine:=nullif(v_item->>'medicineId','')::uuid;
      v_location:=nullif(v_item->>'locationId','')::uuid;
      v_clear:=coalesce((v_item->>'clear')::boolean,false);
      if v_slot not in ('morning','noon','evening','bedtime') then raise exception '用药时段不正确'; end if;
      if v_medicine is not null and not exists(select 1 from public.medicines where id=v_medicine and patient_id=v_patient and archived_at is null) then raise exception '药品不属于这个用药空间'; end if;
      if not v_clear and (v_location is null or not exists(select 1 from public.locations where id=v_location and patient_id=v_patient and archived_at is null)) then raise exception '地点不属于这个用药空间'; end if;
      v_location_time:=case v_slot when 'morning' then time '07:00' when 'noon' then time '12:00' when 'evening' then time '18:00' else time '22:00' end;
      v_schedule_location:=null;
      if v_medicine is not null then
        select s.location_id into v_schedule_location from public.schedules s
        where s.medicine_id=v_medicine and v_date between s.effective_from and coalesce(s.effective_to,v_date)
        order by s.effective_from desc,s.created_at desc,s.id desc limit 1;
      end if;
      v_previous_location:=public.resolve_dose_location(v_patient,v_medicine,v_date,v_slot,((v_date+v_location_time) at time zone v_timezone),v_schedule_location);
      select r.id into v_previous_revision from public.location_override_revisions r
      where r.patient_id=v_patient and r.local_date=v_date and r.dose_slot=v_slot and r.medicine_id is not distinct from v_medicine
      order by r.created_at desc,r.id desc limit 1;
      insert into public.location_override_revisions(change_group_id,patient_id,local_date,dose_slot,medicine_id,location_id,previous_location_id,previous_revision_id,is_cleared,actor_user_id)
      values(v_group,v_patient,v_date,v_slot,v_medicine,case when v_clear then null else v_location end,v_previous_location,v_previous_revision,v_clear,auth.uid());
    end loop;
  end if;
  perform public.complete_mutation('set_dose_location_overrides',p_idempotency_key,v_group);
  return v_group;
end $$;

-- 保持原 RPC 签名；计划调整只追加新版本，不删除或覆盖既有计划行。
create or replace function public.api_set_schedule(p_payload jsonb,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient uuid:=(p_payload->>'patientId')::uuid;
  v_medicine uuid:=(p_payload->>'medicineId')::uuid;
  v_start date:=(p_payload->>'effectiveFrom')::date;
  v_today date; v_next_start date; v_id uuid; v_existing uuid;
  v_med public.medicines%rowtype;
  v_schedule_location uuid:=nullif(p_payload->>'locationId','')::uuid;
  v_daily numeric:=coalesce((p_payload->>'dailyDose')::numeric,0);
  v_pattern public.schedule_pattern:=(p_payload->>'pattern')::public.schedule_pattern;
  v_days smallint[]:='{}'::smallint[];
begin
  if not public.has_patient_role(v_patient,'editor') then raise exception '没有修改权限'; end if;
  v_existing:=public.begin_mutation('set_schedule',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  select * into v_med from public.medicines where id=v_medicine and patient_id=v_patient for update;
  if not found then raise exception '没有修改权限'; end if;
  v_today:=public.medicine_local_date(v_medicine,now());
  if not (p_payload ? 'expectedVersion') or (p_payload->>'expectedVersion')::bigint<>v_med.version then raise exception '药品设置刚被家人修改，请刷新后重试'; end if;
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
  if v_pattern='weekdays' then
    if jsonb_typeof(coalesce(p_payload->'daysOfWeek','[]'::jsonb))<>'array' then raise exception '指定星期格式不正确'; end if;
    select coalesce(array_agg(distinct x.day order by x.day),'{}'::smallint[]) into v_days
    from (select value::smallint as day from jsonb_array_elements_text(coalesce(p_payload->'daysOfWeek','[]'::jsonb))) x;
    if coalesce(array_length(v_days,1),0)=0 or exists(select 1 from unnest(v_days) as selected_day(day) where selected_day.day<1 or selected_day.day>7) then raise exception '请至少选择一个有效服药日'; end if;
  end if;
  if v_start<v_today then raise exception '新设置不能从过去生效，以免改写已确认的历史'; end if;
  if v_start=v_today and exists(select 1 from public.schedules where medicine_id=v_medicine and effective_from<=v_today and (effective_to is null or effective_to>=v_today)) then raise exception '已有用量计划请从明天或更晚开始调整，以免改变今天早些时候的结果'; end if;
  select min(effective_from) into v_next_start from public.schedules where medicine_id=v_medicine and effective_from>v_start;
  insert into public.schedules(medicine_id,effective_from,effective_to,pattern,days_of_week,interval_days,morning,noon,evening,bedtime,location_id,actor_user_id)
  values(v_medicine,v_start,case when v_next_start is null then null else v_next_start-1 end,v_pattern,v_days,case when v_pattern='alternate' then 2 else 1 end,
    coalesce((p_payload->>'morning')::numeric,v_daily),coalesce((p_payload->>'noon')::numeric,0),coalesce((p_payload->>'evening')::numeric,0),coalesce((p_payload->>'bedtime')::numeric,0),v_schedule_location,auth.uid())
  returning id into v_id;
  update public.medicines set
    units_per_box=coalesce((p_payload->>'unitsPerBox')::numeric,units_per_box),
    safety_units=coalesce((p_payload->>'safetyUnits')::numeric,safety_units),
    reserve_units=coalesce((p_payload->>'reserveUnits')::numeric,reserve_units),
    version=version+1,updated_at=now()
  where id=v_medicine;
  perform public.complete_mutation('set_schedule',p_idempotency_key,v_id);
  return v_id;
end $$;

create or replace function public.api_set_schedule_batch(p_payload jsonb,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient uuid:=(p_payload->>'patientId')::uuid;
  v_start date:=(p_payload->>'effectiveFrom')::date;
  v_slot text:=p_payload->>'slot';
  v_delta numeric:=(p_payload->>'delta')::numeric;
  v_items jsonb:=coalesce(p_payload->'items','[]'::jsonb);
  v_today date; v_group uuid:=gen_random_uuid(); v_existing uuid; v_item jsonb;
  v_med public.medicines%rowtype; v_medicine uuid; v_next_start date; v_id uuid;
  v_pattern public.schedule_pattern; v_days smallint[]; v_interval integer;
  v_morning numeric; v_noon numeric; v_evening numeric; v_bedtime numeric;
  v_location uuid; v_paused boolean;
begin
  if not public.has_patient_role(v_patient,'editor') then raise exception '没有修改权限'; end if;
  v_existing:=public.begin_mutation('set_schedule_batch',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  if v_start is null or v_slot is null or v_delta is null or v_slot not in ('morning','noon','evening','bedtime') or v_delta=0 then raise exception '批量调整内容不正确'; end if;
  if jsonb_typeof(v_items)<>'array' or jsonb_array_length(v_items)=0 or jsonb_array_length(v_items)>200 then raise exception '请选择需要调整的药品'; end if;
  if exists(select 1 from jsonb_array_elements(v_items) i group by i->>'medicineId' having count(*)>1) then raise exception '药品不能重复选择'; end if;
  select (now() at time zone timezone)::date into v_today from public.patients where id=v_patient;
  if v_start<v_today then raise exception '批量计划不能从过去生效'; end if;
  perform m.id from public.medicines m
    join jsonb_array_elements(v_items) i on m.id=(i->>'medicineId')::uuid
    where m.patient_id=v_patient and m.archived_at is null order by m.id for update of m;
  if (select count(*) from public.medicines m join jsonb_array_elements(v_items) i on m.id=(i->>'medicineId')::uuid where m.patient_id=v_patient and m.archived_at is null)<>jsonb_array_length(v_items) then raise exception '部分药品不存在或已停用'; end if;
  for v_item in select value from jsonb_array_elements(v_items) loop
    v_medicine:=(v_item->>'medicineId')::uuid;
    select * into v_med from public.medicines where id=v_medicine;
    if not (v_item ? 'expectedVersion') or (v_item->>'expectedVersion')::bigint<>v_med.version then raise exception '药品计划刚被家人修改，请刷新后重试'; end if;
    if v_start=v_today and exists(select 1 from public.schedules where medicine_id=v_medicine and effective_from<=v_today and (effective_to is null or effective_to>=v_today)) then raise exception '已有计划的药品请从明天开始批量调整'; end if;
    v_pattern:='daily'; v_days:='{}'; v_interval:=1; v_morning:=0; v_noon:=0; v_evening:=0; v_bedtime:=0; v_location:=null; v_paused:=false;
    select s.pattern,s.days_of_week,s.interval_days,s.morning,s.noon,s.evening,s.bedtime,s.location_id,s.paused
      into v_pattern,v_days,v_interval,v_morning,v_noon,v_evening,v_bedtime,v_location,v_paused
    from public.schedules s where s.medicine_id=v_medicine and s.effective_from<=v_start
      and (s.effective_to is null or s.effective_to>=v_start)
    order by s.effective_from desc,s.created_at desc,s.id desc limit 1;
    if not found then
      v_pattern:='daily'; v_days:='{}'; v_interval:=1; v_morning:=0; v_noon:=0; v_evening:=0; v_bedtime:=0; v_location:=null; v_paused:=false;
    end if;
    if v_slot='morning' then v_morning:=v_morning+v_delta;
    elsif v_slot='noon' then v_noon:=v_noon+v_delta;
    elsif v_slot='evening' then v_evening:=v_evening+v_delta;
    else v_bedtime:=v_bedtime+v_delta; end if;
    if least(v_morning,v_noon,v_evening,v_bedtime)<0
      or round(v_morning,v_med.unit_precision)<>v_morning or round(v_noon,v_med.unit_precision)<>v_noon
      or round(v_evening,v_med.unit_precision)<>v_evening or round(v_bedtime,v_med.unit_precision)<>v_bedtime then
      raise exception '批量调整会产生负数或精度不正确，请修改调整量';
    end if;
    select min(effective_from) into v_next_start from public.schedules where medicine_id=v_medicine and effective_from>v_start;
    insert into public.schedules(medicine_id,effective_from,effective_to,pattern,days_of_week,interval_days,morning,noon,evening,bedtime,location_id,paused,actor_user_id)
    values(v_medicine,v_start,case when v_next_start is null then null else v_next_start-1 end,v_pattern,v_days,v_interval,v_morning,v_noon,v_evening,v_bedtime,v_location,v_paused,auth.uid()) returning id into v_id;
    update public.medicines set version=version+1,updated_at=now() where id=v_medicine;
  end loop;
  perform public.complete_mutation('set_schedule_batch',p_idempotency_key,v_group);
  return v_group;
end $$;

revoke execute on function public.resolve_dose_location(uuid,uuid,date,text,timestamptz,uuid) from public,anon,authenticated;
revoke execute on function public.planned_dose_events(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated;
revoke execute on function public.api_schedule_overview(uuid,date),public.api_day_plan(uuid,date),public.api_set_schedule(jsonb,text),
  public.api_location_calendar(uuid,date),public.api_set_day_location_overrides(jsonb,text),
  public.api_set_dose_location_overrides(jsonb,text),public.api_set_schedule_batch(jsonb,text) from public,anon;
grant execute on function public.api_schedule_overview(uuid,date),public.api_day_plan(uuid,date),public.api_set_schedule(jsonb,text),
  public.api_location_calendar(uuid,date),public.api_set_day_location_overrides(jsonb,text),
  public.api_set_dose_location_overrides(jsonb,text),public.api_set_schedule_batch(jsonb,text) to authenticated;

commit;
