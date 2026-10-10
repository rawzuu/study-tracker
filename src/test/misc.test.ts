import { describe, expect, it } from 'vitest';
import { FAMILIES, SINGLES, evaluate } from '../features/achievements/achievements';
import { buildIcs } from '../features/planner/ics';
import { matchPlanBlocks } from '../features/planner/match';
import { escapeHtml } from '../features/stats/charts';
import { clusterReviews } from '../lib/anki';
import { sessionsToCsv } from '../lib/csv';
import { capitalize, fmtHM, isoWeek } from '../lib/time';
import { D, H, M, NOW, block, data, session, subject } from './helpers';

describe('úspěchy', () => {
  it('ID jsou unikátní a je jich přes 100', () => {
    const ids = [...FAMILIES.flatMap((f) => f.thresholds.map((_, i) => `${f.id}.${i + 1}`)), ...SINGLES.map((s) => s.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(100);
  });
  it('prahy jsou rostoucí', () => {
    for (const f of FAMILIES) for (let i = 1; i < f.thresholds.length; i++) expect(f.thresholds[i]).toBeGreaterThan(f.thresholds[i - 1]);
  });
  it('hodiny a série se počítají včetně data odemčení', () => {
    const sessions = Array.from({ length: 8 }, (_, i) => session({ start: NOW - (7 - i) * D, durationSec: 2 * 3600 }));
    const r = evaluate(data({ sessions }), NOW);
    const hours = r.families.find((x) => x.family.id === 'hours')!;
    expect(hours.tier).toBe(2); // 16 h → 1 h a 10 h
    expect(hours.tiers[1].at).toBe(sessions[4].end); // 10 h dosaženo v 5. sezení
    expect(r.families.find((x) => x.family.id === 'streak')!.value).toBe(8);
    expect(r.unlockedIds).toContain('streak.2');
  });
  it('prázdná data – nic odemčeno, nic nespadne', () => {
    expect(evaluate(data(), NOW).unlocked).toBe(0);
  });
});

describe('export a bezpečnost', () => {
  it('ICS: escapování a zalamování řádků', () => {
    const ics = buildIcs({ blocks: [block({ title: 'A; B, C' + 'x'.repeat(80) })], exams: [], subjects: [subject({ id: 's', name: 'Mat' })], alarmMin: 10 });
    expect(ics).toContain(String.raw`A\; B\, C`);
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
  it('CSV: středník, uvozovky a ochrana proti vzorcům', () => {
    const csv = sessionsToCsv([session({ subjectId: 's', topic: '=HYPERLINK("x")', note: 'a;b' })], [subject({ id: 's', name: 'Mat' })], []);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"a;b"');
  });
  it('HTML v tooltipech je escapované', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('Anki a kalendář', () => {
  it('opakování se seskupí do bloků podle pauzy 10 min', () => {
    const r = (t: number) => ({ deck: 'nem', time: t, durationMs: 8000 });
    const blocks = clusterReviews([r(0), r(60_000), r(120_000), r(20 * M), r(21 * M)]);
    expect(blocks.length).toBe(2);
    expect(blocks[0].count).toBe(3);
  });
  it('sezení odškrtne překrývající se plán stejného předmětu', () => {
    const b = block({ subjectId: 's', start: NOW, durationMin: 60 });
    expect(matchPlanBlocks([b], 's', NOW + 10 * M, NOW + 50 * M)).toHaveLength(1);
    expect(matchPlanBlocks([b], 'jiný', NOW, NOW + H)).toHaveLength(0);
    expect(matchPlanBlocks([b], 's', NOW + 55 * M, NOW + 2 * H)).toHaveLength(0);
  });
});

describe('formát čísel na přehledu', () => {
  it('hodiny a minuty', () => {
    expect(fmtHM(0)).toBe('0:00');
    expect(fmtHM(89 * 60 + 59)).toBe('1:29');
    expect(fmtHM(16 * 3600 + 30 * 60)).toBe('16:30');
    expect(fmtHM(-5)).toBe('0:00');
  });
  it('číslo týdne podle ISO', () => {
    expect(isoWeek(new Date(2026, 9, 10, 23, 30).getTime())).toBe(41);
    expect(isoWeek(new Date(2026, 0, 1).getTime())).toBe(1); // čtvrtek
    expect(isoWeek(new Date(2025, 11, 29).getTime())).toBe(1); // pondělí 1. týdne 2026
    expect(isoWeek(new Date(2027, 0, 1).getTime())).toBe(53); // pátek patří k 53. týdnu 2026
    expect(isoWeek(new Date(2026, 2, 29, 12).getTime())).toBe(13); // den změny času
  });
  it('velké písmeno jen na začátku', () => {
    expect(capitalize('čtvrtek 8. října')).toBe('Čtvrtek 8. října');
    expect(capitalize('')).toBe('');
  });
});
