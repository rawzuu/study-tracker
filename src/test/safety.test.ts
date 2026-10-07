import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasNewer, mergeData } from '../data/merge';
import { AppData, CollectionKey, Entity } from '../data/schema';
import { addDays, atMinutes, minutesOfDay, startOfDay } from '../lib/time';
import { data, session, subject, NOW, M } from './helpers';

vi.mock('../lib/anki', async (orig) => ({ ...(await orig<typeof import('../lib/anki')>()), fetchAnki: vi.fn() }));
const { fetchAnki } = await import('../lib/anki');
const { runAnkiSync } = await import('../features/anki/useAnkiSync');

describe('víc záložek – ukládání se slučuje', () => {
  it('změny ze dvou záložek se při uložení neztratí a slučování se zastaví', () => {
    const base = data({ subjects: [subject({ id: 's' })] });
    const tabA = { ...base, sessions: [session({ id: 'a', updatedAt: 10 })] };
    const tabB = { ...base, sessions: [session({ id: 'b', updatedAt: 11 })] };
    // A uloží, pak B uloží (persist = sloučení s tím, co je v IndexedDB)
    const afterA = tabA;
    const afterB = mergeData(tabB, afterA);
    expect(afterB.sessions.map((s) => s.id).sort()).toEqual(['a', 'b']);
    // A dostane zprávu „uloženo“ → načte a sloučí, protože v úložišti je něco nového
    expect(hasNewer(tabA, afterB)).toBe(true);
    const tabA2 = mergeData(tabA, afterB);
    // … a pak už ne – žádné nekonečné přeposílání mezi záložkami
    expect(hasNewer(tabA2, afterB)).toBe(false);
    expect(hasNewer(afterB, tabA2)).toBe(false);
  });
  it('smazání v jedné záložce nepřepíše starší kopie v druhé', () => {
    const live = data({ sessions: [session({ id: 'x', updatedAt: 1 })] });
    const deleted = data({ sessions: [session({ id: 'x', updatedAt: 5, deletedAt: 5 })] });
    expect(mergeData(live, deleted).sessions[0].deletedAt).toBe(5);
    expect(hasNewer(live, deleted)).toBe(true);
    expect(hasNewer(deleted, live)).toBe(false);
  });
  it('novější nastavení se pozná', () => {
    const a = data({ settings: { ...data().settings, updatedAt: 1 } });
    const b = data({ settings: { ...data().settings, updatedAt: 2, dailyGoalMin: 30 } });
    expect(hasNewer(a, b)).toBe(true);
    expect(mergeData(a, b).settings.dailyGoalMin).toBe(30);
  });
});

describe('změna času (Praha)', () => {
  it('testy opravdu běží v pásmu se změnou času', () => {
    expect(new Date(2026, 9, 24).getTimezoneOffset()).toBe(-120);
    expect(new Date(2026, 9, 26).getTimezoneOffset()).toBe(-60);
  });
  it('pozice v kalendáři podle místního času i v den změny času', () => {
    for (const day of [new Date(2026, 9, 25).getTime(), new Date(2026, 2, 29).getTime(), new Date(2026, 9, 7).getTime()]) {
      for (const min of [0, 60, 4 * 60, 10 * 60 + 30, 23 * 60 + 45]) {
        const t = atMinutes(day, min);
        expect(new Date(t).getHours() * 60 + new Date(t).getMinutes()).toBe(min);
        expect(minutesOfDay(t)).toBe(min);
      }
    }
  });
  it('dny přes změnu času nesklouznou (předpověď opakování, týdny)', () => {
    const start = startOfDay(new Date(2026, 9, 20).getTime());
    const dates = Array.from({ length: 14 }, (_, i) => new Date(addDays(start, i)).getDate());
    expect(dates).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 1, 2]);
    // stará chyba: start + i * 24 h dávalo po změně času 25 dvakrát
    expect(new Date(start + 6 * 86_400_000).getDate()).toBe(25);
  });
});

describe('Anki – synchronizace okna', () => {
  type Store = Parameters<typeof runAnkiSync>[0];
  function fakeStore(d: AppData) {
    const s = {
      data: d,
      upsertMany(key: CollectionKey, items: Partial<Entity>[]) {
        const list = [...(s.data[key] as Entity[])];
        for (const it of items) {
          const i = list.findIndex((e) => e.id === it.id);
          const stamped = { ...it, createdAt: i >= 0 ? list[i].createdAt : Date.now(), updatedAt: Date.now() } as Entity;
          if (i >= 0) list[i] = { ...list[i], ...stamped };
          else list.push(stamped);
        }
        s.data = { ...s.data, [key]: list };
      },
      upsert(key: CollectionKey, item: Partial<Entity>) {
        s.upsertMany(key, [item]);
      },
      remove(key: CollectionKey, id: string) {
        s.data = { ...s.data, [key]: (s.data[key] as Entity[]).map((e) => (e.id === id ? { ...e, deletedAt: Date.now(), updatedAt: Date.now() } : e)) };
      },
    };
    return s;
  }
  // Opakování v Anki: blok přes půlnoc z pondělí 5. 10. 23:50 do úterý 6. 10. 0:20 (každých 30 s)
  const reviews: { deck: string; time: number; durationMs: number }[] = [];
  for (let t = new Date(2026, 9, 5, 23, 50).getTime(); t <= new Date(2026, 9, 6, 0, 20).getTime(); t += 30_000) reviews.push({ deck: 'nemcina', time: t, durationMs: 25_000 });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW); // středa 7. 10. 10:00 → okno od úterý 0:00
    vi.mocked(fetchAnki).mockImplementation(async (since: number) => ({
      decks: [],
      reviewedToday: 1,
      reviews: reviews.filter((r) => r.time >= since),
      reviewsFetched: true,
    }));
  });
  afterEach(() => vi.useRealTimers());

  const settings = { ...data().settings, anki: { enabled: true, countTime: true, deckSubjects: { nemcina: 's' }, importDays: 60 } };
  const fullStart = new Date(2026, 9, 5, 23, 50).getTime() - 25_000;
  const fullBlock = session({ id: `anki-nemcina-${fullStart}`, subjectId: 's', mode: 'anki', topic: 'nemcina', start: fullStart, end: new Date(2026, 9, 6, 0, 20).getTime(), durationSec: 61 * 25 });

  it('blok přes půlnoc na hranici okna se nezapočítá podruhé', async () => {
    const store = fakeStore(data({ subjects: [subject({ id: 's' })], sessions: [fullBlock], settings }));
    await runAnkiSync(store as unknown as Store, store.data, false);
    const alive = store.data.sessions.filter((s) => s.mode === 'anki' && !s.deletedAt);
    expect(alive.map((s) => s.id)).toEqual([fullBlock.id]);
  });
  it('dřívější rozpůlený duplikát v okně se uklidí', async () => {
    const dup = session({ id: 'anki-nemcina-999', subjectId: 's', mode: 'anki', start: new Date(2026, 9, 6, 0, 0).getTime() - 25_000, end: new Date(2026, 9, 6, 0, 20).getTime() });
    const store = fakeStore(data({ subjects: [subject({ id: 's' })], sessions: [fullBlock, dup], settings }));
    await runAnkiSync(store as unknown as Store, store.data, false);
    expect(store.data.sessions.find((s) => s.id === dup.id)!.deletedAt).toBeDefined();
    expect(store.data.sessions.find((s) => s.id === fullBlock.id)!.deletedAt).toBeUndefined();
  });
  it('smazané sezení nevrací ani zbytečně nepřepisuje', async () => {
    const deleted = { ...fullBlock, deletedAt: 5, updatedAt: 5 };
    const store = fakeStore(data({ subjects: [subject({ id: 's' })], sessions: [deleted], settings }));
    await runAnkiSync(store as unknown as Store, store.data, false);
    expect(store.data.sessions).toEqual([deleted]);
  });
  it('když Anki nevrátí žádnou historii (jiný profil), nic nesmaže', async () => {
    vi.mocked(fetchAnki).mockResolvedValue({ decks: [], reviewedToday: 0, reviews: [], reviewsFetched: true });
    const recent = session({ id: 'anki-nemcina-1', subjectId: 's', mode: 'anki', start: NOW - 60 * M, end: NOW - 40 * M });
    const store = fakeStore(data({ subjects: [subject({ id: 's' })], sessions: [recent], settings }));
    await runAnkiSync(store as unknown as Store, store.data, false);
    expect(store.data.sessions[0].deletedAt).toBeUndefined();
  });
});
