"use client";

import { useState, type FormEvent } from "react";
import {
  AlertTriangle, ArrowLeftRight, Boxes, CheckCircle2, ChevronDown, ClipboardCheck,
  History, Home, LogOut, MapPin, PackagePlus, Plus, RotateCcw, Settings2, ShieldCheck,
  Trash2, UserRound, UsersRound, X,
} from "lucide-react";
import type { AppMode, MedicineSummary, MutationResult } from "@/lib/domain/types";
import { formatQuantity, parseFriendlyQuantity } from "@/lib/domain/quantity";
import { useInventoryApp } from "@/lib/data/use-inventory-app";

type DialogKind = "add" | "receive" | "adjust" | "transfer" | "loss" | "schedule" | "location" | "add-location" | "invite" | "create-space" | null;

export function MedicineApp({ mode }: { mode: AppMode }) {
  const app = useInventoryApp(mode);
  const [tab, setTab] = useState<"overview" | "history" | "family">("overview");
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [activeMedicine, setActiveMedicine] = useState<MedicineSummary | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  if (!app.authChecked) return <Loading />;
  if (mode === "supabase" && !app.user) return <AuthPanel signIn={app.signIn} signUp={app.signUp} />;

  const open = (kind: DialogKind, medicine?: MedicineSummary) => {
    setActiveMedicine(medicine ?? null); setDialog(kind);
  };
  const finish = (result: MutationResult) => {
    setToast(result.message); if (result.ok) setDialog(null);
    window.setTimeout(() => setToast(null), 3200);
  };

  const dashboard = app.dashboard;
  const attention = dashboard?.medicines.filter((medicine) => {
    const total = medicine.locations.reduce((sum, location) => sum + location.units, 0);
    return total <= medicine.safetyUnits || (medicine.expiringUnits ?? 0) > 0;
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
              <div className="heading-actions"><button className="quiet-button" onClick={() => open("add-location")}><Plus size={18} />地点</button><button className="location-switch" onClick={() => open("location")}><MapPin size={20} />当前在 {dashboard.space.locations.find((x) => x.id === dashboard.space.currentLocationId)?.name ?? "未设置"}<ChevronDown size={18} /></button></div>
            </div>

            <nav className="tabs" aria-label="主要功能">
              <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><Home size={19} />药品</button>
              <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}><History size={19} />最近操作</button>
              <button className={tab === "family" ? "active" : ""} onClick={() => setTab("family")}><UsersRound size={19} />家人管理</button>
            </nav>

            {tab === "overview" && <>
              {attention.length > 0 && <section className="attention"><div><AlertTriangle size={23} /><strong>有 {attention.length} 种药需要留意</strong></div><p>可能库存不多或接近有效期，请打开药品卡片查看。</p></section>}
              <div className="section-title"><div><h2>药品库存</h2><p>点“修改数量”即可按眼前实物校准，不必理解后台记录。</p></div><button className="primary-button" onClick={() => open("add")}><Plus size={20} />添加药品</button></div>
              <div className="medicine-grid">
                {dashboard.medicines.map((medicine) => <MedicineCard key={medicine.id} medicine={medicine} canEdit={dashboard.space.role !== "viewer"} open={open} />)}
              </div>
              {dashboard.medicines.length === 0 && <EmptyState title="还没有药品" text="添加第一种药，设置每盒数量和现在的库存。" action={() => open("add")} />}
            </>}

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

      <nav className="mobile-nav"><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><Home />药品</button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}><History />记录</button><button className={tab === "family" ? "active" : ""} onClick={() => setTab("family")}><UsersRound />家人</button></nav>
      {dialog && <ActionDialog kind={dialog} medicine={activeMedicine} dashboard={dashboard} busy={app.busy} close={() => setDialog(null)} submit={async (action, payload) => finish(await app.mutate(action, payload))} />}
      {toast && <div className="toast"><CheckCircle2 size={20} />{toast}</div>}
      {app.busy && <div className="busy-line" />}
    </main>
  );
}

function MedicineCard({ medicine, canEdit, open }: { medicine: MedicineSummary; canEdit: boolean; open: (kind: DialogKind, med: MedicineSummary) => void }) {
  const total = medicine.locations.reduce((sum, location) => sum + location.units, 0);
  const low = total <= medicine.safetyUnits;
  const advice = restockAdvice(medicine);
  return <article className="medicine-card">
    <div className="medicine-head"><div><h3>{medicine.name}</h3><p>{medicine.specification || `每盒 ${medicine.unitsPerBox}${medicine.unitName}`}</p></div>{low && <span className="warning-chip">库存不多</span>}</div>
    <div className="total-stock"><small>合计预计剩余</small><strong>{formatQuantity(total, medicine.unitsPerBox, medicine.unitName)}</strong><span>共 {total}{medicine.unitName}</span></div>
    <div className="location-stocks">{medicine.locations.map((location) => <div key={location.id}><span><MapPin size={17} />{location.name}</span><strong>{formatQuantity(location.units, medicine.unitsPerBox, medicine.unitName)}</strong><small>{location.daysLeft == null ? "暂时无法预测可用天数" : `约可用 ${location.daysLeft} 天，预计 ${dateAfterDays(location.daysLeft)} 用完`}{location.confirmedAt ? ` · ${new Date(location.confirmedAt).toLocaleDateString("zh-CN")}核对` : ""}</small></div>)}</div>
    {medicine.expiringUnits ? <p className="expiry-note"><AlertTriangle size={16} />有 {medicine.expiringUnits}{medicine.unitName} 接近有效期</p> : null}
    {advice && <p className="advice-note"><PackagePlus size={17} />{advice}</p>}
    {medicine.predictionReason && <p className="soft-note">无法准确预测：{medicine.predictionReason}</p>}
    {canEdit && <div className="card-actions"><button className="main-action" onClick={() => open("adjust", medicine)}><ClipboardCheck size={19} />修改数量</button><button onClick={() => open("receive", medicine)}><PackagePlus size={18} />新买入库</button><button onClick={() => open("transfer", medicine)}><ArrowLeftRight size={18} />带到别处</button><button onClick={() => open("loss", medicine)}><Trash2 size={18} />减少</button><button onClick={() => open("schedule", medicine)}><Settings2 size={18} />用量设置</button></div>}
  </article>;
}

function ActionDialog({ kind, medicine, dashboard, busy, close, submit }: { kind: NonNullable<DialogKind>; medicine: MedicineSummary | null; dashboard: ReturnType<typeof useInventoryApp>["dashboard"]; busy: boolean; close: () => void; submit: (action: string, payload: Record<string, unknown>) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const title: Record<NonNullable<DialogKind>, string> = { add: "添加药品", receive: "新买的药放进药箱", adjust: "修改现在的数量", transfer: "把药带到别处", loss: "记录减少的药", schedule: "药品与用量设置", location: "我现在在哪里", "add-location": "添加存放地点", invite: "邀请家人共同管理", "create-space": "新建用药人" };
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      let action = kind.replace("-", "_"); const payload: Record<string, unknown> = { ...values, medicineId: medicine?.id, expectedVersion: medicine?.version };
      if (["receive", "adjust", "loss", "transfer"].includes(kind) && medicine) {
        payload.units = parseFriendlyQuantity(String(values.quantity), medicine.unitsPerBox, medicine.precision).total;
      }
      if (kind === "add") {
        const perBox = Number(values.unitsPerBox);
        payload.initialUnits = parseFriendlyQuantity(String(values.quantity || "0"), perBox, Number(values.precision || 0)).total;
      }
      if (kind === "schedule") payload.dailyDose = Number(values.morning || 0) + Number(values.noon || 0) + Number(values.evening || 0) + Number(values.bedtime || 0);
      if (kind === "location") payload.effectiveFrom = new Date(String(values.effectiveFrom)).toISOString();
      if (kind === "adjust" && medicine) {
        const loc = medicine.locations.find((x) => x.id === values.locationId);
        const next = Number(payload.units); const old = loc?.units ?? 0;
        if (old > 0 && (next >= old * 5 || next <= old / 5) && !window.confirm(`数量从 ${old} 变为 ${next}${medicine.unitName}，变化较大。确认无误吗？`)) return;
      }
      await submit(action, payload);
    } catch (err) { setError(err instanceof Error ? err.message : "请检查输入内容"); }
  };
  const locations = dashboard?.space.locations ?? [];
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="dialog" role="dialog" aria-modal="true" aria-label={title[kind]}>
    <div className="dialog-head"><div><p className="eyebrow">{medicine?.name}</p><h2>{title[kind]}</h2></div><button className="icon-button" onClick={close} aria-label="关闭"><X /></button></div>
    <form onSubmit={onSubmit}>
      {kind === "add" && <>
        <Field label="药品名称"><input name="name" required autoFocus placeholder="例如：降压药" /></Field>
        <div className="two-fields"><Field label="规格说明（选填）"><input name="specification" placeholder="例如：5mg" /></Field><Field label="最小单位"><select name="unitName" defaultValue="粒"><option>粒</option><option>片</option><option>袋</option><option>支</option><option>丸</option><option>毫升</option></select></Field></div>
        <div className="two-fields"><Field label="每盒有多少"><input name="unitsPerBox" type="number" min="0.001" step="any" defaultValue="50" required /></Field><Field label="可以保留几位小数"><select name="precision" defaultValue="0"><option value="0">只能整数</option><option value="1">1 位小数</option><option value="2">2 位小数</option></select></Field></div>
        <Field label="先放在哪里"><LocationSelect name="locationId" locations={locations} /></Field>
        <Field label="现在有多少" hint="可以写“3盒零5粒”或直接写“155粒”"><input name="quantity" defaultValue="0" required /></Field>
        <div className="two-fields"><Field label="每天计划用量"><input name="dailyDose" type="number" min="0" step="any" defaultValue="0" /></Field><Field label="低于多少提醒"><input name="safetyUnits" type="number" min="0" step="any" defaultValue="0" /></Field></div>
      </>}
      {(kind === "receive" || kind === "adjust" || kind === "loss") && medicine && <>
        <Field label="哪个地方"><LocationSelect name="locationId" locations={medicine.locations} /></Field>
        <Field label={kind === "adjust" ? "眼前可用的药有多少" : kind === "receive" ? "这次增加多少" : "这次减少多少"} hint={`${kind === "adjust" ? "不要把已经过期的药算进去；" : ""}例如“3盒零5${medicine.unitName}”或“155${medicine.unitName}”`}><input name="quantity" required autoFocus /></Field>
        {kind !== "adjust" && <Field label="简单说明（选填）"><input name="reason" placeholder={kind === "loss" ? "例如：破损、过期" : "例如：本周购买"} /></Field>}
        {kind === "receive" && <div className="two-fields"><Field label="购买日期（选填）"><input name="receivedAt" type="date" defaultValue={isoDateOffset(0)} /></Field><Field label="有效期至（选填）"><input name="expiresOn" type="date" /></Field></div>}
        {kind === "adjust" && <p className="form-help">保存后，系统会从这次实际核对的数量继续计算，不会删除以前的记录。</p>}
      </>}
      {kind === "transfer" && medicine && <>
        <div className="two-fields"><Field label="从哪里"><LocationSelect name="fromLocationId" locations={medicine.locations} /></Field><Field label="带到哪里"><LocationSelect name="toLocationId" locations={medicine.locations} defaultIndex={1} /></Field></div>
        <Field label="带多少" hint={`例如“1盒零5${medicine.unitName}”`}><input name="quantity" required autoFocus /></Field>
      </>}
      {kind === "schedule" && medicine && <>
        <p className="form-help emphasis">这里只照医生已经确定的方案记录，软件不会推荐或改变剂量。</p>
        <div className="two-fields"><Field label={`每盒有多少${medicine.unitName}`} hint="修改后只影响新的入库，历史换算不会变化"><input name="unitsPerBox" type="number" min="0.001" step="any" defaultValue={medicine.unitsPerBox} required /></Field><Field label="低于多少提醒"><input name="safetyUnits" type="number" min="0" step="any" defaultValue={medicine.safetyUnits} /></Field></div>
        <Field label="家中最低保留数量"><input name="reserveUnits" type="number" min="0" step="any" defaultValue={medicine.reserveUnits} /></Field>
        <div className="dose-fields"><Field label="早"><input name="morning" type="number" min="0" step="any" defaultValue={medicine.dailyDose || 0} /></Field><Field label="中"><input name="noon" type="number" min="0" step="any" defaultValue="0" /></Field><Field label="晚"><input name="evening" type="number" min="0" step="any" defaultValue="0" /></Field><Field label="睡前"><input name="bedtime" type="number" min="0" step="any" defaultValue="0" /></Field></div>
        <div className="two-fields"><Field label="从哪天开始" hint="已有计划默认从明天调整，避免改变今天早些时候的推算"><input name="effectiveFrom" type="date" required defaultValue={isoDateOffset(1)} /></Field><Field label="用药规律"><select name="pattern"><option value="daily">每天</option><option value="alternate">隔天</option></select></Field></div>
        <Field label="从哪里消耗"><select name="locationId" defaultValue={medicine.consumeLocationId ?? ""}><option value="">跟随我当时所在地点</option>{locations.map((x) => <option key={x.id} value={x.id}>固定从{x.name}</option>)}</select></Field>
      </>}
      {kind === "location" && <><Field label="从现在起，我在哪里"><LocationSelect name="locationId" locations={locations} /></Field><Field label="开始时间"><input name="effectiveFrom" type="datetime-local" defaultValue={localDateTime()} required /></Field><p className="form-help">这只影响之后的计划消耗，之前的记录不会改变。</p></>}
      {kind === "add-location" && <><Field label="地点名称"><input name="name" required autoFocus placeholder="例如：学校、随身药盒" /></Field><p className="form-help">添加后，可以把药从家里调拨到这个地点。</p></>}
      {kind === "invite" && <><Field label="家人的注册邮箱"><input name="email" type="email" required autoFocus placeholder="name@example.com" /></Field><Field label="允许做什么"><select name="role"><option value="editor">可以查看和修改库存</option><option value="viewer">只能查看</option></select></Field><p className="form-help">对方登录并接受邀请后，才能进入这个用药空间。邀请不会开放其他私人空间。</p></>}
      {kind === "create-space" && <><Field label="用药人称呼"><input name="name" required autoFocus placeholder="例如：我、妈妈、爸爸" /></Field><Field label="第一个存放地点"><input name="locationName" required defaultValue="家里" /></Field><p className="form-help">新空间默认只有你能看到，以后可以单独邀请家人。</p></>}
      {error && <p className="field-error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="quiet-button" onClick={close}>取消</button><button className="primary-button" disabled={busy}>{busy ? "正在保存…" : "保存"}</button></div>
    </form>
  </section></div>;
}

function AuthPanel({ signIn, signUp }: { signIn: (email: string, password: string) => Promise<string | null>; signUp: (email: string, password: string, name: string) => Promise<string | null> }) {
  const [register, setRegister] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); setError(null); const data = new FormData(event.currentTarget); const result = register ? await signUp(String(data.get("email")), String(data.get("password")), String(data.get("name"))) : await signIn(String(data.get("email")), String(data.get("password"))); setBusy(false); if (result) setError(friendlyError(result)); else if (register) setNotice("注册成功。若已开启邮箱确认，请先打开邮件中的确认链接。"); };
  return <main className="auth-page"><section className="auth-intro"><div className="brand light"><span className="brand-mark">药</span><div><strong>家庭药箱</strong><small>清楚管理家里的药</small></div></div><h1>药放在哪里、还剩多少，家里人都心里有数。</h1><p>适合长期用药家庭。只管理库存和既定计划，不提供医疗建议。</p><div className="auth-benefits"><span><CheckCircle2 />家里、学校分开管理</span><span><CheckCircle2 />授权家人一起照看</span><span><CheckCircle2 />不必每天打开打卡</span></div></section><section className="auth-card"><p className="eyebrow">{register ? "第一次使用" : "欢迎回来"}</p><h2>{register ? "创建账号" : "登录家庭药箱"}</h2><form onSubmit={submit}>{register && <Field label="怎么称呼你"><input name="name" required autoFocus /></Field>}<Field label="邮箱"><input name="email" type="email" required autoFocus={!register} autoComplete="email" /></Field><Field label="密码"><input name="password" type="password" minLength={8} required autoComplete={register ? "new-password" : "current-password"} /></Field>{error && <p className="field-error">{error}</p>}{notice && <p className="success-box">{notice}</p>}<button className="primary-button full" disabled={busy}>{busy ? "请稍候…" : register ? "创建账号" : "登录"}</button></form><button className="text-button" onClick={() => { setRegister(!register); setError(null); }}>{register ? "已有账号？直接登录" : "还没有账号？现在注册"}</button></section></main>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
function LocationSelect({ name, locations, defaultIndex = 0 }: { name: string; locations: Array<{ id: string; name: string }>; defaultIndex?: number }) { return <select name={name} defaultValue={locations[Math.min(defaultIndex, Math.max(0, locations.length - 1))]?.id}>{locations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>; }
function EmptyState({ title, text, action }: { title: string; text: string; action: () => void }) { return <div className="empty-state"><span><Boxes size={32} /></span><h2>{title}</h2><p>{text}</p><button className="primary-button" onClick={action}><Plus size={19} />开始添加</button></div>; }
function Loading() { return <main className="loading-page"><div className="brand-mark">药</div><p>正在打开家庭药箱…</p></main>; }
function roleName(role: string) { return role === "owner" ? "空间主人" : role === "editor" ? "可共同管理" : "只能查看"; }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function localDateTime() { const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000); return now.toISOString().slice(0, 16); }
function dateAfterDays(days: number) { return new Date(Date.now() + days * 86_400_000).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }); }
function isoDateOffset(days: number) { const date = new Date(); date.setDate(date.getDate() + days); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function operationIcon(kind: string) { if (kind === "transfer") return <ArrowLeftRight />; if (kind === "adjust") return <ClipboardCheck />; if (kind === "undo") return <RotateCcw />; return <PackagePlus />; }
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
