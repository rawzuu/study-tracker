import { describe, expect, it } from 'vitest';
import { FAMILIES, SINGLES, evaluate } from '../features/achievements/achievements';
import { buildIcs } from '../features/planner/ics';
import { blockHasSession, matchPlanBlocks } from '../features/planner/match';
import { escapeHtml } from '../features/stats/charts';
import { ankiEstimateMin, ankiSecPerAnswer, clusterReviews } from '../lib/anki';
import { blockTopic, blockTopics } from '../lib/blockTopic';
import { sessionsToCsv } from '../lib/csv';
import { capitalize, fmtDec, fmtDuration, isoWeek } from '../lib/time';
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
  it('délka všude stejně: „25 min“, „1 h 19 min“', () => {
    expect(fmtDuration(0)).toBe('0 min');
    expect(fmtDuration(25 * 60)).toBe('25 min');
    expect(fmtDuration(79 * 60 + 59)).toBe('1 h 19 min');
    expect(fmtDuration(3 * 3600)).toBe('3 h');
    expect(fmtDuration(16 * 3600 + 5 * 60)).toBe('16 h 5 min');
    expect(fmtDuration(-5)).toBe('0 min');
  });
  it('desetinná čárka', () => {
    expect(fmtDec(3.62)).toBe('3,6');
    expect(fmtDec(4)).toBe('4,0');
    expect(fmtDec(0.125, 2)).toBe('0,13');
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

describe('blok plánu → téma a zápis', () => {
  it('z vygenerovaného názvu vezme skutečné téma', () => {
    expect(blockTopic('Opakování: Derivace, Limity +2')).toBe('Derivace');
    expect(blockTopic('Opakování: Derivace')).toBe('Derivace');
    expect(blockTopic('Nové téma: Řady')).toBe('Řady');
    expect(blockTopic('Pokračovat: Ukazatele')).toBe('Ukazatele');
    expect(blockTopic('Příprava na zkoušku: Zápočtový test')).toBe('Zápočtový test');
    expect(blockTopic('Opakování: Zápočtový test (−3 d)')).toBe('Zápočtový test');
    expect(blockTopic('Podle plánu: Nové téma: Řady')).toBe('Řady');
  });
  it('blok s více tématy vrátí všechna uvedená', () => {
    expect(blockTopics('Opakování: Derivace, Limity, Řady +4')).toEqual(['Derivace', 'Limity', 'Řady']);
    expect(blockTopics('Podle plánu: Opakování: A, B')).toEqual(['A', 'B']);
    expect(blockTopics('Nové téma: Řady')).toEqual(['Řady']);
    expect(blockTopics('Po přednášce: Fyzika I')).toEqual([]);
    expect(blockTopics('Integrály, per partes')).toEqual(['Integrály, per partes']); // vlastní název se nedělí
  });
  it('názvy bez tématu vrátí prázdné, vlastní název nechá', () => {
    expect(blockTopic('Po přednášce: Fyzika I')).toBe('');
    expect(blockTopic('Nová látka')).toBe('');
    expect(blockTopic('Anki: 40 karet')).toBe('');
    expect(blockTopic('')).toBe('');
    expect(blockTopic('  Integrály per partes ')).toBe('Integrály per partes');
  });
  it('pozná, že k bloku už je zapsaný čas', () => {
    const b = block({ subjectId: 's', start: NOW, durationMin: 60 });
    expect(blockHasSession([session({ subjectId: 's', start: NOW + 10 * M, end: NOW + 50 * M })], b)).toBe(true);
    expect(blockHasSession([session({ subjectId: 'x', start: NOW, end: NOW + 60 * M })], b)).toBe(false);
    expect(blockHasSession([session({ subjectId: 's', start: NOW + 55 * M, end: NOW + 90 * M })], b)).toBe(false);
    expect(blockHasSession([session({ subjectId: 's', start: NOW, end: NOW + 60 * M, deletedAt: NOW })], b)).toBe(false);
  });
});

describe('odhad času na Anki', () => {
  it('nové karty se počítají víckrát (131 karet, z toho 60 nových ≈ 30 min při 8 s)', () => {
    expect(ankiEstimateMin([{ newCount: 60, learnCount: 0, reviewCount: 71 }], 8)).toBe(30);
    expect(ankiEstimateMin([{ newCount: 0, learnCount: 0, reviewCount: 131 }], 8)).toBe(20);
    expect(ankiEstimateMin([{ newCount: 0, learnCount: 0, reviewCount: 3 }], 8)).toBe(5);
  });
  it('tempo z historie, jinak z dneška, jinak 10 s', () => {
    const anki = (n: number, sec: number, daysAgo = 1, mode = 'anki') => ({ mode, start: NOW - daysAgo * D, durationSec: sec, note: `${n} karet` });
    expect(ankiSecPerAnswer([anki(40, 300), anki(60, 500)], undefined, NOW)).toBe(8);
    expect(ankiSecPerAnswer([anki(40, 300)], { reviewedToday: 20, msToday: 120_000 }, NOW)).toBe(6); // málo historie → dnešek
    expect(ankiSecPerAnswer([anki(400, 3000, 40)], undefined, NOW)).toBe(10); // starší než 30 dní se nepočítá
    expect(ankiSecPerAnswer([anki(400, 3000, 1, 'pomodoro')], undefined, NOW)).toBe(10);
  });
});

describe('Anki – prohlížeče bez přístupu', () => {
  it('Safari na https blokuje, Chrome, Edge a Firefox ne, telefon nikdy', async () => {
    const { ankiBlocked } = await import('../lib/anki');
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
    const safari = `${mac} Version/27.0.1 Safari/605.1.15`;
    const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    expect(ankiBlocked(safari, 'https:')).toBe('safari');
    expect(ankiBlocked(safari, 'http:')).toBe(null); // místní vývojový server
    expect(ankiBlocked(chrome, 'https:')).toBe(null);
    expect(ankiBlocked(`${chrome} Edg/141.0.0.0`, 'https:')).toBe(null);
    expect(ankiBlocked('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0', 'https:')).toBe(null);
    expect(ankiBlocked('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', 'https:')).toBe('phone');
  });
});
