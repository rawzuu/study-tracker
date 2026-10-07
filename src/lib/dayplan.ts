import { AppData, PlanBlock, alive } from '../data/schema';
import { Activity, Recommendation, recommend } from './recommend';
import { bestWindow } from './stats';
import { DAY, HOUR, MIN, addDays, atMinutes, startOfDay } from './time';

/**
 * Ranní plánování: navrhne bloky na zbytek dne.
 *
 * 1. Nejdřív nabídne přesunutí nedokončených bloků ze včerejška.
 * 2. Pak opakovaně volá doporučovací algoritmus a „simuluje“, že vybraný blok už je v plánu
 *    (sníží zaostávání za cílem, odškrtne témata, přidá penalizaci za stejný předmět) –
 *    výsledkem je prokládaný plán podle priorit, dokud se nenaplní denní cíl.
 * 3. Bloky rozmístí do volných míst (mezi existující plán a odučené bloky, s pauzou 10 min);
 *    náročné bloky (nová látka, příprava na zkoušku) přednostně do tvé nejsilnější denní doby.
 */

export interface DayPlanItem {
  key: string;
  subjectId: string;
  title: string;
  minutes: number;
  start: number;
  activity: Activity | 'carry';
  reasons: string[];
  include: boolean;
  carry?: PlanBlock; // existující blok, který se jen přesune
}

const GAP = 10 * MIN;

function hm(day: number, v: string): number {
  const [h, m] = v.split(':').map(Number);
  return atMinutes(day, (h || 0) * 60 + (m || 0));
}

/** Nastavené rozmezí dne (bez ohledu na aktuální čas). */
export function dayRange(data: AppData, day: number) {
  return { start: hm(day, data.settings.planDayStart ?? '08:00'), end: hm(day, data.settings.planDayEnd ?? '22:00') };
}

export function dayBounds(data: AppData, now = Date.now()) {
  const day = startOfDay(now);
  const roundUp = Math.ceil(now / (15 * MIN)) * 15 * MIN;
  return { day, from: Math.max(roundUp, hm(day, data.settings.planDayStart ?? '08:00')), to: hm(day, data.settings.planDayEnd ?? '22:00') };
}

/** Obsazené intervaly dne (plán + odučené), seřazené. */
export function busyIntervals(data: AppData, day: number, exclude: Set<string> = new Set()): [number, number][] {
  const out: [number, number][] = [];
  for (const b of alive(data.planBlocks)) if (!exclude.has(b.id) && startOfDay(b.start) === day) out.push([b.start, b.start + b.durationMin * MIN]);
  for (const s of alive(data.sessions)) if (startOfDay(s.start) === day) out.push([s.start, s.end]);
  return out.sort((a, b) => a[0] - b[0]);
}

/** Najde nejbližší volné místo dané délky od `from`. */
export function findSlot(busy: [number, number][], from: number, to: number, minutes: number): number | null {
  let t = from;
  const len = minutes * MIN;
  for (const [a, b] of busy) {
    if (b + GAP <= t) continue;
    if (a - GAP >= t + len) break;
    t = Math.max(t, b + GAP);
  }
  return t + len <= to ? t : null;
}

export function proposeDay(data: AppData, now = Date.now(), extra = 0): DayPlanItem[] {
  const { day } = dayBounds(data, now);
  const sessions = alive(data.sessions);
  const studiedToday = sessions.filter((s) => s.start >= day).reduce((a, s) => a + s.durationSec / 60, 0);
  const plannedLeft = alive(data.planBlocks)
    .filter((b) => !b.done && startOfDay(b.start) === day && b.start + b.durationMin * MIN > now)
    .reduce((a, b) => a + b.durationMin, 0);
  let target = Math.max(0, data.settings.dailyGoalMin - studiedToday - plannedLeft) + extra * 25;

  const items: DayPlanItem[] = [];

  // 1) nedokončené bloky z posledních 2 dnů
  const carry = alive(data.planBlocks).filter((b) => !b.done && b.start < day && b.start >= addDays(day, -2));
  for (const b of carry) {
    items.push({ key: `carry-${b.id}`, subjectId: b.subjectId, title: b.title || 'Nedokončený blok', minutes: b.durationMin, start: 0, activity: 'carry', reasons: ['nedokončeno ' + (b.start >= addDays(day, -1) ? 'včera' : 'předevčírem')], include: true, carry: b });
    target -= b.durationMin;
  }

  // 2) doporučení se simulací
  const extraMinutes = new Map<string, number>();
  const recentMinutes = new Map<string, number>();
  const coveredTopics = new Set<string>();
  for (const it of items) extraMinutes.set(it.subjectId, (extraMinutes.get(it.subjectId) ?? 0) + it.minutes);
  let lastSubject: string | null = null;
  let guard = 0;
  while (target > 10 && guard++ < 8) {
    const pool: Recommendation[] = recommend({ data, now, sim: { extraMinutes, recentMinutes, coveredTopics, lastSubject } }).filter((x) => x.subjectId);
    const top = pool.find((x) => x.score > 0);
    if (!top) break;
    // Prokládání: stejný předmět nikdy dvakrát po sobě, pokud existuje jiný aktivní předmět (i s nižší prioritou)
    const r: Recommendation | undefined = top.subjectId !== lastSubject ? top : (pool.find((x) => x.subjectId !== lastSubject) ?? top);
    if (!r || !r.subjectId) break;
    const minutes = Math.min(r.minutes, Math.max(25, Math.round(target / 5) * 5));
    items.push({ key: `rec-${guard}-${r.key}`, subjectId: r.subjectId, title: r.title, minutes, start: 0, activity: r.activity, reasons: r.reasons.slice(0, 2), include: true });
    extraMinutes.set(r.subjectId, (extraMinutes.get(r.subjectId) ?? 0) + minutes);
    for (const [k, v] of recentMinutes) recentMinutes.set(k, v * 0.5); // čas běží – starší bloky váží méně
    recentMinutes.set(r.subjectId, (recentMinutes.get(r.subjectId) ?? 0) + minutes);
    for (const t of r.topics) coveredTopics.add(t.id);
    lastSubject = r.subjectId;
    target -= minutes;
  }

  return place(data, items, now);
}

/**
 * Rozmístí položky do volných míst dne – v pořadí, v jakém je navrhl algoritmus (to je prokládané
 * podle priorit). Náročný blok se jen posune do tvé nejsilnější denní doby, pokud je ještě před tebou.
 */
export function place(data: AppData, items: DayPlanItem[], now = Date.now()): DayPlanItem[] {
  const { day, from, to } = dayBounds(data, now);
  const busy = busyIntervals(data, day, new Set(items.filter((i) => i.carry).map((i) => i.carry!.id)));
  const peak = bestWindow(alive(data.sessions).filter((s) => s.start > now - 60 * DAY && s.mode !== 'anki'));
  const peakFrom = peak ? atMinutes(day, peak.from * 60) : null;
  const peakTo = peakFrom != null ? peakFrom + 2 * HOUR : null;
  const deep = (a: DayPlanItem['activity']) => a === 'exam' || a === 'new' || a === 'continue';

  const placed: DayPlanItem[] = [];
  let cursor = from;
  for (const it of items) {
    let start: number | null = null;
    if (peakFrom != null && peakTo != null && deep(it.activity) && peakTo > cursor) {
      start = findSlot(busy, Math.max(cursor, peakFrom), Math.min(to, peakTo + it.minutes * MIN), it.minutes);
    }
    if (start == null) start = findSlot(busy, cursor, to, it.minutes);
    if (start == null) {
      placed.push({ ...it, start: 0, include: false });
      continue;
    }
    busy.push([start, start + it.minutes * MIN]);
    busy.sort((a, b) => a[0] - b[0]);
    cursor = start + it.minutes * MIN;
    placed.push({ ...it, start });
  }
  return placed.sort((a, b) => (a.start || Infinity) - (b.start || Infinity));
}
