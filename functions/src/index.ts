import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';

import type { AdminLotterySnapshot, LotteryAuditLog, LotteryEntry, LotteryKind, LotterySettings, PublicLotterySnapshot } from '../../shared/models';
import { normalizeXIdForComparison, submitLotterySchema, validateWinnerSlots } from '../../shared/validation';

initializeApp();
setGlobalOptions({ region: 'asia-northeast1', maxInstances: 10 });

const db = getFirestore();
const auth = getAuth();
const ADMIN_SHARED_PASSWORD = defineSecret('ADMIN_SHARED_PASSWORD');
const RUNTIME = db.collection('lotteryRuntime').doc('current');
const entries = db.collection('lotteryEntries');
const identifiers = db.collection('lotteryIdentifiers');
const tokens = db.collection('lotteryTokens');
const audits = db.collection('lotteryAuditLogs');
const nowIso = () => new Date().toISOString();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const defaultSettings = (): LotterySettings => ({ roundId: `round-${crypto.randomUUID()}`, state: 'accepting', drawnKinds: [], counterWinnerSlots: 0, privateWinnerSlots: 0, tableWinnerSlots: 0, vacantCounterSlots: 0, vacantPrivateSlots: 0, vacantTableSlots: 0, publishedAt: null, lastUpdatedAt: nowIso() });

const ensureRuntime = async (): Promise<LotterySettings> => {
  const snapshot = await RUNTIME.get();
  if (snapshot.exists) {
    const stored = snapshot.data() as LotterySettings;
    const settings = { ...stored, drawnKinds: stored.drawnKinds ?? ['counter', 'private'], tableWinnerSlots: stored.tableWinnerSlots ?? 0, vacantTableSlots: stored.vacantTableSlots ?? 0 };
    if (stored.drawnKinds === undefined || stored.tableWinnerSlots === undefined || stored.vacantTableSlots === undefined) await RUNTIME.update(settings);
    return settings;
  }
  const settings = defaultSettings();
  await RUNTIME.create(settings);
  return settings;
};

const assertAdmin = (request: CallableRequest<unknown>) => {
  if (request.auth?.token['admin'] !== true) throw new HttpsError('permission-denied', '管理者のみ利用できます');
  return request.auth.uid;
};

const writeAudit = async (actor: string, action: string, target: LotteryAuditLog['target'], details: string) => {
  await audits.add({ actor, action, target, details, createdAt: nowIso() });
};

const secureEquals = (received: string, expected: string) => {
  const left = createHash('sha256').update(received).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
};

const choose = <T,>(items: T[], count: number): T[] => {
  const pool = [...items];
  const selected: T[] = [];
  while (selected.length < count && pool.length) selected.push(pool.splice(randomInt(pool.length), 1)[0]!);
  return selected;
};

const winnerCode = (usedCodes: Set<string> = new Set()) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = `MSK-${Array.from(randomBytes(6), (value) => alphabet[value % alphabet.length]).join('')}`;
  } while (usedCodes.has(code));
  usedCodes.add(code);
  return code;
};

export const adminLogin = onCall({ secrets: [ADMIN_SHARED_PASSWORD] }, async (request) => {
  const password = String(request.data?.password ?? '');
  if (!secureEquals(password, ADMIN_SHARED_PASSWORD.value())) {
    await writeAudit('anonymous', 'ログイン失敗', 'auth', '管理パスワードの照合に失敗');
    throw new HttpsError('permission-denied', '認証に失敗しました');
  }
  const uid = 'bar-misaki-lottery-admin';
  await writeAudit(uid, 'ログイン成功', 'auth', '管理者ログイン');
  return { customToken: await auth.createCustomToken(uid, { admin: true }) };
});

export const submitLotteryEntry = onCall(async (request) => {
  const parsed = submitLotterySchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? '入力内容を確認してください');
  const input = parsed.data;
  const normalizedIds = [normalizeXIdForComparison(input.representativeId)];
  const tokenHash = hash(input.token);
  const entryRef = entries.doc();
  const timestamp = nowIso();

  await db.runTransaction(async (transaction) => {
    const runtimeSnapshot = await transaction.get(RUNTIME);
    const settings = runtimeSnapshot.exists ? runtimeSnapshot.data() as LotterySettings : defaultSettings();
    if (settings.state !== 'accepting') throw new HttpsError('failed-precondition', '現在は応募を受け付けていません');
    const tokenRef = tokens.doc(`${settings.roundId}_${tokenHash}`);
    const markerRefs = normalizedIds.map((id) => identifiers.doc(`${settings.roundId}_${hash(id)}`));
    const [tokenSnapshot, ...markerSnapshots] = await Promise.all([transaction.get(tokenRef), ...markerRefs.map((ref) => transaction.get(ref))]);
    if (tokenSnapshot.exists) throw new HttpsError('already-exists', 'この端末からはすでに応募済みです');
    if (markerSnapshots.some((snapshot) => snapshot.exists)) throw new HttpsError('already-exists', 'このX IDはすでに応募されています');
    const countQuery = entries.where('roundId', '==', settings.roundId);
    const countSnapshot = await transaction.get(countQuery);
    const entry: LotteryEntry = { id: entryRef.id, roundId: settings.roundId, entryNumber: `MSK-${String(countSnapshot.size + 1).padStart(4, '0')}`, kind: input.kind, representativeId: input.representativeId, representativeVrcName: input.representativeVrcName, companionVrcName: input.companionVrcName ?? null, normalizedIds, peopleCount: input.companionVrcName ? 2 : 1, status: 'pending', winnerCode: null, previousWinnerCode: null, createdAt: timestamp, updatedAt: timestamp, drawnAt: null, excludedAt: null };
    transaction.set(entryRef, entry);
    transaction.set(tokenRef, { roundId: settings.roundId, entryId: entryRef.id, createdAt: timestamp });
    markerRefs.forEach((ref, index) => transaction.set(ref, { roundId: settings.roundId, entryId: entryRef.id, normalizedId: normalizedIds[index], createdAt: timestamp }));
    transaction.set(RUNTIME, { ...settings, lastUpdatedAt: timestamp });
  });
  return { ok: true };
});

export const cancelLotteryEntry = onCall(async (request) => {
  const token = String(request.data?.token ?? '');
  if (token.length < 32) throw new HttpsError('invalid-argument', '端末トークンが不正です');
  let cancelledEntry: LotteryEntry | null = null;

  await db.runTransaction(async (transaction) => {
    const runtimeSnapshot = await transaction.get(RUNTIME);
    const settings = runtimeSnapshot.exists ? runtimeSnapshot.data() as LotterySettings : defaultSettings();
    if (settings.state !== 'accepting') {
      throw new HttpsError('failed-precondition', '抽選開始後は応募をキャンセルできません');
    }
    const tokenRef = tokens.doc(`${settings.roundId}_${hash(token)}`);
    const tokenSnapshot = await transaction.get(tokenRef);
    if (!tokenSnapshot.exists) throw new HttpsError('not-found', 'キャンセルできる応募が見つかりません');
    const entryRef = entries.doc(String(tokenSnapshot.data()?.entryId));
    const entrySnapshot = await transaction.get(entryRef);
    const entry = entrySnapshot.data() as LotteryEntry | undefined;
    if (!entry || entry.roundId !== settings.roundId) {
      throw new HttpsError('not-found', 'キャンセルできる応募が見つかりません');
    }
    cancelledEntry = entry;
    entry.normalizedIds.forEach((id) => transaction.delete(identifiers.doc(`${settings.roundId}_${hash(id)}`)));
    transaction.delete(entryRef);
    transaction.delete(tokenRef);
    transaction.update(RUNTIME, { lastUpdatedAt: nowIso() });
  });

  if (cancelledEntry) {
    await writeAudit('customer', '応募キャンセル', cancelledEntry.kind, cancelledEntry.entryNumber);
  }
  return { ok: true };
});

export const getLotteryStatus = onCall(async (request): Promise<PublicLotterySnapshot> => {
  const token = String(request.data?.token ?? '');
  if (token.length < 32) throw new HttpsError('invalid-argument', '端末トークンが不正です');
  const settings = await ensureRuntime();
  const tokenSnapshot = await tokens.doc(`${settings.roundId}_${hash(token)}`).get();
  let entry: PublicLotterySnapshot['entry'] = null;
  if (tokenSnapshot.exists && tokenSnapshot.data()?.roundId === settings.roundId) {
    const entrySnapshot = await entries.doc(String(tokenSnapshot.data()?.entryId)).get();
    if (entrySnapshot.exists) {
      const { normalizedIds: _normalizedIds, previousWinnerCode: _previousCode, ...publicEntry } = entrySnapshot.data() as LotteryEntry;
      entry = {
        ...publicEntry,
        status: settings.state === 'published' ? publicEntry.status : 'pending',
        winnerCode: settings.state === 'published' ? publicEntry.winnerCode : null,
      };
    }
  }
  return { settings: { roundId: settings.roundId, state: settings.state, drawnKinds: settings.drawnKinds, lastUpdatedAt: settings.lastUpdatedAt }, entry };
});

export const getAdminLottery = onCall(async (request): Promise<AdminLotterySnapshot> => {
  assertAdmin(request);
  const settings = await ensureRuntime();
  const [entrySnapshots, auditSnapshots] = await Promise.all([entries.where('roundId', '==', settings.roundId).orderBy('createdAt', 'desc').get(), audits.orderBy('createdAt', 'desc').limit(100).get()]);
  return { settings, entries: entrySnapshots.docs.map((doc) => doc.data() as LotteryEntry), audits: auditSnapshots.docs.map((doc) => ({ id: doc.id, ...doc.data() } as LotteryAuditLog)) };
});

export const runLottery = onCall(async (request) => {
  const actor = assertAdmin(request);
  const allKinds: LotteryKind[] = ['counter', 'private', 'table'];
  const requestedKinds = Array.isArray(request.data?.enabledKinds) ? request.data.enabledKinds.map(String) : [];
  const enabledKinds = allKinds.filter((kind) => requestedKinds.includes(kind));
  if (!enabledKinds.length) throw new HttpsError('invalid-argument', '抽選対象を1つ以上選択してください');
  const requestedSlots = request.data?.winnerSlots ?? {};
  const winnerSlots = Object.fromEntries(allKinds.map((kind) => [kind, enabledKinds.includes(kind) ? Number(requestedSlots[kind] ?? 0) : 0])) as Record<LotteryKind, number>;
  const settings = await ensureRuntime();
  const entrySnapshots = await entries.where('roundId', '==', settings.roundId).get();
  const current = entrySnapshots.docs.map((doc) => doc.data() as LotteryEntry);
  const entriesByKind = Object.fromEntries(allKinds.map((kind) => [kind, current.filter((entry) => entry.kind === kind)])) as Record<LotteryKind, LotteryEntry[]>;
  const error = allKinds.map((kind) => validateWinnerSlots(kind, winnerSlots[kind], entriesByKind[kind].length)).find(Boolean);
  if (error) throw new HttpsError('invalid-argument', error);
  await db.runTransaction(async (transaction) => {
    const fresh = await transaction.get(RUNTIME);
    const state = (fresh.data() as LotterySettings | undefined)?.state;
    if (state !== 'accepting' && state !== 'closed') throw new HttpsError('failed-precondition', '現在の状態では抽選できません');
    transaction.update(RUNTIME, { state: 'drawing', lastUpdatedAt: nowIso() });
  });
  try {
    const winners = new Set(allKinds.flatMap((kind) => choose(entriesByKind[kind], winnerSlots[kind])).map((entry) => entry.id));
    const timestamp = nowIso();
    const batch = db.batch();
    const issuedCodes = new Set<string>();
    current.forEach((entry) => batch.update(entries.doc(entry.id), { status: winners.has(entry.id) ? 'winner' : 'pending', winnerCode: winners.has(entry.id) ? winnerCode(issuedCodes) : null, previousWinnerCode: null, drawnAt: timestamp, excludedAt: null, updatedAt: timestamp }));
    batch.update(RUNTIME, { state: 'drawn', drawnKinds: enabledKinds, counterWinnerSlots: winnerSlots.counter, privateWinnerSlots: winnerSlots.private, tableWinnerSlots: winnerSlots.table, vacantCounterSlots: 0, vacantPrivateSlots: 0, vacantTableSlots: 0, publishedAt: null, lastUpdatedAt: timestamp });
    await batch.commit();
    const labels: Record<LotteryKind, string> = { counter: 'カウンター', private: '個室', table: 'テーブル席' };
    await writeAudit(actor, '抽選実行', 'all', enabledKinds.map((kind) => `${labels[kind]}${winnerSlots[kind]}組`).join('、') + 'を抽選');
  } catch (error) {
    await RUNTIME.update({ state: 'accepting', lastUpdatedAt: nowIso() });
    throw error;
  }
  return { ok: true };
});

export const excludeLotteryWinners = onCall(async (request) => {
  const actor = assertAdmin(request);
  const entryIds = Array.isArray(request.data?.entryIds) ? request.data.entryIds.map(String).slice(0, 100) : [];
  if (!entryIds.length) throw new HttpsError('invalid-argument', '除外する当選者を選択してください');
  await db.runTransaction(async (transaction) => {
    const [runtimeSnapshot, ...entrySnapshots] = await Promise.all([transaction.get(RUNTIME), ...entryIds.map((id) => transaction.get(entries.doc(id)))]);
    const settings = runtimeSnapshot.data() as LotterySettings;
    const selected = entrySnapshots.map((snapshot) => snapshot.data() as LotteryEntry).filter((entry) => entry?.roundId === settings.roundId && entry.status === 'winner');
    if (!selected.length) throw new HttpsError('failed-precondition', '除外可能な当選者がいません');
    const timestamp = nowIso();
    selected.forEach((entry) => transaction.update(entries.doc(entry.id), { status: 'excluded', previousWinnerCode: entry.winnerCode, winnerCode: null, excludedAt: timestamp, updatedAt: timestamp }));
    transaction.update(RUNTIME, { vacantCounterSlots: settings.vacantCounterSlots + selected.filter((entry) => entry.kind === 'counter').length, vacantPrivateSlots: settings.vacantPrivateSlots + selected.filter((entry) => entry.kind === 'private').length, vacantTableSlots: settings.vacantTableSlots + selected.filter((entry) => entry.kind === 'table').length, state: 'drawn', publishedAt: null, lastUpdatedAt: timestamp });
  });
  await writeAudit(actor, '当選者除外', 'all', entryIds.join(', '));
  return { ok: true };
});

export const undoLotteryExclusions = onCall(async (request) => {
  const actor = assertAdmin(request);
  const entryIds = Array.isArray(request.data?.entryIds) ? request.data.entryIds.map(String).slice(0, 100) : [];
  await db.runTransaction(async (transaction) => {
    const [runtimeSnapshot, ...entrySnapshots] = await Promise.all([transaction.get(RUNTIME), ...entryIds.map((id) => transaction.get(entries.doc(id)))]);
    const settings = runtimeSnapshot.data() as LotterySettings;
    if (settings.state === 'published') throw new HttpsError('failed-precondition', '公開後は除外を取り消せません');
    const selected = entrySnapshots.map((snapshot) => snapshot.data() as LotteryEntry).filter((entry) => entry?.roundId === settings.roundId && entry.status === 'excluded');
    selected.forEach((entry) => transaction.update(entries.doc(entry.id), { status: 'winner', winnerCode: entry.previousWinnerCode || winnerCode(), previousWinnerCode: null, excludedAt: null, updatedAt: nowIso() }));
    transaction.update(RUNTIME, { vacantCounterSlots: Math.max(0, settings.vacantCounterSlots - selected.filter((entry) => entry.kind === 'counter').length), vacantPrivateSlots: Math.max(0, settings.vacantPrivateSlots - selected.filter((entry) => entry.kind === 'private').length), vacantTableSlots: Math.max(0, settings.vacantTableSlots - selected.filter((entry) => entry.kind === 'table').length), lastUpdatedAt: nowIso() });
  });
  await writeAudit(actor, '除外取消', 'all', entryIds.join(', '));
  return { ok: true };
});

export const redrawLotteryVacancies = onCall(async (request) => {
  const actor = assertAdmin(request);
  const settings = await ensureRuntime();
  if (settings.state !== 'drawn') throw new HttpsError('failed-precondition', '再抽選できる状態ではありません');
  const snapshots = await entries.where('roundId', '==', settings.roundId).get();
  const current = snapshots.docs.map((doc) => doc.data() as LotteryEntry);
  const replacements = [
    ...choose(current.filter((entry) => entry.kind === 'counter' && entry.status === 'pending'), settings.vacantCounterSlots),
    ...choose(current.filter((entry) => entry.kind === 'private' && entry.status === 'pending'), settings.vacantPrivateSlots),
    ...choose(current.filter((entry) => entry.kind === 'table' && entry.status === 'pending'), settings.vacantTableSlots),
  ];
  if (!replacements.length) throw new HttpsError('failed-precondition', '再抽選できる候補者がいません');
  const issuedCodes = new Set(current.map((entry) => entry.winnerCode).filter((code): code is string => Boolean(code)));
  const timestamp = nowIso();
  const batch = db.batch();
  replacements.forEach((entry) => batch.update(entries.doc(entry.id), { status: 'winner', winnerCode: winnerCode(issuedCodes), drawnAt: timestamp, updatedAt: timestamp }));
  batch.update(RUNTIME, { vacantCounterSlots: Math.max(0, settings.vacantCounterSlots - replacements.filter((entry) => entry.kind === 'counter').length), vacantPrivateSlots: Math.max(0, settings.vacantPrivateSlots - replacements.filter((entry) => entry.kind === 'private').length), vacantTableSlots: Math.max(0, settings.vacantTableSlots - replacements.filter((entry) => entry.kind === 'table').length), state: 'drawn', publishedAt: null, lastUpdatedAt: timestamp });
  await batch.commit();
  await writeAudit(actor, '空き枠再抽選', 'all', `${replacements.length}組を再抽選`);
  return { ok: true };
});

export const publishLotteryResults = onCall(async (request) => {
  const actor = assertAdmin(request);
  const settings = await ensureRuntime();
  if (settings.state !== 'drawn') throw new HttpsError('failed-precondition', '公開できる抽選結果がありません');
  if (settings.vacantCounterSlots || settings.vacantPrivateSlots || settings.vacantTableSlots) throw new HttpsError('failed-precondition', '空き枠の再抽選を完了してください');
  const pending = await entries.where('roundId', '==', settings.roundId).where('status', '==', 'pending').get();
  const timestamp = nowIso();
  const batch = db.batch();
  pending.docs.forEach((doc) => { const entry = doc.data() as LotteryEntry; if (settings.drawnKinds.includes(entry.kind)) batch.update(doc.ref, { status: 'loser', updatedAt: timestamp }); });
  batch.update(RUNTIME, { state: 'published', publishedAt: timestamp, lastUpdatedAt: timestamp });
  await batch.commit();
  await writeAudit(actor, '結果公開', 'all', `公開日時 ${timestamp}`);
  return { ok: true };
});

export const resetLottery = onCall(async (request) => {
  const actor = assertAdmin(request);
  if (request.data?.confirmation !== 'リセット') throw new HttpsError('invalid-argument', '確認欄に「リセット」と入力してください');
  const previous = await ensureRuntime();
  await RUNTIME.set(defaultSettings());
  await writeAudit(actor, '抽選リセット', 'all', `ラウンド ${previous.roundId} を無効化`);
  return { ok: true };
});
