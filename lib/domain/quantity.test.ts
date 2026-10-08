import { describe, expect, it } from "vitest";
import { formatQuantity, parseFriendlyQuantity } from "./quantity";
import { plannedConsumption } from "./projection";

describe("友好数量输入", () => {
  it("支持三盒零五粒", () => {
    expect(parseFriendlyQuantity("3盒零5粒", 50)).toEqual({ boxes: 3, loose: 5, total: 155 });
    expect(parseFriendlyQuantity("三盒零五粒", 50).total).toBe(155);
    expect(formatQuantity(155, 50, "粒")).toBe("3盒零5粒");
  });
  it("按精度拒绝非法小数", () => {
    expect(() => parseFriendlyQuantity("1.5粒", 50, 0)).toThrow();
    expect(parseFriendlyQuantity("1.5毫升", 100, 1).total).toBe(1.5);
  });
});

describe("区间推算", () => {
  it("同一区间计算稳定，不因重复调用多扣", () => {
    const rules = [{ effectiveFrom: "2026-01-01", dailyDose: 2, pattern: "daily" as const }];
    const first = plannedConsumption(rules, new Date("2026-01-01"), new Date("2026-01-04"));
    expect(first).toBe(6);
    expect(plannedConsumption(rules, new Date("2026-01-01"), new Date("2026-01-04"))).toBe(first);
  });
  it("计划从生效日开始，隔日规则不会改写更早日期", () => {
    const rules = [{ effectiveFrom: "2026-01-03", dailyDose: 2, pattern: "alternate" as const }];
    expect(plannedConsumption(rules, new Date("2026-01-01"), new Date("2026-01-08"))).toBe(6);
  });
});
