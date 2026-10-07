import { describe, expect, it } from 'vitest';
import { mergeData, mergeEntities, serialize } from '../data/merge';
import { SchemaTooNewError, migrate } from '../data/migrations';
import { SCHEMA_VERSION, emptyData } from '../data/schema';
import { data, session } from './helpers';

describe('slučování dat (synchronizace)', () => {
  it('vyhraje novější updatedAt a nic se neztratí', () => {
    const a = [session({ id: '1', updatedAt: 5, topic: 'A' }), session({ id: '2', updatedAt: 1 })];
    const b = [session({ id: '1', updatedAt: 3, topic: 'B' }), session({ id: '3', updatedAt: 1 })];
    const m = mergeEntities(a, b);
    expect(m.map((x) => x.id).sort()).toEqual(['1', '2', '3']);
    expect(m.find((x) => x.id === '1')!.topic).toBe('A');
  });
  it('smazání (tombstone) se přenese, když je novější', () => {
    const m = mergeEntities([session({ id: '1', updatedAt: 1 })], [session({ id: '1', updatedAt: 2, deletedAt: 2 })]);
    expect(m[0].deletedAt).toBe(2);
  });
  it('zachová neznámá pole z budoucích verzí z obou stran', () => {
    const local = { ...data(), futureLocal: 1 } as never;
    const remote = { ...data(), futureRemote: 2 } as never;
    const m = mergeData(local, remote) as unknown as Record<string, number>;
    expect(m.futureLocal).toBe(1);
    expect(m.futureRemote).toBe(2);
  });
  it('serializace je deterministická', () => {
    const d = data({ sessions: [session({ id: 'b', createdAt: 2 }), session({ id: 'a', createdAt: 1 })] });
    const e = data({ sessions: [...d.sessions].reverse() });
    expect(serialize(d)).toBe(serialize(e));
  });
});

describe('migrace', () => {
  it('doplní chybějící kolekce a nastavení', () => {
    const m = migrate({ schemaVersion: 1, sessions: [], settings: { theme: 'light' } });
    expect(m.topics).toEqual([]);
    expect(m.anki).toEqual([]);
    expect(m.settings.theme).toBe('light');
    expect(m.settings.desiredRetention).toBe(0.9);
  });
  it('odmítne data z novější verze (nepřepíše je)', () => {
    expect(() => migrate({ schemaVersion: SCHEMA_VERSION + 1 })).toThrow(SchemaTooNewError);
  });
  it('prázdný vstup = prázdná data', () => {
    expect(migrate(null).sessions).toEqual(emptyData().sessions);
  });
});
