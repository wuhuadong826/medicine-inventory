import type { DashboardData, MedicineSummary, MutationResult, OperationKind, SpaceSummary } from "@/lib/domain/types";

export interface DemoChange { medicineId: string; locationId: string; delta: number }
export interface DemoState {
  spaces: SpaceSummary[];
  dashboards: Record<string, DashboardData>;
  changes: Record<string, DemoChange[]>;
}

const ids = {
  mine: "demo-patient-me", mother: "demo-patient-mother",
  home: "demo-location-home", school: "demo-location-school", motherHome: "demo-location-mother-home",
};

function med(partial: Partial<MedicineSummary> & Pick<MedicineSummary, "id" | "name" | "locations">): MedicineSummary {
  return {
    specification: "", unitName: "粒", unitsPerBox: 50, precision: 0,
    safetyUnits: 30, reserveUnits: 20, dailyDose: 2, version: 1,
    consumeLocationId: null, predictionReason: null, ...partial,
  };
}

export function createDemoState(): DemoState {
  const now = new Date().toISOString();
  const spaces: SpaceSummary[] = [
    { id: ids.mine, name: "我的药品", role: "owner", isPrivate: true, currentLocationId: ids.school,
      locations: [{ id: ids.home, name: "家里" }, { id: ids.school, name: "学校" }] },
    { id: ids.mother, name: "妈妈的药品", role: "editor", isPrivate: true, currentLocationId: ids.motherHome,
      locations: [{ id: ids.motherHome, name: "家里" }] },
  ];
  const myMedicines = [
    med({ id: "demo-med-a", name: "药品 A", specification: "每盒 50 粒", dailyDose: 2,
      locations: [{ id: ids.home, name: "家里", units: 150, daysLeft: 75 }, { id: ids.school, name: "学校", units: 50, daysLeft: 25 }] }),
    med({ id: "demo-med-b", name: "维生素 D", specification: "400 IU", unitName: "粒", unitsPerBox: 30,
      dailyDose: 1, safetyUnits: 14, locations: [{ id: ids.home, name: "家里", units: 18, daysLeft: 18 }, { id: ids.school, name: "学校", units: 7, daysLeft: 7 }], expiringUnits: 5 }),
  ];
  const dashboards: Record<string, DashboardData> = {
    [ids.mine]: { space: spaces[0], medicines: myMedicines,
      operations: [{ id: "demo-op-1", medicineId: "demo-med-a", medicineName: "药品 A", kind: "receive", description: "家里增加 3 盒", occurredAt: now, actorName: "我", canUndo: true }],
      members: [{ userId: "demo-user-me", displayName: "我", role: "owner" }, { userId: "demo-user-mother", displayName: "妈妈", role: "editor" }], invitations: [] },
    [ids.mother]: { space: spaces[1], medicines: [med({ id: "demo-med-c", name: "降压药", specification: "5mg", unitName: "片", unitsPerBox: 28, dailyDose: 1,
      locations: [{ id: ids.motherHome, name: "家里", units: 43, daysLeft: 43 }] })], operations: [],
      members: [{ userId: "demo-user-mother", displayName: "妈妈", role: "owner" }, { userId: "demo-user-me", displayName: "我", role: "editor" }], invitations: [] },
  };
  return { spaces, dashboards, changes: {} };
}

function operation(kind: OperationKind, medicine: MedicineSummary, description: string) {
  return { id: crypto.randomUUID(), medicineId: medicine.id, medicineName: medicine.name, kind, description,
    occurredAt: new Date().toISOString(), actorName: "演示用户", canUndo: true };
}

function updatePredictions(medicine: MedicineSummary) {
  medicine.locations.forEach((location) => {
    location.daysLeft = medicine.dailyDose > 0 ? Math.max(0, Math.floor(location.units / medicine.dailyDose)) : null;
  });
  medicine.version += 1;
}

export function applyDemoMutation(state: DemoState, spaceId: string, action: string, payload: Record<string, unknown>): MutationResult {
  const dashboard = state.dashboards[spaceId];
  if (!dashboard) return { ok: false, message: "未找到用药空间" };
  if (dashboard.space.role === "viewer" && action !== "accept_invite") return { ok: false, message: "当前账号只有查看权限" };
  if (action === "set_location") {
    const locationId = String(payload.locationId);
    if (!dashboard.space.locations.some((item) => item.id === locationId)) return { ok: false, message: "未找到地点" };
    dashboard.space.currentLocationId = locationId;
    const space = state.spaces.find((item) => item.id === spaceId);
    if (space) space.currentLocationId = locationId;
    return { ok: true, message: "所在地已更新，只影响之后的推算" };
  }
  if (action === "add_location") {
    const location = { id: crypto.randomUUID(), name: String(payload.name) };
    dashboard.space.locations.push(location);
    dashboard.medicines.forEach((medicine) => medicine.locations.push({ ...location, units: 0, daysLeft: null }));
    return { ok: true, message: "存放地点已添加" };
  }
  if (action === "invite") {
    if (dashboard.space.role !== "owner") return { ok: false, message: "只有空间主人可以邀请家人" };
    dashboard.invitations.push({ id: crypto.randomUUID(), email: String(payload.email), role: payload.role === "viewer" ? "viewer" : "editor", status: "pending", expiresAt: new Date(Date.now() + 14 * 86400000).toISOString() });
    return { ok: true, message: "演示邀请已创建" };
  }
  if (action === "add_medicine") {
    const locationId = String(payload.locationId || dashboard.space.locations[0]?.id);
    const location = dashboard.space.locations.find((item) => item.id === locationId);
    const medicine = med({ id: crypto.randomUUID(), name: String(payload.name), specification: String(payload.specification ?? ""),
      unitName: String(payload.unitName || "粒"), unitsPerBox: Number(payload.unitsPerBox), dailyDose: Number(payload.dailyDose || 0),
      safetyUnits: Number(payload.safetyUnits || 0), reserveUnits: Number(payload.reserveUnits || 0),
      locations: dashboard.space.locations.map((item) => ({ id: item.id, name: item.name, units: item.id === locationId ? Number(payload.initialUnits || 0) : 0, daysLeft: null })) });
    updatePredictions(medicine);
    dashboard.medicines.push(medicine);
    const op = operation("receive", medicine, `${location?.name ?? "存放地"}初始录入 ${payload.initialUnits || 0}${medicine.unitName}`);
    dashboard.operations.unshift(op);
    state.changes[op.id] = Number(payload.initialUnits) ? [{ medicineId: medicine.id, locationId, delta: Number(payload.initialUnits) }] : [];
    return { ok: true, message: "药品已添加" };
  }
  const medicine = dashboard.medicines.find((item) => item.id === payload.medicineId);
  if (!medicine) return { ok: false, message: "未找到药品" };
  if (payload.expectedVersion != null && Number(payload.expectedVersion) !== medicine.version) {
    return { ok: false, message: "库存刚被家人修改，请刷新后再试" };
  }
  if (action === "set_schedule") {
    medicine.dailyDose = Number(payload.dailyDose);
    medicine.consumeLocationId = payload.locationId ? String(payload.locationId) : null;
    medicine.unitsPerBox = Number(payload.unitsPerBox || medicine.unitsPerBox);
    medicine.safetyUnits = Number(payload.safetyUnits || 0);
    medicine.reserveUnits = Number(payload.reserveUnits || 0);
    updatePredictions(medicine);
    return { ok: true, message: "用量和消耗地点已更新，从指定日期开始生效" };
  }
  const changes: DemoChange[] = [];
  let description = "";
  let kind: OperationKind = "adjust";
  if (action === "adjust" || action === "receive" || action === "loss") {
    const target = medicine.locations.find((item) => item.id === payload.locationId);
    if (!target) return { ok: false, message: "未找到存放地点" };
    const value = Number(payload.units);
    const delta = action === "adjust" ? value - target.units : action === "receive" ? value : -value;
    if (target.units + delta < 0) return { ok: false, message: "数量不足，无法完成操作" };
    target.units += delta;
    target.confirmedAt = action === "adjust" ? new Date().toISOString() : target.confirmedAt;
    changes.push({ medicineId: medicine.id, locationId: target.id, delta });
    kind = action;
    description = action === "adjust" ? `${target.name}数量改为 ${value}${medicine.unitName}` :
      action === "receive" ? `${target.name}增加 ${value}${medicine.unitName}` : `${target.name}减少 ${value}${medicine.unitName}`;
  } else if (action === "transfer") {
    const source = medicine.locations.find((item) => item.id === payload.fromLocationId);
    const target = medicine.locations.find((item) => item.id === payload.toLocationId);
    const units = Number(payload.units);
    if (!source || !target || source.id === target.id) return { ok: false, message: "请选择两个不同地点" };
    if (units <= 0 || source.units < units) return { ok: false, message: "来源地点数量不足" };
    source.units -= units; target.units += units;
    changes.push({ medicineId: medicine.id, locationId: source.id, delta: -units }, { medicineId: medicine.id, locationId: target.id, delta: units });
    kind = "transfer"; description = `从${source.name}带 ${units}${medicine.unitName}到${target.name}`;
  }
  updatePredictions(medicine);
  const op = operation(kind, medicine, description);
  dashboard.operations.unshift(op); state.changes[op.id] = changes;
  return { ok: true, message: "已保存" };
}

export function createDemoSpace(state: DemoState, name: string, locationName: string) {
  const patientId = crypto.randomUUID(); const locationId = crypto.randomUUID();
  const space: SpaceSummary = { id: patientId, name, role: "owner", isPrivate: true, currentLocationId: locationId, locations: [{ id: locationId, name: locationName }] };
  state.spaces.push(space);
  state.dashboards[patientId] = { space, medicines: [], operations: [], members: [{ userId: "demo-user-me", displayName: "我", role: "owner" }], invitations: [] };
  return patientId;
}

export function undoDemoOperation(state: DemoState, spaceId: string, operationId: string): MutationResult {
  const dashboard = state.dashboards[spaceId];
  const target = dashboard?.operations.find((item) => item.id === operationId);
  const changes = state.changes[operationId];
  if (!dashboard || !target || !target.canUndo || !changes) return { ok: false, message: "此操作暂时不能撤销" };
  const targetIndex = dashboard.operations.findIndex((item) => item.id === operationId);
  if (dashboard.operations.slice(0, targetIndex).some((item) => item.medicineId === target.medicineId && item.kind !== "undo")) {
    return { ok: false, message: "之后已有其他操作，请直接使用“修改数量”纠正" };
  }
  for (const change of changes) {
    const medicine = dashboard.medicines.find((item) => item.id === change.medicineId);
    const location = medicine?.locations.find((item) => item.id === change.locationId);
    if (!medicine || !location || location.units - change.delta < 0) return { ok: false, message: "之后的操作已使用了这些库存，请改用“修改数量”纠正" };
  }
  changes.forEach((change) => {
    const medicine = dashboard.medicines.find((item) => item.id === change.medicineId)!;
    medicine.locations.find((item) => item.id === change.locationId)!.units -= change.delta;
    updatePredictions(medicine);
  });
  target.canUndo = false;
  dashboard.operations.unshift({ ...operation("undo", dashboard.medicines.find((item) => item.id === target.medicineId)!, `已撤销：${target.description}`), canUndo: false });
  return { ok: true, message: "已撤销，原记录仍然保留" };
}
