export const lotteryKinds = ['counter', 'private', 'table'] as const;
export const lotteryStates = ['accepting', 'drawing', 'drawn', 'published', 'closed'] as const;
export const entryStatuses = ['pending', 'winner', 'loser', 'excluded'] as const;

export type LotteryKind = (typeof lotteryKinds)[number];
export type LotteryState = (typeof lotteryStates)[number];
export type EntryStatus = (typeof entryStatuses)[number];

export interface LotterySettings {
  roundId: string;
  state: LotteryState;
  drawnKinds: LotteryKind[];
  counterWinnerSlots: number;
  privateWinnerSlots: number;
  tableWinnerSlots: number;
  vacantCounterSlots: number;
  vacantPrivateSlots: number;
  vacantTableSlots: number;
  publishedAt: string | null;
  lastUpdatedAt: string;
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
}

export interface LotteryAuditLog {
  id: string;
  actor: string;
  action: string;
  target: LotteryKind | 'all' | 'auth';
  details: string;
  createdAt: string;
}

export interface AdminLotterySnapshot {
  settings: LotterySettings;
  entries: LotteryEntry[];
  audits: LotteryAuditLog[];
}

export interface PublicLotterySnapshot {
  settings: Pick<LotterySettings, 'roundId' | 'state' | 'drawnKinds' | 'lastUpdatedAt'>;
  entry: Omit<LotteryEntry, 'normalizedIds' | 'previousWinnerCode'> | null;
}

export interface SubmitLotteryInput {
  kind: LotteryKind;
  representativeId: string;
  representativeVrcName: string;
  companionVrcName?: string;
  token: string;
}

export interface LotteryDrawInput {
  enabledKinds: LotteryKind[];
  winnerSlots: Record<LotteryKind, number>;
}
