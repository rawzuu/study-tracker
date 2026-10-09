import { AppData, PlanBlock, alive } from '../data/schema';
import { Activity, Recommendation, recommend } from './recommend';
import { focusWindow } from './stats';
import { lectureSubject, lecturesIn } from './timetable';
import { DAY, HOUR, MIN, addDays, atMinutes, startOfDay } from './time';

/**
 * Ranní plánování: navrhne bloky na zbytek dne.
 *
 * 1. Nejdřív nabídne přesunutí nedokončených bloků ze včerejška a (volitelně) krátké opakování
 *    po dnešních přednáškách z rozvrhu.
 * 2. Pak opakovaně volá doporučovací algoritmus a „simuluje“, že vybraný blok už je v plánu
 *    (sníží zaostávání za cílem, odškrtne témata, přidá penalizaci za stejný předmět) –
 *    výsledkem je prokládaný plán podle priorit, dokud se nenaplní denní cíl.
 * 3. Rozmístění: opakování po přednášce hned za hodinu; náročné bloky (nová látka, pokračování,
 *    příprava na zkoušku) do tvé nejsilnější doby podle soustředění; zbytek do nejbližších volných
 *    míst. Stejný předmět nikdy dvakrát za sebou (když je z čeho vybírat), pauza podle délky bloku.
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
  after?: number; // umístit hned po tomto čase (opakování po přednášce)
}

const GAP = 10 * MIN;

/** Pauza po bloku podle jeho délky (25 → 5 min, 50 → 10 min, 90 → 20 min). */
export const breakAfter = (minutes: number) => Math.min(20, Math.max(5, Math.round(minutes / 25) * 5));

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

/** Obsazené intervaly dne (plán + odučené + výuka z rozvrhu), seřazené. */
export function busyIntervals(data: AppData, day: number, exclude: Set<string> = new Set()): [number, number][] {
  const out: [number, number][] = [];
  for (const l of lecturesIn(data, day, addDays(day, 1))) out.push([l.start, l.end]);
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

  // 1b) krátké opakování po dnešních přednáškách (dá se vypnout v Nastavení)
  if (data.settings.lectureRecap !== false) {
    for (const l of lecturesIn(data, day, addDays(day, 1))) {
      if (l.end < now - HOUR) continue;
      const subjectId = lectureSubject(data, l.timetableId, l.series);
      if (!subjectId || sessions.some((s) => s.subjectId === subjectId && s.end > l.end)) continue;
      items.push({ key: `recap-${l.key}`, subjectId, title: `Po přednášce: ${l.title}`, minutes: 15, start: 0, activity: 'recap', reasons: ['krátké shrnutí, dokud je látka čerstvá'], include: true, after: l.end });
      target -= 15;
    }
  }

  // 2) doporučení se simulací – plní se do cíle (i když už žádný předmět nemá kladné skóre)
  const extraMinutes = new Map<string, number>();
  const recentMinutes = new Map<string, number>();
  const coveredTopics = new Set<string>();
  for (const it of items) extraMinutes.set(it.subjectId, (extraMinutes.get(it.subjectId) ?? 0) + it.minutes);
  let lastSubject: string | null = null;
  let guard = 0;
  while (target > 10 && guard++ < 10) {
    const pool: Recommendation[] = recommend({ data, now, sim: { extraMinutes, recentMinutes, coveredTopics, lastSubject } }).filter((x) => x.subjectId && x.activity !== 'recap');
    if (!pool.length) break;
    // Prokládání: stejný předmět nikdy dvakrát po sobě, pokud existuje jiný aktivní předmět (i s nižší prioritou)
    const r: Recommendation = pool[0].subjectId !== lastSubject ? pool[0] : (pool.find((x) => x.subjectId !== lastSubject) ?? pool[0]);
    const minutes = Math.min(r.minutes, Math.max(25, Math.round(target / 5) * 5));
    items.push({ key: `rec-${guard}-${r.key}`, subjectId: r.subjectId!, title: r.title, minutes, start: 0, activity: r.activity, reasons: r.reasons.slice(0, 2), include: true });
    extraMinutes.set(r.subjectId!, (extraMinutes.get(r.subjectId!) ?? 0) + minutes);
    for (const [k, v] of recentMinutes) recentMinutes.set(k, v * 0.5); // čas běží – starší bloky váží méně
    recentMinutes.set(r.subjectId!, (recentMinutes.get(r.subjectId!) ?? 0) + minutes);
    for (const t of r.topics) coveredTopics.add(t.id);
    lastSubject = r.subjectId;
    target -= minutes;
  }

  return place(data, items, now);
}

/**
 * Rozmístí položky do volných míst dne:
 *  1. opakování po přednášce hned za hodinou (nejpozději do 3 h),
 *  2. náročné bloky do nejsilnější doby (podle soustředění), pokud je ještě před tebou,
 *  3. zbytek v pořadí návrhu do nejbližších volných míst – dopoledne tak nezůstane prázdné.
 * Ve všech krocích: stejný předmět nikdy těsně za sebou (když jsou v plánu i jiné předměty)
 * a pauza po bloku podle jeho délky.
 */
export function place(data: AppData, items: DayPlanItem[], now = Date.now()): DayPlanItem[] {
  const { day, from, to } = dayBounds(data, now);
  const busy = busyIntervals(data, day, new Set(items.filter((i) => i.carry).map((i) => i.carry!.id)));
  const peak = focusWindow(alive(data.sessions).filter((s) => s.start > now - 60 * DAY && s.mode !== 'anki'));
  const peakFrom = peak ? atMinutes(day, peak.from * 60) : null;
  const peakTo = peakFrom != null ? peakFrom + 2 * HOUR : null;
  const deep = (a: DayPlanItem['activity']) => a === 'exam' || a === 'new' || a === 'continue';
  const varied = new Set(items.map((i) => i.subjectId)).size > 1;

  const placed: { it: DayPlanItem; start: number }[] = [];
  const startOf = new Map<string, number>();

  /** Stejný předmět nesmí být těsně za sebou (méně než hodinu mezi bloky). */
  const APART = HOUR;
  const neighboursOk = (subjectId: string, start: number, minutes: number) => {
    if (!varied) return true;
    const end = start + minutes * MIN;
    const prev = placed.filter((p) => p.start < start).sort((a, b) => b.start - a.start)[0];
    const next = placed.filter((p) => p.start > start).sort((a, b) => a.start - b.start)[0];
    const prevOk = !prev || prev.it.subjectId !== subjectId || start - (prev.start + prev.it.minutes * MIN) >= APART;
    const nextOk = !next || next.it.subjectId !== subjectId || next.start - end >= APART;
    return prevOk && nextOk;
  };
  const commit = (it: DayPlanItem, start: number) => {
    // pauza po bloku podle délky: findSlot počítá s GAP, intervalu proto přidáme rozdíl
    busy.push([start, start + it.minutes * MIN + breakAfter(it.minutes) * MIN - GAP]);
    busy.sort((a, b) => a[0] - b[0]);
    placed.push({ it, start });
    startOf.set(it.key, start);
  };
  /** Nejdřívější volné místo v [lo, hi], které nekoliduje se sousedy. */
  const slot = (it: DayPlanItem, lo: number, hi: number, strict = true): number | null => {
    let t = lo;
    for (let i = 0; i < 80; i++) {
      const s = findSlot(busy, t, hi, it.minutes);
      if (s == null) return null;
      if (!strict || neighboursOk(it.subjectId, s, it.minutes)) return s;
      t = s + 15 * MIN;
    }
    return null;
  };

  // 1) opakování po přednášce
  for (const it of items.filter((i) => i.after != null)) {
    const s = slot(it, Math.max(from, it.after!), Math.min(to, it.after! + 3 * HOUR + it.minutes * MIN), false);
    if (s != null) commit(it, s);
  }
  // 2) náročné bloky do nejsilnější doby
  if (peakFrom != null && peakTo != null && peakTo > from)
    for (const it of items.filter((i) => i.after == null && deep(i.activity))) {
      const s = slot(it, Math.max(from, peakFrom), Math.min(to, peakTo + it.minutes * MIN));
      if (s != null) commit(it, s);
    }
  // 3) zbytek: opakovaně vyber položku (v pořadí návrhu), která se vejde nejdřív
  let rest = items.filter((i) => i.after == null && !startOf.has(i.key));
  while (rest.length) {
    let pick: { it: DayPlanItem; s: number } | null = null;
    for (const it of rest) {
      const s = slot(it, from, to);
      if (s != null && (!pick || s < pick.s)) pick = { it, s };
    }
    // když nic nesplní střídání předmětů, vezmi aspoň první volné místo (lepší plán než žádný)
    if (!pick)
      for (const it of rest) {
        const s = slot(it, from, to, false);
        if (s != null && (!pick || s < pick.s)) pick = { it, s };
      }
    if (!pick) break;
    commit(pick.it, pick.s);
    rest = rest.filter((i) => i !== pick!.it);
  }

  return items
    .map((it) => (startOf.has(it.key) ? { ...it, start: startOf.get(it.key)! } : { ...it, start: 0, include: false }))
    .sort((a, b) => (a.start || Infinity) - (b.start || Infinity));
}
