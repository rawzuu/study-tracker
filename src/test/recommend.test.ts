import { describe, expect, it } from 'vitest';
import { recommend } from '../lib/recommend';
import { busyIntervals, findSlot, proposeDay } from '../lib/dayplan';
import { D, H, M, NOW, TODAY, block, data, exam, session, subject, topic } from './helpers';

describe('doporučení „Co teď?“', () => {
  it('bez předmětů nic', () => {
    expect(recommend({ data: data(), now: NOW })).toEqual([]);
  });
  it('blízká zkouška má přednost, ale nevytlačí vše ostatní', () => {
    const a = subject({ id: 'a', weeklyGoalMin: 300 });
    const b = subject({ id: 'b', weeklyGoalMin: 300 });
    const d = data({ subjects: [a, b], exams: [exam({ subjectId: 'a', date: '2026-10-09' })], sessions: [session({ subjectId: 'b', start: NOW - 6 * D })] });
    const recs = recommend({ data: d, now: NOW });
    expect(recs[0].subjectId).toBe('a');
    expect(recs.map((r) => r.subjectId)).toContain('b');
  });
  it('témata k opakování → činnost „review“', () => {
    const a = subject({ id: 'a' });
    const d = data({ subjects: [a], topics: [topic({ subjectId: 'a', stage: 1, lastStudiedAt: NOW - 5 * D, nextReviewAt: NOW - D, reviews: 2 })] });
    const r = recommend({ data: d, now: NOW })[0];
    expect(r.activity).toBe('review');
    expect(r.topics.length).toBe(1);
  });
  it('předmět učený před chvílí je penalizovaný (prokládání)', () => {
    const a = subject({ id: 'a', weeklyGoalMin: 300 });
    const b = subject({ id: 'b', weeklyGoalMin: 300 });
    const d = data({ subjects: [a, b], sessions: [session({ subjectId: 'a', start: NOW - 90 * M, durationSec: 80 * 60 }), session({ subjectId: 'b', start: NOW - 2 * D })] });
    const recs = recommend({ data: d, now: NOW });
    expect(recs[0].subjectId).toBe('b');
    expect(recs.find((r) => r.subjectId === 'a')!.signals.X).toBeGreaterThan(0.5);
  });
  it('pomocný předmět „Anki“ se nedoporučuje jako běžný předmět', () => {
    const d = data({ subjects: [subject({ id: 'anki', name: 'Anki' })], sessions: [session({ subjectId: 'anki', mode: 'anki' })] });
    expect(recommend({ data: d, now: NOW }).filter((r) => r.subjectId === 'anki')).toEqual([]);
  });
});

describe('ranní plánování', () => {
  it('findSlot respektuje obsazené bloky a pauzu', () => {
    const busy: [number, number][] = [[TODAY + 9 * H, TODAY + 10 * H]];
    // 50 min se vejde před blok (8:00–8:50 + 10 min pauza), 55 min už ne → až po bloku a pauze
    expect(findSlot(busy, TODAY + 8 * H, TODAY + 22 * H, 50)).toBe(TODAY + 8 * H);
    expect(findSlot(busy, TODAY + 8 * H, TODAY + 22 * H, 55)).toBe(TODAY + 10 * H + 10 * M);
    expect(findSlot(busy, TODAY + 21 * H, TODAY + 22 * H, 90)).toBe(null);
  });
  it('navržené bloky se nepřekrývají, jsou v rozmezí dne a pokryjí cíl', () => {
    const subs = ['a', 'b', 'c'].map((x) => subject({ id: x, weeklyGoalMin: 300 }));
    const d = data({ subjects: subs, sessions: subs.map((s, i) => session({ subjectId: s.id, start: NOW - (i + 1) * D })), planBlocks: [block({ subjectId: 'a', start: TODAY + 13 * H, durationMin: 60 })], settings: { dailyGoalMin: 180 } as never });
    const items = proposeDay(d, NOW).filter((i) => i.include);
    const total = items.reduce((a, i) => a + i.minutes, 0);
    expect(total).toBeGreaterThanOrEqual(110); // 180 − 60 už naplánovaných − tolerance
    const busy = busyIntervals(d, TODAY);
    const all = [...busy, ...items.map((i) => [i.start, i.start + i.minutes * M] as [number, number])].sort((x, y) => x[0] - y[0]);
    for (let k = 1; k < all.length; k++) expect(all[k][0]).toBeGreaterThanOrEqual(all[k - 1][1]);
    for (const i of items) {
      expect(i.start).toBeGreaterThanOrEqual(NOW);
      expect(i.start + i.minutes * M).toBeLessThanOrEqual(TODAY + 22 * H);
    }
    // prokládání: nejsou dva stejné předměty hned po sobě (pokud je z čeho vybírat)
    const order = items.sort((x, y) => x.start - y.start).map((i) => i.subjectId);
    for (let k = 1; k < order.length; k++) expect(order[k]).not.toBe(order[k - 1]);
  });
  it('nedokončený včerejší blok nabídne k přesunutí', () => {
    const d = data({ subjects: [subject({ id: 'a' })], planBlocks: [block({ subjectId: 'a', start: TODAY - D + 15 * H })] });
    expect(proposeDay(d, NOW).some((i) => i.activity === 'carry')).toBe(true);
  });
});

describe('ranní plánování – pořadí', () => {
  it('i s nejsilnější denní dobou zůstane prokládané pořadí', () => {
    const subs = ['a', 'b'].map((x) => subject({ id: x, weeklyGoalMin: 600 }));
    // historie: učení vždy ve 14–16 h → nejsilnější okno odpoledne
    const hist = Array.from({ length: 10 }, (_, i) => session({ subjectId: i % 2 ? 'a' : 'b', start: TODAY - (i + 1) * D + 14 * H, durationSec: 5400 }));
    const d = data({ subjects: subs, sessions: hist, exams: [exam({ subjectId: 'a', date: '2026-10-09' })], settings: { dailyGoalMin: 300 } as never });
    const items = proposeDay(d, TODAY + 8 * H).filter((i) => i.include).sort((x, y) => x.start - y.start);
    expect(items.length).toBeGreaterThan(2);
    for (let k = 1; k < items.length; k++) expect(items[k].subjectId).not.toBe(items[k - 1].subjectId);
  });
});
