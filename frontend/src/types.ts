export type Role = "CUSTOMER" | "HOST" | "MANAGER" | "DISPLAY";
export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}
export type EntryStatus =
  | "WAITING"
  | "ARRIVAL_WINDOW"
  | "CHECKED_IN"
  | "SNOOZED"
  | "CALLED"
  | "SEATED"
  | "DINING"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "NO_SHOW";
export interface Entry {
  id: string;
  token: string;
  customerName?: string;
  partySize: number;
  preference: string;
  accessible: boolean;
  status: EntryStatus;
  joinedAt: string;
  fairnessSince: string;
  checkedInAt: string | null;
  arrivalWindowOpenedAt: string | null;
  arrivalDeadline: string | null;
  callDeadline: string | null;
  snoozeReleaseAt: string | null;
  snoozeCount: number;
  snoozesRemaining: number;
  priority: boolean;
  tableId: string | null;
  tableNumber: string | null;
  areaName: string | null;
  etaSeconds: number | null;
  estimatedStartAt: string | null;
  computedAt: string | null;
  estimateSource: string;
  sampleCount: number;
  confidence: string;
  assumesArrival: boolean;
  position: number | null;
  version: number;
  terminalReason: string | null;
}
export interface Area {
  id: string;
  name: string;
}
export interface Table {
  id: string;
  number: string;
  areaId: string;
  areaName: string;
  capacity: number;
  accessible: boolean;
  status: "AVAILABLE" | "ASSIGNED" | "OCCUPIED" | "UNAVAILABLE";
  enabled: boolean;
  version: number;
}
export interface Policy {
  arrivalLeadMinutes: number;
  arrivalGraceMinutes: number;
  callGraceMinutes: number;
  maxSnoozes: number;
  snoozeMinutes: number;
  snoozeSpots: number;
  priorityBurstLimit: number;
  agingMinutes: number;
  starvationMinutes: number;
  sampleSize: number;
  sampleHorizonMinutes: number;
  minimumSamples: number;
  defaultDiningMinutes: number;
  maxActiveParties: number;
  capacityWastePenalty: number;
}
export interface Restaurant {
  id: string;
  name: string;
  location: string;
  timezone: string;
  description: string;
  open: boolean;
  demoMode: boolean;
  serverTime: string;
  sessionId: string | null;
  sessionStatus: string;
  recoveryRequired: boolean;
  policy: Policy;
  areas: Area[];
  tables: Table[];
  waitingCount: number;
}
export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}
export interface Visit {
  id: string;
  entryId: string;
  token: string;
  tableId: string;
  tableNumber: string;
  partySize: number;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
}
export interface Suggestion {
  entryId: string;
  tableId: string;
  score: number;
  reason?: string;
  token?: string;
  tableNumber?: string;
}
export interface HostBoard {
  entries: Entry[];
  tables: Table[];
  visits: Visit[];
  revision: number;
  serverTime: string;
  suggestions: Suggestion[];
}
export interface Analytics {
  averageWaitMinutes: number | null;
  averageDiningMinutes: number | null;
  completedParties: number;
  cancellations: number;
  noShows: number;
  utilizationPercent: number | null;
  throughputPerHour: number | null;
  queueTrends: { hour: string; joined: number; completed: number }[];
  tableUtilization: {
    tableNumber: string;
    utilizationPercent: number | null;
  }[];
  sampleCount: number;
  asOf: string;
}
export interface Audit {
  id: string;
  action: string;
  actor: string;
  reason: string;
  occurredAt: string;
  entryId?: string;
  details?: unknown;
}
export interface DisplayBoard {
  restaurantName: string;
  called: { token: string; tableNumber: string; areaName: string }[];
  challenge: string;
  expiresAt: string;
  serverTime: string;
}
