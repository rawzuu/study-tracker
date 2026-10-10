import { PlanBlock, Session, Subject } from '../data/schema';
import { StreakRules, avgFocus, byDay, byHour, bySubject, inRange, streakDays, streakRuns, totalSec } from './stats';
import { DAY, addDays, dayKey, fmtDuration, startOfDay, weekdayIdx } from './time';

/**
 * Výpočty pro měsíční report a týdenní reflexi.
 * Vše jsou čisté funkce nad seznamem sezení – snadno se testují a rozšiřují.
 */

export interface PeriodStats {
  from: number;
  to: number;
  days: number; // počet dní v období (u běžícího období jen do dneška)
  total: number; // s
  sessions: number;
  activeDays: number;
  consistency: number; // 0–1
  avgPerActiveDay: number; // s
  avgSession: number; // s
  longestSession: Session | null;
  bestDay: { key: string; sec: number } | null;
  longestStreak: number;
  focus: number | null;
  deepShare: number; // podíl času v blocích ≥ 45 min
  interruptionsPerHour: number;
  weekdayAvg: number[]; // průměrné minuty na den v týdnu (Po–Ne)
  hourMinutes: number[]; // 0–23
  peakWindow: { from: number; to: number } | null;
  dayparts: { label: string; min: number; focus: number | null }[];
  chronotype: string;
  perSubject: Map<string, number>;
  perDay: Map<string, number>;
  planAdherence: number | null; // podíl splněných naplánovaných bloků
  plannedSec: number;
}

const WEEKDAY_IN = ['v pondělí', 'v úterý', 've středu', 've čtvrtek', 'v pátek', 'v sobotu', 'v neděli'];
const DAYPART_WHEN: Record<string, string> = { Ráno: 'ráno', Odpoledne: 'odpoledne', Večer: 'večer', Noc: 'v noci' };

const DAYPARTS = [
  { label: 'Ráno', from: 5, to: 12 },
  { label: 'Odpoledne', from: 12, to: 17 },
  { label: 'Večer', from: 17, to: 22 },
  { label: 'Noc', from: 22, to: 29 },
];

export function periodStats(all: Session[], blocks: PlanBlock[], from: number, to: number, rules: StreakRules = {}): PeriodStats {
  const list = inRange(all, from, to);
  const now = Date.now();
  const effTo = Math.min(to, startOfDay(now) + DAY);
  const days = Math.max(1, Math.round((effTo - from) / DAY));
  const total = totalSec(list);
  const perDay = byDay(list);
  const activeDays = perDay.size;

  let bestDay: PeriodStats['bestDay'] = null;
  for (const [key, sec] of perDay) if (!bestDay || sec > bestDay.sec) bestDay = { key, sec };

  // série v rámci období – stejná pravidla jako na přehledu (dny volna, minimum minut)
  const sDays = streakDays(list, rules.minMin ?? 0);
  const longestStreak = effTo > from ? Math.max(0, ...streakRuns(sDays, from, effTo - 1, rules.restDays ?? 0).map((r) => r.run)) : 0;

  // průměr na den v týdnu = součet / počet takových dní v období
  const wdTotals = new Array(7).fill(0);
  const wdCount = new Array(7).fill(0);
  for (let t = from; t < effTo; t = addDays(t, 1)) {
    const i = weekdayIdx(t);
    wdCount[i]++;
    wdTotals[i] += (perDay.get(dayKey(t)) ?? 0) / 60;
  }
  const weekdayAvg = wdTotals.map((v, i) => (wdCount[i] ? v / wdCount[i] : 0));

  const hourMinutes = byHour(list);
  let peakWindow: PeriodStats['peakWindow'] = null;
  let best = 0;
  for (let h = 0; h < 24; h++) {
    const v = hourMinutes[h] + hourMinutes[(h + 1) % 24];
    if (v > best) {
      best = v;
      peakWindow = { from: h, to: (h + 2) % 24 };
    }
  }

  const dayparts = DAYPARTS.map((p) => {
    const inPart = (h: number) => (p.to > 24 ? h >= p.from || h < p.to - 24 : h >= p.from && h < p.to);
    const min = hourMinutes.reduce((a, v, h) => (inPart(h) ? a + v : a), 0);
    const focus = avgFocus(list.filter((s) => inPart(new Date(s.start).getHours())));
    return { label: p.label, min, focus };
  });
  const totalMin = total / 60 || 1;
  const morning = dayparts[0].min / totalMin;
  const night = (dayparts[2].min + dayparts[3].min) / totalMin;
  const chronotype = !list.length
    ? '—'
    : morning >= 0.45
      ? 'Ranní ptáče'
      : night >= 0.55
        ? 'Noční sova'
        : 'Denní typ';

  // Bloky z Anki jsou krátké opakování kartiček – do průměrné délky bloku a hluboké práce je nepočítáme.
  const focusList = list.filter((s) => s.mode !== 'anki');
  const focusTotal = totalSec(focusList);
  const deep = focusList.filter((s) => s.durationSec >= 45 * 60).reduce((a, s) => a + s.durationSec, 0);
  const interruptions = list.reduce((a, s) => a + s.interruptions, 0);

  const pastBlocks = blocks.filter((b) => !b.deletedAt && b.start >= from && b.start < Math.min(to, now));
  const planAdherence = pastBlocks.length ? pastBlocks.filter((b) => b.done).length / pastBlocks.length : null;

  return {
    from,
    to,
    days,
    total,
    sessions: list.length,
    activeDays,
    consistency: activeDays / days,
    avgPerActiveDay: activeDays ? total / activeDays : 0,
    avgSession: focusList.length ? focusTotal / focusList.length : 0,
    longestSession: focusList.reduce<Session | null>((m, s) => (!m || s.durationSec > m.durationSec ? s : m), null),
    bestDay,
    longestStreak,
    focus: avgFocus(list),
    deepShare: focusTotal ? deep / focusTotal : 0,
    interruptionsPerHour: total ? interruptions / (total / 3600) : 0,
    weekdayAvg,
    hourMinutes,
    peakWindow,
    dayparts,
    chronotype,
    perSubject: bySubject(list),
    perDay,
    planAdherence,
    plannedSec: blocks.filter((b) => !b.deletedAt && b.start >= from && b.start < to).reduce((a, b) => a + b.durationMin * 60, 0),
  };
}

export function monthRange(year: number, month: number): { from: number; to: number } {
  return { from: new Date(year, month, 1).getTime(), to: new Date(year, month + 1, 1).getTime() };
}

export function pct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** Zajímavé postřehy v lidské řeči. */
export function highlights(cur: PeriodStats, prev: PeriodStats, subjects: Subject[]): string[] {
  const name = (id: string) => subjects.find((s) => s.id === id)?.name ?? '?';
  const out: string[] = [];
  if (!cur.sessions) return out;

  const change = pct(cur.total, prev.total);
  if (change != null) {
    out.push(
      change >= 0
        ? `O ${change} % víc učení než v předchozím období (+${fmtDuration(cur.total - prev.total)}).`
        : `O ${Math.abs(change)} % méně učení než v předchozím období (−${fmtDuration(prev.total - cur.total)}).`,
    );
  }
  if (cur.bestDay) {
    const d = new Date(cur.bestDay.key);
    out.push(`Nejsilnější den: ${d.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' })} – ${fmtDuration(cur.bestDay.sec)}.`);
  }
  const bestWd = cur.weekdayAvg.indexOf(Math.max(...cur.weekdayAvg));
  if (cur.weekdayAvg[bestWd] > 0) out.push(`Nejvíc se učíš ${WEEKDAY_IN[bestWd]} – v průměru ${fmtDuration(cur.weekdayAvg[bestWd] * 60)}.`);

  const focused = cur.dayparts.filter((p) => p.focus != null && p.min >= 30).sort((a, b) => (b.focus ?? 0) - (a.focus ?? 0));
  if (focused.length >= 2) {
    const top = focused[0];
    const low = focused[focused.length - 1];
    if ((top.focus ?? 0) - (low.focus ?? 0) >= 0.3)
      out.push(`Nejlépe se soustředíš ${DAYPART_WHEN[top.label]} (${top.focus!.toFixed(1)} / 5), nejhůř ${DAYPART_WHEN[low.label]} (${low.focus!.toFixed(1)}).`);
  }

  // největší růst předmětu
  let grow: { id: string; diff: number } | null = null;
  for (const [id, sec] of cur.perSubject) {
    const diff = sec - (prev.perSubject.get(id) ?? 0);
    if (!grow || diff > grow.diff) grow = { id, diff };
  }
  if (grow && grow.diff >= 1800) out.push(`Největší posun: ${name(grow.id)} (+${fmtDuration(grow.diff)}).`);

  if (cur.deepShare >= 0.5) out.push(`${Math.round(cur.deepShare * 100)} % času připadlo na hluboké bloky nad 45 minut. Skvělé pro náročnou látku.`);
  else if (cur.sessions >= 6) out.push(`Jen ${Math.round(cur.deepShare * 100)} % času bylo v blocích nad 45 minut. U náročné látky zkus delší bloky.`);

  if (cur.consistency >= 0.7) out.push(`Učení v ${cur.activeDays} z ${cur.days} dní – výborná pravidelnost.`);
  else if (cur.activeDays > 0) out.push(`Učení v ${cur.activeDays} z ${cur.days} dní. Pravidelné kratší učení funguje lépe než nárazovky.`);

  if (cur.longestSession) out.push(`Nejdelší blok: ${fmtDuration(cur.longestSession.durationSec)} (${name(cur.longestSession.subjectId)}).`);
  return out;
}
