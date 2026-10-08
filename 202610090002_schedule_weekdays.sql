begin;

create or replace function public.api_set_schedule(p_payload jsonb, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient uuid:=(p_payload->>'patientId')::uuid;
  v_medicine uuid:=(p_payload->>'medicineId')::uuid;
  v_start date:=(p_payload->>'effectiveFrom')::date;
  v_today date;
  v_next_start date;
  v_id uuid;
  v_existing uuid;
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
  if v_pattern='weekdays' then
    if jsonb_typeof(coalesce(p_payload->'daysOfWeek','[]'::jsonb))<>'array' then raise exception '指定星期格式不正确'; end if;
    select coalesce(array_agg(distinct x.day order by x.day),'{}'::smallint[]) into v_days
    from (select value::smallint as day from jsonb_array_elements_text(coalesce(p_payload->'daysOfWeek','[]'::jsonb))) x;
    if coalesce(array_length(v_days,1),0)=0 or exists(select 1 from unnest(v_days) as selected_day(day) where selected_day.day<1 or selected_day.day>7) then raise exception '请至少选择一个有效服药日'; end if;
  end if;
  if v_start<v_today then raise exception '新设置不能从过去生效，以免改写已确认的历史'; end if;
  if v_start=v_today and exists(select 1 from public.schedules where medicine_id=v_medicine and effective_from<=v_today and (effective_to is null or effective_to>=v_today)) then raise exception '已有用量计划请从明天或更晚开始调整，以免改变今天早些时候的结果'; end if;
  select min(effective_from) into v_next_start from public.schedules where medicine_id=v_medicine and effective_from>v_start;
  update public.schedules set effective_to=v_start-1 where medicine_id=v_medicine and effective_from<v_start and (effective_to is null or effective_to>=v_start);
  delete from public.schedules where medicine_id=v_medicine and effective_from=v_start;
  insert into public.schedules(medicine_id,effective_from,effective_to,pattern,days_of_week,interval_days,morning,noon,evening,bedtime,location_id,actor_user_id)
  values(v_medicine,v_start,case when v_next_start is null then null else v_next_start-1 end,v_pattern,v_days,case when v_pattern='alternate' then 2 else 1 end,coalesce((p_payload->>'morning')::numeric,v_daily),coalesce((p_payload->>'noon')::numeric,0),coalesce((p_payload->>'evening')::numeric,0),coalesce((p_payload->>'bedtime')::numeric,0),v_schedule_location,auth.uid()) returning id into v_id;
  update public.medicines set
    units_per_box=coalesce((p_payload->>'unitsPerBox')::numeric,units_per_box),
    safety_units=coalesce((p_payload->>'safetyUnits')::numeric,safety_units),
    reserve_units=coalesce((p_payload->>'reserveUnits')::numeric,reserve_units),
    version=version+1,updated_at=now()
  where id=v_medicine;
  perform public.complete_mutation('set_schedule',p_idempotency_key,v_id);
  return v_id;
end $$;

revoke execute on function public.api_set_schedule(jsonb,text) from public, anon;
grant execute on function public.api_set_schedule(jsonb,text) to authenticated;

commit;
