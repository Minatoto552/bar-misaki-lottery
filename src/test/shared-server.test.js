import { describe, expect, it } from 'vitest';

import worker from '../../public/server/index.js';

class MemoryD1 {
  row = null;
  prepare(sql) {
    const database = this;
    return {
      values: [],
      bind(...values) { this.values = values; return this; },
      async run() {
        if (sql.startsWith('INSERT OR IGNORE') && !database.row) database.row = { value: this.values[1], version: 0 };
        if (sql.startsWith('UPDATE app_state')) {
          if (database.row?.version !== this.values[2]) return { meta: { changes: 0 } };
          database.row = { value: this.values[0], version: database.row.version + 1 };
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      },
      async first() { return database.row; },
    };
  }
}

const post = async (env, name, input, sessionToken) => {
  const response = await worker.fetch(new Request(`https://example.test/api/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}) }, body: JSON.stringify(input) }), env);
  return { status: response.status, body: await response.json() };
};

describe('shared Sites backend', () => {
  it('shares an application with the admin across separate device tokens', async () => {
    const env = { DB: new MemoryD1(), ADMIN_SHARED_PASSWORD: '3331' };
    const firstDevice = 'a'.repeat(64);
    expect((await post(env, 'submitLotteryEntry', { kind: 'table', representativeId: '@remote', representativeVrcName: 'Remote VRC', token: firstDevice })).status).toBe(200);
    const login = await post(env, 'adminLogin', { password: '3331' });
    const admin = await post(env, 'getAdminLottery', {}, login.body.sessionToken);
    expect(admin.body.entries).toHaveLength(1);
    expect(admin.body.entries[0].representativeId).toBe('@remote');
    const secondDevice = await post(env, 'getLotteryStatus', { token: 'b'.repeat(64) });
    expect(secondDevice.body.entry).toBeNull();
    expect(secondDevice.body.settings.state).toBe('accepting');
  });

  it('preserves recruitment categories when resetting a round', async () => {
    const env = { DB: new MemoryD1(), ADMIN_SHARED_PASSWORD: '3331' };
    const login = await post(env, 'adminLogin', { password: '3331' });
    const session = login.body.sessionToken;
    expect((await post(env, 'updateAvailableLotteryKinds', { availableKinds: ['private', 'table'] }, session)).status).toBe(200);
    expect((await post(env, 'resetLottery', { confirmation: 'リセット' }, session)).status).toBe(200);
    const admin = await post(env, 'getAdminLottery', {}, session);
    expect(admin.body.settings.availableKinds).toEqual(['private', 'table']);
    expect(admin.body.entries).toHaveLength(0);
  });

  it('closes applications separately before running the draw', async () => {
    const env = { DB: new MemoryD1(), ADMIN_SHARED_PASSWORD: '3331' };
    const device = 'c'.repeat(64);
    expect((await post(env, 'submitLotteryEntry', { kind: 'private', representativeId: '@close', representativeVrcName: 'Close VRC', token: device })).status).toBe(200);
    const login = await post(env, 'adminLogin', { password: '3331' });
    const session = login.body.sessionToken;
    expect((await post(env, 'runLottery', { enabledKinds: ['private'], winnerSlots: { counter: 0, private: 1, table: 0 } }, session)).status).toBe(400);
    expect((await post(env, 'closeLottery', {}, session)).status).toBe(200);
    const closed = await post(env, 'getAdminLottery', {}, session);
    expect(closed.body.settings.state).toBe('closed');
    expect(closed.body.entries[0].status).toBe('pending');
    expect(closed.body.entries[0].drawnAt).toBeNull();
    expect((await post(env, 'submitLotteryEntry', { kind: 'private', representativeId: '@late', representativeVrcName: 'Late VRC', token: 'd'.repeat(64) })).status).toBe(400);
    expect((await post(env, 'runLottery', { enabledKinds: ['private'], winnerSlots: { counter: 0, private: 1, table: 0 } }, session)).status).toBe(200);
    expect((await post(env, 'getAdminLottery', {}, session)).body.settings.state).toBe('drawn');
  });

  it('keeps legacy applicants and draws by instance, seat and people limits', async () => {
    const env = { DB: new MemoryD1(), ADMIN_SHARED_PASSWORD: '3331' };
    const login = await post(env, 'adminLogin', { password: '3331' });
    const session = login.body.sessionToken;
    const initial = (await post(env, 'getAdminLottery', {}, session)).body;
    const instances = initial.settings.instances.map((item) => ({ ...item, visible: item.id !== 'instance3', enabled: item.id !== 'instance3' }));
    const recruitmentSlots = initial.settings.recruitmentSlots.map((slot) => ({
      ...slot,
      enabled: slot.id === 'instance1:counter' || slot.id === 'instance2:table',
      capacity: slot.id === 'instance1:counter' || slot.id === 'instance2:table' ? 1 : 0,
      minPeople: slot.id === 'instance1:counter' ? 2 : 1,
      maxPeople: 2,
    }));
    expect((await post(env, 'updateLotteryConfiguration', { applicationDeadline: null, instances, recruitmentSlots, featureSettings: initial.settings.featureSettings }, session)).status).toBe(200);
    expect((await post(env, 'submitLotteryEntry', { kind: 'counter', instanceId: 'instance1', preferenceMode: 'specified', representativeId: '@solo', representativeVrcName: 'Solo', token: 'e'.repeat(64) })).status).toBe(400);
    expect((await post(env, 'submitLotteryEntry', { kind: 'counter', instanceId: 'instance1', preferenceMode: 'specified', representativeId: '@pair', representativeVrcName: 'Pair', companionVrcName: 'Partner', token: 'f'.repeat(64) })).status).toBe(200);
    expect((await post(env, 'submitLotteryEntry', { kind: 'table', instanceId: 'instance2', preferenceMode: 'specified', representativeId: '@table2', representativeVrcName: 'Table', token: '1'.repeat(64) })).status).toBe(200);
    expect((await post(env, 'submitLotteryEntry', { kind: 'private', preferenceMode: 'omakase', representativeId: '@auto', representativeVrcName: 'Auto', token: '2'.repeat(64) })).status).toBe(200);
    expect((await post(env, 'closeLottery', {}, session)).status).toBe(200);
    expect((await post(env, 'runLottery', {}, session)).status).toBe(200);
    const drawn = (await post(env, 'getAdminLottery', {}, session)).body;
    const winners = drawn.entries.filter((entry) => entry.status === 'winner');
    expect(winners).toHaveLength(2);
    expect(winners.filter((entry) => entry.assignedInstanceId === 'instance1' && entry.assignedKind === 'counter')).toHaveLength(1);
    expect(winners.filter((entry) => entry.assignedInstanceId === 'instance2' && entry.assignedKind === 'table')).toHaveLength(1);
  });
});
