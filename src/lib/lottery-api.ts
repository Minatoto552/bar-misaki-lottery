import { signInWithCustomToken, signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";

import type {
  AdminLotterySnapshot,
  LotteryAuditLog,
  LotteryEntry,
  LotteryConfigurationInput,
  LotteryDrawInput,
  InstanceId,
  LotteryKind,
  LotterySettings,
  PublicLotterySnapshot,
  SubmitLotteryInput,
} from "../../shared/models";
import {
  normalizeXIdForComparison,
  submitLotterySchema,
} from "../../shared/validation";
import {
  firebaseServices,
  isDemoMode,
  isSharedApiMode,
  sharedApiBaseUrl,
} from "./firebase";

const DB_KEY = "bar-misaki-lottery-demo-v1";
const TOKEN_KEY = "bar-misaki-lottery-device-token-v1";
const ADMIN_KEY = "bar-misaki-lottery-admin-session-v1";
const SHARED_ADMIN_KEY = "bar-misaki-lottery-shared-admin-token-v1";
export const LOTTERY_UPDATED_EVENT = "bar-misaki-lottery-updated";

interface DemoDatabase {
  settings: LotterySettings;
  entries: LotteryEntry[];
  audits: LotteryAuditLog[];
  tokenEntryMap: Record<string, string>;
}

const nowIso = () => new Date().toISOString();
const newRoundId = () => `round-${crypto.randomUUID()}`;
const defaultInstances = () =>
  ([1, 2, 3] as const).map((number) => ({
    id: `instance${number}` as InstanceId,
    label: `インスタンス${number}`,
    visible: number === 1,
    enabled: number === 1,
  }));
const defaultSlots = () =>
  defaultInstances().flatMap((instance) =>
    (["counter", "private", "table"] as LotteryKind[]).map((kind) => ({
      id: `${instance.id}:${kind}`,
      instanceId: instance.id,
      kind,
      capacity: instance.id === "instance1" ? 1 : 0,
      minPeople: 1,
      maxPeople: 2,
      enabled: instance.id === "instance1",
    })),
  );

const initialDatabase = (): DemoDatabase => ({
  settings: {
    roundId: newRoundId(),
    state: "accepting",
    availableKinds: ["counter", "private", "table"],
    drawnKinds: [],
    counterWinnerSlots: 0,
    privateWinnerSlots: 0,
    tableWinnerSlots: 0,
    vacantCounterSlots: 0,
    vacantPrivateSlots: 0,
    vacantTableSlots: 0,
    publishedAt: null,
    lastUpdatedAt: nowIso(),
    applicationDeadline: null,
    instances: defaultInstances(),
    recruitmentSlots: defaultSlots(),
    featureSettings: {
      showInstanceSelection: true,
      showKindSelection: true,
      showOmakase: true,
      kindVisibility: { counter: true, private: true, table: true },
    },
    vacantSlotCounts: {},
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
    parsed.settings.availableKinds ??= ["counter", "private", "table"];
    parsed.settings.drawnKinds ??= ["counter", "private"];
    parsed.settings.applicationDeadline ??= null;
    parsed.settings.instances ??= defaultInstances();
    parsed.settings.recruitmentSlots ??= defaultSlots();
    parsed.settings.recruitmentSlots = parsed.settings.recruitmentSlots.map(
      (slot) => ({ ...slot, minPeople: slot.minPeople ?? 1, maxPeople: slot.maxPeople ?? 2 }),
    );
    parsed.settings.featureSettings ??= {
      showInstanceSelection: true,
      showKindSelection: true,
      showOmakase: true,
      kindVisibility: { counter: true, private: true, table: true },
    };
    parsed.settings.vacantSlotCounts ??= {};
    parsed.entries = parsed.entries.map((entry) => {
      const legacy = entry as LotteryEntry & { companionId?: string | null };
      return {
        ...entry,
        representativeVrcName:
          entry.representativeVrcName ?? entry.representativeId,
        companionVrcName: entry.companionVrcName ?? legacy.companionId ?? null,
        normalizedIds: [normalizeXIdForComparison(entry.representativeId)],
        confirmedAt: entry.confirmedAt ?? null,
        preferenceMode: entry.preferenceMode ?? "omakase",
        requestedInstanceId: entry.requestedInstanceId ?? null,
        assignedInstanceId: entry.assignedInstanceId ?? null,
        assignedKind: entry.assignedKind ?? null,
        legacyAutoOmakase:
          entry.legacyAutoOmakase ?? entry.requestedInstanceId == null,
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
  target: LotteryAuditLog["target"],
  details: string,
): DemoDatabase => ({
  ...database,
  audits: [
    {
      id: `audit-${crypto.randomUUID()}`,
      actor: "demo-admin",
      action,
      target,
      details,
      createdAt: nowIso(),
    },
    ...database.audits,
  ],
});

const call = async <TInput, TOutput>(
  name: string,
  input: TInput,
): Promise<TOutput> => {
  if (isSharedApiMode && sharedApiBaseUrl) {
    const token = sessionStorage.getItem(SHARED_ADMIN_KEY);
    const response = await fetch(`${sharedApiBaseUrl}/api/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(input ?? {}),
    });
    const body = (await response.json()) as { error?: string } & TOutput;
    if (!response.ok)
      throw new Error(body.error || "サーバーとの通信に失敗しました");
    return body;
  }
  if (!firebaseServices.functions)
    throw new Error("Firebase Functionsが設定されていません");
  const result = await httpsCallable<TInput, TOutput>(
    firebaseServices.functions,
    name,
  )(input);
  return result.data;
};

const randomIndex = (max: number): number => {
  if (!Number.isSafeInteger(max) || max <= 0)
    throw new Error("抽選候補数が不正です");
  const values = new Uint32Array(1);
  const range = 0x1_0000_0000;
  const limit = range - (range % max);
  do crypto.getRandomValues(values);
  while (values[0]! >= limit);
  return values[0]! % max;
};

const choose = <T>(items: T[], count: number): T[] => {
  const pool = [...items];
  const selected: T[] = [];
  while (selected.length < count && pool.length) {
    selected.push(pool.splice(randomIndex(pool.length), 1)[0]!);
  }
  return selected;
};

const allocateConfiguredWinners = (
  entries: LotteryEntry[],
  settings: LotterySettings,
  lockedIds: Set<string> = new Set(),
) => {
  const activeInstances = new Set(
    settings.instances
      .filter((instance) => instance.enabled && instance.visible)
      .map((instance) => instance.id),
  );
  const slots = settings.recruitmentSlots.filter(
    (slot) =>
      slot.enabled &&
      slot.capacity > 0 &&
      activeInstances.has(slot.instanceId) &&
      settings.featureSettings.kindVisibility[slot.kind],
  );
  if (!slots.length) throw new Error("有効な募集枠がありません");
  const assignments = new Map<
    string,
    { instanceId: InstanceId; kind: LotteryKind }
  >();
  const remaining = new Map(slots.map((slot) => [slot.id, slot.capacity]));
  for (const entry of entries.filter(
    (item) => lockedIds.has(item.id) && item.status === "winner",
  )) {
    if (!entry.assignedInstanceId || !entry.assignedKind) continue;
    const slotId = `${entry.assignedInstanceId}:${entry.assignedKind}`;
    if (!remaining.has(slotId) || remaining.get(slotId)! <= 0)
      throw new Error(`${entry.entryNumber}の当選確定枠が現在の募集設定と一致しません`);
    remaining.set(slotId, remaining.get(slotId)! - 1);
    assignments.set(entry.id, {
      instanceId: entry.assignedInstanceId,
      kind: entry.assignedKind,
    });
  }
  for (const slot of slots) {
    const candidates = entries.filter(
      (entry) =>
        !lockedIds.has(entry.id) &&
        entry.status !== "excluded" &&
        entry.preferenceMode === "specified" &&
        entry.requestedInstanceId === slot.instanceId &&
        entry.kind === slot.kind &&
        entry.peopleCount >= slot.minPeople &&
        entry.peopleCount <= slot.maxPeople,
    );
    for (const entry of choose(candidates, remaining.get(slot.id) ?? 0)) {
      assignments.set(entry.id, {
        instanceId: slot.instanceId,
        kind: slot.kind,
      });
      remaining.set(slot.id, remaining.get(slot.id)! - 1);
    }
  }
  const openAssignments = slots.flatMap((slot) =>
    Array.from({ length: remaining.get(slot.id) ?? 0 }, () => slot),
  );
  const omakase = choose(
    entries.filter(
      (entry) =>
        !lockedIds.has(entry.id) &&
        entry.status !== "excluded" &&
        entry.preferenceMode === "omakase",
    ),
    entries.filter(
      (entry) =>
        !lockedIds.has(entry.id) &&
        entry.status !== "excluded" &&
        entry.preferenceMode === "omakase",
    ).length,
  );
  for (const entry of omakase) {
    if (!openAssignments.length) break;
    const eligibleIndexes = openAssignments
      .map((slot, index) => ({ slot, index }))
      .filter(
        ({ slot }) =>
          entry.peopleCount >= slot.minPeople &&
          entry.peopleCount <= slot.maxPeople,
      );
    if (!eligibleIndexes.length) continue;
    const selected = eligibleIndexes[randomIndex(eligibleIndexes.length)]!;
    const slot = openAssignments.splice(selected.index, 1)[0]!;
    assignments.set(entry.id, {
      instanceId: slot.instanceId,
      kind: slot.kind,
    });
  }
  return { assignments, slots };
};

const winnerCode = (usedCodes: Set<string> = new Set()): string => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    const values = new Uint8Array(6);
    crypto.getRandomValues(values);
    code = `MSK-${Array.from(values, (value) => alphabet[value % alphabet.length]).join("")}`;
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

export const submitLotteryEntry = async (
  input: SubmitLotteryInput,
): Promise<void> => {
  const parsed = submitLotterySchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.message ?? "入力内容を確認してください",
    );
  if (!isDemoMode) {
    await call("submitLotteryEntry", parsed.data);
    return;
  }

  const database = loadDemo();
  if (database.settings.state !== "accepting")
    throw new Error("現在は応募を受け付けていません");
  if (
    database.settings.applicationDeadline &&
    Date.now() >= new Date(database.settings.applicationDeadline).getTime()
  )
    throw new Error("応募締切時刻を過ぎています");
  const preferenceMode = parsed.data.preferenceMode ?? "specified";
  const requestedInstanceId = parsed.data.instanceId ?? "instance1";
  const slot = database.settings.recruitmentSlots.find(
    (candidate) =>
      candidate.instanceId === requestedInstanceId &&
      candidate.kind === parsed.data.kind,
  );
  if (preferenceMode === "omakase") {
    if (!database.settings.featureSettings.showOmakase)
      throw new Error("おまかせ応募は現在利用できません");
    if (parsed.data.companionVrcName)
      throw new Error("おまかせは1人応募の場合のみ選択できます");
  } else if (
    !slot ||
    !slot.enabled ||
    slot.capacity <= 0 ||
    !database.settings.instances.find(
      (instance) =>
        instance.id === slot.instanceId && instance.enabled && instance.visible,
    ) ||
    !database.settings.featureSettings.kindVisibility[slot.kind]
  )
    throw new Error("選択した募集枠は現在受け付けていません");
  const peopleCount = parsed.data.companionVrcName ? 2 : 1;
  if (
    preferenceMode === "specified" &&
    slot &&
    (peopleCount < slot.minPeople || peopleCount > slot.maxPeople)
  )
    throw new Error(
      `${slot.minPeople}〜${slot.maxPeople}人で応募できる募集枠です`,
    );
  if (
    preferenceMode === "specified" &&
    !database.settings.availableKinds.includes(parsed.data.kind)
  )
    throw new Error("この募集項目は現在受け付けていません");
  const existingId = database.tokenEntryMap[parsed.data.token];
  const existing = database.entries.find(
    (entry) =>
      entry.id === existingId && entry.roundId === database.settings.roundId,
  );
  const normalizedIds = [
    normalizeXIdForComparison(parsed.data.representativeId),
  ];
  const used = new Set(
    database.entries
      .filter(
        (entry) =>
          entry.roundId === database.settings.roundId && entry.id !== existingId,
      )
      .flatMap((entry) => entry.normalizedIds),
  );
  if (normalizedIds.some((id) => used.has(id)))
    throw new Error("このX IDはすでに応募されています");
  const id = existing?.id ?? `entry-${crypto.randomUUID()}`;
  const timestamp = nowIso();
  const entry: LotteryEntry = {
    id,
    roundId: database.settings.roundId,
    entryNumber: existing?.entryNumber ?? `MSK-${String(database.entries.filter((item) => item.roundId === database.settings.roundId).length + 1).padStart(4, "0")}`,
    kind: parsed.data.kind,
    representativeId: parsed.data.representativeId,
    representativeVrcName: parsed.data.representativeVrcName,
    companionVrcName: parsed.data.companionVrcName ?? null,
    normalizedIds,
    peopleCount,
    status: existing?.status ?? "pending",
    winnerCode: null,
    previousWinnerCode: null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    drawnAt: null,
    excludedAt: null,
    confirmedAt: null,
    preferenceMode,
    requestedInstanceId:
      preferenceMode === "specified" ? requestedInstanceId : null,
    assignedInstanceId: null,
    assignedKind: null,
    legacyAutoOmakase: false,
  };
  if (existing)
    database.entries = database.entries.map((item) =>
      item.id === existing.id ? entry : item,
    );
  else database.entries.push(entry);
  database.tokenEntryMap[parsed.data.token] = id;
  database.settings.lastUpdatedAt = timestamp;
  saveDemo(database);
};

export const getPublicLotterySnapshot = async (
  token: string,
): Promise<PublicLotterySnapshot> => {
  if (!isDemoMode) return call("getLotteryStatus", { token });
  const database = loadDemo();
  const entryId = database.tokenEntryMap[token];
  const entry = database.entries.find(
    (candidate) =>
      candidate.id === entryId &&
      candidate.roundId === database.settings.roundId,
  );
  const publicEntry = entry
    ? (({
        normalizedIds: _normalizedIds,
        previousWinnerCode: _previousCode,
        ...rest
      }) => ({
        ...rest,
        status:
          database.settings.state === "published"
            ? rest.status
            : ("pending" as const),
        winnerCode:
          database.settings.state === "published" ? rest.winnerCode : null,
      }))(entry)
    : null;
  return {
    settings: {
      roundId: database.settings.roundId,
      state: database.settings.state,
      availableKinds: database.settings.availableKinds,
      drawnKinds: database.settings.drawnKinds,
      lastUpdatedAt: database.settings.lastUpdatedAt,
      applicationDeadline: database.settings.applicationDeadline,
      instances: database.settings.instances,
      recruitmentSlots: database.settings.recruitmentSlots,
      featureSettings: database.settings.featureSettings,
    },
    entry: publicEntry,
  };
};

export const lookupWinnerCode = async (
  code: string,
): Promise<PublicLotterySnapshot> => {
  const normalized = code.trim().toUpperCase();
  if (!normalized) throw new Error("WINNER CODEを入力してください");
  if (!isDemoMode) return call("getWinnerByCode", { code: normalized });
  const database = loadDemo();
  if (database.settings.state !== "published")
    throw new Error("結果はまだ公開されていません");
  const entry = database.entries.find(
    (candidate) =>
      candidate.roundId === database.settings.roundId &&
      (candidate.winnerCode === normalized ||
        candidate.previousWinnerCode === normalized),
  );
  if (!entry) throw new Error("WINNER CODEが見つかりません");
  const { normalizedIds: _ids, previousWinnerCode: _previous, ...rest } = entry;
  return {
    settings: {
      roundId: database.settings.roundId,
      state: database.settings.state,
      availableKinds: database.settings.availableKinds,
      drawnKinds: database.settings.drawnKinds,
      lastUpdatedAt: database.settings.lastUpdatedAt,
      applicationDeadline: database.settings.applicationDeadline,
      instances: database.settings.instances,
      recruitmentSlots: database.settings.recruitmentSlots,
      featureSettings: database.settings.featureSettings,
    },
    entry: {
      ...rest,
      winnerCode: entry.status === "winner" ? entry.winnerCode : null,
    },
  };
};

export const cancelWinnerByCode = async (code: string): Promise<void> => {
  const normalized = code.trim().toUpperCase();
  if (!isDemoMode) {
    await call("cancelWinnerByCode", { code: normalized });
    return;
  }
  let database = loadDemo();
  if (database.settings.state !== "published")
    throw new Error("結果公開後のみ当選を取り消せます");
  const entry = database.entries.find(
    (candidate) =>
      candidate.roundId === database.settings.roundId &&
      candidate.status === "winner" &&
      candidate.winnerCode === normalized,
  );
  if (!entry) throw new Error("取り消しできる当選者が見つかりません");
  const timestamp = nowIso();
  database.entries = database.entries.map((candidate) =>
    candidate.id === entry.id
      ? {
          ...candidate,
          status: "cancelled",
          previousWinnerCode: candidate.winnerCode,
          winnerCode: null,
          updatedAt: timestamp,
        }
      : candidate,
  );
  database.settings.lastUpdatedAt = timestamp;
  database = withAudit(database, "当選取り消し", "all", entry.entryNumber);
  saveDemo(database);
};

export const confirmWinnerByCode = async (code: string): Promise<void> => {
  const normalized = code.trim().toUpperCase();
  if (!normalized) throw new Error("WINNER CODEがありません");
  if (!isDemoMode) {
    await call("confirmWinnerByCode", { code: normalized });
    return;
  }
  let database = loadDemo();
  if (database.settings.state !== "published")
    throw new Error("結果公開後のみ確認できます");
  const entry = database.entries.find(
    (candidate) =>
      candidate.roundId === database.settings.roundId &&
      candidate.status === "winner" &&
      candidate.winnerCode === normalized,
  );
  if (!entry) throw new Error("確認できる当選者が見つかりません");
  const timestamp = nowIso();
  database.entries = database.entries.map((candidate) =>
    candidate.id === entry.id
      ? { ...candidate, confirmedAt: timestamp, updatedAt: timestamp }
      : candidate,
  );
  database.settings.lastUpdatedAt = timestamp;
  database = withAudit(database, "当選コード確認", "all", entry.entryNumber);
  saveDemo(database);
};

export const cancelLotteryEntry = async (token: string): Promise<void> => {
  if (!isDemoMode) {
    await call("cancelLotteryEntry", { token });
    return;
  }
  let database = loadDemo();
  if (database.settings.state !== "accepting") {
    throw new Error("受付締切後は応募をキャンセルできません");
  }
  const entryId = database.tokenEntryMap[token];
  const entry = database.entries.find(
    (candidate) =>
      candidate.id === entryId &&
      candidate.roundId === database.settings.roundId,
  );
  if (!entry) throw new Error("キャンセルできる応募が見つかりません");
  database.entries = database.entries.filter(
    (candidate) => candidate.id !== entry.id,
  );
  delete database.tokenEntryMap[token];
  database.settings.lastUpdatedAt = nowIso();
  database = withAudit(
    database,
    "応募キャンセル",
    entry.kind,
    entry.entryNumber,
  );
  saveDemo(database);
};

export const loginAdmin = async (password: string): Promise<void> => {
  if (isDemoMode) {
    const expected = import.meta.env.VITE_DEMO_ADMIN_PASSWORD || "3331";
    if (password !== expected) throw new Error("パスワードが正しくありません");
    sessionStorage.setItem(ADMIN_KEY, "true");
    return;
  }
  if (isSharedApiMode) {
    const { sessionToken } = await call<
      { password: string },
      { sessionToken: string }
    >("adminLogin", { password });
    sessionStorage.setItem(SHARED_ADMIN_KEY, sessionToken);
    return;
  }
  if (!firebaseServices.auth)
    throw new Error("Firebase Authenticationが設定されていません");
  const { customToken } = await call<
    { password: string },
    { customToken: string }
  >("adminLogin", { password });
  await signInWithCustomToken(firebaseServices.auth, customToken);
};

export const logoutAdmin = async (): Promise<void> => {
  sessionStorage.removeItem(ADMIN_KEY);
  sessionStorage.removeItem(SHARED_ADMIN_KEY);
  if (firebaseServices.auth) await signOut(firebaseServices.auth);
};

export const isAdminSessionActive = (): boolean =>
  isDemoMode
    ? sessionStorage.getItem(ADMIN_KEY) === "true"
    : isSharedApiMode
      ? Boolean(sessionStorage.getItem(SHARED_ADMIN_KEY))
      : Boolean(firebaseServices.auth?.currentUser);

export const getAdminLotterySnapshot =
  async (): Promise<AdminLotterySnapshot> => {
    if (!isDemoMode) return call("getAdminLottery", {});
    if (!isAdminSessionActive()) throw new Error("管理者ログインが必要です");
    const database = loadDemo();
    return {
      settings: database.settings,
      entries: database.entries.filter(
        (entry) => entry.roundId === database.settings.roundId,
      ),
      audits: database.audits.slice(0, 100),
    };
  };

export const updateAvailableLotteryKinds = async (
  availableKinds: LotteryKind[],
): Promise<void> => {
  const allKinds: LotteryKind[] = ["counter", "private", "table"];
  const normalized = allKinds.filter((kind) => availableKinds.includes(kind));
  if (!normalized.length) throw new Error("募集項目を1つ以上選択してください");
  if (!isDemoMode) {
    await call("updateAvailableLotteryKinds", { availableKinds: normalized });
    return;
  }
  let database = loadDemo();
  if (database.settings.state !== "accepting")
    throw new Error("募集項目は応募受付中のみ変更できます");
  const timestamp = nowIso();
  database.settings.availableKinds = normalized;
  database.settings.lastUpdatedAt = timestamp;
  const labels: Record<LotteryKind, string> = {
    counter: "カウンター",
    private: "個室",
    table: "テーブル席",
  };
  database = withAudit(
    database,
    "募集項目更新",
    "all",
    `${normalized.map((kind) => labels[kind]).join("、")}を募集中に設定`,
  );
  saveDemo(database);
};

export const updateLotteryConfiguration = async (
  input: LotteryConfigurationInput,
): Promise<void> => {
  if (!isDemoMode) {
    await call("updateLotteryConfiguration", input);
    return;
  }
  let database = loadDemo();
  if (database.settings.state !== "accepting")
    throw new Error("設定は応募受付中のみ変更できます");
  const instanceIds = new Set(input.instances.map((instance) => instance.id));
  if (input.instances.length !== 3 || instanceIds.size !== 3)
    throw new Error("インスタンス設定を確認してください");
  for (const slot of input.recruitmentSlots) {
    if (!instanceIds.has(slot.instanceId))
      throw new Error("募集枠のインスタンスが不正です");
    if (!Number.isInteger(slot.capacity) || slot.capacity < 0)
      throw new Error("募集数は0以上の整数で入力してください");
    if (
      !Number.isInteger(slot.minPeople) ||
      !Number.isInteger(slot.maxPeople) ||
      slot.minPeople < 1 ||
      slot.maxPeople < slot.minPeople ||
      slot.maxPeople > 2
    )
      throw new Error("申し込み人数は1〜2人の範囲で設定してください");
  }
  database.settings.applicationDeadline = input.applicationDeadline;
  database.settings.instances = input.instances;
  database.settings.recruitmentSlots = input.recruitmentSlots;
  database.settings.featureSettings = input.featureSettings;
  database.settings.availableKinds = (["counter", "private", "table"] as LotteryKind[]).filter(
    (kind) =>
      input.featureSettings.kindVisibility[kind] &&
      input.recruitmentSlots.some(
        (slot) => slot.kind === kind && slot.enabled && slot.capacity > 0,
      ),
  );
  database.settings.lastUpdatedAt = nowIso();
  database = withAudit(
    database,
    "インスタンス・募集枠設定更新",
    "all",
    `${input.recruitmentSlots.filter((slot) => slot.enabled && slot.capacity > 0).length}枠を有効化`,
  );
  saveDemo(database);
};

export const adminUpdateLotteryEntry = async (
  entryId: string,
  input: Pick<SubmitLotteryInput, "kind" | "instanceId" | "preferenceMode">,
): Promise<void> => {
  if (!isDemoMode) {
    await call("adminUpdateLotteryEntry", { entryId, ...input });
    return;
  }
  let database = loadDemo();
  const entry = database.entries.find((item) => item.id === entryId);
  if (!entry) throw new Error("応募が見つかりません");
  const timestamp = nowIso();
  database.entries = database.entries.map((item) =>
    item.id === entryId
      ? {
          ...item,
          kind: input.kind,
          preferenceMode: input.preferenceMode ?? "specified",
          requestedInstanceId:
            input.preferenceMode === "omakase" ? null : input.instanceId ?? null,
          legacyAutoOmakase: false,
          updatedAt: timestamp,
        }
      : item,
  );
  database.settings.lastUpdatedAt = timestamp;
  database = withAudit(
    database,
    "応募条件管理者修正",
    entry.kind,
    `${entry.entryNumber}の応募条件を修正`,
  );
  saveDemo(database);
};

export const closeLottery = async (): Promise<void> => {
  if (!isDemoMode) {
    await call("closeLottery", {});
    return;
  }
  let database = loadDemo();
  if (database.settings.state !== "accepting")
    throw new Error("応募受付中の場合のみ締め切れます");
  const timestamp = nowIso();
  database.settings.state = "closed";
  database.settings.lastUpdatedAt = timestamp;
  database = withAudit(
    database,
    "応募受付締切",
    "all",
    "応募受付を締め切り",
  );
  saveDemo(database);
};

export const runLottery = async ({
  enabledKinds,
  winnerSlots,
}: LotteryDrawInput): Promise<void> => {
  if (!isDemoMode) {
    await call("runLottery", { enabledKinds, winnerSlots });
    return;
  }
  let database = loadDemo();
  if (database.settings.state !== "closed")
    throw new Error("応募受付を締め切ってから抽選してください");
  const current = database.entries.filter(
    (entry) => entry.roundId === database.settings.roundId,
  );
  const { assignments, slots } = allocateConfiguredWinners(
    current,
    database.settings,
  );
  database.settings.state = "drawing";
  saveDemo(database);
  const timestamp = nowIso();
  const winnerIds = new Set(assignments.keys());
  database = loadDemo();
  const issuedCodes = new Set<string>();
  database.entries = database.entries.map((entry) =>
    entry.roundId !== database.settings.roundId
      ? entry
      : {
          ...entry,
          status: winnerIds.has(entry.id) ? "winner" : "pending",
          winnerCode: winnerIds.has(entry.id) ? winnerCode(issuedCodes) : null,
          drawnAt: timestamp,
          confirmedAt: null,
          updatedAt: timestamp,
          assignedInstanceId: assignments.get(entry.id)?.instanceId ?? null,
          assignedKind: assignments.get(entry.id)?.kind ?? null,
        },
  );
  database.settings = {
    ...database.settings,
    state: "drawn",
    drawnKinds: [...new Set(slots.map((slot) => slot.kind))],
    counterWinnerSlots: slots.filter((slot) => slot.kind === "counter").reduce((sum, slot) => sum + slot.capacity, 0),
    privateWinnerSlots: slots.filter((slot) => slot.kind === "private").reduce((sum, slot) => sum + slot.capacity, 0),
    tableWinnerSlots: slots.filter((slot) => slot.kind === "table").reduce((sum, slot) => sum + slot.capacity, 0),
    vacantCounterSlots: 0,
    vacantPrivateSlots: 0,
    vacantTableSlots: 0,
    publishedAt: null,
    lastUpdatedAt: timestamp,
  };
  const labels: Record<LotteryKind, string> = {
    counter: "カウンター",
    private: "個室",
    table: "テーブル席",
  };
  database = withAudit(
    database,
    "抽選実行",
    "all",
    slots
      .map((slot) => `${slot.instanceId}/${labels[slot.kind]}${slot.capacity}組`)
      .join("、") + "を抽選",
  );
  saveDemo(database);
};

export const redrawLottery = async (
  lockedEntryIds: string[] = [],
): Promise<void> => {
  const persistedLocks =
    !lockedEntryIds.length && typeof window !== "undefined"
      ? (() => {
          try {
            return JSON.parse(
              sessionStorage.getItem("bar-misaki-redraw-locks") || "[]",
            ) as string[];
          } catch {
            return [];
          }
        })()
      : [];
  const locks = lockedEntryIds.length ? lockedEntryIds : persistedLocks;
  if (!isDemoMode) {
    await call("redrawLottery", { lockedEntryIds: locks });
    return;
  }
  let database = loadDemo();
  if (database.settings.state !== "drawn")
    throw new Error("抽選済みの結果がある場合のみ再抽選できます");
  const current = database.entries.filter(
    (entry) => entry.roundId === database.settings.roundId,
  );
  const locked = current.filter(
    (entry) => locks.includes(entry.id) && entry.status === "winner",
  );
  const { assignments } = allocateConfiguredWinners(
    current,
    database.settings,
    new Set(locks),
  );
  const winnerIds = new Set(assignments.keys());
  const issuedCodes = new Set<string>(
    locked
      .map((entry) => entry.winnerCode)
      .filter((code): code is string => Boolean(code)),
  );
  const timestamp = nowIso();
  database.entries = database.entries.map((entry) =>
    entry.roundId !== database.settings.roundId || entry.status === "excluded"
      ? entry
      : {
          ...entry,
          status: winnerIds.has(entry.id) ? "winner" : "pending",
          winnerCode: locks.includes(entry.id)
            ? entry.winnerCode
            : winnerIds.has(entry.id)
              ? winnerCode(issuedCodes)
              : null,
          previousWinnerCode: null,
          confirmedAt: null,
          drawnAt: timestamp,
          updatedAt: timestamp,
          assignedInstanceId:
            assignments.get(entry.id)?.instanceId ?? entry.assignedInstanceId,
          assignedKind:
            assignments.get(entry.id)?.kind ?? entry.assignedKind,
        },
  );
  database.settings.vacantCounterSlots = 0;
  database.settings.vacantPrivateSlots = 0;
  database.settings.vacantTableSlots = 0;
  database.settings.publishedAt = null;
  database.settings.lastUpdatedAt = timestamp;
  database = withAudit(
    database,
    "抽選やり直し",
    "all",
    `当選確定${locked.length}組・残りを再抽選`,
  );
  saveDemo(database);
};

export const excludeWinners = async (entryIds: string[]): Promise<void> => {
  if (!isDemoMode)
    return void (await call("excludeLotteryWinners", { entryIds }));
  let database = loadDemo();
  const selected = database.entries.filter(
    (entry) => entryIds.includes(entry.id) && entry.status === "winner",
  );
  if (!selected.length) throw new Error("除外する当選組を選択してください");
  const timestamp = nowIso();
  database.entries = database.entries.map((entry) =>
    entryIds.includes(entry.id) && entry.status === "winner"
      ? {
          ...entry,
          status: "excluded",
          previousWinnerCode: entry.winnerCode,
          winnerCode: null,
          excludedAt: timestamp,
          updatedAt: timestamp,
        }
      : entry,
  );
  for (const entry of selected) {
    if (!entry.assignedInstanceId || !entry.assignedKind) continue;
    const slotId = `${entry.assignedInstanceId}:${entry.assignedKind}`;
    database.settings.vacantSlotCounts[slotId] =
      (database.settings.vacantSlotCounts[slotId] ?? 0) + 1;
  }
  database.settings.vacantCounterSlots += selected.filter(
    (entry) => entry.kind === "counter",
  ).length;
  database.settings.vacantPrivateSlots += selected.filter(
    (entry) => entry.kind === "private",
  ).length;
  database.settings.vacantTableSlots += selected.filter(
    (entry) => entry.kind === "table",
  ).length;
  database.settings.state = "drawn";
  database.settings.publishedAt = null;
  database.settings.lastUpdatedAt = timestamp;
  database = withAudit(
    database,
    "当選者除外",
    "all",
    selected.map((entry) => entry.entryNumber).join(", "),
  );
  saveDemo(database);
};

export const undoExclusions = async (entryIds: string[]): Promise<void> => {
  if (!isDemoMode)
    return void (await call("undoLotteryExclusions", { entryIds }));
  let database = loadDemo();
  if (database.settings.state === "published")
    throw new Error("公開後は除外を取り消せません");
  const selected = database.entries.filter(
    (entry) => entryIds.includes(entry.id) && entry.status === "excluded",
  );
  database.entries = database.entries.map((entry) =>
    entryIds.includes(entry.id) && entry.status === "excluded"
      ? {
          ...entry,
          status: "winner",
          winnerCode: entry.previousWinnerCode || winnerCode(),
          previousWinnerCode: null,
          excludedAt: null,
          updatedAt: nowIso(),
        }
      : entry,
  );
  for (const entry of selected) {
    if (!entry.assignedInstanceId || !entry.assignedKind) continue;
    const slotId = `${entry.assignedInstanceId}:${entry.assignedKind}`;
    database.settings.vacantSlotCounts[slotId] = Math.max(
      0,
      (database.settings.vacantSlotCounts[slotId] ?? 0) - 1,
    );
  }
  database.settings.vacantCounterSlots = Math.max(
    0,
    database.settings.vacantCounterSlots -
      selected.filter((entry) => entry.kind === "counter").length,
  );
  database.settings.vacantPrivateSlots = Math.max(
    0,
    database.settings.vacantPrivateSlots -
      selected.filter((entry) => entry.kind === "private").length,
  );
  database.settings.vacantTableSlots = Math.max(
    0,
    database.settings.vacantTableSlots -
      selected.filter((entry) => entry.kind === "table").length,
  );
  database.settings.lastUpdatedAt = nowIso();
  database = withAudit(
    database,
    "除外取消",
    "all",
    selected.map((entry) => entry.entryNumber).join(", "),
  );
  saveDemo(database);
};

export const redrawVacancies = async (): Promise<void> => {
  if (!isDemoMode) return void (await call("redrawLotteryVacancies", {}));
  let database = loadDemo();
  const current = database.entries.filter(
    (entry) => entry.roundId === database.settings.roundId,
  );
  const replacements: LotteryEntry[] = [];
  const assigned = new Map<string, { instanceId: InstanceId; kind: LotteryKind }>();
  for (const [slotId, requested] of Object.entries(database.settings.vacantSlotCounts)) {
    const slot = database.settings.recruitmentSlots.find((item) => item.id === slotId);
    if (!slot || requested <= 0) continue;
    const candidates = current.filter(
      (entry) =>
        entry.status === "pending" &&
        !replacements.some((item) => item.id === entry.id) &&
        entry.peopleCount >= slot.minPeople &&
        entry.peopleCount <= slot.maxPeople &&
        (entry.preferenceMode === "omakase" ||
          (entry.requestedInstanceId === slot.instanceId && entry.kind === slot.kind)),
    );
    for (const entry of choose(candidates, Math.min(requested, candidates.length))) {
      replacements.push(entry);
      assigned.set(entry.id, { instanceId: slot.instanceId, kind: slot.kind });
    }
  }
  if (!Object.keys(database.settings.vacantSlotCounts).length) {
    const selectFor = (kind: LotteryKind, requested: number) =>
      choose(
        current.filter((entry) => entry.kind === kind && entry.status === "pending"),
        requested,
      );
    replacements.push(
      ...selectFor("counter", database.settings.vacantCounterSlots),
      ...selectFor("private", database.settings.vacantPrivateSlots),
      ...selectFor("table", database.settings.vacantTableSlots),
    );
  }
  if (!replacements.length) throw new Error("再抽選できる候補者がいません");
  const ids = new Set(replacements.map((entry) => entry.id));
  const issuedCodes = new Set(
    current
      .map((entry) => entry.winnerCode)
      .filter((code): code is string => Boolean(code)),
  );
  const timestamp = nowIso();
  database.entries = database.entries.map((entry) =>
    ids.has(entry.id)
      ? {
          ...entry,
          status: "winner",
          winnerCode: winnerCode(issuedCodes),
          drawnAt: timestamp,
          updatedAt: timestamp,
          assignedInstanceId: assigned.get(entry.id)?.instanceId ?? entry.assignedInstanceId,
          assignedKind: assigned.get(entry.id)?.kind ?? entry.assignedKind,
        }
      : entry,
  );
  database.settings.vacantCounterSlots = Math.max(
    0,
    database.settings.vacantCounterSlots -
      replacements.filter((entry) => entry.kind === "counter").length,
  );
  database.settings.vacantPrivateSlots = Math.max(
    0,
    database.settings.vacantPrivateSlots -
      replacements.filter((entry) => entry.kind === "private").length,
  );
  database.settings.vacantTableSlots = Math.max(
    0,
    database.settings.vacantTableSlots -
      replacements.filter((entry) => entry.kind === "table").length,
  );
  database.settings.vacantSlotCounts = {};
  database.settings.state = "drawn";
  database.settings.lastUpdatedAt = timestamp;
  database = withAudit(
    database,
    "空き枠再抽選",
    "all",
    `${replacements.length}組を再抽選`,
  );
  saveDemo(database);
};

export const publishLotteryResults = async (): Promise<void> => {
  if (!isDemoMode) return void (await call("publishLotteryResults", {}));
  let database = loadDemo();
  if (database.settings.state !== "drawn")
    throw new Error("抽選済みの結果がありません");
  if (
    database.settings.vacantCounterSlots ||
    database.settings.vacantPrivateSlots ||
    database.settings.vacantTableSlots
  )
    throw new Error("空き枠の再抽選を完了してください");
  const timestamp = nowIso();
  database.entries = database.entries.map((entry) =>
    entry.roundId === database.settings.roundId &&
    entry.status === "pending" &&
    entry.drawnAt
      ? { ...entry, status: "loser", updatedAt: timestamp }
      : entry,
  );
  database.settings.state = "published";
  database.settings.publishedAt = timestamp;
  database.settings.lastUpdatedAt = timestamp;
  database = withAudit(database, "結果公開", "all", "抽選結果を公開");
  saveDemo(database);
};

export const resetLottery = async (confirmation: string): Promise<void> => {
  if (confirmation !== "リセット")
    throw new Error("確認欄に「リセット」と入力してください");
  if (!isDemoMode) return void (await call("resetLottery", { confirmation }));
  const database = loadDemo();
  const next = initialDatabase();
  next.settings.availableKinds = [...database.settings.availableKinds];
  next.settings.applicationDeadline = database.settings.applicationDeadline;
  next.settings.instances = database.settings.instances;
  next.settings.recruitmentSlots = database.settings.recruitmentSlots;
  next.settings.featureSettings = database.settings.featureSettings;
  next.audits = withAudit(
    database,
    "抽選リセット",
    "all",
    `ラウンド ${database.settings.roundId} をリセット`,
  ).audits;
  saveDemo(next);
};
