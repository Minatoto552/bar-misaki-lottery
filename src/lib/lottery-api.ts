import { signInWithCustomToken, signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';

import type {
  AdminLotterySnapshot,
  LotteryAuditLog,
  LotteryEntry,
  LotteryDrawInput,
  LotteryKind,
  LotterySettings,
  PublicLotterySnapshot,
  SubmitLotteryInput,
} from '../../shared/models';
import { normalizeXIdForComparison, submitLotterySchema, validateWinnerSlots } from '../../shared/validation';
import { firebaseServices, isDemoMode, isSharedApiMode, sharedApiBaseUrl } from './firebase';

const DB_KEY = 'bar-misaki-lottery-demo-v1';
const TOKEN_KEY = 'bar-misaki-lottery-device-token-v1';
const ADMIN_KEY = 'bar-misaki-lottery-admin-session-v1';
const SHARED_ADMIN_KEY = 'bar-misaki-lottery-shared-admin-token-v1';
export const LOTTERY_UPDATED_EVENT = 'bar-misaki-lottery-updated';

interface DemoDatabase {
  settings: LotterySettings;
  entries: LotteryEntry[];
  audits: LotteryAuditLog[];
  tokenEntryMap: Record<string, string>;
}

const nowIso = () => new Date().toISOString();
const newRoundId = () => `round-${crypto.randomUUID()}`;

const initialDatabase = (): DemoDatabase => ({
  settings: {
    roundId: newRoundId(),
    state: 'accepting',
    availableKinds: ['counter', 'private', 'table'],
    drawnKinds: [],
    counterWinnerSlots: 0,
    privateWinnerSlots: 0,
    tableWinnerSlots: 0,
    vacantCounterSlots: 0,
    vacantPrivateSlots: 0,
    vacantTableSlots: 0,
    publishedAt: null,
    lastUpdatedAt: nowIso(),
  },
  entries: [],
  audits: [],
  tokenEntryMap: {},
});

const loadDemo = (): DemoDatabase => {
  const stored = localStorage.getItem(DB_KEY);
  if (!stored) {
    const initial = initialDatabase();
    localStorage.setItem(DB_KEY, JSON.stringify(initial));
    return initial;
  }
  try {
    const parsed = JSON.parse(stored) as DemoDatabase;
    parsed.settings.tableWinnerSlots ??= 0;
    parsed.settings.vacantTableSlots ??= 0;
    parsed.settings.availableKinds ??= ['counter', 'private', 'table'];
    parsed.settings.drawnKinds ??= ['counter', 'private'];
    parsed.entries = parsed.entries.map((entry) => {
      const legacy = entry as LotteryEntry & { companionId?: string | null };
      return {
        ...entry,
        representativeVrcName: entry.representativeVrcName ?? entry.representativeId,
        companionVrcName: entry.companionVrcName ?? legacy.companionId ?? null,
        normalizedIds: [normalizeXIdForComparison(entry.representativeId)],
      };
    });
    return parsed;
  } catch {
    const initial = initialDatabase();
    localStorage.setItem(DB_KEY, JSON.stringify(initial));
    return initial;
  }
};

const saveDemo = (database: DemoDatabase) => {
  localStorage.setItem(DB_KEY, JSON.stringify(database));
  window.dispatchEvent(new CustomEvent(LOTTERY_UPDATED_EVENT));
};

const withAudit = (
  database: DemoDatabase,
  action: string,
  target: LotteryAuditLog['target'],
  details: string,
): DemoDatabase => ({
  ...database,
  audits: [
    {
      id: `audit-${crypto.randomUUID()}`,
      actor: 'demo-admin',
      action,
      target,
      details,
      createdAt: nowIso(),
    },
    ...database.audits,
  ],
});

const call = async <TInput, TOutput>(name: string, input: TInput): Promise<TOutput> => {
  if (isSharedApiMode && sharedApiBaseUrl) {
    const token = sessionStorage.getItem(SHARED_ADMIN_KEY);
    const response = await fetch(`${sharedApiBaseUrl}/api/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(input ?? {}),
    });
    const body = await response.json() as { error?: string } & TOutput;
    if (!response.ok) throw new Error(body.error || 'サーバーとの通信に失敗しました');
    return body;
  }
  if (!firebaseServices.functions) throw new Error('Firebase Functionsが設定されていません');
  const result = await httpsCallable<TInput, TOutput>(firebaseServices.functions, name)(input);
  return result.data;
};

const randomIndex = (max: number): number => {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0]! % max;
};

const choose = <T,>(items: T[], count: number): T[] => {
  const pool = [...items];
  const selected: T[] = [];
  while (selected.length < count && pool.length) {
    selected.push(pool.splice(randomIndex(pool.length), 1)[0]!);
  }
  return selected;
};

const winnerCode = (usedCodes: Set<string> = new Set()): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    const values = new Uint8Array(6);
    crypto.getRandomValues(values);
    code = `MSK-${Array.from(values, (value) => alphabet[value % alphabet.length]).join('')}`;
  } while (usedCodes.has(code));
  usedCodes.add(code);
  return code;
};

export const ensureDeviceToken = (): string => {
  const current = localStorage.getItem(TOKEN_KEY);
  if (current) return current;
  const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  localStorage.setItem(TOKEN_KEY, token);
  return token;
};

export const submitLotteryEntry = async (input: SubmitLotteryInput): Promise<void> => {
  const parsed = submitLotterySchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '入力内容を確認してください');
  if (!isDemoMode) {
    await call('submitLotteryEntry', parsed.data);
    return;
  }

  const database = loadDemo();
  if (database.settings.state !== 'accepting') throw new Error('現在は応募を受け付けていません');
  if (!database.settings.availableKinds.includes(parsed.data.kind)) throw new Error('この募集項目は現在受け付けていません');
  const normalizedIds = [normalizeXIdForComparison(parsed.data.representativeId)];
  const used = new Set(
    database.entries
      .filter((entry) => entry.roundId === database.settings.roundId)
      .flatMap((entry) => entry.normalizedIds),
  );
  if (normalizedIds.some((id) => used.has(id))) throw new Error('このX IDはすでに応募されています');
  if (database.tokenEntryMap[parsed.data.token]) throw new Error('この端末からはすでに応募済みです');

  const id = `entry-${crypto.randomUUID()}`;
  const timestamp = nowIso();
  const entry: LotteryEntry = {
    id,
    roundId: database.settings.roundId,
    entryNumber: `MSK-${String(database.entries.filter((item) => item.roundId === database.settings.roundId).length + 1).padStart(4, '0')}`,
    kind: parsed.data.kind,
    representativeId: parsed.data.representativeId,
    representativeVrcName: parsed.data.representativeVrcName,
    companionVrcName: parsed.data.companionVrcName ?? null,
    normalizedIds,
    peopleCount: parsed.data.companionVrcName ? 2 : 1,
    status: 'pending',
    winnerCode: null,
    previousWinnerCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    drawnAt: null,
    excludedAt: null,
  };
  database.entries.push(entry);
  database.tokenEntryMap[parsed.data.token] = id;
  database.settings.lastUpdatedAt = timestamp;
  saveDemo(database);
};

export const getPublicLotterySnapshot = async (token: string): Promise<PublicLotterySnapshot> => {
  if (!isDemoMode) return call('getLotteryStatus', { token });
  const database = loadDemo();
  const entryId = database.tokenEntryMap[token];
  const entry = database.entries.find(
    (candidate) => candidate.id === entryId && candidate.roundId === database.settings.roundId,
  );
  const publicEntry = entry
    ? (({ normalizedIds: _normalizedIds, previousWinnerCode: _previousCode, ...rest }) => ({
        ...rest,
        status: database.settings.state === 'published' ? rest.status : 'pending' as const,
        winnerCode: database.settings.state === 'published' ? rest.winnerCode : null,
      }))(entry)
    : null;
  return {
    settings: {
      roundId: database.settings.roundId,
      state: database.settings.state,
      availableKinds: database.settings.availableKinds,
      drawnKinds: database.settings.drawnKinds,
      lastUpdatedAt: database.settings.lastUpdatedAt,
    },
    entry: publicEntry,
  };
};

export const cancelLotteryEntry = async (token: string): Promise<void> => {
  if (!isDemoMode) {
    await call('cancelLotteryEntry', { token });
    return;
  }
  let database = loadDemo();
  if (database.settings.state !== 'accepting') {
    throw new Error('抽選開始後は応募をキャンセルできません');
  }
  const entryId = database.tokenEntryMap[token];
  const entry = database.entries.find(
    (candidate) => candidate.id === entryId && candidate.roundId === database.settings.roundId,
  );
  if (!entry) throw new Error('キャンセルできる応募が見つかりません');
  database.entries = database.entries.filter((candidate) => candidate.id !== entry.id);
  delete database.tokenEntryMap[token];
  database.settings.lastUpdatedAt = nowIso();
  database = withAudit(database, '応募キャンセル', entry.kind, entry.entryNumber);
  saveDemo(database);
};

export const loginAdmin = async (password: string): Promise<void> => {
  if (isDemoMode) {
    const expected = import.meta.env.VITE_DEMO_ADMIN_PASSWORD || '1112';
    if (password !== expected) throw new Error('パスワードが正しくありません');
    sessionStorage.setItem(ADMIN_KEY, 'true');
    return;
  }
  if (isSharedApiMode) {
    const { sessionToken } = await call<{ password: string }, { sessionToken: string }>('adminLogin', { password });
    sessionStorage.setItem(SHARED_ADMIN_KEY, sessionToken);
    return;
  }
  if (!firebaseServices.auth) throw new Error('Firebase Authenticationが設定されていません');
  const { customToken } = await call<{ password: string }, { customToken: string }>('adminLogin', { password });
  await signInWithCustomToken(firebaseServices.auth, customToken);
};

export const logoutAdmin = async (): Promise<void> => {
  sessionStorage.removeItem(ADMIN_KEY);
  sessionStorage.removeItem(SHARED_ADMIN_KEY);
  if (firebaseServices.auth) await signOut(firebaseServices.auth);
};

export const isAdminSessionActive = (): boolean =>
  isDemoMode ? sessionStorage.getItem(ADMIN_KEY) === 'true' : isSharedApiMode ? Boolean(sessionStorage.getItem(SHARED_ADMIN_KEY)) : Boolean(firebaseServices.auth?.currentUser);

export const getAdminLotterySnapshot = async (): Promise<AdminLotterySnapshot> => {
  if (!isDemoMode) return call('getAdminLottery', {});
  if (!isAdminSessionActive()) throw new Error('管理者ログインが必要です');
  const database = loadDemo();
  return {
    settings: database.settings,
    entries: database.entries.filter((entry) => entry.roundId === database.settings.roundId),
    audits: database.audits.slice(0, 100),
  };
};

export const updateAvailableLotteryKinds = async (availableKinds: LotteryKind[]): Promise<void> => {
  const allKinds: LotteryKind[] = ['counter', 'private', 'table'];
  const normalized = allKinds.filter((kind) => availableKinds.includes(kind));
  if (!normalized.length) throw new Error('募集項目を1つ以上選択してください');
  if (!isDemoMode) {
    await call('updateAvailableLotteryKinds', { availableKinds: normalized });
    return;
  }
  let database = loadDemo();
  if (database.settings.state !== 'accepting') throw new Error('募集項目は応募受付中のみ変更できます');
  const timestamp = nowIso();
  database.settings.availableKinds = normalized;
  database.settings.lastUpdatedAt = timestamp;
  const labels: Record<LotteryKind, string> = { counter: 'カウンター', private: '個室', table: 'テーブル席' };
  database = withAudit(database, '募集項目更新', 'all', `${normalized.map((kind) => labels[kind]).join('、')}を募集中に設定`);
  saveDemo(database);
};

export const runLottery = async ({ enabledKinds, winnerSlots }: LotteryDrawInput): Promise<void> => {
  if (!isDemoMode) {
    await call('runLottery', { enabledKinds, winnerSlots });
    return;
  }
  let database = loadDemo();
  if (database.settings.state !== 'accepting' && database.settings.state !== 'closed') {
    throw new Error('現在の状態では抽選を開始できません');
  }
  const current = database.entries.filter((entry) => entry.roundId === database.settings.roundId);
  if (!enabledKinds.length) throw new Error('抽選対象を1つ以上選択してください');
  const entriesByKind = Object.fromEntries(
    (['counter', 'private', 'table'] as LotteryKind[]).map((kind) => [kind, current.filter((entry) => entry.kind === kind)]),
  ) as Record<LotteryKind, LotteryEntry[]>;
  const effectiveSlots = Object.fromEntries(
    (['counter', 'private', 'table'] as LotteryKind[]).map((kind) => [kind, enabledKinds.includes(kind) ? winnerSlots[kind] : 0]),
  ) as Record<LotteryKind, number>;
  const error = (['counter', 'private', 'table'] as LotteryKind[])
    .map((kind) => validateWinnerSlots(kind, effectiveSlots[kind], entriesByKind[kind].length))
    .find(Boolean);
  if (error) throw new Error(error);
  database.settings.state = 'drawing';
  saveDemo(database);
  const timestamp = nowIso();
  const winnerIds = new Set([
    ...choose(entriesByKind.counter, effectiveSlots.counter).map((entry) => entry.id),
    ...choose(entriesByKind.private, effectiveSlots.private).map((entry) => entry.id),
    ...choose(entriesByKind.table, effectiveSlots.table).map((entry) => entry.id),
  ]);
  database = loadDemo();
  const issuedCodes = new Set<string>();
  database.entries = database.entries.map((entry) =>
    entry.roundId !== database.settings.roundId
      ? entry
      : {
          ...entry,
          status: winnerIds.has(entry.id) ? 'winner' : 'pending',
          winnerCode: winnerIds.has(entry.id) ? winnerCode(issuedCodes) : null,
          drawnAt: timestamp,
          updatedAt: timestamp,
        },
  );
  database.settings = {
    ...database.settings,
    state: 'drawn',
    drawnKinds: [...enabledKinds],
    counterWinnerSlots: effectiveSlots.counter,
    privateWinnerSlots: effectiveSlots.private,
    tableWinnerSlots: effectiveSlots.table,
    vacantCounterSlots: 0,
    vacantPrivateSlots: 0,
    vacantTableSlots: 0,
    publishedAt: null,
    lastUpdatedAt: timestamp,
  };
  const labels: Record<LotteryKind, string> = { counter: 'カウンター', private: '個室', table: 'テーブル席' };
  database = withAudit(database, '抽選実行', 'all', enabledKinds.map((kind) => `${labels[kind]}${effectiveSlots[kind]}組`).join('、') + 'を抽選');
  saveDemo(database);
};

export const excludeWinners = async (entryIds: string[]): Promise<void> => {
  if (!isDemoMode) return void (await call('excludeLotteryWinners', { entryIds }));
  let database = loadDemo();
  const selected = database.entries.filter((entry) => entryIds.includes(entry.id) && entry.status === 'winner');
  if (!selected.length) throw new Error('除外する当選組を選択してください');
  const timestamp = nowIso();
  database.entries = database.entries.map((entry) =>
    entryIds.includes(entry.id) && entry.status === 'winner'
      ? { ...entry, status: 'excluded', previousWinnerCode: entry.winnerCode, winnerCode: null, excludedAt: timestamp, updatedAt: timestamp }
      : entry,
  );
  database.settings.vacantCounterSlots += selected.filter((entry) => entry.kind === 'counter').length;
  database.settings.vacantPrivateSlots += selected.filter((entry) => entry.kind === 'private').length;
  database.settings.vacantTableSlots += selected.filter((entry) => entry.kind === 'table').length;
  database.settings.state = 'drawn';
  database.settings.publishedAt = null;
  database.settings.lastUpdatedAt = timestamp;
  database = withAudit(database, '当選者除外', 'all', selected.map((entry) => entry.entryNumber).join(', '));
  saveDemo(database);
};

export const undoExclusions = async (entryIds: string[]): Promise<void> => {
  if (!isDemoMode) return void (await call('undoLotteryExclusions', { entryIds }));
  let database = loadDemo();
  if (database.settings.state === 'published') throw new Error('公開後は除外を取り消せません');
  const selected = database.entries.filter((entry) => entryIds.includes(entry.id) && entry.status === 'excluded');
  database.entries = database.entries.map((entry) =>
    entryIds.includes(entry.id) && entry.status === 'excluded'
      ? { ...entry, status: 'winner', winnerCode: entry.previousWinnerCode || winnerCode(), previousWinnerCode: null, excludedAt: null, updatedAt: nowIso() }
      : entry,
  );
  database.settings.vacantCounterSlots = Math.max(0, database.settings.vacantCounterSlots - selected.filter((entry) => entry.kind === 'counter').length);
  database.settings.vacantPrivateSlots = Math.max(0, database.settings.vacantPrivateSlots - selected.filter((entry) => entry.kind === 'private').length);
  database.settings.vacantTableSlots = Math.max(0, database.settings.vacantTableSlots - selected.filter((entry) => entry.kind === 'table').length);
  database.settings.lastUpdatedAt = nowIso();
  database = withAudit(database, '除外取消', 'all', selected.map((entry) => entry.entryNumber).join(', '));
  saveDemo(database);
};

export const redrawVacancies = async (): Promise<void> => {
  if (!isDemoMode) return void (await call('redrawLotteryVacancies', {}));
  let database = loadDemo();
  const current = database.entries.filter((entry) => entry.roundId === database.settings.roundId);
  const selectFor = (kind: LotteryKind, requested: number) => {
    const candidates = current.filter((entry) => entry.kind === kind && entry.status === 'pending');
    return choose(candidates, Math.min(requested, candidates.length));
  };
  const replacements = [
    ...selectFor('counter', database.settings.vacantCounterSlots),
    ...selectFor('private', database.settings.vacantPrivateSlots),
    ...selectFor('table', database.settings.vacantTableSlots),
  ];
  if (!replacements.length) throw new Error('再抽選できる候補者がいません');
  const ids = new Set(replacements.map((entry) => entry.id));
  const issuedCodes = new Set(current.map((entry) => entry.winnerCode).filter((code): code is string => Boolean(code)));
  const timestamp = nowIso();
  database.entries = database.entries.map((entry) =>
    ids.has(entry.id) ? { ...entry, status: 'winner', winnerCode: winnerCode(issuedCodes), drawnAt: timestamp, updatedAt: timestamp } : entry,
  );
  database.settings.vacantCounterSlots = Math.max(0, database.settings.vacantCounterSlots - replacements.filter((entry) => entry.kind === 'counter').length);
  database.settings.vacantPrivateSlots = Math.max(0, database.settings.vacantPrivateSlots - replacements.filter((entry) => entry.kind === 'private').length);
  database.settings.vacantTableSlots = Math.max(0, database.settings.vacantTableSlots - replacements.filter((entry) => entry.kind === 'table').length);
  database.settings.state = 'drawn';
  database.settings.lastUpdatedAt = timestamp;
  database = withAudit(database, '空き枠再抽選', 'all', `${replacements.length}組を再抽選`);
  saveDemo(database);
};

export const publishLotteryResults = async (): Promise<void> => {
  if (!isDemoMode) return void (await call('publishLotteryResults', {}));
  let database = loadDemo();
  if (database.settings.state !== 'drawn') throw new Error('抽選済みの結果がありません');
  if (database.settings.vacantCounterSlots || database.settings.vacantPrivateSlots || database.settings.vacantTableSlots) throw new Error('空き枠の再抽選を完了してください');
  const timestamp = nowIso();
  database.entries = database.entries.map((entry) =>
    entry.roundId === database.settings.roundId && entry.status === 'pending' && database.settings.drawnKinds.includes(entry.kind)
      ? { ...entry, status: 'loser', updatedAt: timestamp }
      : entry,
  );
  database.settings.state = 'published';
  database.settings.publishedAt = timestamp;
  database.settings.lastUpdatedAt = timestamp;
  database = withAudit(database, '結果公開', 'all', '抽選結果を公開');
  saveDemo(database);
};

export const resetLottery = async (confirmation: string): Promise<void> => {
  if (confirmation !== 'リセット') throw new Error('確認欄に「リセット」と入力してください');
  if (!isDemoMode) return void (await call('resetLottery', { confirmation }));
  const database = loadDemo();
  const next = initialDatabase();
  next.audits = withAudit(database, '抽選リセット', 'all', `ラウンド ${database.settings.roundId} をリセット`).audits;
  saveDemo(next);
};
