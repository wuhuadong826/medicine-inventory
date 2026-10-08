import { describe, expect, it } from "vitest";
import { applyDemoMutation, createDemoState, undoDemoOperation } from "../data/demo";

describe("核心库存规则", () => {
  it("地点调拨前后总量守恒", () => {
    const state = createDemoState();
    const spaceId = state.spaces[0].id;
    const medicine = state.dashboards[spaceId].medicines[0];
    const before = medicine.locations.reduce((sum, x) => sum + x.units, 0);
    const result = applyDemoMutation(state, spaceId, "transfer", {
      medicineId: medicine.id,
      fromLocationId: medicine.locations[0].id,
      toLocationId: medicine.locations[1].id,
      units: 20,
    });
    expect(result.ok).toBe(true);
    expect(medicine.locations.map((x) => x.units)).toEqual([130, 70]);
    expect(medicine.locations.reduce((sum, x) => sum + x.units, 0)).toBe(before);
  });

  it("调拨不允许产生负库存", () => {
    const state = createDemoState();
    const spaceId = state.spaces[0].id;
    const medicine = state.dashboards[spaceId].medicines[0];
    expect(applyDemoMutation(state, spaceId, "transfer", {
      medicineId: medicine.id,
      fromLocationId: medicine.locations[1].id,
      toLocationId: medicine.locations[0].id,
      units: 999,
    }).ok).toBe(false);
  });

  it("盘点直接建立新数量并用补偿记录撤销", () => {
    const state = createDemoState();
    const spaceId = state.spaces[0].id;
    const medicine = state.dashboards[spaceId].medicines[0];
    const school = medicine.locations[1];
    expect(applyDemoMutation(state, spaceId, "adjust", { medicineId: medicine.id, locationId: school.id, units: 67 }).ok).toBe(true);
    expect(school.units).toBe(67);
    const operationId = state.dashboards[spaceId].operations[0].id;
    expect(undoDemoOperation(state, spaceId, operationId).ok).toBe(true);
    expect(school.units).toBe(50);
    expect(state.dashboards[spaceId].operations.some((x) => x.kind === "undo")).toBe(true);
  });

  it("查看者不能修改库存", () => {
    const state = createDemoState();
    const spaceId = state.spaces[0].id;
    state.dashboards[spaceId].space.role = "viewer";
    const medicine = state.dashboards[spaceId].medicines[0];
    expect(applyDemoMutation(state, spaceId, "adjust", { medicineId: medicine.id, locationId: medicine.locations[0].id, units: 1 }).ok).toBe(false);
  });

  it("过期版本不会覆盖家人刚完成的修改", () => {
    const state = createDemoState();
    const spaceId = state.spaces[0].id;
    const medicine = state.dashboards[spaceId].medicines[0];
    const staleVersion = medicine.version;
    applyDemoMutation(state, spaceId, "receive", { medicineId: medicine.id, locationId: medicine.locations[0].id, units: 5, expectedVersion: staleVersion });
    expect(applyDemoMutation(state, spaceId, "loss", { medicineId: medicine.id, locationId: medicine.locations[0].id, units: 2, expectedVersion: staleVersion }).ok).toBe(false);
  });

  it("已有后续操作时不直接撤销旧记录", () => {
    const state = createDemoState();
    const spaceId = state.spaces[0].id;
    const medicine = state.dashboards[spaceId].medicines[0];
    applyDemoMutation(state, spaceId, "receive", { medicineId: medicine.id, locationId: medicine.locations[0].id, units: 5 });
    const oldOperation = state.dashboards[spaceId].operations[0].id;
    applyDemoMutation(state, spaceId, "loss", { medicineId: medicine.id, locationId: medicine.locations[0].id, units: 2 });
    expect(undoDemoOperation(state, spaceId, oldOperation).ok).toBe(false);
  });
});
