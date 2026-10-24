import { describe, expect, it } from 'vitest';

import type { LotteryEntry, LotterySettings, RecruitmentSlot } from '../../shared/models';
import { getDrawReadiness, getNextAction, getUsableSlots } from '../lib/admin-operations';

const slot = (overrides: Partial<RecruitmentSlot>): RecruitmentSlot => ({
  id: 'instance1:counter',
  instanceId: 'instance1',
  kind: 'counter',
  capacity: 1,
  minPeople: 1,
  maxPeople: 2,
  enabled: true,
  ...overrides,
});

const makeSettings = (overrides: Partial<LotterySettings> = {}): LotterySettings => ({
  roundId: 'round-test',
  state: 'accepting',
  availableKinds: ['counter'],
  drawnKinds: [],
  counterWinnerSlots: 0,
  privateWinnerSlots: 0,
  tableWinnerSlots: 0,
  vacantCounterSlots: 0,
  vacantPrivateSlots: 0,
  vacantTableSlots: 0,
  publishedAt: null,
  lastUpdatedAt: '2026-10-24T00:00:00.000Z',
  applicationDeadline: null,
  instances: [
    { id: 'instance1', label: 'インスタンス1', visible: true, enabled: true },
    { id: 'instance2', label: 'インスタンス2', visible: false, enabled: false },
    { id: 'instance3', label: 'インスタンス3', visible: false, enabled: false },
  ],
  recruitmentSlots: [slot({})],
  featureSettings: {
    showInstanceSelection: true,
    showKindSelection: true,
    showOmakase: true,
    kindVisibility: { counter: true, private: true, table: true },
  },
  vacantSlotCounts: {},
  ...overrides,
});

const entry = (overrides: Partial<LotteryEntry>): LotteryEntry => ({
  id: 'entry-1',
  roundId: 'round-test',
  entryNumber: 'MSK-0001',
  kind: 'counter',
  representativeId: '@a',
  representativeVrcName: 'A',
  companionVrcName: null,
  normalizedIds: ['a'],
  peopleCount: 1,
  status: 'pending',
  winnerCode: null,
  previousWinnerCode: null,
  createdAt: '2026-10-24T00:00:00.000Z',
  updatedAt: '2026-10-24T00:00:00.000Z',
  drawnAt: null,
  excludedAt: null,
  confirmedAt: null,
  preferenceMode: 'specified',
  requestedInstanceId: 'instance1',
  assignedInstanceId: null,
  assignedKind: null,
  legacyAutoOmakase: false,
  ...overrides,
});

describe('admin operations', () => {
  it('excludes slots whose instance or kind is hidden from the draw', () => {
    const settings = makeSettings({
      recruitmentSlots: [slot({}), slot({ id: 'instance2:table', instanceId: 'instance2', kind: 'table' })],
    });
    expect(getUsableSlots(settings).map((item) => item.id)).toEqual(['instance1:counter']);
  });

  it('blocks the draw until applications are closed', () => {
    const readiness = getDrawReadiness(makeSettings({ state: 'accepting' }), []);
    expect(readiness.blockers).toContain('先に応募受付を締め切ってください');
  });

  it('blocks the draw when no slot is usable', () => {
    const readiness = getDrawReadiness(makeSettings({ state: 'closed', recruitmentSlots: [slot({ enabled: false })] }), []);
    expect(readiness.blockers.some((item) => item.includes('有効な募集枠がありません'))).toBe(true);
    expect(readiness.maxWinners).toBe(0);
  });

  it('allows the draw when closed with a usable slot and reports the maximum winners', () => {
    const readiness = getDrawReadiness(makeSettings({ state: 'closed', recruitmentSlots: [slot({ capacity: 3 })] }), [entry({})]);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.maxWinners).toBe(3);
  });

  it('warns about specified applications that match no usable slot', () => {
    const readiness = getDrawReadiness(
      makeSettings({ state: 'closed' }),
      [entry({ kind: 'table', requestedInstanceId: 'instance1' }), entry({ id: 'entry-2', preferenceMode: 'omakase', requestedInstanceId: null })],
    );
    expect(readiness.blockers).toEqual([]);
    expect(readiness.warnings.some((item) => item.includes('1組は'))).toBe(true);
  });

  it('asks the admin to set up slots while accepting with none usable', () => {
    const action = getNextAction(makeSettings({ recruitmentSlots: [] }), []);
    expect(action.tab).toBe('recruitment');
    expect(action.tone).toBe('warning');
  });

  it('suggests closing while accepting with slots', () => {
    const action = getNextAction(makeSettings({ state: 'accepting' }), []);
    expect(action.tab).toBe('draw');
    expect(action.tone).toBe('info');
  });

  it('suggests redraw when vacancies remain after drawn state', () => {
    const action = getNextAction(makeSettings({ state: 'drawn', vacantCounterSlots: 1 }), []);
    expect(action.title).toBe('空き枠の再抽選が必要です');
    expect(action.tab).toBe('results');
  });

  it('suggests publishing when drawn with no vacancies', () => {
    const action = getNextAction(makeSettings({ state: 'drawn' }), []);
    expect(action.title).toBe('結果を公開できます');
  });
});
