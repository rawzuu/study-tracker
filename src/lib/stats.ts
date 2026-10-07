import { Session, Subject } from '../data/schema';
import { DAY, addDays, dayKey, startOfDay, weekdayIdx } from './time';

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

/** Série dní po sobě, kdy ses učil (aktuální může začínat i včera). */
export function streaks(list: Session[]): { current: number; best: number } {
  const days = new Set(list.map((s) => dayKey(s.start)));
  if (!days.size) return { current: 0, best: 0 };
  const sorted = [...days].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const cur = new Date(sorted[i]);
    const diff = Math.round((cur.getTime() - prev.getTime()) / DAY);
    run = diff === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  let current = 0;
  let t = startOfDay(Date.now());
  if (!days.has(dayKey(t))) t = addDays(t, -1);
  while (days.has(dayKey(t))) {
    current++;
    t = addDays(t, -1);
  }
  return { current, best };
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
