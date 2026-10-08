-- 空间共用药品库、主要/备用地点储备、药盒照片和按地点临期统计（增量迁移）
-- 适用于已经执行 202610080001_initial.sql 的项目，不删除或重建现有数据。

begin;

alter table public.locations
  add column if not exists is_primary boolean not null default false,
  add column if not exists target_days integer check (target_days is null or target_days between 1 and 365);

with ranked as (
  select id,row_number() over(partition by patient_id order by sort_order,created_at,id) as position
  from public.locations where archived_at is null
)
update public.locations l set is_primary=(r.position=1),target_days=case when r.position=1 then null else coalesce(l.target_days,7) end
from ranked r where r.id=l.id and not exists(
  select 1 from public.locations current_primary where current_primary.patient_id=l.patient_id and current_primary.is_primary and current_primary.archived_at is null
);

update public.locations set target_days=null where is_primary and archived_at is null;
update public.locations set target_days=7 where not is_primary and target_days is null and archived_at is null;

create unique index if not exists locations_one_primary_per_patient
  on public.locations(patient_id) where is_primary and archived_at is null;

alter table public.medicines
  add column if not exists category text not null default '' check (char_length(category) <= 60),
  add column if not exists brand text not null default '' check (char_length(brand) <= 80),
  add column if not exists dosage_form text not null default '' check (char_length(dosage_form) <= 40),
  add column if not exists packaging_spec text not null default '' check (char_length(packaging_spec) <= 80),
  add column if not exists origin text not null default '' check (origin in ('', 'domestic', 'imported')),
  add column if not exists photo_path text check (photo_path is null or char_length(photo_path) between 1 and 500);

create index if not exists medicines_patient_library
  on public.medicines(patient_id, created_at desc)
  where archived_at is null;

create or replace function public.api_my_spaces()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.display_name,'role',pp.role,'isPrivate',p.is_private,
    'currentLocationId',(select h.location_id from public.patient_location_history h where h.patient_id=p.id and h.effective_from<=now() order by h.effective_from desc limit 1),
    'locations',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',l.id,'name',l.name,'isPrimary',l.is_primary,'targetDays',l.target_days
    ) order by l.sort_order,l.created_at),'[]'::jsonb) from public.locations l where l.patient_id=p.id and l.archived_at is null)
  ) order by p.created_at),'[]'::jsonb)
  from public.patients p join public.patient_permissions pp on pp.patient_id=p.id
  where pp.user_id=auth.uid()
$$;

create or replace function public.api_create_patient(p_payload jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_patient uuid; v_location uuid; v_existing uuid;
begin
  v_existing:=public.begin_mutation('create_patient',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  if nullif(trim(p_payload->>'name'),'') is null then raise exception '请输入用药人称呼'; end if;
  if not exists(select 1 from pg_timezone_names where name=coalesce(nullif(p_payload->>'timezone',''),'Asia/Shanghai')) then raise exception '无效的时区'; end if;
  insert into public.patients(owner_user_id,display_name,timezone)
  values(auth.uid(),trim(p_payload->>'name'),coalesce(nullif(p_payload->>'timezone',''),'Asia/Shanghai')) returning id into v_patient;
  insert into public.patient_permissions(patient_id,user_id,role,granted_by) values(v_patient,auth.uid(),'owner',auth.uid());
  insert into public.locations(patient_id,name,is_primary,target_days)
  values(v_patient,coalesce(nullif(trim(p_payload->>'locationName'),''),'家里'),true,null) returning id into v_location;
  insert into public.patient_location_history(patient_id,location_id,effective_from,actor_user_id) values(v_patient,v_location,now(),auth.uid());
  perform public.complete_mutation('create_patient',p_idempotency_key,v_patient);
  return v_patient;
end $$;

create or replace function public.api_add_location(p_payload jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient uuid := (p_payload->>'patientId')::uuid;
  v_id uuid;
  v_existing uuid;
  v_primary boolean := coalesce((p_payload->>'isPrimary')::boolean,false);
  v_days integer := coalesce((p_payload->>'targetDays')::integer,7);
begin
  if not public.has_patient_role(v_patient,'editor') then raise exception '没有修改权限'; end if;
  v_existing:=public.begin_mutation('add_location',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  if nullif(trim(p_payload->>'name'),'') is null then raise exception '请输入地点名称'; end if;
  if not exists(select 1 from public.locations where patient_id=v_patient and is_primary and archived_at is null) then v_primary:=true; end if;
  if not v_primary and (v_days<1 or v_days>365) then raise exception '备用天数应在 1 到 365 天之间'; end if;
  if v_primary then
    update public.locations set is_primary=false,target_days=coalesce(target_days,7) where patient_id=v_patient and is_primary and archived_at is null;
  end if;
  insert into public.locations(patient_id,name,sort_order,is_primary,target_days)
  values(v_patient,trim(p_payload->>'name'),coalesce((select max(sort_order)+1 from public.locations where patient_id=v_patient),0),v_primary,case when v_primary then null else v_days end)
  returning id into v_id;
  perform public.complete_mutation('add_location',p_idempotency_key,v_id);
  return v_id;
end $$;

create or replace function public.api_update_location_settings(p_payload jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient uuid := (p_payload->>'patientId')::uuid;
  v_location uuid := (p_payload->>'locationId')::uuid;
  v_primary boolean := coalesce((p_payload->>'isPrimary')::boolean,false);
  v_days integer := coalesce((p_payload->>'targetDays')::integer,7);
  v_current_primary boolean;
  v_existing uuid;
begin
  if not public.has_patient_role(v_patient,'editor') then raise exception '没有修改权限'; end if;
  v_existing:=public.begin_mutation('update_location_settings',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  select is_primary into v_current_primary from public.locations where id=v_location and patient_id=v_patient and archived_at is null for update;
  if not found then raise exception '未找到地点'; end if;
  if not v_primary and v_current_primary then raise exception '请直接把另一个地点设为主要地点'; end if;
  if not v_primary and (v_days<1 or v_days>365) then raise exception '备用天数应在 1 到 365 天之间'; end if;
  if v_primary then
    update public.locations set is_primary=false,target_days=coalesce(target_days,7) where patient_id=v_patient and is_primary and id<>v_location and archived_at is null;
  end if;
  update public.locations set is_primary=v_primary,target_days=case when v_primary then null else v_days end where id=v_location;
  perform public.complete_mutation('update_location_settings',p_idempotency_key,v_location);
  return v_location;
end $$;

create or replace function public.api_add_medicine(p_payload jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient uuid := (p_payload->>'patientId')::uuid;
  v_medicine uuid;
  v_operation uuid;
  v_batch uuid;
  v_existing uuid;
  v_units numeric := coalesce((p_payload->>'initialUnits')::numeric,0);
  v_daily numeric := coalesce((p_payload->>'dailyDose')::numeric,0);
  v_location uuid := (p_payload->>'locationId')::uuid;
  v_precision smallint := coalesce((p_payload->>'precision')::smallint,0);
begin
  if not public.has_patient_role(v_patient,'editor') then raise exception '没有修改权限'; end if;
  v_existing := public.begin_mutation('add_medicine',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  if nullif(trim(p_payload->>'name'),'') is null then raise exception '请输入药品名称'; end if;
  if v_units<0 or round(v_units,v_precision)<>v_units then raise exception '数量格式不正确'; end if;
  if v_precision<0 or v_precision>3 or (p_payload->>'unitsPerBox')::numeric<=0
    or round((p_payload->>'unitsPerBox')::numeric,v_precision)<>(p_payload->>'unitsPerBox')::numeric then raise exception '包装数量精度不正确'; end if;
  if v_daily<0 or round(v_daily,v_precision)<>v_daily then raise exception '每日用量精度不正确'; end if;
  if round(coalesce((p_payload->>'safetyUnits')::numeric,0),v_precision)<>coalesce((p_payload->>'safetyUnits')::numeric,0)
    or round(coalesce((p_payload->>'reserveUnits')::numeric,0),v_precision)<>coalesce((p_payload->>'reserveUnits')::numeric,0) then raise exception '提醒数量精度不正确'; end if;
  if not exists(select 1 from public.locations where id=v_location and patient_id=v_patient and archived_at is null) then raise exception '存放地点不属于这个用药空间'; end if;

  insert into public.medicines(
    patient_id,name,category,brand,dosage_form,specification,packaging_spec,origin,notes,
    unit_name,units_per_box,unit_precision,safety_units,reserve_units
  ) values (
    v_patient,trim(p_payload->>'name'),trim(coalesce(p_payload->>'category','')),trim(coalesce(p_payload->>'brand','')),
    trim(coalesce(p_payload->>'dosageForm','')),trim(coalesce(p_payload->>'specification','')),
    trim(coalesce(p_payload->>'packagingSpec','')),coalesce(p_payload->>'origin',''),trim(coalesce(p_payload->>'notes','')),
    coalesce(nullif(trim(p_payload->>'unitName'),''),'粒'),(p_payload->>'unitsPerBox')::numeric,v_precision,
    coalesce((p_payload->>'safetyUnits')::numeric,0),coalesce((p_payload->>'reserveUnits')::numeric,0)
  ) returning id into v_medicine;

  if v_units>0 then
    insert into public.medicine_batches(medicine_id,received_at,expires_on,note)
    values(v_medicine,public.medicine_local_date(v_medicine,now()),null,'初始库存') returning id into v_batch;
    insert into public.stock_operations(patient_id,medicine_id,kind,actor_user_id,idempotency_key,package_size_snapshot,version_before,metadata)
    values(v_patient,v_medicine,'receive',auth.uid(),p_idempotency_key,(p_payload->>'unitsPerBox')::numeric,0,jsonb_build_object('description','初始库存录入')) returning id into v_operation;
    insert into public.stock_entries(operation_id,location_id,batch_id,delta_units) values(v_operation,v_location,v_batch,v_units);
  end if;
  if v_daily>0 then
    insert into public.schedules(medicine_id,effective_from,pattern,morning,actor_user_id)
    values(v_medicine,public.medicine_local_date(v_medicine,now()),'daily',v_daily,auth.uid());
  end if;
  perform public.complete_mutation('add_medicine',p_idempotency_key,v_medicine);
  return v_medicine;
end $$;

create or replace function public.api_update_medicine(p_payload jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient uuid := (p_payload->>'patientId')::uuid;
  v_medicine uuid := (p_payload->>'medicineId')::uuid;
  v_med public.medicines%rowtype;
  v_existing uuid;
  v_units_per_box numeric := (p_payload->>'unitsPerBox')::numeric;
  v_origin text := coalesce(p_payload->>'origin','');
begin
  if not public.has_patient_role(v_patient,'editor') then raise exception '没有修改权限'; end if;
  v_existing := public.begin_mutation('update_medicine',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  select * into v_med from public.medicines where id=v_medicine and patient_id=v_patient and archived_at is null for update;
  if not found then raise exception '未找到药品'; end if;
  if not (p_payload ? 'expectedVersion') or (p_payload->>'expectedVersion')::bigint<>v_med.version then raise exception '药品资料刚被家人修改，请刷新后再试'; end if;
  if nullif(trim(p_payload->>'name'),'') is null then raise exception '请输入药品名称'; end if;
  if v_units_per_box<=0 or round(v_units_per_box,v_med.unit_precision)<>v_units_per_box then raise exception '包装数量精度不正确'; end if;
  if v_origin not in ('','domestic','imported') then raise exception '国产/进口选项无效'; end if;

  update public.medicines set
    name=trim(p_payload->>'name'), category=trim(coalesce(p_payload->>'category','')),
    brand=trim(coalesce(p_payload->>'brand','')), dosage_form=trim(coalesce(p_payload->>'dosageForm','')),
    specification=trim(coalesce(p_payload->>'specification','')), packaging_spec=trim(coalesce(p_payload->>'packagingSpec','')),
    origin=v_origin, notes=trim(coalesce(p_payload->>'notes','')),
    unit_name=coalesce(nullif(trim(p_payload->>'unitName'),''),unit_name), units_per_box=v_units_per_box,
    version=version+1, updated_at=now()
  where id=v_medicine;
  perform public.complete_mutation('update_medicine',p_idempotency_key,v_medicine);
  return v_medicine;
end $$;

create or replace function public.api_archive_medicine(p_payload jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient uuid := (p_payload->>'patientId')::uuid;
  v_medicine uuid := (p_payload->>'medicineId')::uuid;
  v_med public.medicines%rowtype;
  v_existing uuid;
begin
  if not public.has_patient_role(v_patient,'editor') then raise exception '没有修改权限'; end if;
  v_existing := public.begin_mutation('archive_medicine',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  select * into v_med from public.medicines where id=v_medicine and patient_id=v_patient and archived_at is null for update;
  if not found then raise exception '未找到药品'; end if;
  if not (p_payload ? 'expectedVersion') or (p_payload->>'expectedVersion')::bigint<>v_med.version then raise exception '药品资料刚被家人修改，请刷新后再试'; end if;
  if exists(select 1 from public.stock_operations where medicine_id=v_medicine)
    or exists(select 1 from public.medicine_batches where medicine_id=v_medicine)
    or exists(select 1 from public.schedules where medicine_id=v_medicine) then
    raise exception '该药品已有库存、用药计划或历史记录，不能停用；可以继续保留并修改资料';
  end if;
  update public.medicines set archived_at=now(),version=version+1,updated_at=now() where id=v_medicine;
  perform public.complete_mutation('archive_medicine',p_idempotency_key,v_medicine);
  return v_medicine;
end $$;

create or replace function public.api_set_medicine_photo(p_payload jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient uuid := (p_payload->>'patientId')::uuid;
  v_medicine uuid := (p_payload->>'medicineId')::uuid;
  v_path text := nullif(p_payload->>'photoPath','');
  v_existing uuid;
begin
  if not public.has_patient_role(v_patient,'editor') then raise exception '没有修改权限'; end if;
  v_existing := public.begin_mutation('set_medicine_photo',p_idempotency_key);
  if v_existing is not null then return v_existing; end if;
  perform 1 from public.medicines where id=v_medicine and patient_id=v_patient and archived_at is null for update;
  if not found then raise exception '未找到药品'; end if;
  if v_path is not null and (v_path not like v_patient::text||'/'||v_medicine::text||'/%' or char_length(v_path)>500 or position('..' in v_path)>0) then
    raise exception '照片路径无效';
  end if;
  update public.medicines set photo_path=v_path,version=version+1,updated_at=now() where id=v_medicine;
  perform public.complete_mutation('set_medicine_photo',p_idempotency_key,v_medicine);
  return v_medicine;
end $$;

create or replace function public.planned_dose_events(
  p_medicine_id uuid,p_location_id uuid,p_from timestamptz,p_to timestamptz
) returns table(dose_at timestamptz,amount numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with context as (
    select m.patient_id,p.timezone
    from public.medicines m join public.patients p on p.id=m.patient_id
    where m.id=p_medicine_id
  ), doses as (
    select slot.amount,instant.dose_at,
      coalesce(active_schedule.location_id,(
        select h.location_id from public.patient_location_history h
        where h.patient_id=c.patient_id and h.effective_from<=instant.dose_at
        order by h.effective_from desc limit 1
      )) resolved_location
    from context c
    cross join lateral (
      select bounds.start_date+offsets.day_offset as dose_date
      from (values (
        (p_from at time zone c.timezone)::date-1,
        (p_to at time zone c.timezone)::date
      )) bounds(start_date,end_date)
      cross join lateral generate_series(0,bounds.end_date-bounds.start_date) offsets(day_offset)
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
      (time '07:00',active_schedule.morning),(time '12:00',active_schedule.noon),
      (time '18:00',active_schedule.evening),(time '22:00',active_schedule.bedtime)
    ) slot(dose_time,amount)
    cross join lateral (select (day.dose_date+slot.dose_time) at time zone c.timezone as dose_at) instant
    where not active_schedule.paused and slot.amount>0
      and (active_schedule.pattern='daily'
        or (active_schedule.pattern='alternate' and mod(day.dose_date-active_schedule.effective_from,active_schedule.interval_days)=0)
        or (active_schedule.pattern='weekdays' and extract(isodow from day.dose_date)::smallint=any(active_schedule.days_of_week)))
  )
  select doses.dose_at,doses.amount from doses
  where resolved_location=p_location_id and doses.dose_at>p_from and doses.dose_at<=p_to
  order by doses.dose_at
$$;

create or replace function public.planned_units_for_days(p_medicine_id uuid,p_days integer,p_from timestamptz default now())
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  with context as (
    select (p_from at time zone p.timezone)::date as start_date
    from public.medicines m join public.patients p on p.id=m.patient_id
    where m.id=p_medicine_id
  ), dose_dates as (
    select c.start_date+offsets.day_offset as dose_date
    from context c cross join lateral generate_series(0,greatest(0,least(p_days,365))-1) offsets(day_offset)
  )
  select coalesce(sum(active_schedule.morning+active_schedule.noon+active_schedule.evening+active_schedule.bedtime),0)
  from dose_dates d
  join lateral (
    select s.effective_from,s.pattern,s.interval_days,s.days_of_week,s.paused,s.morning,s.noon,s.evening,s.bedtime
    from public.schedules s
    where s.medicine_id=p_medicine_id
      and d.dose_date between s.effective_from and coalesce(s.effective_to,d.dose_date)
    order by s.effective_from desc,s.created_at desc,s.id desc
    limit 1
  ) active_schedule on true
  where not active_schedule.paused and (active_schedule.pattern='daily'
    or (active_schedule.pattern='alternate' and mod(d.dose_date-active_schedule.effective_from,active_schedule.interval_days)=0)
    or (active_schedule.pattern='weekdays' and extract(isodow from d.dose_date)::smallint=any(active_schedule.days_of_week)))
$$;

create or replace function public.api_secondary_location_targets(p_patient_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'medicineId',m.id,'locationId',l.id,'requiredUnits',calculation.required_units,
    'recommendedBoxes',calculation.recommended_boxes,'targetUnits',calculation.recommended_boxes*m.units_per_box
  ) order by l.sort_order,m.created_at),'[]'::jsonb)
  from public.locations l
  join public.medicines m on m.patient_id=l.patient_id and m.archived_at is null
  cross join lateral (
    select required.required_units,
      case when required.required_units>0 then ceil(required.required_units/m.units_per_box) else 0 end as recommended_boxes
    from (select public.planned_units_for_days(m.id,l.target_days,now()) as required_units) required
  ) calculation
  where l.patient_id=p_patient_id and l.archived_at is null and not l.is_primary
    and public.has_patient_role(p_patient_id,'viewer')
$$;

create or replace function public.api_location_expiry(p_patient_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'medicineId',m.id,'locationId',l.id,'units',public.batch_units_by_expiry(
      m.id,l.id,public.medicine_local_date(m.id,now()),public.medicine_local_date(m.id,now())+30,now()
    )
  ) order by m.created_at,l.sort_order,l.created_at),'[]'::jsonb)
  from public.medicines m
  join public.locations l on l.patient_id=m.patient_id and l.archived_at is null
  where m.patient_id=p_patient_id and m.archived_at is null and public.has_patient_role(p_patient_id,'viewer')
$$;

create or replace function public.medicine_photo_patient_id(p_name text)
returns uuid language sql immutable set search_path = public, pg_temp as $$
  select case
    when split_part(p_name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then split_part(p_name,'/',1)::uuid
    else null
  end
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('medicine-photos','medicine-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set
  public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists medicine_photos_read on storage.objects;
drop policy if exists medicine_photos_insert on storage.objects;
drop policy if exists medicine_photos_update on storage.objects;
drop policy if exists medicine_photos_delete on storage.objects;

create policy medicine_photos_read on storage.objects for select to authenticated
using(bucket_id='medicine-photos' and public.has_patient_role(public.medicine_photo_patient_id(name),'viewer'));
create policy medicine_photos_insert on storage.objects for insert to authenticated
with check(bucket_id='medicine-photos' and public.has_patient_role(public.medicine_photo_patient_id(name),'editor'));
create policy medicine_photos_update on storage.objects for update to authenticated
using(bucket_id='medicine-photos' and public.has_patient_role(public.medicine_photo_patient_id(name),'editor'))
with check(bucket_id='medicine-photos' and public.has_patient_role(public.medicine_photo_patient_id(name),'editor'));
create policy medicine_photos_delete on storage.objects for delete to authenticated
using(bucket_id='medicine-photos' and public.has_patient_role(public.medicine_photo_patient_id(name),'editor'));

revoke execute on function public.api_update_medicine(jsonb,text), public.api_archive_medicine(jsonb,text),
  public.api_set_medicine_photo(jsonb,text), public.api_update_location_settings(jsonb,text),
  public.api_location_expiry(uuid), public.api_secondary_location_targets(uuid), public.medicine_photo_patient_id(text)
  from public, anon;
revoke execute on function public.planned_dose_events(uuid,uuid,timestamptz,timestamptz),
  public.planned_units_for_days(uuid,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.api_add_medicine(jsonb,text), public.api_update_medicine(jsonb,text),
  public.api_archive_medicine(jsonb,text), public.api_set_medicine_photo(jsonb,text), public.api_update_location_settings(jsonb,text),
  public.api_location_expiry(uuid), public.api_secondary_location_targets(uuid),
  public.medicine_photo_patient_id(text) to authenticated;

commit;
