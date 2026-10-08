export type Role = "owner" | "editor" | "viewer";
export type AppMode = "demo" | "supabase";
export type OperationKind = "receive" | "adjust" | "transfer" | "loss" | "undo";

export interface LocationSummary {
  id: string;
  name: string;
  units: number;
  confirmedAt?: string;
  daysLeft?: number | null;
  runOutDate?: string | null;
}

export interface MedicineSummary {
  id: string;
  name: string;
  specification: string;
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
  locations: Array<{ id: string; name: string }>;
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

export interface QuantityInput {
  boxes: number;
  loose: number;
  total: number;
}

export interface MutationResult { ok: boolean; message: string }
