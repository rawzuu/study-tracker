import { Session, Subject } from '../data/schema';
import { addDays, dayKey, parseDayKey, startOfDay, startOfWeek, weekdayIdx } from './time';

export function inRange(sessions: Session[], from: number, to: number): Session[] {
  return sessions.filter((s) => s.start >= from && s.start < to);
}

export function totalSec(list: Session[]): number {
  return list.reduce((a, s) => a + s.durationSec, 0);
}

/** Sekundy učení po dnech (klíč YYYY-MM-DD). */
export function byDay(list: Session[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of list) {
    const k = dayKey(s.start);
    m.set(k, (m.get(k) ?? 0) + s.durationSec);
  }
  return m;
}

export function bySubject(list: Session[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of list) m.set(s.subjectId, (m.get(s.subjectId) ?? 0) + s.durationSec);
  return m;
}

/** Pravidla série: kolik dní volna týdně ji nepřeruší a od kolika minut se den počítá. */
export interface StreakRules {
  restDays?: number; // 0–2 dny volna za týden (Po–Ne)
  minMin?: number; // 0 = jakékoli učení
}

/** Dny, které se počítají do série (aspoň `minMin` minut učení). */
export function streakDays(list: Session[], minMin = 0): Set<string> {
  const per = byDay(list);
  return new Set([...per.entries()].filter(([, sec]) => sec > 0 && sec >= minMin * 60).map(([k]) => k));
}

/**
 * Průběh série den po dni od `from` do dne `until` (včetně). Série = počet dní s učením;
 * den bez učení ji nepřeruší, pokud v daném týdnu ještě zbývá den volna. Dnešek, který ještě
 * neskončil, ji nepřeruší nikdy.
 */
export function streakRuns(days: Set<string>, from: number, until: number, restDays = 0): { t: number; run: number }[] {
  const out: { t: number; run: number }[] = [];
  const end = startOfDay(until);
  let run = 0;
  let week = -1;
  let rest = 0;
  for (let t = startOfDay(from); t <= end; t = addDays(t, 1)) {
    const w = startOfWeek(t);
    if (w !== week) {
      week = w;
      rest = 0;
    }
    if (days.has(dayKey(t))) run++;
    else if (t === end) {
      /* dnešek ještě běží */
    } else if (run > 0 && rest < restDays) rest++;
    else run = 0;
    out.push({ t, run });
  }
  return out;
}

/** Aktuální a nejdelší série. */
export function streaks(list: Session[], rules: StreakRules = {}, now = Date.now()): { current: number; best: number } {
  const days = streakDays(list, rules.minMin ?? 0);
  if (!days.size) return { current: 0, best: 0 };
  const first = parseDayKey([...days].sort()[0]).getTime();
  const runs = streakRuns(days, first, now, rules.restDays ?? 0);
  return { current: runs[runs.length - 1]?.run ?? 0, best: Math.max(0, ...runs.map((r) => r.run)) };
}

/**
 * Matice [den v týdnu][hodina] s minutami učení.
 * Sezení se rozpočítá přesně do hodin, přes které zasahuje.
 */
export function hourWeekdayMatrix(list: Session[]): number[][] {
  const m = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const s of list) {
    const span = Math.max(1, s.end - s.start);
    const ratio = (s.durationSec * 1000) / span; // podíl čistého času (bez pauz)
    let t = s.start;
    while (t < s.end) {
      const d = new Date(t);
      const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
      const seg = Math.min(nextHour, s.end) - t;
      m[weekdayIdx(t)][d.getHours()] += (seg * ratio) / 60_000;
      t += seg;
    }
  }
  return m;
}

/** Minuty učení po hodinách dne (0–23). */
export function byHour(list: Session[]): number[] {
  const mat = hourWeekdayMatrix(list);
  return Array.from({ length: 24 }, (_, h) => mat.reduce((a, row) => a + row[h], 0));
}

/** Průměrné soustředění podle hodiny začátku sezení. */
export function focusByHour(list: Session[]): (number | null)[] {
  const sum = new Array<number>(24).fill(0);
  const cnt = new Array<number>(24).fill(0);
  for (const s of list) {
    if (!s.focus) continue;
    const h = new Date(s.start).getHours();
    sum[h] += s.focus;
    cnt[h]++;
  }
  return sum.map((v, i) => (cnt[i] ? v / cnt[i] : null));
}

export function avgFocus(list: Session[]): number | null {
  const rated = list.filter((s) => s.focus);
  if (!rated.length) return null;
  return rated.reduce((a, s) => a + (s.focus ?? 0), 0) / rated.length;
}

/** Nejproduktivnější 2hodinové okno podle minut. */
export function bestWindow(list: Session[]): { from: number; to: number } | null {
  const h = byHour(list);
  let best = -1;
  let at = 0;
  for (let i = 0; i < 24; i++) {
    const v = h[i] + h[(i + 1) % 24];
    if (v > best) {
      best = v;
      at = i;
    }
  }
  return best > 0 ? { from: at, to: (at + 2) % 24 } : null;
}

export function subjectMap(subjects: Subject[]): Map<string, Subject> {
  return new Map(subjects.map((s) => [s.id, s]));
}

/** Minuty sezení rozdělené do hodin dne (podle toho, kdy opravdu probíhalo). */
function hourMinutes(s: Session): [number, number][] {
  const out: [number, number][] = [];
  const span = Math.max(1, s.end - s.start);
  const ratio = (s.durationSec * 1000) / span;
  let t = s.start;
  while (t < s.end) {
    const d = new Date(t);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
    const seg = Math.min(next, s.end) - t;
    out.push([d.getHours(), (seg * ratio) / 60_000]);
    t += seg;
  }
  return out;
}

/**
 * Nejsilnější 2hodinové okno podle KVALITY soustředění (vážený průměr hodnocení 1–5).
 * Málo dat v okně se „přitahuje“ k celkovému průměru, aby nevyhrálo okno s jedním výborným blokem.
 * Bez dostatku hodnocení se vrátí okno podle množství učení.
 */
export function focusWindow(list: Session[]): { from: number; to: number } | null {
  const rated = list.filter((s) => s.focus && s.mode !== 'anki');
  if (rated.length < 8) return bestWindow(list);
  const min = new Array<number>(24).fill(0);
  const fsum = new Array<number>(24).fill(0);
  for (const s of rated)
    for (const [h, m] of hourMinutes(s)) {
      min[h] += m;
      fsum[h] += m * (s.focus ?? 0);
    }
  const total = min.reduce((a, b) => a + b, 0);
  const g = fsum.reduce((a, b) => a + b, 0) / total;
  const K = 90; // „virtuálních“ minut s průměrným soustředěním
  let best: { at: number; score: number } | null = null;
  for (let i = 0; i < 24; i++) {
    const j = (i + 1) % 24;
    const w = min[i] + min[j];
    if (w < Math.max(60, total * 0.05)) continue;
    const score = (fsum[i] + fsum[j] + K * g) / (w + K);
    if (!best || score > best.score) best = { at: i, score };
  }
  return best ? { from: best.at, to: (best.at + 2) % 24 } : bestWindow(list);
}
