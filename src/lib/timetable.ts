import { AppData, Timetable, TimetableEvent, alive } from '../data/schema';
import { WEEKDAYS_SHORT, fmtTime, weekdayIdx } from './time';

/** Termín z rozvrhu, jak se zobrazí v kalendáři. */
export interface Lecture extends TimetableEvent {
  timetableId: string;
}

/** Aktivní termíny ze všech rozvrhů v rozmezí [from, to) – bez skrytých řad a odpadlých termínů. */
export function lecturesIn(data: AppData, from: number, to: number): Lecture[] {
  const out: Lecture[] = [];
  for (const tt of alive(data.timetables ?? [])) {
    const hidden = new Set(tt.hiddenSeries);
    const skipped = new Set(tt.skipped);
    for (const e of tt.events) {
      if (e.end <= from || e.start >= to || hidden.has(e.series) || skipped.has(e.key)) continue;
      out.push({ ...e, timetableId: tt.id });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export interface TimetableDiff {
  added: number;
  removed: number;
  unchanged: number;
  addedSeries: string[];
  removedSeries: string[];
}

/** Co se změní, když nahradíme starý rozvrh novým (porovnává jen budoucí termíny). */
export function diffTimetable(old: TimetableEvent[], next: TimetableEvent[], now = Date.now()): TimetableDiff {
  const oldF = old.filter((e) => e.end > now);
  const nextF = next.filter((e) => e.end > now);
  const oldKeys = new Set(oldF.map((e) => `${e.key}|${e.end}`));
  const nextKeys = new Set(nextF.map((e) => `${e.key}|${e.end}`));
  const oldSeries = new Set(oldF.map((e) => e.series));
  const nextSeries = new Set(nextF.map((e) => e.series));
  return {
    added: nextF.filter((e) => !oldKeys.has(`${e.key}|${e.end}`)).length,
    removed: oldF.filter((e) => !nextKeys.has(`${e.key}|${e.end}`)).length,
    unchanged: nextF.filter((e) => oldKeys.has(`${e.key}|${e.end}`)).length,
    addedSeries: [...nextSeries].filter((s) => !oldSeries.has(s)),
    removedSeries: [...oldSeries].filter((s) => !nextSeries.has(s)),
  };
}

/**
 * Nahradí budoucí termíny rozvrhu novým importem; proběhlé termíny zůstanou tak, jak byly
 * (některé školy exportují jen rozvrh „od dneška“). Skryté předměty a odpadlé termíny zůstanou,
 * pokud v novém rozvrhu pořád existují – uživatel je nemusí nastavovat znovu.
 */
export function replaceEvents(tt: Timetable, next: TimetableEvent[], now = Date.now()): Timetable {
  const events = [...tt.events.filter((e) => e.end <= now), ...next.filter((e) => e.end > now)].sort((a, b) => a.start - b.start);
  const series = new Set(events.map((e) => e.series));
  const keys = new Set(events.map((e) => e.key));
  return {
    ...tt,
    importedAt: now,
    events,
    hiddenSeries: tt.hiddenSeries.filter((s) => series.has(s)),
    skipped: tt.skipped.filter((k) => keys.has(k)),
  };
}

export interface SeriesInfo {
  series: string;
  count: number;
  upcoming: number;
  when: string; // např. „Po 9:15, St 11:00“
  hidden: boolean;
}

/** Přehled řad (předmětů) v rozvrhu pro správu – kdy se konají a kolik termínů zbývá. */
export function seriesOf(tt: Timetable, now = Date.now()): SeriesInfo[] {
  const map = new Map<string, TimetableEvent[]>();
  for (const e of tt.events) {
    if (!map.has(e.series)) map.set(e.series, []);
    map.get(e.series)!.push(e);
  }
  const hidden = new Set(tt.hiddenSeries);
  return [...map.entries()]
    .map(([series, list]) => {
      const slots = new Map<string, number>();
      for (const e of list) {
        const k = `${weekdayIdx(e.start)}|${fmtTime(e.start)}`;
        slots.set(k, (slots.get(k) ?? 0) + 1);
      }
      const when = [...slots.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k]) => k.split('|'))
        .sort((a, b) => Number(a[0]) - Number(b[0]) || a[1].localeCompare(b[1]))
        .map(([d, t]) => `${WEEKDAYS_SHORT[Number(d)]} ${t}`)
        .join(', ');
      return { series, count: list.length, upcoming: list.filter((e) => e.end > now).length, when, hidden: hidden.has(series) };
    })
    .sort((a, b) => a.series.localeCompare(b.series, 'cs'));
}
