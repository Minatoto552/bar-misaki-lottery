export const lotteryKinds = ["counter", "private", "table"] as const;
export const lotteryStates = [
  "accepting",
  "drawing",
  "drawn",
  "published",
  "closed",
] as const;
export const entryStatuses = [
  "pending",
  "winner",
  "loser",
  "excluded",
  "cancelled",
] as const;

export type LotteryKind = (typeof lotteryKinds)[number];
export type LotteryState = (typeof lotteryStates)[number];
export type EntryStatus = (typeof entryStatuses)[number];
export const instanceIds = ["instance1", "instance2", "instance3"] as const;
export type InstanceId = (typeof instanceIds)[number];
export type PreferenceMode = "specified" | "omakase";

export interface LotteryInstance {
  id: InstanceId;
  label: string;
  visible: boolean;
  enabled: boolean;
}

export interface RecruitmentSlot {
  id: string;
  instanceId: InstanceId;
  kind: LotteryKind;
  capacity: number;
  minPeople: number;
  maxPeople: number;
  enabled: boolean;
}

export interface LotteryFeatureSettings {
  showInstanceSelection: boolean;
  showKindSelection: boolean;
  showOmakase: boolean;
  kindVisibility: Record<LotteryKind, boolean>;
}

export interface LotterySettings {
  roundId: string;
  state: LotteryState;
  availableKinds: LotteryKind[];
  drawnKinds: LotteryKind[];
  counterWinnerSlots: number;
  privateWinnerSlots: number;
  tableWinnerSlots: number;
  vacantCounterSlots: number;
  vacantPrivateSlots: number;
  vacantTableSlots: number;
  publishedAt: string | null;
  lastUpdatedAt: string;
  applicationDeadline: string | null;
  instances: LotteryInstance[];
  recruitmentSlots: RecruitmentSlot[];
  featureSettings: LotteryFeatureSettings;
  vacantSlotCounts: Record<string, number>;
}

export interface LotteryEntry {
  id: string;
  roundId: string;
  entryNumber: string;
  kind: LotteryKind;
  representativeId: string;
  representativeVrcName: string;
  companionVrcName: string | null;
  normalizedIds: string[];
  peopleCount: number;
  status: EntryStatus;
  winnerCode: string | null;
  previousWinnerCode: string | null;
  createdAt: string;
  updatedAt: string;
  drawnAt: string | null;
  excludedAt: string | null;
  confirmedAt: string | null;
  preferenceMode: PreferenceMode;
  requestedInstanceId: InstanceId | null;
  assignedInstanceId: InstanceId | null;
  assignedKind: LotteryKind | null;
  legacyAutoOmakase: boolean;
}

export interface LotteryAuditLog {
  id: string;
  actor: string;
  action: string;
  target: LotteryKind | "all" | "auth";
  details: string;
  createdAt: string;
}

export interface AdminLotterySnapshot {
  settings: LotterySettings;
  entries: LotteryEntry[];
  audits: LotteryAuditLog[];
}

export interface PublicLotterySnapshot {
  settings: Pick<
    LotterySettings,
    | "roundId"
    | "state"
    | "availableKinds"
    | "drawnKinds"
    | "lastUpdatedAt"
    | "applicationDeadline"
    | "instances"
    | "recruitmentSlots"
    | "featureSettings"
  >;
  entry: Omit<LotteryEntry, "normalizedIds" | "previousWinnerCode"> | null;
}

export interface SubmitLotteryInput {
  kind: LotteryKind;
  instanceId?: InstanceId;
  preferenceMode?: PreferenceMode;
  representativeId: string;
  representativeVrcName: string;
  companionVrcName?: string;
  token: string;
}

export interface LotteryConfigurationInput {
  applicationDeadline: string | null;
  instances: LotteryInstance[];
  recruitmentSlots: RecruitmentSlot[];
  featureSettings: LotteryFeatureSettings;
}

export interface LotteryDrawInput {
  enabledKinds: LotteryKind[];
  winnerSlots: Record<LotteryKind, number>;
}
