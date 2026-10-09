export type Role = "owner" | "editor" | "viewer";
export type AppMode = "demo" | "supabase";
export type OperationKind = "receive" | "adjust" | "transfer" | "loss" | "undo";

export interface LocationSummary {
  id: string;
  name: string;
  isPrimary?: boolean;
  targetDays?: number | null;
  units: number;
  confirmedAt?: string;
  daysLeft?: number | null;
  runOutDate?: string | null;
  expiringUnits?: number;
  requiredUnits?: number;
  targetUnits?: number;
  recommendedBoxes?: number;
}

export interface MedicineSummary {
  id: string;
  name: string;
  specification: string;
  category: string;
  brand: string;
  dosageForm: string;
  packagingSpec: string;
  origin: "domestic" | "imported" | "";
  photoPath?: string | null;
  notes: string;
  unitName: string;
  unitsPerBox: number;
  precision: number;
  safetyUnits: number;
  reserveUnits: number;
  dailyDose: number;
  consumeLocationId?: string | null;
  version: number;
  locations: LocationSummary[];
  expiringUnits?: number;
  predictionReason?: string | null;
}

export interface SpaceSummary {
  id: string;
  name: string;
  role: Role;
  isPrivate: boolean;
  currentLocationId?: string | null;
  locations: Array<{ id: string; name: string; isPrimary?: boolean; targetDays?: number | null }>;
}

export interface OperationSummary {
  id: string;
  medicineId: string;
  medicineName: string;
  kind: OperationKind;
  description: string;
  occurredAt: string;
  actorName: string;
  canUndo: boolean;
}

export interface MemberSummary {
  userId: string;
  displayName: string;
  role: Role;
}

export interface InvitationSummary {
  id: string;
  email: string;
  role: Exclude<Role, "owner">;
  expiresAt: string;
  status: "pending" | "accepted" | "revoked";
}

export interface PendingInvitation {
  id: string;
  patientName: string;
  invitedBy: string;
  role: Exclude<Role, "owner">;
  expiresAt: string;
}

export interface DashboardData {
  space: SpaceSummary;
  medicines: MedicineSummary[];
  operations: OperationSummary[];
  members: MemberSummary[];
  invitations: InvitationSummary[];
}

export type DoseSlot = "morning" | "noon" | "evening" | "bedtime";
export type SchedulePattern = "daily" | "alternate" | "weekdays";

export interface SchedulePlanSummary {
  medicineId: string;
  medicineName: string;
  unitName: string;
  version: number;
  scheduleId: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  pattern: SchedulePattern;
  daysOfWeek: number[];
  morning: number;
  noon: number;
  evening: number;
  bedtime: number;
  locationId: string | null;
  paused: boolean;
  isDoseDay: boolean;
  upcoming?: {
    scheduleId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    pattern: SchedulePattern;
    daysOfWeek: number[];
    morning: number;
    noon: number;
    evening: number;
    bedtime: number;
    locationId: string | null;
    paused: boolean;
  } | null;
}

export interface ScheduleOverviewData {
  timezone: string;
  localDate: string;
  plans: SchedulePlanSummary[];
}

export interface LocationCalendarDay {
  date: string;
  locationId: string | null;
  locationName: string | null;
  isOverride: boolean;
  wasCorrected: boolean;
  isMixed: boolean;
  hasDoseOverride: boolean;
  correctedAt?: string | null;
  correctedBy?: string | null;
  previousLocationName?: string | null;
}

export interface DayDoseItem {
  medicineId: string;
  medicineName: string;
  unitName: string;
  slot: DoseSlot;
  amount: number;
  normalLocationId: string | null;
  resolvedLocationId: string | null;
}

export interface DayPlanData {
  date: string;
  timezone: string;
  doses: DayDoseItem[];
}

export interface QuantityInput {
  boxes: number;
  loose: number;
  total: number;
}

export interface MutationResult { ok: boolean; message: string; id?: string }
