export interface DoseRule {
  effectiveFrom: string;
  effectiveTo?: string | null;
  dailyDose: number;
  pattern: "daily" | "alternate" | "weekdays";
  daysOfWeek?: number[];
}

const DAY = 86_400_000;

export function plannedConsumption(rules: DoseRule[], from: Date, to: Date): number {
  if (to <= from) return 0;
  let total = 0;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  while (cursor < to) {
    const date = cursor.toISOString().slice(0, 10);
    for (const rule of rules) {
      if (date < rule.effectiveFrom || (rule.effectiveTo && date > rule.effectiveTo)) continue;
      const start = new Date(`${rule.effectiveFrom}T00:00:00`);
      const days = Math.round((cursor.getTime() - start.getTime()) / DAY);
      const active = rule.pattern === "daily"
        || (rule.pattern === "alternate" && days >= 0 && days % 2 === 0)
        || (rule.pattern === "weekdays" && (rule.daysOfWeek ?? []).includes(cursor.getDay() || 7));
      if (active) total += rule.dailyDose;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

export function predictDays(units: number, dailyDose: number): number | null {
  if (dailyDose <= 0 || units < 0) return null;
  return Math.floor(units / dailyDose);
}
