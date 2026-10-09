"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, History, MapPin, RotateCcw } from "lucide-react";
import type { DashboardData, DayPlanData, DoseSlot, LocationCalendarDay, MutationResult } from "@/lib/domain/types";

const slots: Array<{ key: DoseSlot; label: string }> = [
  { key:"morning",label:"早上" },{ key:"noon",label:"中午" },{ key:"evening",label:"晚上" },{ key:"bedtime",label:"睡前" },
];

export function LocationCalendarPanel({ dashboard, spaceId, localDate, days, busy, loadMonth, loadDay, mutate, notify }: {
  dashboard: DashboardData; days: LocationCalendarDay[]; busy: boolean;
  spaceId: string; localDate?: string; loadMonth: (spaceId: string,monthStart: string) => Promise<unknown>; loadDay: (spaceId: string,date: string) => Promise<DayPlanData | null>;
  mutate: (action: string,payload: Record<string,unknown>) => Promise<MutationResult>; notify: (result: MutationResult) => void;
}) {
  const today=localDate??isoToday();
  const [month,setMonth]=useState(today.slice(0,7));
  const [selectedDate,setSelectedDate]=useState(today);
  const [dayPlan,setDayPlan]=useState<DayPlanData|null>(null);
  const [rangeEnd,setRangeEnd]=useState(today);
  const [dayLocation,setDayLocation]=useState("");
  const [locationPreview,setLocationPreview]=useState(false);
  const [slotLocations,setSlotLocations]=useState<Record<string,string>>({});
  const [medicineLocations,setMedicineLocations]=useState<Record<string,string>>({});
  const [dosePreview,setDosePreview]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const canEdit=dashboard.space.role!=="viewer";
  const firstLocationId=dashboard.space.locations[0]?.id??"";
  const locationResetKey=`${dashboard.space.id}:${dashboard.space.locations.map((location)=>location.id).join(",")}`;

  useEffect(()=>{ if(localDate){setMonth(localDate.slice(0,7));setSelectedDate(localDate);} },[localDate]);
  useEffect(()=>{ setDayLocation(""); setSlotLocations({}); setMedicineLocations({}); setLocationPreview(false); setDosePreview(false); setError(null); },[locationResetKey]);
  useEffect(()=>{ void loadMonth(spaceId,`${month}-01`); },[month,spaceId,loadMonth]);
  useEffect(()=>{ setRangeEnd(selectedDate); setLocationPreview(false); setDosePreview(false); setSlotLocations({}); setMedicineLocations({}); void loadDay(spaceId,selectedDate).then(setDayPlan); },[selectedDate,spaceId,loadDay]);
  const firstWeekday=days[0] ? (new Date(`${days[0].date}T00:00:00`).getDay()+6)%7 : 0;
  const selectedInfo=days.find((day)=>day.date===selectedDate);
  const selectedLocationId=dayLocation||selectedInfo?.locationId||firstLocationId;
  const locationName=(id:string|null)=>dashboard.space.locations.find((item)=>item.id===id)?.name ?? "未设置";
  const rangeCount=Math.max(1,Math.round((Date.parse(`${rangeEnd}T00:00:00Z`)-Date.parse(`${selectedDate}T00:00:00Z`))/86_400_000)+1);
  const doseChanges=useMemo(()=> (dayPlan?.doses ?? []).map((dose)=>{
    const target=medicineLocations[`${dose.medicineId}:${dose.slot}`] || slotLocations[dose.slot] || dose.resolvedLocationId || "";
    return {...dose,targetLocationId:target,changed:Boolean(target)&&target!==dose.resolvedLocationId};
  }),[dayPlan,medicineLocations,slotLocations]);

  const refresh=async()=>{ await loadMonth(spaceId,`${month}-01`); setDayPlan(await loadDay(spaceId,selectedDate)); };
  const chooseDate=(day:LocationCalendarDay)=>{
    setSelectedDate(day.date); setRangeEnd(day.date); setDayLocation(day.locationId??firstLocationId);
    setLocationPreview(false); setDosePreview(false); setSlotLocations({}); setMedicineLocations({}); setError(null);
  };
  const saveSingleDayLocation=async()=>{
    setError(null);
    if(!selectedLocationId){setError("请先添加并选择一个地点");return;}
    const hadDoseOverride=Boolean(selectedInfo?.hasDoseOverride);
    const result=await mutate("set_day_locations",{dateFrom:selectedDate,dateTo:selectedDate,locationId:selectedLocationId,clear:false});
    if(!result.ok){notify(result);setError(result.message);return;}
    if(hadDoseOverride){
      const clearResult=await mutate("set_dose_locations",{date:selectedDate,assignments:[],clearAll:true});
      if(!clearResult.ok){
        const message=`全天地点已经保存，但原有分时段安排未能清除：${clearResult.message}`;
        setError(message); notify({ok:false,message}); await refresh(); return;
      }
    }
    notify({ok:true,message:`${selectedDate} 已设为全天在${locationName(selectedLocationId)}${hadDoseOverride?"，原分时段安排已清除":""}`});
    await refresh();
  };
  const saveDayRange=async()=>{
    setError(null);
    if(!selectedLocationId){setError("请先添加并选择一个地点");return;}
    if(!rangeEnd||rangeEnd<selectedDate){setError("结束日期不能早于开始日期");return;}
    if(!locationPreview){setLocationPreview(true);return;}
    const result=await mutate("set_day_locations",{dateFrom:selectedDate,dateTo:rangeEnd,locationId:selectedLocationId,clear:false});
    notify(result); if(result.ok){setLocationPreview(false);await refresh();} else setError(result.message);
  };
  const clearDayLocation=async()=>{
    setError(null);
    const result=await mutate("set_day_locations",{dateFrom:selectedDate,dateTo:selectedDate,locationId:selectedLocationId,clear:true});
    notify(result); if(result.ok)await refresh(); else setError(result.message);
  };
  const saveDoseLocations=async(clearAll=false)=>{
    setError(null);
    const assignments = clearAll ? [] : [
      ...Object.entries(slotLocations).filter(([,locationId])=>locationId).map(([slot,locationId])=>({slot,locationId})),
      ...Object.entries(medicineLocations).filter(([,locationId])=>locationId).map(([key,locationId])=>{const [medicineId,slot]=key.split(":");return{medicineId,slot,locationId};}),
    ];
    if(!clearAll&&!assignments.length){setError("请至少选择一个时段或药品例外");return;}
    if(!clearAll&&!dosePreview){setDosePreview(true);return;}
    const result=await mutate("set_dose_locations",{date:selectedDate,assignments,clearAll});
    notify(result); if(result.ok){setDosePreview(false);setSlotLocations({});setMedicineLocations({});await refresh();} else setError(result.message);
  };

  return <section className="calendar-module">
    <div className="section-title"><div><h2>所在地日历</h2><p>过去日期的修正采用独立审计记录，不覆盖原所在地历史或库存流水。</p></div></div>
    <div className="calendar-layout"><section className="plain-card calendar-card"><div className="calendar-head"><button className="icon-button" onClick={()=>setMonth(shiftMonth(month,-1))} aria-label="上个月"><ChevronLeft/></button><h3>{month.replace("-"," 年 ")} 月</h3><button className="icon-button" onClick={()=>setMonth(shiftMonth(month,1))} aria-label="下个月"><ChevronRight/></button></div>
      <div className="calendar-grid weekday-head">{"一二三四五六日".split("").map((day)=><span key={day}>周{day}</span>)}</div>
      <div className="calendar-grid">{Array.from({length:firstWeekday},(_,index)=><span key={`blank-${index}`} />)}{days.map((day)=><button key={day.date} className={`calendar-day ${selectedDate===day.date?"selected":""} ${day.isOverride||day.hasDoseOverride?"corrected":""}`} onClick={()=>chooseDate(day)}><b>{Number(day.date.slice(-2))}</b><small>{day.isMixed||day.hasDoseOverride?"多地点":day.locationName??"未设置"}</small>{day.wasCorrected&&<em>已修正</em>}</button>)}</div>
    </section>

    <aside className="plain-card calendar-detail"><div className="calendar-detail-title"><CalendarDays/><div><strong>{selectedDate}</strong><small>{selectedInfo?.isOverride?"使用当日所在地修正":selectedInfo?.isMixed?"当天有所在地切换":"按原所在地历史计算"}</small></div></div>
      <div className="current-day-location"><MapPin/><span>当天显示：<strong>{selectedInfo?.isMixed||selectedInfo?.hasDoseOverride?"多个地点":selectedInfo?.locationName??"未设置"}</strong></span></div>
      {selectedInfo?.wasCorrected&&<p className="audit-note"><History size={15}/>修正记录保留于数据库：{selectedInfo.previousLocationName??"正常规则"} → {selectedInfo.isOverride?selectedInfo.locationName??"未设置":"恢复正常规则"}{selectedInfo.correctedBy?`，最近由 ${selectedInfo.correctedBy} 修改`:""}{selectedInfo.correctedAt?`（${new Date(selectedInfo.correctedAt).toLocaleString("zh-CN")}）`:""}。</p>}
      {canEdit&&<>
        <div className="day-location-editor"><label className="field"><span>{selectedDate} 全天在哪里</span><select value={selectedLocationId} onChange={(event)=>{setDayLocation(event.target.value);setError(null);}}>{dashboard.space.locations.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          {selectedInfo?.hasDoseOverride&&<p className="override-warning">这一天已有按时段或药品设置的跨地点安排。保存全天地点后，这些安排会被明确清除，并以所选地点为准。</p>}
          <div className="inline-actions"><button className="primary-button" disabled={busy||!selectedLocationId} onClick={()=>void saveSingleDayLocation()}><MapPin size={17}/>保存当天地点</button>{selectedInfo?.isOverride&&<button className="quiet-button" disabled={busy} onClick={()=>void clearDayLocation()}><RotateCcw size={16}/>恢复正常规则</button>}</div>
        </div>

        <details className="calendar-advanced"><summary>连续多天批量设置（可选）</summary><div className="calendar-advanced-body"><p className="form-help">默认只修改上方选中的一天。需要连续多天在同一地点时，再使用这里。</p><div className="two-fields"><label className="field"><span>结束日期</span><input type="date" min={selectedDate} value={rangeEnd} onChange={(event)=>{setRangeEnd(event.target.value);setLocationPreview(false);}}/></label><label className="field"><span>实际所在地</span><select value={selectedLocationId} onChange={(event)=>{setDayLocation(event.target.value);setLocationPreview(false);}}>{dashboard.space.locations.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label></div>
          {locationPreview&&<div className="change-preview"><strong>修改预览</strong><p>{selectedDate}{rangeEnd!==selectedDate?` 至 ${rangeEnd}（共 ${rangeCount} 天）`:""}将整体按“{locationName(selectedLocationId)}”计算。其他日期不受影响。</p>{rangeCount===1&&dayPlan&&<ConsumptionPreview doses={dayPlan.doses.map((dose)=>({...dose,targetLocationId:selectedLocationId}))} locationName={locationName}/>}</div>}
          <div className="inline-actions"><button className="primary-button" disabled={busy||!selectedLocationId} onClick={()=>void saveDayRange()}>{locationPreview?"确认批量保存":"预览批量修改"}</button></div>
        </div></details>

        <details className="calendar-advanced"><summary>高级：按时段或单种药品分配地点</summary><div className="calendar-advanced-body"><p className="form-help">只改变 {selectedDate} 的库存消耗归属，不改变长期计划用量。留空的时段继续按正常规则。</p><div className="slot-location-grid">{slots.map((slot)=><label className="field" key={slot.key}><span>{slot.label}</span><select value={slotLocations[slot.key]??""} onChange={(event)=>{setSlotLocations((current)=>({...current,[slot.key]:event.target.value}));setDosePreview(false);}}><option value="">保持正常规则</option>{dashboard.space.locations.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label>)}</div>
          {(dayPlan?.doses.length??0)>0&&<details className="medicine-exceptions"><summary>单种药品例外（可选）</summary>{dayPlan?.doses.map((dose)=><label className="field" key={`${dose.medicineId}:${dose.slot}`}><span>{slotLabel(dose.slot)} · {dose.medicineName}（{dose.amount}{dose.unitName}）</span><select value={medicineLocations[`${dose.medicineId}:${dose.slot}`]??""} onChange={(event)=>{setMedicineLocations((current)=>({...current,[`${dose.medicineId}:${dose.slot}`]:event.target.value}));setDosePreview(false);}}><option value="">跟随时段或正常规则</option>{dashboard.space.locations.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label>)}</details>}
          {dosePreview&&<div className="change-preview"><strong>库存消耗预览</strong><ConsumptionPreview doses={doseChanges} locationName={locationName}/></div>}
          <div className="inline-actions"><button className="primary-button" disabled={busy} onClick={()=>void saveDoseLocations(false)}>{dosePreview?"确认保存":"预览时段调整"}</button>{selectedInfo?.hasDoseOverride&&<button className="quiet-button" disabled={busy} onClick={()=>void saveDoseLocations(true)}><RotateCcw size={16}/>清除分时段调整</button>}</div>
        </div></details>
      </>}
      {error&&<p className="field-error">{error}</p>}
    </aside></div>
  </section>;
}

function ConsumptionPreview({doses,locationName}:{doses:Array<{medicineName:string;unitName:string;slot:DoseSlot;amount:number;resolvedLocationId?:string|null;targetLocationId?:string|null}>;locationName:(id:string|null)=>string}) {
  if(!doses.length)return <p>当天没有生效的用药计划。</p>;
  return <div className="consumption-preview">{doses.map((dose)=><div key={`${dose.medicineName}:${dose.slot}`}><span>{slotLabel(dose.slot)} · {dose.medicineName} {dose.amount}{dose.unitName}</span><small>{locationName(dose.resolvedLocationId??null)} → {locationName(dose.targetLocationId??dose.resolvedLocationId??null)}</small></div>)}</div>;
}
function slotLabel(slot:DoseSlot){return slots.find((item)=>item.key===slot)?.label??slot;}
function isoToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function shiftMonth(value:string,delta:number){const [year,month]=value.split("-").map(Number);const d=new Date(year,month-1+delta,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;}
