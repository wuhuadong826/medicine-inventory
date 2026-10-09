"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { withBasePath } from "@/lib/site-path";
import type { AppMode, DashboardData, DayPlanData, LocationCalendarDay, MedicineSummary, MutationResult, PendingInvitation, ScheduleOverviewData, SchedulePlanSummary, SpaceSummary } from "@/lib/domain/types";
import { applyDemoMutation, createDemoSpace, createDemoState, type DemoState, undoDemoOperation } from "./demo";

const STORAGE_KEY = "family-medicine-demo-v2";

export function useInventoryApp(mode: AppMode) {
  const supabase = useMemo(() => mode === "supabase" ? createClient() : null, [mode]);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(mode === "demo");
  const [spaces, setSpaces] = useState<SpaceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingInvites, setPendingInvites] = useState<PendingInvitation[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [scheduleOverview, setScheduleOverview] = useState<ScheduleOverviewData | null>(null);
  const [calendarDays, setCalendarDays] = useState<LocationCalendarDay[]>([]);
  const [demo, setDemo] = useState<DemoState | null>(null);
  const mutationInFlight = useRef(false);
  const pendingRequest = useRef<{ fingerprint: string; key: string } | null>(null);

  const saveDemo = useCallback((next: DemoState) => {
    setDemo({ ...next });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  useEffect(() => {
    if (mode === "demo") {
      let initial: DemoState;
      try { initial = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || createDemoState(); }
      catch { initial = createDemoState(); }
      const firstId = initial.spaces[0]?.id ?? null;
      setDemo(initial); setSpaces(initial.spaces); setSelectedId(firstId);
      setDashboard(firstId ? initial.dashboards[firstId] : null);
      return;
    }
    supabase!.auth.getUser().then(({ data }) => { setUser(data.user); setAuthChecked(true); });
    const { data: listener } = supabase!.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null); setAuthChecked(true);
    });
    return () => listener.subscription.unsubscribe();
  }, [mode, supabase]);

  const loadSpaces = useCallback(async () => {
    if (!supabase || !user) return;
    setBusy(true); setError(null);
    const [{ data, error: requestError }, { data: inviteData }] = await Promise.all([
      supabase.rpc("api_my_spaces"), supabase.rpc("api_my_invitations"),
    ]);
    setPendingInvites((inviteData ?? []) as PendingInvitation[]);
    if (requestError) setError(requestError.message);
    else {
      const next = (data ?? []) as SpaceSummary[];
      setSpaces(next);
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id ?? null);
    }
    setBusy(false);
  }, [supabase, user]);

  useEffect(() => { void loadSpaces(); }, [loadSpaces]);

  const loadDashboard = useCallback(async (spaceId: string) => {
    if (mode === "demo" && demo) { setDashboard(demo.dashboards[spaceId]); return; }
    if (!supabase) return;
    setBusy(true); setError(null);
    const [{ data, error: requestError }, { data: details }, { data: expiryRows, error: expiryError }, { data: targetRows, error: targetError }] = await Promise.all([
      supabase.rpc("api_patient_dashboard", { p_patient_id: spaceId }),
      supabase.from("medicines").select("id,category,brand,dosage_form,packaging_spec,origin,photo_path,notes").eq("patient_id", spaceId).is("archived_at", null),
      supabase.rpc("api_location_expiry", { p_patient_id: spaceId }),
      supabase.rpc("api_secondary_location_targets", { p_patient_id: spaceId }),
    ]);
    if (requestError) setError(requestError.message);
    else {
      const next = data as DashboardData;
      const detailMap = new Map((details ?? []).map((item) => [item.id, item]));
      const expiryMap = new Map(((expiryRows ?? []) as Array<{ medicineId: string; locationId: string; units: number }>).map((item) => [`${item.medicineId}:${item.locationId}`, Number(item.units)]));
      const targetMap = new Map(((targetRows ?? []) as Array<{ medicineId: string; locationId: string; requiredUnits: number; targetUnits: number; recommendedBoxes: number }>).map((item) => [`${item.medicineId}:${item.locationId}`, item]));
      const locationMap = new Map(next.space.locations.map((location) => [location.id, location]));
      next.medicines = next.medicines.map((medicine) => {
        const item = detailMap.get(medicine.id);
        return {
          ...medicine,
          category: item?.category ?? "",
          brand: item?.brand ?? "",
          dosageForm: item?.dosage_form ?? "",
          packagingSpec: item?.packaging_spec ?? "",
          origin: item?.origin === "domestic" || item?.origin === "imported" ? item.origin : "",
          photoPath: item?.photo_path ?? null,
          notes: item?.notes ?? "",
          locations: medicine.locations.map((location) => {
            const target = targetMap.get(`${medicine.id}:${location.id}`);
            return {
              ...location, ...locationMap.get(location.id),
              ...(expiryError ? {} : { expiringUnits: expiryMap.get(`${medicine.id}:${location.id}`) ?? 0 }),
              ...(targetError || !target ? {} : { requiredUnits: Number(target.requiredUnits), targetUnits: Number(target.targetUnits), recommendedBoxes: Number(target.recommendedBoxes) }),
            };
          }),
        } satisfies MedicineSummary;
      });
      setDashboard(next);
    }
    setBusy(false);
  }, [demo, mode, supabase]);

  const loadScheduleOverview = useCallback(async (spaceId: string) => {
    if (mode === "demo" && demo) {
      const localDate = localIsoDate();
      const plans: SchedulePlanSummary[] = (demo.dashboards[spaceId]?.medicines ?? []).map((medicine) => ({
        medicineId: medicine.id, medicineName: medicine.name, unitName: medicine.unitName, version: medicine.version,
        scheduleId: medicine.dailyDose > 0 ? `demo-schedule-${medicine.id}` : null, effectiveFrom: medicine.dailyDose > 0 ? localDate : null,
        effectiveTo: null, pattern: "daily", daysOfWeek: [], morning: medicine.dailyDose, noon: 0, evening: 0, bedtime: 0,
        locationId: medicine.consumeLocationId ?? null, paused: false, isDoseDay: medicine.dailyDose > 0,
      }));
      setScheduleOverview({ timezone: "Asia/Shanghai", localDate, plans });
      return;
    }
    if (!supabase) return;
    const { data, error: requestError } = await supabase.rpc("api_schedule_overview", { p_patient_id: spaceId, p_date: null });
    if (requestError) { setError(requestError.message); return; }
    const result = data as ScheduleOverviewData;
    result.plans = (result.plans ?? []).map((plan) => ({ ...plan,
      version: Number(plan.version), morning: Number(plan.morning), noon: Number(plan.noon),
      evening: Number(plan.evening), bedtime: Number(plan.bedtime), daysOfWeek: (plan.daysOfWeek ?? []).map(Number),
      upcoming: plan.upcoming ? { ...plan.upcoming, morning:Number(plan.upcoming.morning),noon:Number(plan.upcoming.noon),evening:Number(plan.upcoming.evening),bedtime:Number(plan.upcoming.bedtime),daysOfWeek:(plan.upcoming.daysOfWeek??[]).map(Number) } : null,
    }));
    setScheduleOverview(result);
  }, [demo, mode, supabase]);

  const loadLocationCalendar = useCallback(async (spaceId: string, monthStart: string) => {
    if (mode === "demo" && demo) {
      const dashboardForSpace = demo.dashboards[spaceId];
      const [year, month] = monthStart.split("-").map(Number);
      const count = new Date(year, month, 0).getDate();
      const location = dashboardForSpace?.space.locations.find((item) => item.id === dashboardForSpace.space.currentLocationId) ?? null;
      const days = Array.from({ length: count }, (_, index): LocationCalendarDay => ({
        date: `${year}-${String(month).padStart(2,"0")}-${String(index + 1).padStart(2,"0")}`,
        locationId: location?.id ?? null, locationName: location?.name ?? null, isOverride: false,
        wasCorrected: false, isMixed: false, hasDoseOverride: false,
      }));
      setCalendarDays(days); return days;
    }
    if (!supabase) return [];
    const { data, error: requestError } = await supabase.rpc("api_location_calendar", { p_patient_id: spaceId, p_month_start: monthStart });
    if (requestError) { setError(requestError.message); return []; }
    const days = (data ?? []) as LocationCalendarDay[]; setCalendarDays(days); return days;
  }, [demo, mode, supabase]);

  const loadDayPlan = useCallback(async (spaceId: string, date: string): Promise<DayPlanData | null> => {
    if (mode === "demo" && demo) {
      const current = demo.dashboards[spaceId];
      return { date, timezone: "Asia/Shanghai", doses: (current?.medicines ?? []).filter((medicine) => medicine.dailyDose > 0).map((medicine) => ({
        medicineId: medicine.id, medicineName: medicine.name, unitName: medicine.unitName, slot: "morning",
        amount: medicine.dailyDose, normalLocationId: medicine.consumeLocationId ?? current.space.currentLocationId ?? null,
        resolvedLocationId: medicine.consumeLocationId ?? current.space.currentLocationId ?? null,
      })) };
    }
    if (!supabase) return null;
    const { data, error: requestError } = await supabase.rpc("api_day_plan", { p_patient_id: spaceId, p_date: date });
    if (requestError) { setError(requestError.message); return null; }
    const result = data as DayPlanData;
    result.doses = (result.doses ?? []).map((dose) => ({ ...dose, amount: Number(dose.amount) }));
    return result;
  }, [demo, mode, supabase]);

  useEffect(() => {
    setScheduleOverview(null); setCalendarDays([]);
    if (selectedId) { void loadDashboard(selectedId); void loadScheduleOverview(selectedId); }
  }, [selectedId, loadDashboard, loadScheduleOverview]);

  useEffect(() => {
    if (!selectedId || mode !== "supabase") return;
    const refresh = () => { if (document.visibilityState === "visible") { void loadDashboard(selectedId); void loadScheduleOverview(selectedId); } };
    const timer = window.setInterval(refresh, 300_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [selectedId, mode, loadDashboard, loadScheduleOverview]);

  useEffect(() => {
    let cancelled = false;
    const paths = dashboard?.medicines.map((item) => item.photoPath).filter((path): path is string => Boolean(path)) ?? [];
    if (!supabase || paths.length === 0) { setPhotoUrls({}); return; }
    supabase.storage.from("medicine-photos").createSignedUrls(paths, 3600).then(({ data }) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      data?.forEach((item, index) => { if (item.signedUrl) next[paths[index]] = item.signedUrl; });
      setPhotoUrls(next);
    });
    return () => { cancelled = true; };
  }, [dashboard, supabase]);

  const selectSpace = (id: string) => {
    if (!spaces.some((space) => space.id === id)) { setError("未找到这个用药空间，已保留当前空间"); return; }
    if (id === selectedId) return;
    setSelectedId(id);
    if (mode === "demo" && demo && demo.dashboards[id]) setDashboard(demo.dashboards[id]);
    else setDashboard(null);
  };

  const mutate = async (action: string, payload: Record<string, unknown>): Promise<MutationResult> => {
    if (!selectedId && action !== "create_space") return { ok: false, message: "请先选择用药人" };
    if (mutationInFlight.current) return { ok: false, message: "操作正在保存，请稍候" };
    mutationInFlight.current = true;
    setBusy(true); setError(null);
    try {
      if (mode === "demo" && demo) {
        const cloned = structuredClone(demo) as DemoState;
        let targetId = selectedId ?? "";
        let result: MutationResult;
        if (action === "create_space") { targetId = createDemoSpace(cloned, String(payload.name), String(payload.locationName || "家里")); result = { ok: true, message: "用药人空间已创建" }; }
        else result = action === "undo" ? undoDemoOperation(cloned, targetId, String(payload.operationId)) : applyDemoMutation(cloned, targetId, action, payload);
        if (result.ok) { saveDemo(cloned); setSpaces(cloned.spaces); setSelectedId(targetId); setDashboard(cloned.dashboards[targetId]); }
        return result;
      }
      if (!supabase) return { ok: false, message: "连接尚未就绪" };
      const rpcMap: Record<string, string> = {
        add_medicine: "api_add_medicine", adjust: "api_stock_change", receive: "api_stock_change",
        loss: "api_stock_change", transfer: "api_stock_change", undo: "api_undo_operation",
        set_schedule: "api_set_schedule", set_location: "api_set_current_location",
        set_schedule_batch: "api_set_schedule_batch", set_day_locations: "api_set_day_location_overrides",
        set_dose_locations: "api_set_dose_location_overrides",
        add_location: "api_add_location", invite: "api_invite_member", create_space: "api_create_patient",
        update_medicine: "api_update_medicine", archive_medicine: "api_archive_medicine", location_settings: "api_update_location_settings",
      };
      const rpcName = rpcMap[action];
      if (!rpcName) return { ok: false, message: "不支持的操作" };
      const fingerprint = JSON.stringify([action, selectedId, payload]);
      const idempotencyKey = pendingRequest.current?.fingerprint === fingerprint
        ? pendingRequest.current.key
        : crypto.randomUUID();
      pendingRequest.current = { fingerprint, key: idempotencyKey };
      const params = action === "undo" ? { p_operation_id: payload.operationId, p_idempotency_key: idempotencyKey }
        : action === "invite" ? { p_payload: { ...payload, patientId: selectedId }, p_idempotency_key: idempotencyKey }
        : { p_action: action, p_payload: action === "create_space" ? payload : { ...payload, patientId: selectedId }, p_idempotency_key: idempotencyKey };
      if (["add_medicine", "set_schedule", "set_location", "set_schedule_batch", "set_day_locations", "set_dose_locations", "add_location", "create_space", "update_medicine", "archive_medicine", "location_settings"].includes(action)) delete (params as Record<string, unknown>).p_action;
      const { data, error: requestError } = await supabase.rpc(rpcName, params);
      if (requestError) { setError(requestError.message); return { ok: false, message: requestError.message }; }
      pendingRequest.current = null;
      await loadSpaces(); if (selectedId) await Promise.all([loadDashboard(selectedId),loadScheduleOverview(selectedId)]);
      return { ok: true, message: action === "archive_medicine" ? "药品资料已停用" : "已保存", id: typeof data === "string" ? data : undefined };
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  };

  const saveMedicinePhoto = async (medicineId: string, file: File | null, oldPath?: string | null): Promise<MutationResult> => {
    if (!supabase || !selectedId) return { ok: false, message: "照片上传仅在已连接 Supabase 时可用" };
    if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      return { ok: false, message: "请选择不超过 5MB 的 JPG、PNG 或 WebP 图片" };
    }
    if (mutationInFlight.current) return { ok: false, message: "操作正在保存，请稍候" };
    mutationInFlight.current = true; setBusy(true); setError(null);
    let newPath: string | null = null;
    try {
      if (file) {
        const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        newPath = `${selectedId}/${medicineId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("medicine-photos").upload(newPath, file, { contentType: file.type, upsert: false });
        if (uploadError) return { ok: false, message: `照片上传失败：${uploadError.message}` };
      }
      const { error: requestError } = await supabase.rpc("api_set_medicine_photo", {
        p_payload: { patientId: selectedId, medicineId, photoPath: newPath }, p_idempotency_key: crypto.randomUUID(),
      });
      if (requestError) {
        if (newPath) await supabase.storage.from("medicine-photos").remove([newPath]);
        return { ok: false, message: requestError.message };
      }
      if (oldPath && oldPath !== newPath) await supabase.storage.from("medicine-photos").remove([oldPath]);
      await loadDashboard(selectedId);
      return { ok: true, message: file ? "药盒照片已保存" : "药盒照片已删除" };
    } finally {
      mutationInFlight.current = false; setBusy(false);
    }
  };

  const answerInvite = async (invitationId: string, accept: boolean): Promise<MutationResult> => {
    if (!supabase) return { ok: false, message: "演示模式没有待接受邀请" };
    if (mutationInFlight.current) return { ok: false, message: "操作正在保存，请稍候" };
    mutationInFlight.current = true;
    setBusy(true);
    try {
      const { error: requestError } = await supabase.rpc("api_accept_invite", { p_invitation_id: invitationId, p_accept: accept });
      if (requestError) return { ok: false, message: requestError.message };
      await loadSpaces();
      return { ok: true, message: accept ? "已加入用药空间" : "已拒绝邀请" };
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error: authError } = await supabase!.auth.signInWithPassword({ email, password });
    return authError?.message ?? null;
  };
  const signUp = async (email: string, password: string, name: string) => {
    const { error: authError } = await supabase!.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: `${location.origin}${withBasePath("/auth/callback/")}` } });
    return authError?.message ?? null;
  };
  const signOut = async () => { pendingRequest.current = null; await supabase?.auth.signOut(); setSpaces([]); setDashboard(null); setScheduleOverview(null); setCalendarDays([]); };
  const resetDemo = () => { const next = createDemoState(); saveDemo(next); setSpaces(next.spaces); selectSpace(next.spaces[0].id); };

  return { mode, user, authChecked, spaces, selectedId, dashboard, scheduleOverview, calendarDays, pendingInvites, photoUrls, busy, error, selectSpace, mutate, loadScheduleOverview, loadLocationCalendar, loadDayPlan, saveMedicinePhoto, answerInvite, signIn, signUp, signOut, resetDemo };
}

function localIsoDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
