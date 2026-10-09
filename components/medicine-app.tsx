"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle, ArrowLeftRight, Boxes, CheckCircle2, ChevronDown, ClipboardCheck,
  CalendarDays, History, Home, LogOut, MapPin, PackagePlus, Pill, Plus, RotateCcw, Settings2, ShieldCheck,
  Trash2, UserRound, UsersRound, X,
} from "lucide-react";
import type { AppMode, MedicineSummary, MutationResult, SchedulePattern, SchedulePlanSummary } from "@/lib/domain/types";
import { formatQuantity, parseFriendlyQuantity } from "@/lib/domain/quantity";
import { useInventoryApp } from "@/lib/data/use-inventory-app";
import { SchedulePanel } from "@/components/schedule-panel";
import { LocationCalendarPanel } from "@/components/location-calendar-panel";

type ActionDialogKind = "add" | "receive" | "quick-receive" | "adjust" | "transfer" | "loss" | "schedule" | "location" | "add-location" | "location-settings" | "invite" | "create-space";
type LibraryDialogKind = "library-add" | "library-edit";
type DialogKind = ActionDialogKind | LibraryDialogKind | null;

export function MedicineApp({ mode }: { mode: AppMode }) {
  const app = useInventoryApp(mode);
  const [tab, setTab] = useState<"overview" | "schedule" | "calendar" | "library" | "history" | "family">("overview");
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [activeMedicine, setActiveMedicine] = useState<MedicineSummary | null>(null);
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [inventoryLocationId, setInventoryLocationId] = useState("all");
  const [librarySearch, setLibrarySearch] = useState("");

  useEffect(() => { setInventoryLocationId("all"); setLibrarySearch(""); }, [app.selectedId]);

  if (!app.authChecked) return <Loading />;
  if (mode === "supabase" && !app.user) return <AuthPanel signIn={app.signIn} signUp={app.signUp} />;

  const open = (kind: DialogKind, medicine?: MedicineSummary, locationId?: string | null) => {
    setActiveMedicine(medicine ?? null); setActiveLocationId(locationId ?? null); setDialog(kind);
  };
  const finish = (result: MutationResult) => {
    setToast(result.message); if (result.ok) setDialog(null);
    window.setTimeout(() => setToast(null), 3200);
  };

  const dashboard = app.dashboard;
  const visibleMedicines = dashboard?.medicines
    .filter((medicine) => inventoryLocationId === "all" || (medicine.locations.find((location) => location.id === inventoryLocationId)?.units ?? 0) > 0)
    .map((medicine) => {
      const locations = inventoryLocationId === "all" ? medicine.locations : medicine.locations.filter((location) => location.id === inventoryLocationId);
      const hasLocationExpiry = locations.some((location) => location.expiringUnits !== undefined);
      return { ...medicine, locations, expiringUnits: hasLocationExpiry ? locations.reduce((sum, location) => sum + (location.expiringUnits ?? 0), 0) : medicine.expiringUnits };
    }) ?? [];
  const attention = visibleMedicines.filter((medicine) => {
    const total = medicine.locations.reduce((sum, location) => sum + location.units, 0);
    return total <= medicine.safetyUnits || (medicine.expiringUnits ?? 0) > 0;
  });
  const libraryItems = dashboard?.medicines.filter((medicine) => {
    const keyword = librarySearch.trim().toLocaleLowerCase("zh-CN");
    return !keyword || [medicine.name, medicine.brand, medicine.category, medicine.dosageForm, medicine.specification].some((value) => value?.toLocaleLowerCase("zh-CN").includes(keyword));
  }) ?? [];

  return (
    <main className="app-shell">
      {mode === "demo" && (
        <div className="demo-banner">
          <span><strong>演示模式</strong>　数据仅保存在这台设备的浏览器中，请勿录入真实隐私信息。</span>
          <button onClick={app.resetDemo}>恢复示例</button>
        </div>
      )}
      <header className="topbar">
        <div className="brand"><span className="brand-mark">药</span><div><strong>家庭药箱</strong><small>清楚管理家里的药</small></div></div>
        <div className="top-actions">
          {mode === "supabase" && <button className="icon-button" aria-label="退出登录" onClick={app.signOut}><LogOut size={21} /></button>}
        </div>
      </header>
      {app.pendingInvites.map((invite) => <div className="invite-banner" key={invite.id}><div><UsersRound size={21} /><span><strong>{invite.invitedBy}</strong> 邀请你共同管理“{invite.patientName}”</span></div><span className="invite-actions"><button className="quiet-button" onClick={async () => finish(await app.answerInvite(invite.id, false))}>暂不加入</button><button className="primary-button" onClick={async () => finish(await app.answerInvite(invite.id, true))}>接受邀请</button></span></div>)}

      <div className="workspace">
        <aside className="space-panel">
          <p className="eyebrow">选择用药人</p>
          <div className="space-list">
            {app.spaces.map((space) => (
              <button key={space.id} className={`space-button ${app.selectedId === space.id ? "active" : ""}`} onClick={() => app.selectSpace(space.id)}>
                <span className="avatar"><UserRound size={23} /></span>
                <span><strong>{space.name}</strong><small>{space.role === "owner" ? "我的私人空间" : space.role === "editor" ? "可共同管理" : "仅可查看"}</small></span>
              </button>
            ))}
          </div>
          <button className="quiet-button full" onClick={() => open("create-space")}><Plus size={18} /> 新建用药人</button>
          <div className="privacy-note"><ShieldCheck size={18} /><span>私人空间默认不共享，只有你授权的家人才能进入。</span></div>
        </aside>

        <section className="content">
          {app.error && <div className="error-box"><AlertTriangle size={20} />{friendlyError(app.error)}</div>}
          {!dashboard && !app.busy && (
            <EmptyState title="还没有用药人空间" text="先建立“我”或家人的用药空间，再开始添加药品。" action={() => open("create-space")} />
          )}
          {dashboard && <>
            <div className="page-heading">
              <div><p className="eyebrow">正在管理</p><h1>{dashboard.space.name}</h1><p>预测数量会随用药计划变化，不代表已经实际服药。</p></div>
              <div className="heading-actions">{dashboard.space.role !== "viewer" && <><button className="quiet-button" onClick={() => open("add-location")}><Plus size={18} />地点</button><button className="quiet-button" onClick={() => open("location-settings")}><Settings2 size={18} />储备设置</button><button className="location-switch" onClick={() => open("location")}><MapPin size={20} />当前在 {dashboard.space.locations.find((x) => x.id === dashboard.space.currentLocationId)?.name ?? "未设置"}<ChevronDown size={18} /></button></>}</div>
            </div>

            <nav className="tabs" aria-label="主要功能">
              <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><Home size={19} />药品</button>
              <button className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}><Pill size={19} />用药计划</button>
              <button className={tab === "calendar" ? "active" : ""} onClick={() => setTab("calendar")}><CalendarDays size={19} />所在地日历</button>
              <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Boxes size={19} />药品库</button>
              <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}><History size={19} />最近操作</button>
              <button className={tab === "family" ? "active" : ""} onClick={() => setTab("family")}><UsersRound size={19} />家人管理</button>
            </nav>

            {tab === "overview" && <>
              {attention.length > 0 && <section className="attention"><div><AlertTriangle size={23} /><strong>有 {attention.length} 种药需要留意</strong></div><p>可能库存不多或接近有效期，请打开药品卡片查看。</p></section>}
              <div className="section-title inventory-title"><div><h2>药品库存</h2><p>这里选择的是正在管理的库存地点，与“当前所在地”和主要/备用设置互不改变。</p></div><div className="section-actions">{dashboard.space.role !== "viewer" && <><button className="quiet-button" onClick={() => open("add", undefined, inventoryLocationId === "all" ? null : inventoryLocationId)}><Plus size={18} />手动新增</button><button className="primary-button" onClick={() => open("quick-receive", undefined, inventoryLocationId === "all" ? null : inventoryLocationId)}><PackagePlus size={19} />从药品库入库</button></>}</div></div>
              <div className="inventory-locations"><button className={inventoryLocationId==="all"?"active":""} onClick={()=>setInventoryLocationId("all")}><Boxes/><span><strong>全部地点</strong><small>汇总查看</small></span></button>{dashboard.space.locations.map((location)=>{const medicineCount=dashboard.medicines.filter((medicine)=>(medicine.locations.find((item)=>item.id===location.id)?.units??0)>0).length;return <button key={location.id} className={inventoryLocationId===location.id?"active":""} onClick={()=>setInventoryLocationId(location.id)}><MapPin/><span><strong>{location.name}</strong><small>{location.isPrimary?"主要地点":"备用地点"} · {medicineCount} 种有库存</small></span>{dashboard.space.currentLocationId===location.id&&<em>当前所在地</em>}</button>;})}</div>
              {inventoryLocationId!=="all"&&<p className="managed-location-note"><MapPin size={17}/>正在管理 <strong>{dashboard.space.locations.find((item)=>item.id===inventoryLocationId)?.name}</strong> 的库存；下面的入库和修改数量会默认作用于这里。</p>}
              <div className="medicine-grid">
                {visibleMedicines.map((medicine) => <MedicineCard key={medicine.id} medicine={medicine} canEdit={dashboard.space.role !== "viewer"} open={(kind) => open(kind, dashboard.medicines.find((item) => item.id === medicine.id) ?? medicine, inventoryLocationId === "all" ? null : inventoryLocationId)} />)}
              </div>
              {visibleMedicines.length === 0 && <EmptyState title={inventoryLocationId === "all" ? "还没有药品" : "这个地点暂时没有库存"} text={inventoryLocationId === "all" ? "可以先登记常用药品，再按实际地点入库。" : "仍然可以切换到这里；入库或调拨后会显示药品。"} action={dashboard.space.role === "viewer" ? undefined : () => open(inventoryLocationId === "all" ? "library-add" : "quick-receive", undefined, inventoryLocationId === "all" ? null : inventoryLocationId)} actionLabel={inventoryLocationId === "all" ? "登记药品" : "从药品库入库"} />}
            </>}

            {tab === "schedule" && <SchedulePanel dashboard={dashboard} overview={app.scheduleOverview} busy={app.busy} mutate={app.mutate} reload={async()=>{if(app.selectedId)await app.loadScheduleOverview(app.selectedId);}} editMedicine={(medicine)=>open("schedule",medicine)} notify={finish} />}

            {tab === "calendar" && app.selectedId && <LocationCalendarPanel dashboard={dashboard} spaceId={app.selectedId} localDate={app.scheduleOverview?.localDate} days={app.calendarDays} busy={app.busy} loadMonth={app.loadLocationCalendar} loadDay={app.loadDayPlan} mutate={app.mutate} notify={finish} />}

            {tab === "library" && <section className="plain-card library-panel">
              <div className="section-title"><div><h2>空间共用药品库</h2><p>药品资料由当前空间成员共同复用；登记资料不代表已有库存。</p></div>{dashboard.space.role !== "viewer" && <button className="primary-button" onClick={() => open("library-add")}><Plus size={19} />登记药品</button>}</div>
              <input className="library-search" type="search" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="搜索药品名称、品牌或类别" aria-label="搜索药品库" />
              <div className="library-grid">{libraryItems.map((medicine) => <LibraryCard key={medicine.id} medicine={medicine} photoUrl={medicine.photoPath ? app.photoUrls[medicine.photoPath] : undefined} canEdit={dashboard.space.role !== "viewer"} open={open} />)}</div>
              {libraryItems.length === 0 && <EmptyState title={librarySearch ? "没有找到相符药品" : "药品库还是空的"} text={librarySearch ? "换个名称、品牌或类别试试。" : "先登记常用药品，以后入库时直接选择。"} action={!librarySearch && dashboard.space.role !== "viewer" ? () => open("library-add") : undefined} actionLabel="登记药品" />}
            </section>}

            {tab === "history" && <section className="plain-card">
              <div className="section-title"><div><h2>最近操作</h2><p>错误操作可以安全撤销；原记录不会被删除。</p></div></div>
              <div className="history-list">{dashboard.operations.map((item) => (
                <div className="history-row" key={item.id}><span className="history-icon">{operationIcon(item.kind)}</span><div><strong>{item.description}</strong><small>{item.medicineName} · {formatDateTime(item.occurredAt)} · {item.actorName}</small></div>
                  {item.canUndo && dashboard.space.role !== "viewer" && <button className="quiet-button" disabled={app.busy} onClick={async () => finish(await app.mutate("undo", { operationId: item.id }))}><RotateCcw size={17} />撤销</button>}</div>
              ))}{dashboard.operations.length === 0 && <p className="empty-line">还没有操作记录</p>}</div>
            </section>}

            {tab === "family" && <section className="plain-card">
              <div className="section-title"><div><h2>谁可以管理</h2><p>同在一个家庭，不代表自动看到彼此的药品。</p></div>{dashboard.space.role === "owner" && <button className="primary-button" onClick={() => open("invite")}><Plus size={19} />邀请家人</button>}</div>
              <div className="member-list">{dashboard.members.map((member) => <div className="member-row" key={member.userId}><span className="avatar"><UserRound size={21} /></span><div><strong>{member.displayName}</strong><small>{roleName(member.role)}</small></div><span className="role-chip">{roleName(member.role)}</span></div>)}</div>
              {dashboard.invitations.length > 0 && <><h3 className="subheading">等待接受</h3>{dashboard.invitations.map((invite) => <div className="member-row" key={invite.id}><span className="avatar muted"><UsersRound size={20} /></span><div><strong>{invite.email}</strong><small>邀请有效至 {new Date(invite.expiresAt).toLocaleDateString("zh-CN")}</small></div><span className="role-chip">{roleName(invite.role)}</span></div>)}</>}
            </section>}
          </>}
        </section>
      </div>

      <nav className="mobile-nav"><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><Home />库存</button><button className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}><Pill />计划</button><button className={tab === "calendar" ? "active" : ""} onClick={() => setTab("calendar")}><CalendarDays />日历</button><button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Boxes />药品库</button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}><History />记录</button><button className={tab === "family" ? "active" : ""} onClick={() => setTab("family")}><UsersRound />家人</button></nav>
      {dialog && (dialog === "library-add" || dialog === "library-edit"
        ? <MedicineLibraryDialog kind={dialog} medicine={activeMedicine} dashboard={dashboard} mode={mode} photoUrl={activeMedicine?.photoPath ? app.photoUrls[activeMedicine.photoPath] : undefined} busy={app.busy} close={() => setDialog(null)} mutate={app.mutate} savePhoto={app.saveMedicinePhoto} finish={finish} />
        : <ActionDialog kind={dialog} medicine={activeMedicine} schedulePlan={activeMedicine ? app.scheduleOverview?.plans.find((plan)=>plan.medicineId===activeMedicine.id) : undefined} localDate={app.scheduleOverview?.localDate} dashboard={dashboard} photoUrls={app.photoUrls} defaultLocationId={activeLocationId} busy={app.busy} close={() => setDialog(null)} submit={async (action, payload) => finish(await app.mutate(action, payload))} />)}
      {toast && <div className="toast"><CheckCircle2 size={20} />{toast}</div>}
      {app.busy && <div className="busy-line" />}
    </main>
  );
}

function MedicineCard({ medicine, canEdit, open }: { medicine: MedicineSummary; canEdit: boolean; open: (kind: DialogKind) => void }) {
  const total = medicine.locations.reduce((sum, location) => sum + location.units, 0);
  const low = total <= medicine.safetyUnits;
  const advice = restockAdvice(medicine);
  return <article className="medicine-card">
    <div className="medicine-head"><div><h3>{medicine.name}</h3><p>{medicine.specification || `每盒 ${medicine.unitsPerBox}${medicine.unitName}`}</p></div>{low && <span className="warning-chip">库存不多</span>}</div>
    <div className="total-stock"><small>合计预计剩余</small><strong>{formatQuantity(total, medicine.unitsPerBox, medicine.unitName)}</strong><span>共 {total}{medicine.unitName}</span></div>
    <div className="location-stocks">{medicine.locations.map((location) => <LocationStock key={location.id} medicine={medicine} location={location} />)}</div>
    {medicine.expiringUnits ? <p className="expiry-note"><AlertTriangle size={16} />有 {medicine.expiringUnits}{medicine.unitName} 接近有效期</p> : null}
    {advice && <p className="advice-note"><PackagePlus size={17} />{advice}</p>}
    {medicine.predictionReason && <p className="soft-note">无法准确预测：{medicine.predictionReason}</p>}
    {canEdit && <div className="card-actions"><button className="main-action" onClick={() => open("adjust")}><ClipboardCheck size={19} />修改数量</button><button onClick={() => open("receive")}><PackagePlus size={18} />新买入库</button><button onClick={() => open("transfer")}><ArrowLeftRight size={18} />带到别处</button><button onClick={() => open("loss")}><Trash2 size={18} />减少</button><button onClick={() => open("schedule")}><Settings2 size={18} />吃药计划</button></div>}
  </article>;
}

function LocationStock({ medicine, location }: { medicine: MedicineSummary; location: MedicineSummary["locations"][number] }) {
  const target = reserveTarget(medicine, location);
  const primary = location.isPrimary ?? location.name.includes("家");
  return <div><span><MapPin size={17} />{location.name}<em>{primary ? "主要" : "备用"}</em></span><strong>{formatQuantity(location.units, medicine.unitsPerBox, medicine.unitName)}</strong><small>{location.daysLeft == null ? "暂时无法预测可用天数" : `约可用 ${location.daysLeft} 天，预计 ${dateAfterDays(location.daysLeft)} 用完`}{location.confirmedAt ? ` · ${new Date(location.confirmedAt).toLocaleDateString("zh-CN")}核对` : ""}</small>{target && <small className={`reserve-note ${target.state}`}>{target.text}</small>}</div>;
}

function LibraryCard({ medicine, photoUrl, canEdit, open }: { medicine: MedicineSummary; photoUrl?: string; canEdit: boolean; open: (kind: DialogKind, med: MedicineSummary) => void }) {
  const total = medicine.locations.reduce((sum, location) => sum + location.units, 0);
  return <article className="library-card">
    <div className="medicine-photo">{photoUrl ? <img src={photoUrl} alt={`${medicine.name}药盒`} /> : <Boxes size={28} />}</div>
    <div className="library-card-body"><h3>{medicine.name}</h3><p>{productDescription(medicine)}</p><small>{total > 0 ? `当前共有 ${formatQuantity(total, medicine.unitsPerBox, medicine.unitName)}` : "尚未入库"}</small></div>
    <div className="library-card-actions">{canEdit && <button className="primary-button" onClick={() => open("receive", medicine)}><PackagePlus size={17} />入库</button>}<button className="quiet-button" onClick={() => open("library-edit", medicine)}><Settings2 size={17} />{canEdit ? "编辑" : "查看"}</button></div>
  </article>;
}

function ActionDialog({ kind, medicine, schedulePlan, localDate, dashboard, photoUrls, defaultLocationId, busy, close, submit }: { kind: ActionDialogKind; medicine: MedicineSummary | null; schedulePlan?: SchedulePlanSummary; localDate?: string; dashboard: ReturnType<typeof useInventoryApp>["dashboard"]; photoUrls: Record<string,string>; defaultLocationId: string | null; busy: boolean; close: () => void; submit: (action: string, payload: Record<string, unknown>) => Promise<void> }) {
  const planForForm = schedulePlan?.upcoming ?? schedulePlan;
  const [error, setError] = useState<string | null>(null);
  const [selectedMedicineId, setSelectedMedicineId] = useState(dashboard?.medicines[0]?.id ?? "");
  const [settingLocationId, setSettingLocationId] = useState(dashboard?.space.locations[0]?.id ?? "");
  const [schedulePattern, setSchedulePattern] = useState(planForForm?.pattern ?? "daily");
  const selectedMedicine = kind === "quick-receive" ? dashboard?.medicines.find((item) => item.id === selectedMedicineId) ?? null : medicine;
  const settingLocation = dashboard?.space.locations.find((item) => item.id === settingLocationId);
  const locations = dashboard?.space.locations ?? [];
  const managedLocation = defaultLocationId ? locations.find((item)=>item.id===defaultLocationId) ?? null : null;
  const title: Record<ActionDialogKind, string> = { add: "手动新增药品和库存", receive: "新买的药放进药箱", "quick-receive": "从药品库选择入库", adjust: "修改现在的数量", transfer: "把药带到别处", loss: "记录减少的药", schedule: "吃药计划与药品设置", location: "我现在在哪里", "add-location": "添加存放地点", "location-settings": "主要地点与备用储备", invite: "邀请家人共同管理", "create-space": "新建用药人" };
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(null);
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    try {
      const action = kind === "quick-receive" ? "receive" : kind === "location" ? "set_location" : kind === "schedule" ? "set_schedule" : kind.replace("-", "_"); const payload: Record<string, unknown> = { ...values, medicineId: selectedMedicine?.id, expectedVersion: selectedMedicine?.version };
      if (["adjust", "loss", "transfer"].includes(kind) && selectedMedicine) {
        payload.units = parseFriendlyQuantity(String(values.quantity), selectedMedicine.unitsPerBox, selectedMedicine.precision).total;
      }
      if (["receive", "quick-receive"].includes(kind) && selectedMedicine) payload.units = quantityFromParts(values.boxes, values.loose, selectedMedicine.unitsPerBox, selectedMedicine.precision);
      if (kind === "add") {
        const perBox = Number(values.unitsPerBox);
        payload.initialUnits = quantityFromParts(values.boxes, values.loose, perBox, Number(values.precision || 0));
      }
      if (kind === "schedule") {
        payload.dailyDose = Number(values.morning || 0) + Number(values.noon || 0) + Number(values.evening || 0) + Number(values.bedtime || 0);
        payload.daysOfWeek = form.getAll("daysOfWeek").map(Number);
        if (values.pattern === "weekdays" && !(payload.daysOfWeek as number[]).length) throw new Error("请至少选择一个服药日");
      }
      if (kind === "location") payload.effectiveFrom = new Date(String(values.effectiveFrom)).toISOString();
      if (kind === "adjust" && selectedMedicine) {
        const loc = selectedMedicine.locations.find((x) => x.id === values.locationId);
        const next = Number(payload.units); const old = loc?.units ?? 0;
        if (old > 0 && (next >= old * 5 || next <= old / 5) && !window.confirm(`数量从 ${old} 变为 ${next}${selectedMedicine.unitName}，变化较大。确认无误吗？`)) return;
      }
      await submit(action, payload);
    } catch (err) { setError(err instanceof Error ? err.message : "请检查输入内容"); }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="dialog" role="dialog" aria-modal="true" aria-label={title[kind]}>
    <div className="dialog-head"><div><p className="eyebrow">{selectedMedicine?.name}</p><h2>{title[kind]}</h2></div><button className="icon-button" onClick={close} aria-label="关闭"><X /></button></div>
    <form onSubmit={onSubmit}>
      {kind === "add" && <>
        <Field label="药品名称"><input name="name" required autoFocus placeholder="例如：降压药" /></Field>
        <div className="two-fields"><Field label="规格说明（选填）"><input name="specification" placeholder="例如：5mg" /></Field><Field label="最小单位"><select name="unitName" defaultValue="粒"><option>粒</option><option>片</option><option>袋</option><option>支</option><option>丸</option><option>毫升</option></select></Field></div>
        <div className="two-fields"><Field label="每盒有多少"><input name="unitsPerBox" type="number" min="0.001" step="any" defaultValue="50" required /></Field><Field label="可以保留几位小数"><select name="precision" defaultValue="0"><option value="0">只能整数</option><option value="1">1 位小数</option><option value="2">2 位小数</option></select></Field></div>
        {managedLocation?<><input type="hidden" name="locationId" value={managedLocation.id}/><LocationTarget location={managedLocation.name}/></>:<Field label="先放在哪里"><LocationSelect name="locationId" locations={locations} defaultId={defaultLocationId} /></Field>}
        <div className="two-fields quantity-parts"><Field label="现在有多少整盒"><input name="boxes" type="number" min="0" step="1" defaultValue="0" required inputMode="numeric" /></Field><Field label="另外有多少零散"><input name="loose" type="number" min="0" step="any" defaultValue="0" required inputMode="decimal" /></Field></div>
        <p className="form-help">系统会按“整盒数量 × 每盒数量 + 零散数量”自动计算，不需要填写“3盒零5粒”。</p>
        <div className="two-fields"><Field label="每天计划用量"><input name="dailyDose" type="number" min="0" step="any" defaultValue="0" /></Field><Field label="低于多少提醒"><input name="safetyUnits" type="number" min="0" step="any" defaultValue="0" /></Field></div>
      </>}
      {kind === "quick-receive" && <>
        {dashboard?.medicines.length ? <><Field label="选择药品"><select name="medicineId" value={selectedMedicineId} onChange={(event) => setSelectedMedicineId(event.target.value)}>{dashboard.medicines.map((item) => <option key={item.id} value={item.id}>{productLabel(item)}</option>)}</select></Field>
          {selectedMedicine && <><div className="selected-product"><div className="medicine-photo small">{selectedMedicine.photoPath && photoUrls[selectedMedicine.photoPath] ? <img src={photoUrls[selectedMedicine.photoPath]} alt={`${selectedMedicine.name}药盒`} /> : <Boxes size={22} />}</div><div><strong>{selectedMedicine.name}</strong><small>{productDescription(selectedMedicine)}</small></div></div>{managedLocation?<><input type="hidden" name="locationId" value={managedLocation.id}/><LocationTarget location={managedLocation.name}/></>:<Field label="放到哪里"><LocationSelect name="locationId" locations={selectedMedicine.locations} defaultId={defaultLocationId} /></Field>}<div className="two-fields quantity-parts"><Field label="这次增加几整盒"><input name="boxes" type="number" min="0" step="1" defaultValue="0" required autoFocus inputMode="numeric" /></Field><Field label={`另外增加多少${selectedMedicine.unitName}`}><input name="loose" type="number" min="0" step="any" defaultValue="0" required inputMode="decimal" /></Field></div><Field label="简单说明（选填）"><input name="reason" placeholder="例如：本周购买" /></Field><div className="two-fields"><Field label="购买日期（选填）"><input name="receivedAt" type="date" defaultValue={isoDateOffset(0)} /></Field><Field label="有效期至（选填）"><input name="expiresOn" type="date" /></Field></div></>}</> : <p className="form-help">药品库还是空的，请先登记药品资料。</p>}
      </>}
      {(kind === "receive" || kind === "adjust" || kind === "loss") && medicine && <>
        {managedLocation?<><input type="hidden" name="locationId" value={managedLocation.id}/><LocationTarget location={managedLocation.name}/></>:<Field label="哪个地方"><LocationSelect name="locationId" locations={medicine.locations} defaultId={defaultLocationId} /></Field>}
        {kind === "receive" ? <div className="two-fields quantity-parts"><Field label="这次增加几整盒"><input name="boxes" type="number" min="0" step="1" defaultValue="0" required autoFocus inputMode="numeric" /></Field><Field label={`另外增加多少${medicine.unitName}`}><input name="loose" type="number" min="0" step="any" defaultValue="0" required inputMode="decimal" /></Field></div> : <Field label={kind === "adjust" ? "眼前可用的药有多少" : "这次减少多少"} hint={`${kind === "adjust" ? "不要把已经过期的药算进去；" : ""}例如“3盒零5${medicine.unitName}”或“155${medicine.unitName}”`}><input name="quantity" required autoFocus /></Field>}
        {kind !== "adjust" && <Field label="简单说明（选填）"><input name="reason" placeholder={kind === "loss" ? "例如：破损、过期" : "例如：本周购买"} /></Field>}
        {kind === "receive" && <div className="two-fields"><Field label="购买日期（选填）"><input name="receivedAt" type="date" defaultValue={isoDateOffset(0)} /></Field><Field label="有效期至（选填）"><input name="expiresOn" type="date" /></Field></div>}
        {kind === "adjust" && <p className="form-help">保存后，系统会从这次实际核对的数量继续计算，不会删除以前的记录。</p>}
      </>}
      {kind === "transfer" && medicine && <>
        {managedLocation?<><input type="hidden" name="fromLocationId" value={managedLocation.id}/><LocationTarget location={managedLocation.name} prefix="调拨来源"/><Field label="带到哪里"><LocationSelect name="toLocationId" locations={medicine.locations.filter((item)=>item.id!==managedLocation.id)} /></Field></>:<div className="two-fields"><Field label="从哪里"><LocationSelect name="fromLocationId" locations={medicine.locations} defaultId={defaultLocationId} /></Field><Field label="带到哪里"><LocationSelect name="toLocationId" locations={medicine.locations} defaultIndex={defaultLocationId ? medicine.locations.findIndex((item) => item.id !== defaultLocationId) : 1} /></Field></div>}
        <Field label="带多少" hint={`例如“1盒零5${medicine.unitName}”`}><input name="quantity" required autoFocus /></Field>
      </>}
      {kind === "schedule" && medicine && <>
        <p className="form-help emphasis">这里只照医生已经确定的方案记录，软件不会推荐或改变剂量。</p>
        <div className="two-fields"><Field label={`每盒有多少${medicine.unitName}`} hint="修改后只影响新的入库，历史换算不会变化"><input name="unitsPerBox" type="number" min="0.001" step="any" defaultValue={medicine.unitsPerBox} required /></Field><Field label="低于多少提醒"><input name="safetyUnits" type="number" min="0" step="any" defaultValue={medicine.safetyUnits} /></Field></div>
        <Field label="家中最低保留数量"><input name="reserveUnits" type="number" min="0" step="any" defaultValue={medicine.reserveUnits} /></Field>
        <div className="dose-fields"><Field label="早"><input name="morning" type="number" min="0" step="any" defaultValue={planForForm?.morning ?? 0} /></Field><Field label="中"><input name="noon" type="number" min="0" step="any" defaultValue={planForForm?.noon ?? 0} /></Field><Field label="晚"><input name="evening" type="number" min="0" step="any" defaultValue={planForForm?.evening ?? 0} /></Field><Field label="睡前"><input name="bedtime" type="number" min="0" step="any" defaultValue={planForForm?.bedtime ?? 0} /></Field></div>
        <div className="two-fields"><Field label="从哪天开始" hint="已有计划默认从明天调整，避免改变今天早些时候的推算"><input name="effectiveFrom" type="date" min={localDate??isoDateOffset(0)} required defaultValue={schedulePlan?.upcoming?.effectiveFrom??(localDate?addIsoDays(localDate,1):isoDateOffset(1))} /></Field><Field label="用药规律"><select name="pattern" value={schedulePattern} onChange={(event) => setSchedulePattern(event.target.value as SchedulePattern)}><option value="daily">每天</option><option value="alternate">隔天</option><option value="weekdays">指定星期</option></select></Field></div>
        {schedulePattern === "weekdays" && <Field label="选择服药日"><div className="weekday-picker">{[[1,"一"],[2,"二"],[3,"三"],[4,"四"],[5,"五"],[6,"六"],[7,"日"]].map(([day, label]) => <label key={day} className="weekday-option"><input type="checkbox" name="daysOfWeek" value={day} defaultChecked={planForForm?.daysOfWeek.includes(Number(day))} /><span>周{label}</span></label>)}</div></Field>}
        <Field label="从哪里消耗"><select name="locationId" defaultValue={planForForm?.locationId ?? medicine.consumeLocationId ?? ""}><option value="">跟随我当时所在地点</option>{locations.map((x) => <option key={x.id} value={x.id}>固定从{x.name}</option>)}</select></Field>
      </>}
      {kind === "location" && <><Field label="从现在起，我在哪里"><LocationSelect name="locationId" locations={locations} /></Field><Field label="开始时间"><input name="effectiveFrom" type="datetime-local" defaultValue={localDateTime()} required /></Field><p className="form-help">这只影响之后的计划消耗，之前的记录不会改变。</p></>}
      {kind === "add-location" && <><Field label="地点名称"><input name="name" required autoFocus placeholder="例如：学校、随身药盒" /></Field><div className="two-fields"><Field label="地点用途"><select name="isPrimary" defaultValue="false"><option value="false">备用地点</option><option value="true">主要地点</option></select></Field><Field label="希望备用多少天"><input name="targetDays" type="number" min="1" max="365" step="1" defaultValue="7" /></Field></div><p className="form-help">主要地点通常是家里。备用地点会按照吃药计划换算为整盒储备目标；设为新的主要地点后，原主要地点自动变为备用。</p></>}
      {kind === "location-settings" && <>{dashboard?.space.locations.length ? <><Field label="选择地点"><select name="locationId" value={settingLocationId} onChange={(event) => setSettingLocationId(event.target.value)}>{dashboard.space.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>{settingLocation && <div key={settingLocation.id} className="two-fields"><Field label="地点用途"><select name="isPrimary" defaultValue={settingLocation.isPrimary ? "true" : "false"}><option value="true">主要地点</option><option value="false">备用地点</option></select></Field><Field label="希望备用多少天"><input name="targetDays" type="number" min="1" max="365" step="1" defaultValue={settingLocation.targetDays ?? 7} /></Field></div>}<p className="form-help">备用目标按每种药当前生效的吃药计划计算，并向上取整为整盒。若要更换主要地点，直接把新地点设为“主要地点”。</p></> : <p className="form-help">请先添加地点。</p>}</>}
      {kind === "invite" && <><Field label="家人的注册邮箱"><input name="email" type="email" required autoFocus placeholder="name@example.com" /></Field><Field label="允许做什么"><select name="role"><option value="editor">可以查看和修改库存</option><option value="viewer">只能查看</option></select></Field><p className="form-help">对方登录并接受邀请后，才能进入这个用药空间。邀请不会开放其他私人空间。</p></>}
      {kind === "create-space" && <><Field label="用药人称呼"><input name="name" required autoFocus placeholder="例如：我、妈妈、爸爸" /></Field><Field label="第一个存放地点"><input name="locationName" required defaultValue="家里" /></Field><p className="form-help">新空间默认只有你能看到，以后可以单独邀请家人。</p></>}
      {error && <p className="field-error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="quiet-button" onClick={close}>取消</button><button className="primary-button" disabled={busy || (kind === "quick-receive" && !selectedMedicine) || (kind === "location-settings" && !settingLocation)}>{busy ? "正在保存…" : "保存"}</button></div>
    </form>
  </section></div>;
}

function MedicineLibraryDialog({ kind, medicine, dashboard, mode, photoUrl, busy, close, mutate, savePhoto, finish }: {
  kind: LibraryDialogKind; medicine: MedicineSummary | null; dashboard: ReturnType<typeof useInventoryApp>["dashboard"];
  mode: AppMode; photoUrl?: string; busy: boolean; close: () => void;
  mutate: (action: string, payload: Record<string, unknown>) => Promise<MutationResult>;
  savePhoto: (medicineId: string, file: File | null, oldPath?: string | null) => Promise<MutationResult>;
  finish: (result: MutationResult) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const editing = kind === "library-edit" && medicine;
  const brands = Array.from(new Set(dashboard?.medicines.map((item) => item.brand).filter(Boolean) ?? []));
  const categories = Array.from(new Set(dashboard?.medicines.map((item) => item.category).filter(Boolean) ?? []));
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(null);
    const form = new FormData(event.currentTarget);
    const photo = form.get("photo");
    const payload: Record<string, unknown> = {
      medicineId: medicine?.id, expectedVersion: medicine?.version,
      name: String(form.get("name") ?? "").trim(), category: String(form.get("category") ?? "").trim(),
      brand: String(form.get("brand") ?? "").trim(), dosageForm: String(form.get("dosageForm") ?? "").trim(),
      specification: String(form.get("specification") ?? "").trim(), packagingSpec: String(form.get("packagingSpec") ?? "").trim(),
      origin: String(form.get("origin") ?? ""), notes: String(form.get("notes") ?? "").trim(),
      unitName: String(form.get("unitName") ?? "粒"), unitsPerBox: Number(form.get("unitsPerBox") || 1),
    };
    if (!editing) Object.assign(payload, { locationId: dashboard?.space.locations[0]?.id, initialUnits: 0, dailyDose: 0, safetyUnits: 0, reserveUnits: 0, precision: 0 });
    const result = await mutate(editing ? "update_medicine" : "add_medicine", payload);
    if (!result.ok) { setError(friendlyError(result.message)); return; }
    const medicineId = result.id ?? medicine?.id;
    const file = photo instanceof File && photo.size > 0 ? photo : null;
    const removePhoto = form.get("removePhoto") === "on";
    if (medicineId && (file || (removePhoto && medicine?.photoPath))) {
      const photoResult = await savePhoto(medicineId, file, medicine?.photoPath);
      if (!photoResult.ok) { finish({ ok: true, message: `药品资料已保存，但${photoResult.message}` }); return; }
    }
    finish({ ok: true, message: editing ? "药品资料已更新" : "药品已登记到当前空间" });
  };
  const archive = async () => {
    if (!medicine || !window.confirm(`停用“${medicine.name}”吗？已有库存或历史记录时系统会阻止操作。`)) return;
    const result = await mutate("archive_medicine", { medicineId: medicine.id, expectedVersion: medicine.version });
    if (result.ok) finish(result); else setError(friendlyError(result.message));
  };
  if (editing && dashboard?.space.role === "viewer") return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="dialog" role="dialog" aria-modal="true" aria-label="查看药品资料">
    <div className="dialog-head"><div><p className="eyebrow">当前空间共用</p><h2>{medicine.name}</h2></div><button className="icon-button" onClick={close} aria-label="关闭"><X /></button></div>
    <div className="medicine-details"><div className="medicine-photo large">{photoUrl ? <img src={photoUrl} alt={`${medicine.name}药盒`} /> : <Boxes size={30} />}</div><dl><div><dt>品牌</dt><dd>{medicine.brand || "未填写"}</dd></div><div><dt>类别</dt><dd>{medicine.category || "未填写"}</dd></div><div><dt>剂型与规格</dt><dd>{[medicine.dosageForm,medicine.specification].filter(Boolean).join(" · ") || "未填写"}</dd></div><div><dt>包装</dt><dd>{medicine.packagingSpec || `每盒 ${medicine.unitsPerBox}${medicine.unitName}`}</dd></div><div><dt>国产/进口</dt><dd>{medicine.origin === "domestic" ? "国产" : medicine.origin === "imported" ? "进口" : "未填写"}</dd></div><div><dt>备注</dt><dd>{medicine.notes || "无"}</dd></div></dl></div>
    <div className="dialog-actions"><button className="primary-button" onClick={close}>关闭</button></div>
  </section></div>;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="dialog library-dialog" role="dialog" aria-modal="true" aria-label={editing ? "编辑药品资料" : "登记药品资料"}>
    <div className="dialog-head"><div><p className="eyebrow">当前空间共用</p><h2>{editing ? "编辑药品资料" : "登记药品资料"}</h2></div><button className="icon-button" onClick={close} aria-label="关闭"><X /></button></div>
    <form onSubmit={onSubmit}>
      <Field label="药品名称"><input name="name" required autoFocus defaultValue={medicine?.name ?? ""} placeholder="例如：布洛芬" /></Field>
      <div className="two-fields"><Field label="药品类别（选填）"><input name="category" list="medicine-categories" defaultValue={medicine?.category ?? ""} placeholder="例如：解热镇痛" /></Field><Field label="品牌（选填）"><input name="brand" list="medicine-brands" defaultValue={medicine?.brand ?? ""} placeholder="可选择或直接输入" /></Field></div>
      <datalist id="medicine-categories">{categories.map((item) => <option key={item} value={item} />)}</datalist><datalist id="medicine-brands">{brands.map((item) => <option key={item} value={item} />)}</datalist>
      <div className="two-fields"><Field label="剂型（选填）"><input name="dosageForm" defaultValue={medicine?.dosageForm ?? ""} placeholder="例如：片剂、胶囊" /></Field><Field label="药品规格（选填）"><input name="specification" defaultValue={medicine?.specification ?? ""} placeholder="例如：0.2g/片" /></Field></div>
      <div className="two-fields"><Field label="包装规格（选填）"><input name="packagingSpec" defaultValue={medicine?.packagingSpec ?? ""} placeholder="例如：20粒/盒" /></Field><Field label="国产/进口（选填）"><select name="origin" defaultValue={medicine?.origin ?? ""}><option value="">不填写</option><option value="domestic">国产</option><option value="imported">进口</option></select></Field></div>
      <div className="two-fields"><Field label="最小单位"><select name="unitName" defaultValue={medicine?.unitName ?? "粒"}><option>粒</option><option>片</option><option>袋</option><option>支</option><option>丸</option><option>毫升</option></select></Field><Field label="每盒有多少"><input name="unitsPerBox" type="number" min="0.001" step="any" required defaultValue={medicine?.unitsPerBox ?? 1} /></Field></div>
      <Field label="备注（选填）"><input name="notes" defaultValue={medicine?.notes ?? ""} placeholder="用于自己区分药品" /></Field>
      <div className="photo-field"><div className="medicine-photo large">{photoUrl ? <img src={photoUrl} alt={`${medicine?.name ?? "药品"}药盒`} /> : <Boxes size={30} />}</div><Field label="药盒照片（选填）" hint={mode === "demo" ? "演示模式不上传照片" : "支持 JPG、PNG、WebP，最大 5MB"}><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={mode === "demo"} /></Field></div>
      {medicine?.photoPath && <label className="check-row"><input name="removePhoto" type="checkbox" /> 删除现有照片（不会删除药品或库存）</label>}
      {error && <p className="field-error">{error}</p>}
      <div className="dialog-actions">{editing && <button type="button" className="danger-button" onClick={archive} disabled={busy}>停用药品</button>}<span className="dialog-spacer" /><button type="button" className="quiet-button" onClick={close}>取消</button><button className="primary-button" disabled={busy}>{busy ? "正在保存…" : "保存"}</button></div>
    </form>
  </section></div>;
}

function AuthPanel({ signIn, signUp }: { signIn: (email: string, password: string) => Promise<string | null>; signUp: (email: string, password: string, name: string) => Promise<string | null> }) {
  const [register, setRegister] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); setError(null); const data = new FormData(event.currentTarget); const result = register ? await signUp(String(data.get("email")), String(data.get("password")), String(data.get("name"))) : await signIn(String(data.get("email")), String(data.get("password"))); setBusy(false); if (result) setError(friendlyError(result)); else if (register) setNotice("注册成功。若已开启邮箱确认，请先打开邮件中的确认链接。"); };
  return <main className="auth-page"><section className="auth-intro"><div className="brand light"><span className="brand-mark">药</span><div><strong>家庭药箱</strong><small>清楚管理家里的药</small></div></div><h1>药放在哪里、还剩多少，家里人都心里有数。</h1><p>适合长期用药家庭。只管理库存和既定计划，不提供医疗建议。</p><div className="auth-benefits"><span><CheckCircle2 />家里、学校分开管理</span><span><CheckCircle2 />授权家人一起照看</span><span><CheckCircle2 />不必每天打开打卡</span></div></section><section className="auth-card"><p className="eyebrow">{register ? "第一次使用" : "欢迎回来"}</p><h2>{register ? "创建账号" : "登录家庭药箱"}</h2><form onSubmit={submit}>{register && <Field label="怎么称呼你"><input name="name" required autoFocus /></Field>}<Field label="邮箱"><input name="email" type="email" required autoFocus={!register} autoComplete="email" /></Field><Field label="密码"><input name="password" type="password" minLength={8} required autoComplete={register ? "new-password" : "current-password"} /></Field>{error && <p className="field-error">{error}</p>}{notice && <p className="success-box">{notice}</p>}<button className="primary-button full" disabled={busy}>{busy ? "请稍候…" : register ? "创建账号" : "登录"}</button></form><button className="text-button" onClick={() => { setRegister(!register); setError(null); }}>{register ? "已有账号？直接登录" : "还没有账号？现在注册"}</button></section></main>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
function LocationTarget({ location, prefix="本次操作地点" }: { location: string; prefix?: string }) { return <div className="location-target"><MapPin size={19}/><span>{prefix}<strong>{location}</strong></span><small>由当前库存视图自动选定</small></div>; }
function LocationSelect({ name, locations, defaultIndex = 0, defaultId }: { name: string; locations: Array<{ id: string; name: string }>; defaultIndex?: number; defaultId?: string | null }) { const fallback = locations[Math.min(Math.max(defaultIndex,0), Math.max(0, locations.length - 1))]?.id; return <select name={name} defaultValue={locations.some((item) => item.id === defaultId) ? defaultId ?? undefined : fallback}>{locations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>; }
function EmptyState({ title, text, action, actionLabel = "开始添加" }: { title: string; text: string; action?: () => void; actionLabel?: string }) { return <div className="empty-state"><span><Boxes size={32} /></span><h2>{title}</h2><p>{text}</p>{action && <button className="primary-button" onClick={action}><Plus size={19} />{actionLabel}</button>}</div>; }
function Loading() { return <main className="loading-page"><div className="brand-mark">药</div><p>正在打开家庭药箱…</p></main>; }
function roleName(role: string) { return role === "owner" ? "空间主人" : role === "editor" ? "可共同管理" : "只能查看"; }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function localDateTime() { const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000); return now.toISOString().slice(0, 16); }
function dateAfterDays(days: number) { return new Date(Date.now() + days * 86_400_000).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }); }
function isoDateOffset(days: number) { const date = new Date(); date.setDate(date.getDate() + days); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function addIsoDays(value: string, days: number) { const [year,month,date]=value.split("-").map(Number); return new Date(Date.UTC(year,month-1,date+days)).toISOString().slice(0,10); }
function operationIcon(kind: string) { if (kind === "transfer") return <ArrowLeftRight />; if (kind === "adjust") return <ClipboardCheck />; if (kind === "undo") return <RotateCcw />; return <PackagePlus />; }
function productDescription(medicine: MedicineSummary) { return [medicine.brand, medicine.dosageForm, medicine.specification, medicine.packagingSpec].filter(Boolean).join(" · ") || `每盒 ${medicine.unitsPerBox}${medicine.unitName}`; }
function productLabel(medicine: MedicineSummary) { const details = [medicine.brand, medicine.dosageForm, medicine.specification].filter(Boolean).join(" · "); return details ? `${medicine.name}｜${details}` : medicine.name; }
function reserveTarget(medicine: MedicineSummary, location: MedicineSummary["locations"][number]) {
  const primary = location.isPrimary ?? location.name.includes("家");
  if (primary) return null;
  const days = location.targetDays ?? 7;
  const requiredUnits = location.requiredUnits ?? medicine.dailyDose * days;
  const boxes = location.recommendedBoxes ?? (requiredUnits > 0 ? Math.ceil(requiredUnits / medicine.unitsPerBox) : 0);
  if (boxes <= 0) return { state: "unset", text: `备用 ${days} 天 · 请先设置吃药计划` };
  const targetUnits = location.targetUnits ?? boxes * medicine.unitsPerBox;
  const difference = location.units - targetUnits;
  if (difference < 0) return { state: "low", text: `备用 ${days} 天建议 ${boxes} 盒，还差 ${formatQuantity(-difference, medicine.unitsPerBox, medicine.unitName)}` };
  if (difference > 0) return { state: "high", text: `备用 ${days} 天建议 ${boxes} 盒，目前多 ${formatQuantity(difference, medicine.unitsPerBox, medicine.unitName)}` };
  return { state: "good", text: `已达到 ${days} 天储备目标：${boxes} 盒` };
}
function quantityFromParts(boxValue: FormDataEntryValue | undefined, looseValue: FormDataEntryValue | undefined, unitsPerBox: number, precision: number) {
  const boxes = Number(boxValue || 0); const loose = Number(looseValue || 0);
  if (!Number.isInteger(boxes) || boxes < 0) throw new Error("整盒数量必须是大于或等于 0 的整数");
  if (!Number.isFinite(loose) || loose < 0 || loose >= unitsPerBox) throw new Error(`零散数量应小于每盒数量 ${unitsPerBox}`);
  const total = boxes * unitsPerBox + loose;
  const rounded = Number(total.toFixed(precision));
  if (Math.abs(rounded - total) > 1e-9) throw new Error(`零散数量最多保留 ${precision} 位小数`);
  return rounded;
}
function friendlyError(message: string) { if (/Invalid login credentials/i.test(message)) return "邮箱或密码不正确"; if (/Email not confirmed/i.test(message)) return "请先打开注册邮件完成邮箱确认"; if (/duplicate|already/i.test(message)) return "这项内容已经存在，请勿重复提交"; return message; }
function restockAdvice(medicine: MedicineSummary) {
  const total = medicine.locations.reduce((sum, location) => sum + location.units, 0);
  if (medicine.dailyDose <= 0 || medicine.predictionReason) return null;
  const target = medicine.safetyUnits + medicine.dailyDose * 7;
  if (total <= medicine.safetyUnits) return `建议尽快补充约 ${Math.ceil(Math.max(0, target - total))}${medicine.unitName}`;
  const consuming = medicine.locations.find((x) => x.id === medicine.consumeLocationId);
  const home = medicine.locations.find((x) => x.name.includes("家"));
  if (consuming && home && consuming.id !== home.id && consuming.units < medicine.safetyUnits) {
    const amount = Math.max(0, Math.min(medicine.safetyUnits - consuming.units, home.units - medicine.reserveUnits));
    if (amount > 0) return `可从${home.name}带 ${Math.ceil(amount)}${medicine.unitName}到${consuming.name}，并保留家中最低数量`;
  }
  return null;
}
