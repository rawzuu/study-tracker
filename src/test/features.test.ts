import { describe, expect, it } from 'vitest';
import { parseIcs } from '../lib/ical';
import { diffTimetable, lecturesIn, replaceEvents } from '../lib/timetable';
import { busyIntervals, findSlot } from '../lib/dayplan';
import { restoreEntity, trashItems } from '../lib/trash';
import { calibrate, pendingSuggestions } from '../lib/calibrate';
import { mergeData } from '../data/merge';
import { Session, Timetable } from '../data/schema';
import { D, H, M, NOW, TODAY, block, data, exam, session, subject } from './helpers';

const ics = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Rozvrh ZS', ...events, 'END:VCALENDAR'].join('\r\n');
const local = (t: number) => {
  const d = new Date(t);
  return `${d.getDate()}.${d.getMonth() + 1}. ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

describe('import rozvrhu (.ics)', () => {
  it('týdenní opakování v pásmu Europe/Prague drží čas i přes změnu času', () => {
    const r = parseIcs(
      ics(
        'BEGIN:VEVENT',
        'UID:mat1',
        'SUMMARY:Matematika I – přednáška',
        'LOCATION:EA\\, posluchárna 1',
        'DTSTART;TZID=Europe/Prague:20261005T091500',
        'DTEND;TZID=Europe/Prague:20261005T104500',
        'RRULE:FREQ=WEEKLY;UNTIL=20261130T235959Z',
        'END:VEVENT',
      ),
    );
    expect(r.name).toBe('Rozvrh ZS');
    expect(r.events.map((e) => local(e.start))).toEqual(['5.10. 9:15', '12.10. 9:15', '19.10. 9:15', '26.10. 9:15', '2.11. 9:15', '9.11. 9:15', '16.11. 9:15', '23.11. 9:15', '30.11. 9:15']);
    expect(r.events.every((e) => e.end - e.start === 90 * M)).toBe(true);
    expect(r.events[0].location).toBe('EA, posluchárna 1');
    expect(r.events[0].series).toBe('Matematika I – přednáška');
  });

  it('výjimky, přesunutý a zrušený termín', () => {
    const r = parseIcs(
      ics(
        'BEGIN:VEVENT',
        'UID:nem',
        'SUMMARY:Němčina',
        'DTSTART;TZID=Europe/Prague:20261006T140000',
        'DTEND;TZID=Europe/Prague:20261006T153000',
        'RRULE:FREQ=WEEKLY;COUNT=5',
        'EXDATE;TZID=Europe/Prague:20261013T140000',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:nem',
        'RECURRENCE-ID;TZID=Europe/Prague:20261020T140000',
        'SUMMARY:Němčina',
        'DTSTART;TZID=Europe/Prague:20261021T100000',
        'DTEND;TZID=Europe/Prague:20261021T113000',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:nem',
        'RECURRENCE-ID;TZID=Europe/Prague:20261027T140000',
        'STATUS:CANCELLED',
        'SUMMARY:Němčina',
        'DTSTART;TZID=Europe/Prague:20261027T140000',
        'DTEND;TZID=Europe/Prague:20261027T153000',
        'END:VEVENT',
      ),
    );
    expect(r.events.map((e) => local(e.start))).toEqual(['6.10. 14:00', '21.10. 10:00', '3.11. 14:00']);
  });

  it('BYDAY, sudé týdny, COUNT, UTC časy, zalomené řádky a celodenní akce', () => {
    const r = parseIcs(
      ics(
        'BEGIN:VEVENT',
        'UID:alg',
        'SUMMARY:Algoritmizace ',
        ' – cvičení',
        'DTSTART:20261005T080000Z',
        'DURATION:PT1H30M',
        'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:zap',
        'SUMMARY:Zápočtový týden',
        'DTSTART;VALUE=DATE:20261214',
        'DTEND;VALUE=DATE:20261219',
        'END:VEVENT',
      ),
    );
    expect(r.skippedAllDay).toBe(1);
    expect(r.events.map((e) => local(e.start))).toEqual(['5.10. 10:00', '7.10. 10:00', '19.10. 10:00', '21.10. 10:00']);
    expect(r.events[0].title).toBe('Algoritmizace – cvičení');
  });

  it('neznámé pásmo (např. z Windows) bere jako místní čas; neplatný soubor odmítne', () => {
    const r = parseIcs(ics('BEGIN:VEVENT', 'SUMMARY:Fyzika', 'DTSTART;TZID=Central Europe Standard Time:20261008T120000', 'DTEND;TZID=Central Europe Standard Time:20261008T134000', 'END:VEVENT'));
    expect(local(r.events[0].start)).toBe('8.10. 12:00');
    expect(() => parseIcs('ahoj')).toThrow();
  });
});

describe('rozvrh v aplikaci', () => {
  const ev = (series: string, start: number, min = 90) => ({ key: `${series}|${start}`, series, title: series, location: '', start, end: start + min * M });
  const tt = (p: Partial<Timetable> = {}): Timetable => ({ id: 'tt', name: 'Rozvrh', importedAt: 1, events: [], hiddenSeries: [], skipped: [], createdAt: 1, updatedAt: 1, ...p });

  it('nový import nahradí budoucí termíny, proběhlé nechá a zachová skryté předměty i odpadlé hodiny', () => {
    const past = ev('Mat', NOW - 2 * D);
    const keep = ev('Mat', NOW + 2 * D);
    const moved = ev('Fyz', NOW + 3 * D);
    const old = tt({ events: [past, keep, moved], hiddenSeries: ['Fyz', 'Zrušený'], skipped: [keep.key] });
    const movedNew = ev('Fyz', NOW + 3 * D + H);
    const added = ev('Prog', NOW + 4 * D);
    const next = [keep, movedNew, added]; // export „od dneška“ – bez proběhlých hodin
    const d = diffTimetable(old.events, next, NOW);
    expect(d).toMatchObject({ added: 2, removed: 1, unchanged: 1, addedSeries: ['Prog'], removedSeries: [] });
    const r = replaceEvents(old, next, NOW);
    expect(r.events.map((e) => e.key)).toEqual([past.key, keep.key, movedNew.key, added.key]);
    expect(r.hiddenSeries).toEqual(['Fyz']);
    expect(r.skipped).toEqual([keep.key]);
  });

  it('skryté, odpadlé a smazané se v kalendáři ani v plánu nepočítají; ranní plán výuku obejde', () => {
    const a = ev('Mat', TODAY + 9 * H);
    const b = ev('Fyz', TODAY + 11 * H);
    const c = ev('TV', TODAY + 13 * H);
    const d = data({ timetables: [tt({ events: [a, b, c], hiddenSeries: ['TV'], skipped: [b.key] }), tt({ id: 'old', events: [ev('Staré', TODAY + 15 * H)], deletedAt: 5 })] });
    expect(lecturesIn(d, TODAY, TODAY + D).map((l) => l.series)).toEqual(['Mat']);
    const busy = busyIntervals(d, TODAY);
    expect(busy).toEqual([[a.start, a.end]]);
    // 60min blok od 9:00 se vejde až po přednášce (+ 10 min pauza)
    expect(findSlot(busy, TODAY + 9 * H, TODAY + 22 * H, 60)).toBe(a.end + 10 * M);
  });
});

describe('koš', () => {
  it('ukáže smazané za 30 dní, bez systémových mazání', () => {
    const d = data({
      subjects: [subject({ id: 's', name: 'Matematika' })],
      sessions: [
        session({ id: 'a', deletedAt: NOW - D, updatedAt: NOW - D }),
        session({ id: 'anki-x', mode: 'anki', deletedAt: NOW - D, updatedAt: NOW - D }),
        session({ id: 'old', deletedAt: NOW - 40 * D, updatedAt: NOW - 40 * D }),
        session({ id: 'alive' }),
      ],
      planBlocks: [block({ id: 'gen', examId: 'e', deletedAt: NOW - D }), block({ id: 'manual', deletedAt: NOW - 2 * D })],
    });
    expect(trashItems(d, NOW).map((i) => i.id)).toEqual(['a', 'manual']);
  });

  it('obnovení vyhraje nad starším smazáním z jiného zařízení a vrátí i bloky zkoušky', () => {
    const t = NOW - D;
    const d = data({
      exams: [exam({ id: 'e', deletedAt: t, updatedAt: t })],
      planBlocks: [block({ id: 'b1', examId: 'e', deletedAt: t, updatedAt: t }), block({ id: 'b0', examId: 'e', deletedAt: t - 3 * D, updatedAt: t - 3 * D })],
    });
    const r = restoreEntity(d, 'exams', 'e', NOW);
    expect(r.exams[0].deletedAt).toBeUndefined();
    expect(r.exams[0].updatedAt).toBe(NOW);
    expect(r.planBlocks.find((b) => b.id === 'b1')!.deletedAt).toBeUndefined();
    expect(r.planBlocks.find((b) => b.id === 'b0')!.deletedAt).toBe(t - 3 * D); // smazaný dřív a zvlášť – zůstane
    // druhé zařízení má ještě starý tombstone → po sloučení zůstane obnoveno
    expect(mergeData(d, r).exams[0].deletedAt).toBeUndefined();
    expect('deletedAt' in JSON.parse(JSON.stringify(r.exams[0]))).toBe(false);
  });
});

describe('kalibrace (návrhy v měsíčním reportu)', () => {
  // 1. 10. 2026 = konec zářijového reportu
  const END = new Date(2026, 9, 1).getTime();
  const days = (n: number, minutes: (i: number) => number, subjectId = 's', hour = 15): Session[] =>
    Array.from({ length: n }, (_, i) => {
      const start = new Date(2026, 8, 30 - i, hour).getTime();
      return session({ id: `c${subjectId}${i}`, subjectId, start, end: start + minutes(i) * M, durationSec: minutes(i) * 60 });
    });

  it('nereálný denní cíl sníží o rozumný kus (nejvýš 30 %)', () => {
    const d = data({ sessions: days(30, (i) => 60 + (i % 4) * 10), settings: { ...data().settings, dailyGoalMin: 180 } });
    const s = calibrate(d, END).find((x) => x.key === 'dailyGoal')!;
    expect(s.settings!.dailyGoalMin).toBe(135); // 180 − 30 % = 126 → zaokrouhleno k původnímu cíli
    expect(s.reasons[0]).toContain('0 z 30');
  });

  it('cíl, který sedí, nechá být; při málo datech nenavrhuje nic', () => {
    const fits = data({ sessions: days(30, (i) => (i % 10 < 7 ? 130 : 90)), settings: { ...data().settings, dailyGoalMin: 120 } });
    expect(calibrate(fits, END).find((x) => x.key === 'dailyGoal')).toBeUndefined();
    const few = data({ sessions: days(6, () => 20), settings: { ...data().settings, dailyGoalMin: 180 } });
    expect(calibrate(few, END)).toEqual([]);
  });

  it('příliš snadný cíl mírně zvýší', () => {
    const d = data({ sessions: days(30, () => 150), settings: { ...data().settings, dailyGoalMin: 60 } });
    expect(calibrate(d, END).find((x) => x.key === 'dailyGoal')!.settings!.dailyGoalMin).toBe(75);
  });

  it('týdenní cíle předmětů sníží poměrně a řekne, co nejvíc zaostává', () => {
    const subjects = [subject({ id: 'a', name: 'Matematika', weeklyGoalMin: 600 }), subject({ id: 'b', name: 'Němčina', weeklyGoalMin: 300 })];
    const sessions = [...days(42, () => 50, 'a'), ...days(42, (i) => (i % 7 === 0 ? 30 : 0) || 1, 'b')];
    const s = calibrate(data({ subjects, sessions, settings: { ...data().settings, dailyGoalMin: 0 } }), END).find((x) => x.key === 'weeklyGoals')!;
    expect(s.subjects).toEqual([
      { id: 'a', weeklyGoalMin: 420 },
      { id: 'b', weeklyGoalMin: 210 },
    ]);
    expect(s.reasons.join(' ')).toContain('Němčina');
  });

  it('okno ranního plánu podle toho, kdy se opravdu učí', () => {
    const sessions = [...days(30, () => 90, 's', 14), ...days(30, () => 90, 'x', 21)].map((x, i) => ({ ...x, id: `w${i}` }));
    const d = data({ sessions, settings: { ...data().settings, dailyGoalMin: 0, planDayStart: '08:00', planDayEnd: '22:00' } });
    const s = calibrate(d, END).find((x) => x.key === 'dayWindow')!;
    expect(s.settings).toEqual({ planDayStart: '14:00', planDayEnd: '22:30' });
  });

  it('okno nezúží tam, kde se naplánované bloky plní', () => {
    const sessions = days(30, () => 60, 's', 14);
    const late = (done: boolean) => Array.from({ length: 6 }, (_, i) => block({ id: `late${i}`, start: new Date(2026, 8, 25 - i, 20).getTime(), done }));
    const base = { ...data().settings, dailyGoalMin: 0, planDayStart: '08:00', planDayEnd: '22:00' };
    const kept = calibrate(data({ sessions, planBlocks: late(true), settings: base }), END).find((x) => x.key === 'dayWindow')!;
    expect(kept.settings).toEqual({ planDayStart: '14:00', planDayEnd: '22:00' });
    const cut = calibrate(data({ sessions, planBlocks: late(false), settings: base }), END).find((x) => x.key === 'dayWindow')!;
    expect(cut.settings!.planDayEnd).toBe('18:00');
    expect(cut.reasons.join(' ')).toContain('jen 0 %');
  });

  it('o čem už se rozhodlo, se znovu nenabízí', () => {
    const d = data({ sessions: days(30, () => 60), settings: { ...data().settings, dailyGoalMin: 180, calibration: [{ month: '2026-09', key: 'dailyGoal', action: 'kept', at: 1 }] } });
    expect(pendingSuggestions(d, 2026, 8).find((x) => x.key === 'dailyGoal')).toBeUndefined();
    const other = { ...d, settings: { ...d.settings, calibration: [{ month: '2026-08', key: 'dailyGoal' as const, action: 'kept' as const, at: 1 }] } };
    expect(pendingSuggestions(other, 2026, 8).find((x) => x.key === 'dailyGoal')).toBeDefined();
  });
});

describe('skrytí Reflexe', () => {
  it('úspěchy skryté stránky se nezobrazují ani nepočítají', async () => {
    const { evaluate } = await import('../features/achievements/achievements');
    const refl = { id: 'r1', weekStart: '2026-09-28', rating: 4, wentWell: '', blocked: '', focusNext: '', createdAt: NOW - D, updatedAt: NOW - D };
    const shown = evaluate(data({ reflections: [refl] }), NOW);
    expect(shown.unlockedIds).toContain('first-reflection');
    expect(shown.unlockedIds).toContain('reflections.1');
    const hidden = evaluate(data({ reflections: [refl], settings: { ...data().settings, hiddenPages: ['reflexe'] } }), NOW);
    expect(hidden.unlockedIds.some((id) => id.startsWith('reflection') || id === 'first-reflection')).toBe(false);
    expect(hidden.total).toBe(shown.total - 6); // 5 úrovní + 1 jednorázový
  });
});
