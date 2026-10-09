"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Edit3, Layers3, Plus, X } from "lucide-react";
import type { DashboardData, DoseSlot, MedicineSummary, MutationResult, ScheduleOverviewData, SchedulePlanSummary } from "@/lib/domain/types";

const slots: Array<{ key: DoseSlot; label: string }> = [
  { key: "morning", label: "早上" }, { key: "noon", label: "中午" },
  { key: "evening", label: "晚上" }, { key: "bedtime", label: "睡前" },
];

export function SchedulePanel({ dashboard, overview, busy, mutate, reload, editMedicine, notify }: {
  dashboard: DashboardData; overview: ScheduleOverviewData | null; busy: boolean;
  mutate: (action: string, payload: Record<string, unknown>) => Promise<MutationResult>;
  reload: () => Promise<void>; editMedicine: (medicine: MedicineSummary) => void; notify: (result: MutationResult) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [showBatch, setShowBatch] = useState(false);
  const [slot, setSlot] = useState<DoseSlot>("morning");
  const [delta, setDelta] = useState("1");
  const [effectiveFrom, setEffectiveFrom] = useState(addDays(overview?.localDate ?? isoToday(),1));
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plans = overview?.plans ?? [];
  const planMap = useMemo(() => new Map(plans.map((plan) => [plan.medicineId,plan])), [plans]);
  const selectedPlans = selected.map((id) => planMap.get(id)).filter((item): item is SchedulePlanSummary => Boolean(item));
  const numericDelta = Number(delta);
  const invalid = !Number.isFinite(numericDelta) || numericDelta === 0 || selectedPlans.some((plan) => planValueAt(plan,slot,effectiveFrom) + numericDelta < 0);
  useEffect(()=>{ if(overview?.localDate)setEffectiveFrom(addDays(overview.localDate,1)); },[overview?.localDate]);
  useEffect(()=>{ setSelected([]); setShowBatch(false); setPreview(false); setError(null); },[dashboard.space.id]);

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current,id]);
  const saveBatch = async () => {
    setError(null);
    if (!selected.length) { setError("请先勾选需要调整的药品"); return; }
    if (invalid) { setError("调整量不能为 0，也不能让服药数量变成负数"); return; }
    if (!preview) { setPreview(true); return; }
    const result = await mutate("set_schedule_batch", {
      effectiveFrom, slot, delta: numericDelta,
      items: selectedPlans.map((plan) => ({ medicineId: plan.medicineId, expectedVersion: plan.version })),
    });
    notify(result);
    if (result.ok) { setShowBatch(false); setPreview(false); setSelected([]); await reload(); }
    else setError(result.message);
  };

  return <section className="schedule-module">
    <div className="section-title"><div><h2>用药计划</h2><p>这里只记录已经确定的方案，不提供或改变医疗建议。</p></div>{dashboard.space.role !== "viewer" && <button className="primary-button" onClick={() => { setShowBatch(true); setPreview(false); }}><Layers3 size={18} />批量调整</button>}</div>
    <div className="schedule-day-note"><CalendarClock size={20} /><div><strong>{overview?.localDate ?? "今天"} 的安排</strong><small>按 {overview?.timezone ?? "用药人时区"} 的当地零点切换统计日；后台按早、中、晚、睡前的固定时段推算，刷新或跨设备查看不会重复扣减。</small></div></div>
    <div className="schedule-groups">{slots.map((item) => {
      const doses = plans.filter((plan) => plan.scheduleId && plan.isDoseDay && !plan.paused && Number(plan[item.key]) > 0);
      return <article className="schedule-group" key={item.key}><header><h3>{item.label}</h3><span>{doses.length} 种药</span></header>
        {doses.map((plan) => <div className="schedule-dose" key={plan.medicineId}><div><strong>{plan.medicineName}</strong><small>{patternLabel(plan)}{plan.locationId ? " · 固定消耗地点" : " · 跟随所在地"}</small></div><b>{plan[item.key]}{plan.unitName}</b></div>)}
        {doses.length===0 && <p className="empty-line compact">当前没有安排</p>}
      </article>;
    })}</div>
    <div className="plan-list plain-card"><div className="section-title"><div><h2>长期计划</h2><p>修改会从指定日期建立新版本，不覆盖已经确认的历史日期。</p></div></div>
      {plans.map((plan) => {
        const medicine = dashboard.medicines.find((item) => item.id===plan.medicineId);
        return <div className="plan-row" key={plan.medicineId}><label className="plan-check">{dashboard.space.role !== "viewer" && <input type="checkbox" checked={selected.includes(plan.medicineId)} onChange={() => toggle(plan.medicineId)} />}<span><strong>{plan.medicineName}</strong><small>{plan.scheduleId ? `${patternLabel(plan)} · ${doseSummary(plan)}` : "尚未设置当前计划"}</small>{plan.upcoming&&<small className="upcoming-plan">{plan.upcoming.effectiveFrom} 起：{patternLabel(plan.upcoming)} · {doseSummary({...plan,...plan.upcoming})}</small>}</span></label>{dashboard.space.role !== "viewer" && medicine && <button className="quiet-button" onClick={() => editMedicine(medicine)}>{plan.scheduleId||plan.upcoming ? <Edit3 size={16}/> : <Plus size={16}/>} {plan.scheduleId||plan.upcoming ? "调整" : "创建"}</button>}</div>;
      })}
    </div>

    {showBatch && <div className="modal-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-label="批量调整用药计划">
      <div className="dialog-head"><div><p className="eyebrow">原子批量操作</p><h2>批量调整计划</h2></div><button className="icon-button" onClick={() => { setShowBatch(false); setPreview(false); }} aria-label="关闭"><X /></button></div>
      {!preview ? <div className="form-stack"><p className="form-help">只会修改已勾选的 {selected.length} 种药。任何一种校验失败，全部修改都会回滚。</p><div className="two-fields"><label className="field"><span>调整时段</span><select value={slot} onChange={(event) => setSlot(event.target.value as DoseSlot)}>{slots.map((item)=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label className="field"><span>统一增加或减少</span><input type="number" step="any" value={delta} onChange={(event)=>setDelta(event.target.value)} /></label></div><label className="field"><span>生效日期</span><input type="date" min={addDays(overview?.localDate ?? isoToday(),1)} value={effectiveFrom} onChange={(event)=>setEffectiveFrom(event.target.value)} /></label></div>
      : <div className="batch-preview"><p className="form-help emphasis">请确认以下变化从 {effectiveFrom} 开始生效。未勾选药品不会改变。</p>{selectedPlans.map((plan)=>{const before=planValueAt(plan,slot,effectiveFrom);return <div className="preview-row" key={plan.medicineId}><strong>{plan.medicineName}</strong><span>{slotLabel(slot)}：{before} → {before+numericDelta}{plan.unitName}</span></div>;})}</div>}
      {error && <p className="field-error">{error}</p>}
      <div className="dialog-actions"><button className="quiet-button" onClick={() => preview ? setPreview(false) : setShowBatch(false)}>{preview ? "返回修改" : "取消"}</button><button className="primary-button" disabled={busy || !selected.length || invalid} onClick={saveBatch}>{preview ? <><CheckCircle2 size={17}/>确认并保存</> : "预览变化"}</button></div>
    </section></div>}
  </section>;
}

function patternLabel(plan: Pick<SchedulePlanSummary,"pattern"|"daysOfWeek">) {
  if (plan.pattern==="alternate") return "隔日";
  if (plan.pattern==="weekdays") return `每周${plan.daysOfWeek.map((day)=>"一二三四五六日"[day-1]).join("、")}`;
  return "每天";
}
function doseSummary(plan: SchedulePlanSummary) { return slots.filter((slot)=>plan[slot.key]>0).map((slot)=>`${slot.label}${plan[slot.key]}${plan.unitName}`).join("，") || "各时段均为 0"; }
function planValueAt(plan: SchedulePlanSummary,slot:DoseSlot,date:string) { return plan.upcoming&&plan.upcoming.effectiveFrom<=date ? Number(plan.upcoming[slot]) : Number(plan[slot]); }
function slotLabel(slot: DoseSlot) { return slots.find((item)=>item.key===slot)?.label ?? slot; }
function isoToday() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function addDays(value: string, days: number) { const [y,m,d]=value.split("-").map(Number); const date=new Date(Date.UTC(y,m-1,d+days)); return date.toISOString().slice(0,10); }
