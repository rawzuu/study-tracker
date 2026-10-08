import { AppData, CalibrationEntry, Settings, alive } from '../data/schema';
import { DAY, addDays, dayKey, fmtDuration, minutesOfDay, startOfDay, startOfWeek } from './time';
import { byDay } from './stats';

/**
 * Kalibrace cílů a plánu podle skutečnosti – návrhy v měsíčním reportu.
 *
 * Princip: data z posledních 8 týdnů, novější dny váží víc (poločas 14 dní). Návrh vzniká, jen když
 * se realita od nastavení dlouhodobě liší, a změna je omezená (nejvýš ±30 % za měsíc), aby se cíle
 * neměnily skokově a neplavaly podle jednoho výjimečného týdne.
 *
 *  - Denní cíl: má být splnitelný zhruba v 70 % studijních dní. Návrh přijde, když se splňuje
 *    v méně než 45 % (cíl je nereálný) nebo ve více než 85 % (cíl je příliš snadný).
 *  - Týdenní cíle předmětů: když se dlouhodobě plní jen malá část, sníží se všechny poměrně
 *    (priority mezi předměty zůstanou); když se všechny plní s velkou rezervou, mírně se zvýší.
 *  - Časové okno ranního plánu: podle toho, kdy se člověk opravdu učí (10.–90. percentil),
 *    aby plán nenabízel bloky v hodinách, kdy se stejně neuskuteční.
 */

export type CalibrationKey = CalibrationEntry['key'];

export interface Suggestion {
  key: CalibrationKey;
  title: string;
  current: string;
  proposed: string;
  reasons: string[];
  settings?: Partial<Settings>;
  subjects?: { id: string; weeklyGoalMin: number }[];
  before: unknown;
  after: unknown;
}

const LOOKBACK_DAYS = 56;
const HALF_LIFE_DAYS = 14;
const MAX_STEP = 0.3;

const recency = (end: number, t: number) => 0.5 ** ((end - t) / (HALF_LIFE_DAYS * DAY));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round15 = (min: number) => Math.round(min / 15) * 15;
const fmtMin = (min: number) => fmtDuration(min * 60);
const hm = (min: number) => `${Math.floor(min / 60) % 24}:${String(Math.round(min % 60)).padStart(2, '0')}`;
const toMin = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const pad = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Vážený kvantil (váhy = recency). */
export function weightedQuantile(values: number[], weights: number[], q: number): number {
  const pairs = values.map((v, i) => [v, weights[i]] as const).sort((a, b) => a[0] - b[0]);
  const total = pairs.reduce((a, p) => a + p[1], 0);
  let acc = 0;
  for (const [v, w] of pairs) {
    acc += w;
    if (acc >= q * total - 1e-9) return v;
  }
  return pairs[pairs.length - 1]?.[0] ?? 0;
}

function dailyGoal(data: AppData, end: number): Suggestion | null {
  const goal = data.settings.dailyGoalMin;
  if (!goal || goal <= 0) return null; // 0 = vědomě bez cíle
  const lastDay = startOfDay(end - 1);
  const firstDay = addDays(lastDay, -(LOOKBACK_DAYS - 1));
  const perDay = byDay(alive(data.sessions).filter((s) => s.start >= firstDay && s.start < end));
  const days: { min: number; w: number }[] = [];
  for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) {
    const min = (perDay.get(dayKey(d)) ?? 0) / 60;
    if (min >= 5) days.push({ min, w: recency(end, d) });
  }
  if (days.length < 10) return null;
  const wSum = days.reduce((a, d) => a + d.w, 0);
  const hit = days.reduce((a, d) => a + (d.min >= goal ? d.w : 0), 0) / wSum;
  if (hit >= 0.45 && hit <= 0.85) return null;

  const raw = weightedQuantile(days.map((d) => d.min), days.map((d) => d.w), 0.3);
  const step = Math.max(15, goal * MAX_STEP);
  const capped = clamp(raw, goal - step, goal + step);
  // zaokrouhlit na 15 min směrem k původnímu cíli, aby krok nepřekročil limit
  const proposed = Math.max(30, capped < goal ? Math.ceil(capped / 15) * 15 : Math.floor(capped / 15) * 15);
  if (Math.abs(proposed - goal) < Math.max(15, goal * 0.1)) return null;

  const met = days.filter((d) => d.min >= goal).length;
  const median = weightedQuantile(days.map((d) => d.min), days.map(() => 1), 0.5);
  const reasons = [`Cíl ${fmtMin(goal)} byl splněn v ${met} z ${days.length} studijních dní za posledních 8 týdnů.`, `Typický studijní den: ${fmtMin(round15(median) || median)}.`];
  const blocks = alive(data.planBlocks).filter((b) => b.start >= firstDay && b.start < end);
  if (blocks.length >= 5) reasons.push(`Z naplánovaných bloků se uskutečnilo ${Math.round((blocks.filter((b) => b.done).length / blocks.length) * 100)} %.`);
  reasons.push(
    proposed < goal
      ? 'Nový cíl by se splnil zhruba v 7 z 10 dní – pořád táhne nahoru, ale nepůsobí jako předem prohraný. Ranní plán podle něj navrhne reálné množství.'
      : 'Cíl se plní skoro pokaždé, o kousek vyšší posune dál.',
  );
  if (capped !== raw) reasons.push('Změna je za měsíc omezená, případné doladění přijde příště.');
  return {
    key: 'dailyGoal',
    title: 'Denní cíl',
    current: fmtMin(goal),
    proposed: fmtMin(proposed),
    reasons,
    settings: { dailyGoalMin: proposed },
    before: goal,
    after: proposed,
  };
}

function weeklyGoals(data: AppData, end: number): Suggestion | null {
  const goals = alive(data.subjects).filter((s) => !s.archived && s.weeklyGoalMin > 0);
  if (!goals.length) return null;
  const G = goals.reduce((a, s) => a + s.weeklyGoalMin, 0);
  const sessions = alive(data.sessions);
  const lastWeek = startOfWeek(end); // první neúplný týden se nepočítá
  const weeks: { coverage: number; total: number; per: Map<string, number>; w: number }[] = [];
  for (let i = 1; i <= 6; i++) {
    const from = addDays(lastWeek, -7 * i);
    const to = addDays(from, 7);
    const list = sessions.filter((s) => s.start >= from && s.start < to);
    if (!list.length) continue;
    const per = new Map<string, number>();
    for (const s of list) per.set(s.subjectId, (per.get(s.subjectId) ?? 0) + s.durationSec / 60);
    const covered = goals.reduce((a, s) => a + Math.min(per.get(s.id) ?? 0, s.weeklyGoalMin), 0);
    const total = goals.reduce((a, s) => a + (per.get(s.id) ?? 0), 0);
    weeks.push({ coverage: covered / G, total: total / G, per, w: recency(end, to) });
  }
  if (weeks.length < 3) return null;
  const wSum = weeks.reduce((a, w) => a + w.w, 0);
  const C = weeks.reduce((a, w) => a + w.coverage * w.w, 0) / wSum;
  const T = weightedQuantile(weeks.map((w) => w.total), weeks.map((w) => w.w), 0.5);

  let f: number;
  if (C < 0.6) f = clamp(T, 1 - MAX_STEP, 0.9);
  else if (C >= 0.95 && T >= 1.25) f = clamp(T * 0.9, 1.1, 1 + MAX_STEP);
  else return null;

  const next = goals.map((s) => ({ id: s.id, weeklyGoalMin: Math.max(15, round15(s.weeklyGoalMin * f)) }));
  if (next.every((n, i) => n.weeklyGoalMin === goals[i].weeklyGoalMin)) return null;
  const newG = next.reduce((a, n) => a + n.weeklyGoalMin, 0);

  const reasons = [
    `Cíle předmětů dávají dohromady ${fmtMin(G)} týdně, odučí se typicky kolem ${fmtMin(round15(T * G))}.`,
    `Za posledních ${weeks.length} týdnů se v průměru splnilo ${Math.round(C * 100)} % cílů.`,
  ];
  if (f < 1) {
    const behind = goals
      .map((s) => ({ s, c: weeks.reduce((a, w) => a + Math.min(1, (w.per.get(s.id) ?? 0) / s.weeklyGoalMin) * w.w, 0) / wSum }))
      .filter((x) => x.c < 0.5)
      .sort((a, b) => a.c - b.c)
      .slice(0, 2);
    if (behind.length) reasons.push(`Nejvíc zaostává: ${behind.map((x) => `${x.s.name} (${Math.round(x.c * 100)} %)`).join(', ')}.`);
  }
  reasons.push('Všechny cíle se upraví poměrně – pořadí důležitosti předmětů zůstane stejné.');
  return {
    key: 'weeklyGoals',
    title: 'Týdenní cíle předmětů',
    current: `${fmtMin(G)} týdně`,
    proposed: `${fmtMin(newG)} týdně`,
    reasons,
    subjects: next,
    before: Object.fromEntries(goals.map((s) => [s.id, s.weeklyGoalMin])),
    after: Object.fromEntries(next.map((n) => [n.id, n.weeklyGoalMin])),
  };
}

function dayWindow(data: AppData, end: number): Suggestion | null {
  const from = addDays(startOfDay(end - 1), -(LOOKBACK_DAYS - 1));
  const list = alive(data.sessions).filter((s) => s.start >= from && s.start < end && s.mode !== 'anki' && s.end > s.start);
  if (list.length < 15) return null;
  const late = (m: number) => (m < 4 * 60 ? m + 24 * 60 : m); // učení po půlnoci patří k večeru
  const w = list.map((s) => recency(end, s.start));
  const starts = list.map((s) => late(minutesOfDay(s.start)));
  const ends = list.map((s) => {
    const m = minutesOfDay(s.end);
    return startOfDay(s.end) > startOfDay(s.start) || m < 4 * 60 ? m + 24 * 60 : m;
  });
  const p10 = weightedQuantile(starts, w, 0.1);
  const p90 = weightedQuantile(ends, w, 0.9);
  const curStart = toMin(data.settings.planDayStart ?? '08:00');
  const curEnd = toMin(data.settings.planDayEnd ?? '22:00');
  let newStart = clamp(Math.floor(p10 / 30) * 30, 5 * 60, 14 * 60);
  let newEnd = clamp(Math.ceil(p90 / 30) * 30, newStart + 4 * 60, 23 * 60 + 30);
  // Okno nezužujeme tam, kde se naplánované bloky z velké části opravdu plní – plán tam funguje.
  const blocks = alive(data.planBlocks).filter((b) => b.start >= from && b.start < end);
  const doneRate = (list: typeof blocks) => (list.length >= 3 ? list.filter((b) => b.done).length / list.length : null);
  const early = blocks.filter((b) => minutesOfDay(b.start) < newStart);
  const lateBlocks = blocks.filter((b) => minutesOfDay(b.start) >= newEnd);
  if (newStart > curStart && (doneRate(early) ?? 0) >= 0.5) newStart = curStart;
  if (newEnd < curEnd && (doneRate(lateBlocks) ?? 0) >= 0.5) newEnd = curEnd;
  if (Math.abs(newStart - curStart) < 60 && Math.abs(newEnd - curEnd) < 60) return null;

  const reasons = [`80 % učení za posledních 8 týdnů probíhá mezi ${hm(p10)} a ${hm(p90)}.`];
  if (newStart - curStart >= 60 && early.length >= 3) reasons.push(`Z bloků naplánovaných před ${hm(newStart)} se uskutečnilo ${Math.round(doneRate(early)! * 100)} %.`);
  if (curStart - newStart >= 60) reasons.push(`Část učení probíhá už před ${hm(curStart)}, kam ranní plán teď nic nedává.`);
  if (newEnd - curEnd >= 60) reasons.push(`Část učení probíhá i po ${hm(curEnd)}, kam ranní plán teď nic nedává.`);
  if (curEnd - newEnd >= 60) {
    reasons.push(
      lateBlocks.length >= 3
        ? `Z bloků naplánovaných po ${hm(newEnd)} se uskutečnilo jen ${Math.round(doneRate(lateBlocks)! * 100)} %.`
        : `Po ${hm(newEnd)} se učíš jen výjimečně, ranní plán tam ale bloky nabízí.`,
    );
  }
  reasons.push('Ranní plán pak bude navrhovat bloky v hodinách, kdy se opravdu učíš.');
  const before = { start: data.settings.planDayStart, end: data.settings.planDayEnd };
  const after = { start: pad(newStart), end: pad(newEnd) };
  return {
    key: 'dayWindow',
    title: 'Časové okno ranního plánu',
    current: `${hm(curStart)}–${hm(curEnd)}`,
    proposed: `${hm(newStart)}–${hm(newEnd)}`,
    reasons,
    settings: { planDayStart: after.start, planDayEnd: after.end },
    before,
    after,
  };
}

/** Návrhy úprav k datu `end` (konec měsíce reportu). Vrací jen ty, které mají oporu v datech. */
export function calibrate(data: AppData, end: number): Suggestion[] {
  return [dailyGoal(data, end), weeklyGoals(data, end), dayWindow(data, end)].filter((s): s is Suggestion => s !== null);
}

/** Je dost dat, aby návrhy dávaly smysl? (aspoň 10 studijních dní za 8 týdnů) */
export function enoughData(data: AppData, end: number): boolean {
  const from = addDays(startOfDay(end - 1), -(LOOKBACK_DAYS - 1));
  const perDay = byDay(alive(data.sessions).filter((s) => s.start >= from && s.start < end));
  return [...perDay.values()].filter((sec) => sec >= 300).length >= 10;
}

export const monthKey = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;

/** Návrhy pro daný měsíc, o kterých uživatel ještě nerozhodl. */
export function pendingSuggestions(data: AppData, y: number, m: number): Suggestion[] {
  const month = monthKey(y, m);
  const end = Math.min(new Date(y, m + 1, 1).getTime(), Date.now());
  const decided = new Set((data.settings.calibration ?? []).filter((c) => c.month === month).map((c) => c.key));
  return calibrate(data, end).filter((s) => !decided.has(s.key));
}
