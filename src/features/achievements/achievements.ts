import { AppData, Session, alive } from '../../data/schema';
import { BUILTIN_MODES } from '../timer/modes';
import { DAY, addDays, dayKey, parseDayKey, startOfDay, startOfWeek } from '../../lib/time';

/**
 * Úspěchy (odznaky). Počítají se vždy z dat – jsou tedy zpětné, synchronizované a nikdy „neutečou“.
 *
 * ID jsou stabilní („hours.3“, „exam-ready“) – připraveno na budoucí online statistiky
 * (kolik % uživatelů úspěch má), viz share.ts. Nová úroveň = přidat práh na konec, nikdy neměnit pořadí.
 */
export const ACHIEVEMENTS_VERSION = 1;

export type Group = 'Čas' | 'Pravidelnost' | 'Soustředění' | 'Paměť' | 'Plánování' | 'Pestrost' | 'Zvláštní';
export const GROUPS: Group[] = ['Čas', 'Pravidelnost', 'Soustředění', 'Paměť', 'Plánování', 'Pestrost', 'Zvláštní'];

export type IconName =
  | 'clock' | 'flame' | 'blocks' | 'sun' | 'calendar' | 'target' | 'mountain' | 'repeat' | 'anchor' | 'check' | 'notebook'
  | 'list' | 'star' | 'trophy' | 'book' | 'layers' | 'shuffle' | 'sunrise' | 'moon' | 'coffee' | 'shield' | 'brain'
  | 'flask' | 'graduation' | 'undo' | 'grid' | 'sparkles' | 'gift' | 'pi' | 'hourglass';

/** Fakta spočítaná jednou z dat; jednotlivé úspěchy z nich jen čtou. */
export interface Facts {
  now: number;
  sessions: Session[]; // všechna (bez smazaných), seřazená podle konce
  focus: Session[]; // bez Anki
  perDay: Map<string, number>; // s
  daysSorted: string[];
  subjectsDay: Map<string, Set<string>>;
  data: AppData;
}

export function buildFacts(data: AppData, now = Date.now()): Facts {
  const sessions = alive(data.sessions).sort((a, b) => a.end - b.end);
  const perDay = new Map<string, number>();
  const subjectsDay = new Map<string, Set<string>>();
  for (const s of sessions) {
    const k = dayKey(s.start);
    perDay.set(k, (perDay.get(k) ?? 0) + s.durationSec);
    if (!subjectsDay.has(k)) subjectsDay.set(k, new Set());
    subjectsDay.get(k)!.add(s.subjectId);
  }
  return { now, sessions, focus: sessions.filter((s) => s.mode !== 'anki'), perDay, daysSorted: [...perDay.keys()].sort(), subjectsDay, data };
}

/** Hodnota + kdy byl daný práh poprvé dosažen (null = neznámo / nedosaženo). */
export interface Metric {
  value: number;
  reachedAt: (threshold: number) => number | null;
}

/** Kumulativní metrika z (čas, přírůstek). */
function cumulative(events: [number, number][]): Metric {
  const sorted = [...events].sort((a, b) => a[0] - b[0]);
  let acc = 0;
  const line = sorted.map(([t, v]) => [t, (acc += v)] as [number, number]);
  return { value: acc, reachedAt: (th) => line.find(([, v]) => v >= th - 1e-9)?.[0] ?? null };
}
const count = (times: number[]) => cumulative(times.map((t) => [t, 1]));

/** Maximum z (čas, hodnota) – rekordy. */
function record(points: [number, number][]): Metric {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  return { value: sorted.reduce((m, [, v]) => Math.max(m, v), 0), reachedAt: (th) => sorted.find(([, v]) => v >= th)?.[0] ?? null };
}

/** Hodnota bez časové osy. */
const plain = (value: number): Metric => ({ value, reachedAt: () => null });

export interface Family {
  id: string;
  name: string;
  group: Group;
  icon: IconName;
  thresholds: number[];
  unit: 'h' | 'd' | 'x' | 'min' | '';
  desc: (t: number) => string;
  metric: (f: Facts) => Metric;
}

export interface Single {
  id: string;
  name: string;
  group: Group;
  icon: IconName;
  desc: string;
  secret?: boolean;
  /** Vrátí čas odemčení, -1 = odemčeno (čas neznámý), null = zamčeno. */
  check: (f: Facts) => number | null;
}

const H = 3600;
const fmtN = (n: number) => n.toLocaleString('cs-CZ');
const cz = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

function streakMetric(f: Facts): Metric {
  const pts: [number, number][] = [];
  let run = 0;
  let prev: number | null = null;
  for (const k of f.daysSorted) {
    const t = parseDayKey(k).getTime();
    run = prev != null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    prev = t;
    pts.push([t, run]);
  }
  return record(pts);
}

function weekTotals(f: Facts): [number, number][] {
  const m = new Map<number, number>();
  for (const s of f.sessions) {
    const w = startOfWeek(s.start);
    m.set(w, (m.get(w) ?? 0) + s.durationSec);
  }
  return [...m.entries()].map(([w, sec]) => [w, sec / H]);
}

function subjectCrossings(f: Facts, hours: number): number[] {
  const acc = new Map<string, number>();
  const crossed: number[] = [];
  for (const s of f.focus) {
    const before = acc.get(s.subjectId) ?? 0;
    const after = before + s.durationSec;
    acc.set(s.subjectId, after);
    if (before < hours * H && after >= hours * H) crossed.push(s.end);
  }
  return crossed;
}

export const FAMILIES: Family[] = [
  // ---------- Čas ----------
  { id: 'hours', name: 'Hodiny', group: 'Čas', icon: 'clock', unit: 'h', thresholds: [1, 10, 25, 50, 100, 250, 500, 1000], desc: (t) => `${fmtN(t)} ${cz(t, 'hodina', 'hodiny', 'hodin')} učení celkem`, metric: (f) => cumulative(f.sessions.map((s) => [s.end, s.durationSec / H])) },
  { id: 'day', name: 'Silný den', group: 'Čas', icon: 'sun', unit: 'h', thresholds: [2, 4, 6, 8], desc: (t) => `${t} h učení za jeden den`, metric: (f) => record([...f.perDay.entries()].map(([k, s]) => [parseDayKey(k).getTime(), s / H])) },
  { id: 'week', name: 'Silný týden', group: 'Čas', icon: 'calendar', unit: 'h', thresholds: [10, 20, 30, 40], desc: (t) => `${t} h učení za jeden týden`, metric: (f) => record(weekTotals(f)) },
  { id: 'specialist', name: 'Specialista', group: 'Čas', icon: 'book', unit: 'h', thresholds: [10, 50, 100, 250], desc: (t) => `${t} h v jednom předmětu`, metric: (f) => {
    const vals = new Map<string, number>();
    for (const s of f.focus) vals.set(s.subjectId, (vals.get(s.subjectId) ?? 0) + s.durationSec / H);
    const value = Math.max(0, ...vals.values());
    return { value, reachedAt: (th) => subjectCrossings(f, th).sort((a, b) => a - b)[0] ?? null };
  } },
  { id: 'anki', name: 'Kartičkář', group: 'Čas', icon: 'layers', unit: 'h', thresholds: [1, 10, 50, 100], desc: (t) => `${t} h opakování v Anki`, metric: (f) => cumulative(f.sessions.filter((s) => s.mode === 'anki').map((s) => [s.end, s.durationSec / H])) },

  // ---------- Pravidelnost ----------
  { id: 'streak', name: 'Série', group: 'Pravidelnost', icon: 'flame', unit: 'd', thresholds: [3, 7, 14, 30, 60, 100, 200, 365], desc: (t) => `${t} ${cz(t, 'den', 'dny', 'dní')} učení v řadě`, metric: streakMetric },
  { id: 'daily-goal', name: 'Denní cíl', group: 'Pravidelnost', icon: 'target', unit: 'd', thresholds: [1, 7, 30, 100, 365], desc: (t) => `denní cíl splněn ${t}×`, metric: (f) => {
    const goal = f.data.settings.dailyGoalMin * 60;
    if (goal <= 0) return plain(0);
    return count([...f.perDay.entries()].filter(([, s]) => s >= goal).map(([k]) => parseDayKey(k).getTime() + DAY - 1));
  } },
  { id: 'perfect-week', name: 'Perfektní týden', group: 'Pravidelnost', icon: 'trophy', unit: 'x', thresholds: [1, 4, 12, 26], desc: (t) => `${t}× všechny týdenní cíle splněny`, metric: (f) => {
    const goals = alive(f.data.subjects).filter((s) => s.weeklyGoalMin > 0 && !s.archived);
    if (!goals.length) return plain(0);
    const weeks = new Map<number, Map<string, number>>();
    for (const s of f.sessions) {
      const w = startOfWeek(s.start);
      if (!weeks.has(w)) weeks.set(w, new Map());
      const m = weeks.get(w)!;
      m.set(s.subjectId, (m.get(s.subjectId) ?? 0) + s.durationSec);
    }
    const ok = [...weeks.entries()].filter(([w, m]) => addDays(w, 7) <= f.now + DAY && goals.every((g) => (m.get(g.id) ?? 0) >= g.weeklyGoalMin * 60));
    return count(ok.map(([w]) => addDays(w, 7) - 1));
  } },
  { id: 'weekend', name: 'Víkendář', group: 'Pravidelnost', icon: 'coffee', unit: 'x', thresholds: [1, 5, 20], desc: (t) => `${t}× učení v sobotu i v neděli`, metric: (f) => {
    const sats = f.daysSorted.filter((k) => parseDayKey(k).getDay() === 6 && f.perDay.has(dayKey(addDays(parseDayKey(k).getTime(), 1))));
    return count(sats.map((k) => addDays(parseDayKey(k).getTime(), 2) - 1));
  } },
  { id: 'reflections', name: 'Reflexe', group: 'Pravidelnost', icon: 'notebook', unit: 'x', thresholds: [1, 4, 12, 26, 52], desc: (t) => `${t} ${cz(t, 'týdenní reflexe', 'týdenní reflexe', 'týdenních reflexí')}`, metric: (f) => count(alive(f.data.reflections).map((r) => r.createdAt)) },

  // ---------- Soustředění ----------
  { id: 'sessions', name: 'Bloky', group: 'Soustředění', icon: 'blocks', unit: 'x', thresholds: [1, 10, 50, 100, 250, 500, 1000], desc: (t) => `${fmtN(t)} ${cz(t, 'blok', 'bloky', 'bloků')} učení`, metric: (f) => count(f.focus.map((s) => s.end)) },
  { id: 'deep', name: 'Hluboká práce', group: 'Soustředění', icon: 'mountain', unit: 'x', thresholds: [1, 10, 50, 100, 250], desc: (t) => `${t}× blok delší než 50 minut`, metric: (f) => count(f.focus.filter((s) => s.durationSec >= 50 * 60).map((s) => s.end)) },
  { id: 'marathon', name: 'Maraton', group: 'Soustředění', icon: 'hourglass', unit: 'min', thresholds: [90, 120, 180], desc: (t) => `jeden blok delší než ${t} minut`, metric: (f) => record(f.focus.map((s) => [s.end, s.durationSec / 60])) },
  { id: 'flow', name: 'Flow', group: 'Soustředění', icon: 'star', unit: 'x', thresholds: [1, 10, 50, 100], desc: (t) => `${t}× soustředění ohodnoceno 5/5`, metric: (f) => count(f.focus.filter((s) => s.focus === 5).map((s) => s.end)) },
  { id: 'undisturbed', name: 'Nerušeně', group: 'Soustředění', icon: 'shield', unit: 'x', thresholds: [10, 50, 200], desc: (t) => `${t} bloků z časovače (25+ min) bez vyrušení`, metric: (f) => count(f.focus.filter((s) => s.mode !== 'manual' && s.durationSec >= 25 * 60 && s.interruptions === 0).map((s) => s.end)) },

  // ---------- Paměť ----------
  { id: 'reviews', name: 'Opakování', group: 'Paměť', icon: 'repeat', unit: 'x', thresholds: [1, 25, 100, 250, 500, 1000], desc: (t) => `${fmtN(t)} ${cz(t, 'opakování', 'opakování', 'opakování')} témat`, metric: (f) => plain(alive(f.data.topics).reduce((a, t) => a + t.reviews, 0)) },
  { id: 'stability', name: 'Pevná paměť', group: 'Paměť', icon: 'anchor', unit: 'd', thresholds: [30, 90, 180, 365], desc: (t) => `téma se stabilitou ${t}+ dní (FSRS)`, metric: (f) => plain(Math.max(0, ...alive(f.data.topics).map((t) => t.fsrs?.s ?? 0))) },
  { id: 'mastered', name: 'Zvládnuto', group: 'Paměť', icon: 'check', unit: 'x', thresholds: [1, 5, 20, 50], desc: (t) => `${t} ${cz(t, 'téma', 'témata', 'témat')} označeno jako zvládnuté`, metric: (f) => count(alive(f.data.topics).filter((t) => t.mastered).map((t) => t.updatedAt)) },
  { id: 'recall', name: 'Vybavování', group: 'Paměť', icon: 'brain', unit: 'x', thresholds: [1, 10, 50, 100], desc: (t) => `${t}× sepsáno, co si pamatuješ po bloku`, metric: (f) => count(f.focus.filter((s) => s.recall?.trim()).map((s) => s.end)) },

  // ---------- Plánování ----------
  { id: 'plan-done', name: 'Podle plánu', group: 'Plánování', icon: 'list', unit: 'x', thresholds: [1, 10, 50, 100, 250], desc: (t) => `${t} ${cz(t, 'splněný blok', 'splněné bloky', 'splněných bloků')} z plánu`, metric: (f) => count(alive(f.data.planBlocks).filter((b) => b.done).map((b) => b.start)) },

  // ---------- Pestrost ----------
  { id: 'polymath', name: 'Polyhistor', group: 'Pestrost', icon: 'grid', unit: 'x', thresholds: [2, 3, 5, 8], desc: (t) => `${t} předmětů s 10+ hodinami`, metric: (f) => count(subjectCrossings(f, 10)) },
  { id: 'interleave', name: 'Prokládání', group: 'Pestrost', icon: 'shuffle', unit: 'x', thresholds: [1, 10, 30], desc: (t) => `${t}× tři a více předmětů za den`, metric: (f) => count([...f.subjectsDay.entries()].filter(([, s]) => s.size >= 3).map(([k]) => parseDayKey(k).getTime() + DAY - 1)) },
  { id: 'early', name: 'Ranní ptáče', group: 'Pestrost', icon: 'sunrise', unit: 'x', thresholds: [1, 10, 50], desc: (t) => `${t}× začátek učení před 7:00`, metric: (f) => count(f.focus.filter((s) => new Date(s.start).getHours() < 7 && new Date(s.start).getHours() >= 4).map((s) => s.end)) },
  { id: 'night', name: 'Noční sova', group: 'Pestrost', icon: 'moon', unit: 'x', thresholds: [1, 10, 50], desc: (t) => `${t}× začátek učení po 22:00`, metric: (f) => count(f.focus.filter((s) => new Date(s.start).getHours() >= 22).map((s) => s.end)) },
];

const MODE_IDS = BUILTIN_MODES.map((m) => m.id);

export const SINGLES: Single[] = [
  { id: 'first-plan', name: 'Plánovač', group: 'Plánování', icon: 'calendar', desc: 'Naplánuj první blok učení', check: (f) => alive(f.data.planBlocks).reduce<number | null>((m, b) => (m == null || b.createdAt < m ? b.createdAt : m), null) },
  { id: 'first-exam', name: 'Termín', group: 'Plánování', icon: 'graduation', desc: 'Přidej první zkoušku', check: (f) => alive(f.data.exams).reduce<number | null>((m, e) => (m == null || e.createdAt < m ? e.createdAt : m), null) },
  { id: 'exam-ready', name: 'Připraven', group: 'Plánování', icon: 'graduation', desc: 'Před zkouškou splň všechna naplánovaná opakování', check: (f) => {
    for (const e of alive(f.data.exams)) {
      const t = parseDayKey(e.date).getTime();
      const blocks = alive(f.data.planBlocks).filter((b) => b.examId === e.id);
      if (t <= f.now && blocks.length && blocks.every((b) => b.done)) return t;
    }
    return null;
  } },
  { id: 'experimenter', name: 'Experimentátor', group: 'Soustředění', icon: 'flask', desc: 'Vyzkoušej všech 6 režimů časovače', check: (f) => {
    const seen = new Map<string, number>();
    for (const s of f.focus) if (MODE_IDS.includes(s.mode) && !seen.has(s.mode)) seen.set(s.mode, s.end);
    return seen.size === MODE_IDS.length ? Math.max(...seen.values()) : null;
  } },
  { id: 'comeback', name: 'Návrat', group: 'Pravidelnost', icon: 'undo', desc: 'Vrať se k učení po pauze delší než 14 dní', check: (f) => {
    for (let i = 1; i < f.sessions.length; i++) if (f.sessions[i].start - f.sessions[i - 1].end >= 14 * DAY) return f.sessions[i].end;
    return null;
  } },
  { id: 'full-month', name: 'Bez výpadku', group: 'Pravidelnost', icon: 'trophy', desc: 'Uč se každý den celého kalendářního měsíce', check: (f) => {
    const months = new Map<string, number>();
    for (const k of f.daysSorted) months.set(k.slice(0, 7), (months.get(k.slice(0, 7)) ?? 0) + 1);
    for (const [m, n] of months) {
      const [y, mo] = m.split('-').map(Number);
      if (n >= new Date(y, mo, 0).getDate()) return new Date(y, mo, 0).getTime() + DAY - 1;
    }
    return null;
  } },
  { id: 'first-reflection', name: 'Zpětný pohled', group: 'Pravidelnost', icon: 'notebook', desc: 'Napiš první týdenní reflexi', check: (f) => alive(f.data.reflections).reduce<number | null>((m, r) => (m == null || r.createdAt < m ? r.createdAt : m), null) },
  { id: 'anki-link', name: 'Propojeno', group: 'Paměť', icon: 'layers', desc: 'Propoj Study Tracker s Anki', check: (f) => f.data.anki.find((a) => a.id === 'snapshot')?.createdAt ?? null },
  // Skryté
  { id: 'new-year', name: 'Předsevzetí', group: 'Zvláštní', icon: 'sparkles', desc: 'Uč se 1. ledna', secret: true, check: (f) => f.sessions.find((s) => new Date(s.start).getMonth() === 0 && new Date(s.start).getDate() === 1)?.end ?? null },
  { id: 'pi-day', name: 'Den π', group: 'Zvláštní', icon: 'pi', desc: 'Uč se 14. března', secret: true, check: (f) => f.sessions.find((s) => new Date(s.start).getMonth() === 2 && new Date(s.start).getDate() === 14)?.end ?? null },
  { id: 'christmas', name: 'Štědrý den', group: 'Zvláštní', icon: 'gift', desc: 'Uč se na Štědrý den', secret: true, check: (f) => f.sessions.find((s) => new Date(s.start).getMonth() === 11 && new Date(s.start).getDate() === 24)?.end ?? null },
  { id: 'midnight', name: 'Přes půlnoc', group: 'Zvláštní', icon: 'moon', desc: 'Blok učení přes půlnoc', secret: true, check: (f) => f.focus.find((s) => startOfDay(s.start) !== startOfDay(s.end - 1))?.end ?? null },
];

export interface FamilyResult {
  family: Family;
  value: number;
  tier: number; // počet odemčených úrovní (0 = nic)
  tiers: { threshold: number; unlocked: boolean; at: number | null }[];
  next: number | null;
  progress: number; // 0–1 k další úrovni
}

export interface SingleResult {
  single: Single;
  unlocked: boolean;
  at: number | null;
}

export interface Results {
  families: FamilyResult[];
  singles: SingleResult[];
  unlockedIds: string[];
  total: number;
  unlocked: number;
}

export function evaluate(data: AppData, now = Date.now()): Results {
  const f = buildFacts(data, now);
  const families = FAMILIES.map((fam) => {
    const m = fam.metric(f);
    const tiers = fam.thresholds.map((th) => {
      const unlocked = m.value >= th - 1e-9;
      return { threshold: th, unlocked, at: unlocked ? m.reachedAt(th) : null };
    });
    const tier = tiers.filter((t) => t.unlocked).length;
    const next = fam.thresholds[tier] ?? null;
    const prev = tier ? fam.thresholds[tier - 1] : 0;
    return { family: fam, value: m.value, tier, tiers, next, progress: next == null ? 1 : Math.max(0, Math.min(1, (m.value - prev) / (next - prev))) };
  });
  const singles = SINGLES.map((s) => {
    const at = s.check(f);
    return { single: s, unlocked: at != null, at: at != null && at >= 0 ? at : null };
  });
  const unlockedIds = [
    ...families.flatMap((r) => r.tiers.map((t, i) => (t.unlocked ? `${r.family.id}.${i + 1}` : null)).filter((x): x is string => !!x)),
    ...singles.filter((s) => s.unlocked).map((s) => s.single.id),
  ];
  const total = FAMILIES.reduce((a, fam) => a + fam.thresholds.length, 0) + SINGLES.length;
  return { families, singles, unlockedIds, total, unlocked: unlockedIds.length };
}

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Lidský popis jednoho úspěchu podle ID (pro oznámení). */
export function describe(id: string): { name: string; desc: string } | null {
  const [fid, t] = id.split('.');
  const fam = FAMILIES.find((x) => x.id === fid);
  if (fam && t) return { name: `${fam.name} ${ROMAN[Number(t) - 1]}`, desc: fam.desc(fam.thresholds[Number(t) - 1]) };
  const s = SINGLES.find((x) => x.id === id);
  return s ? { name: s.name, desc: s.desc } : null;
}
