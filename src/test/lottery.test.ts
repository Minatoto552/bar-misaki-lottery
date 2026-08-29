// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { cancelLotteryEntry, ensureDeviceToken, getAdminLotterySnapshot, getPublicLotterySnapshot, loginAdmin, publishLotteryResults, resetLottery, runLottery, submitLotteryEntry } from '../lib/lottery-api';

const token = (suffix: string) => `00000000-0000-4000-8000-000000000000-00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

describe('Bar Misaki lottery demo flow', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('requires a companion VRC name for a counter entry', async () => {
    await expect(submitLotteryEntry({ kind: 'counter', representativeId: '@one', representativeVrcName: 'One VRC', token: token('1') })).rejects.toThrow('同行者');
  });

  it('uses only the representative X ID for duplicate detection', async () => {
    await submitLotteryEntry({ kind: 'counter', representativeId: '@Leader', representativeVrcName: 'Leader VRC', companionVrcName: 'Partner VRC', token: token('1') });
    await submitLotteryEntry({ kind: 'private', representativeId: '@partner', representativeVrcName: 'Partner VRC', token: token('2') });
    await expect(submitLotteryEntry({ kind: 'table', representativeId: '@LEADER', representativeVrcName: 'Another VRC', token: token('3') })).rejects.toThrow('すでに応募');
  });

  it('allows 1–2 person table entries and cancellation before drawing', async () => {
    const deviceToken = token('4');
    await submitLotteryEntry({ kind: 'table', representativeId: '@cancel_me', representativeVrcName: 'Table Leader', companionVrcName: 'Table Partner', token: deviceToken });
    expect((await getPublicLotterySnapshot(deviceToken)).entry?.peopleCount).toBe(2);
    await cancelLotteryEntry(deviceToken);
    expect((await getPublicLotterySnapshot(deviceToken)).entry).toBeNull();
    await submitLotteryEntry({ kind: 'table', representativeId: '@CANCEL_ME', representativeVrcName: 'Table Leader', token: deviceToken });
    expect((await getPublicLotterySnapshot(deviceToken)).entry?.peopleCount).toBe(1);
  });

  it('can exclude a seat type from the draw while preserving its application', async () => {
    await submitLotteryEntry({ kind: 'counter', representativeId: '@counter', representativeVrcName: 'Counter', companionVrcName: 'Counter Partner', token: token('5') });
    await submitLotteryEntry({ kind: 'table', representativeId: '@table', representativeVrcName: 'Table', token: token('6') });
    await loginAdmin('1112');
    await runLottery({ enabledKinds: ['counter'], winnerSlots: { counter: 1, private: 0, table: 1 } });
    const admin = await getAdminLotterySnapshot();
    expect(admin.entries.find((entry) => entry.kind === 'counter')?.status).toBe('winner');
    expect(admin.entries.find((entry) => entry.kind === 'table')?.status).toBe('pending');
    expect(admin.settings.tableWinnerSlots).toBe(0);
    await publishLotteryResults();
    expect((await getPublicLotterySnapshot(token('6'))).entry?.status).toBe('pending');
  });

  it('hides results until publication, then exposes the predetermined result', async () => {
    const deviceToken = ensureDeviceToken();
    await submitLotteryEntry({ kind: 'table', representativeId: '@misaki_test', representativeVrcName: 'Misaki Test', companionVrcName: 'Partner 01', token: deviceToken });
    await loginAdmin('1112');
    await runLottery({ enabledKinds: ['table'], winnerSlots: { counter: 0, private: 0, table: 1 } });
    const beforePublish = await getPublicLotterySnapshot(deviceToken);
    expect(beforePublish.settings.state).toBe('drawn');
    expect(beforePublish.entry?.status).toBe('pending');
    expect(beforePublish.entry?.winnerCode).toBeNull();
    const admin = await getAdminLotterySnapshot();
    expect(admin.entries[0]?.status).toBe('winner');
    expect(admin.entries[0]?.winnerCode).toMatch(/^MSK-[A-Z2-9]{6}$/);
    await publishLotteryResults();
    const published = await getPublicLotterySnapshot(deviceToken);
    expect(published.entry?.status).toBe('winner');
    expect(published.entry?.winnerCode).toBe(admin.entries[0]?.winnerCode);
    await resetLottery('リセット');
    expect((await getPublicLotterySnapshot(deviceToken)).entry).toBeNull();
  });
});
