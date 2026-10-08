"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { withBasePath } from "@/lib/site-path";
import type { AppMode, DashboardData, MutationResult, PendingInvitation, SpaceSummary } from "@/lib/domain/types";
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
    const { data, error: requestError } = await supabase.rpc("api_patient_dashboard", { p_patient_id: spaceId });
    if (requestError) setError(requestError.message); else setDashboard(data as DashboardData);
    setBusy(false);
  }, [demo, mode, supabase]);

  useEffect(() => { if (selectedId) void loadDashboard(selectedId); }, [selectedId, loadDashboard]);

  const selectSpace = (id: string) => { setSelectedId(id); if (mode === "demo" && demo) setDashboard(demo.dashboards[id]); };

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
        add_location: "api_add_location", invite: "api_invite_member", create_space: "api_create_patient",
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
      if (["add_medicine", "set_schedule", "set_location", "add_location", "create_space"].includes(action)) delete (params as Record<string, unknown>).p_action;
      const { error: requestError } = await supabase.rpc(rpcName, params);
      if (requestError) { setError(requestError.message); return { ok: false, message: requestError.message }; }
      pendingRequest.current = null;
      await loadSpaces(); if (selectedId) await loadDashboard(selectedId);
      return { ok: true, message: "已保存" };
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
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
  const signOut = async () => { pendingRequest.current = null; await supabase?.auth.signOut(); setSpaces([]); setDashboard(null); };
  const resetDemo = () => { const next = createDemoState(); saveDemo(next); setSpaces(next.spaces); selectSpace(next.spaces[0].id); };

  return { mode, user, authChecked, spaces, selectedId, dashboard, pendingInvites, busy, error, selectSpace, mutate, answerInvite, signIn, signUp, signOut, resetDemo };
}
