import { AppData, Session, Subject, Topic, alive } from '../data/schema';
import { ctxFrom, isDue, retrievability } from '../features/topics/schedule';
import { avgFocus } from './stats';
import { lectureSubject, lecturesIn } from './timetable';
import { DAY, HOUR, MIN, addDays, minutesOfDay, parseDayKey, startOfDay, startOfWeek, weekdayIdx } from './time';

/**
 * „Co se mám teď učit?“ – doporučovací algoritmus.
 *
 * Pro každý aktivní předmět spočítá 6 signálů (0–1) a skóre jako vážený součet:
 *
 *  E  zkouška      – plynule rostoucí naléhavost: E = 1 / (1 + (d/7)²)  (d = dny do zkoušky)
 *                    → za 3 dny 0,84 · za týden 0,5 · za 2 týdny 0,2 · za měsíc 0,05
 *  R  opakování    – témata, která FSRS hlásí k opakování; váha podle toho, o kolik klesla
 *                    vybavitelnost pod cíl (spacing effect, Cepeda et al. 2008; FSRS)
 *  G  týdenní cíl  – zaostávání za cílem úměrně uplynulé části týdne (agenda-based regulation,
 *                    Ariel, Dunlosky & Bailey 2009: učení řízené cíli a prioritami)
 *  N  zanedbání    – dny od posledního učení předmětu: N = 1 − e^(−dny/4)
 *  P  plán         – blok naplánovaný na teď (P = 1), později dnes (0,4), dnes zmeškaný (0,6)
 *  X  penalizace   – kolik ses předmětu věnoval za poslední 3 h (+ jestli byl poslední blok);
 *                    podporuje prokládání předmětů (interleaving, Brunmair & Richter 2019, g = 0,42)
 *                    a brání únavě. Blízká zkouška penalizaci oslabuje.
 *
 *  skóre = 0,30·E + 0,25·R + 0,20·G + 0,10·N + 0,15·P − 0,35·(únava·(1 − 0,6·E) + 0,3 když je předmět hned po sobě)
 *
 * Typ činnosti: témata k opakování → vybavování (retrieval practice); blízká zkouška →
 * procvičování/testování; jinak nová látka (nejlépe „těsně za hranou“ toho, co umíš – region of
 * proximal learning, Metcalfe & Kornell 2005). Délka bloku se volí podle tvých vlastních dat
 * o soustředění v danou denní dobu (synchrony effect, Schmidt et al. 2007).
 */

export const W = { E: 0.3, R: 0.25, G: 0.2, N: 0.1, P: 0.15, X: 0.35 };

export type Activity = 'review' | 'exam' | 'new' | 'continue' | 'anki' | 'plan' | 'recap';

export interface Recommendation {
  key: string;
  subjectId: string | null; // null = Anki bez přiřazení
  activity: Activity;
  title: string; // „Opakování: Derivace, Limity“
  topic: string; // co předvyplnit do časovače
  topics: Topic[];
  minutes: number;
  modeId: string;
  score: number;
  signals: { E: number; R: number; G: number; N: number; P: number; X: number };
  reasons: string[];
  planBlockId?: string;
}

export interface RecommendInput {
  data: AppData;
  now?: number;
  /** Simulace pro plánování dne: předměty/témata už zařazená do plánu. */
  sim?: { extraMinutes?: Map<string, number>; coveredTopics?: Set<string>; recentMinutes?: Map<string, number>; lastSubject?: string | null };
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

function pluralDays(n: number) {
  return n === 1 ? 'den' : n >= 2 && n <= 4 ? 'dny' : 'dní';
}

/**
 * Jaká část týdenní práce bývá hotová do tohoto okamžiku týdne – podle tvých posledních 8 týdnů
 * (kdo se učí hlavně o víkendu, toho ve středu týdenní cíl ještě netlačí). Bez dostatku dat
 * rovnoměrně přes 7 dní. Osobní tempo se mírně „přitahuje“ k rovnoměrnému, aby nebylo extrémní.
 */
export function weekShare(sessions: Session[], now: number): number {
  const weekStart = startOfWeek(now);
  const uniform = Math.max(clamp((now - weekStart) / (7 * DAY)), 1 / 7);
  const from = addDays(weekStart, -56);
  const hist = sessions.filter((s) => s.start >= from && s.start < weekStart && s.mode !== 'anki');
  const weeks = new Set(hist.map((s) => startOfWeek(s.start))).size;
  const total = hist.reduce((a, s) => a + s.durationSec, 0);
  if (weeks < 3 || total < 5 * 3600) return uniform;
  const pos = (t: number) => weekdayIdx(t) * 1440 + minutesOfDay(t);
  const nowPos = pos(now);
  const before = hist.filter((s) => pos(s.start) < nowPos).reduce((a, s) => a + s.durationSec, 0);
  return Math.max(0.75 * (before / total) + 0.25 * clamp((now - weekStart) / (7 * DAY)), 1 / 14);
}

/** Doporučená délka bloku podle tvých dat: v jaké délce bloků máš v tuto denní dobu nejlepší soustředění. */
export function personalBlock(sessions: Session[], now: number, activity: Activity): { minutes: number; modeId: string; note?: string } {
  const h = new Date(now).getHours();
  const part = (x: number) => (x >= 5 && x < 12 ? 0 : x >= 12 && x < 17 ? 1 : x >= 17 && x < 22 ? 2 : 3);
  const rated = sessions.filter((s) => s.focus && s.mode !== 'anki' && part(new Date(s.start).getHours()) === part(h));
  const buckets = [
    { max: 35, minutes: 25, modeId: 'pomodoro' },
    { max: 70, minutes: 50, modeId: 'pomodoro-long' },
    { max: Infinity, minutes: 90, modeId: 'ultradian' },
  ];
  // Průměr soustředění v každé délce „přitažený“ k celkovému průměru (K = 3 bloky) – pár výjimečných
  // bloků tak nerozhodne. Delší blok vyhraje jen se zřetelně lepším soustředěním (+0,15).
  const g = avgFocus(rated) ?? 3;
  const K = 3;
  let best: (typeof buckets)[number] | null = null;
  let bestF = 0;
  for (const b of buckets) {
    const lo = b === buckets[0] ? 0 : buckets[buckets.indexOf(b) - 1].max;
    const list = rated.filter((s) => s.durationSec / 60 > lo && s.durationSec / 60 <= b.max);
    if (list.length < 3) continue;
    const f = (list.reduce((a, s) => a + (s.focus ?? 0), 0) + K * g) / (list.length + K);
    if (f > bestF + 0.15) {
      best = b;
      bestF = f;
    }
  }
  if (activity === 'review' || activity === 'anki') {
    // Vybavování je náročné – kratší bloky, max 50 min
    if (best && best.minutes <= 50) return { minutes: best.minutes, modeId: best.modeId, note: 'podle tvého soustředění' };
    return { minutes: 25, modeId: 'pomodoro' };
  }
  if (best) return { minutes: best.minutes, modeId: best.modeId, note: 'podle tvého soustředění' };
  return { minutes: 50, modeId: 'pomodoro-long' };
}

/** Je teď pro tebe „slabší“ denní doba? (soustředění v této části dne výrazně pod průměrem) */
export function lowFocusNow(sessions: Session[], now: number): boolean {
  const h = new Date(now).getHours();
  const inPart = (x: number) => (h >= 5 && h < 12 ? x >= 5 && x < 12 : h >= 12 && h < 17 ? x >= 12 && x < 17 : h >= 17 && h < 22 ? x >= 17 && x < 22 : x >= 22 || x < 5);
  const rated = sessions.filter((s) => s.focus && s.mode !== 'anki');
  const here = rated.filter((s) => inPart(new Date(s.start).getHours()));
  if (here.length < 5 || rated.length < 10) return false;
  return (avgFocus(here) ?? 0) <= (avgFocus(rated) ?? 0) - 0.4;
}

export function recommend({ data, now = Date.now(), sim }: RecommendInput): Recommendation[] {
  const sessions = alive(data.sessions);
  const ctx = ctxFrom(data);
  const today = startOfDay(now);
  const weekStart = startOfWeek(now);
  const share = weekShare(sessions, now); // kolik týdenního cíle „by mělo“ být hotovo touto dobou
  // Pomocný předmět „Anki“ (nepřiřazené balíčky) se doporučuje zvlášť jako kartičky
  const subjects = alive(data.subjects).filter((s) => !s.archived && s.id !== 'anki');
  const topics = alive(data.topics);
  const exams = alive(data.exams);
  const blocks = alive(data.planBlocks);
  const lowFocus = lowFocusNow(sessions, now);
  const recent = sessions.filter((s) => s.end > now - 3 * HOUR && s.start <= now);
  const lastSession = sessions.reduce<Session | null>((m, s) => (s.end <= now + MIN && (!m || s.end > m.end) ? s : m), null);
  const lastSubject = sim?.lastSubject !== undefined ? sim.lastSubject : lastSession && now - lastSession.end < 45 * MIN ? lastSession.subjectId : null;

  const out: Recommendation[] = [];

  for (const subj of subjects) {
    const sSessions = sessions.filter((s) => s.subjectId === subj.id);
    const lastStudied = sSessions.reduce((m, s) => Math.max(m, s.end), 0);
    const exam = exams
      .filter((e) => e.subjectId === subj.id && parseDayKey(e.date).getTime() + DAY > now)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    const dueTopics = topics
      .filter((t) => t.subjectId === subj.id && isDue(t, today + DAY) && !sim?.coveredTopics?.has(t.id))
      .map((t) => ({ t, r: retrievability(t, ctx, now) ?? ctx.retention }))
      .sort((a, b) => a.r - b.r);
    const plannedNow = blocks.filter((b) => b.subjectId === subj.id && !b.done && startOfDay(b.start) === today);
    const isActive = subj.weeklyGoalMin > 0 || exam || dueTopics.length || plannedNow.length || (lastStudied && now - lastStudied < 30 * DAY);
    if (!isActive) continue;

    // E – zkouška
    const examDays = exam ? Math.max(0, (parseDayKey(exam.date).getTime() - now) / DAY) : Infinity;
    const E = exam ? 1 / (1 + (examDays / 7) ** 2) : 0;

    // R – opakování (o kolik je vybavitelnost pod cílem; po termínu víc)
    const rSum = dueTopics.reduce((a, { r }) => a + Math.max(0.08, (ctx.retention - r) * 4), 0);
    const R = clamp(1 - Math.exp(-rSum));

    // G – týdenní cíl
    const doneWeek = sSessions.filter((s) => s.start >= weekStart).reduce((a, s) => a + s.durationSec / 60, 0) + (sim?.extraMinutes?.get(subj.id) ?? 0);
    const goal = subj.weeklyGoalMin;
    const G = goal > 0 ? clamp((goal * share - doneWeek) / goal) : 0;

    // N – zanedbání
    const daysSince = lastStudied ? (now - lastStudied) / DAY : 30;
    const N = (sim?.extraMinutes?.get(subj.id) ?? 0) > 0 ? 0 : clamp(1 - Math.exp(-daysSince / 4));

    // P – plán
    let P = 0;
    let planBlock: (typeof plannedNow)[number] | undefined;
    for (const b of plannedNow) {
      const p = b.start <= now + 30 * MIN && b.start + b.durationMin * MIN >= now - 30 * MIN ? 1 : b.start > now ? 0.4 : 0.6;
      if (p > P) {
        P = p;
        planBlock = b;
      }
    }
    if (sim) P = 0; // při plánování dne se plán teprve tvoří

    // X – nedávno učené (prokládání, únava)
    const recentMin = recent.filter((s) => s.subjectId === subj.id).reduce((a, s) => a + s.durationSec / 60, 0) + (sim?.recentMinutes?.get(subj.id) ?? 0);
    const isLast = lastSubject === subj.id ? 0.3 : 0;
    const X = clamp(recentMin / 120 + isLast);
    // Únava z dlouhého učení předmětu se u blízké zkoušky toleruje víc, ale „hned znovu totéž“ se penalizuje vždy.
    const penalty = W.X * (clamp(recentMin / 120) * (1 - 0.6 * E) + isLast);

    const score = W.E * E + W.R * R + W.G * G + W.N * N + W.P * P - penalty;

    // Typ činnosti
    let activity: Activity;
    let title: string;
    let topic = '';
    let chosen: Topic[] = [];
    if (P >= 1 && planBlock) {
      activity = 'plan';
      title = planBlock.title ? `Podle plánu: ${planBlock.title}` : 'Blok podle plánu';
      topic = planBlock.title;
    } else if (dueTopics.length) {
      // FSRS hlásí téma k opakování → vybavování má přednost (retrieval practice je i nejlepší příprava na zkoušku)
      activity = 'review';
      chosen = dueTopics.slice(0, 3).map((x) => x.t);
      title = `Opakování: ${chosen.map((t) => t.name).join(', ')}${dueTopics.length > 3 ? ` +${dueTopics.length - 3}` : ''}`;
      topic = chosen[0].name;
    } else if (E >= 0.35) {
      activity = 'exam';
      title = `Příprava na zkoušku: ${exam!.name}`;
      topic = exam!.name;
    } else {
      const fresh = topics.filter((t) => t.subjectId === subj.id && !t.mastered && t.nextReviewAt == null && !sim?.coveredTopics?.has(t.id));
      // poslední téma z vlastního učení (ne název balíčku z Anki)
      const last = sSessions.filter((s) => s.topic && s.mode !== 'anki').sort((a, b) => b.end - a.end)[0];
      if (fresh.length) {
        activity = 'new';
        chosen = [fresh[0]];
        title = `Nové téma: ${fresh[0].name}`;
        topic = fresh[0].name;
      } else {
        activity = 'continue';
        title = last ? `Pokračovat: ${last.topic}` : 'Nová látka';
        topic = last?.topic ?? '';
      }
    }

    const block = planBlock && activity === 'plan' ? { minutes: planBlock.durationMin, modeId: data.settings.defaultMode } : personalBlock(sessions, now, activity);

    // Důvody v lidské řeči (seřazené podle váhy)
    const reasons: [number, string][] = [];
    if (E > 0.05) {
      const d = Math.ceil(examDays);
      reasons.push([W.E * E, d <= 0 ? 'zkouška dnes' : `zkouška za ${d} ${pluralDays(d)}`]);
    }
    if (dueTopics.length) {
      const late = dueTopics.filter(({ t }) => (t.nextReviewAt ?? now) < today).length;
      reasons.push([W.R * R, `${dueTopics.length} ${dueTopics.length === 1 ? 'téma' : dueTopics.length < 5 ? 'témata' : 'témat'} k opakování${late ? ` (${late} po termínu)` : ''} · vybavitelnost ${Math.round(dueTopics[0].r * 100)} %`]);
    }
    if (G > 0.05) reasons.push([W.G * G, `${Math.round(goal * share - doneWeek)} min pod týdenním plánem`]);
    if (N > 0.4 && lastStudied) reasons.push([W.N * N, `${Math.floor(daysSince)} ${pluralDays(Math.floor(daysSince))} bez učení`]);
    if (P > 0) reasons.push([W.P * P, P >= 1 ? 'naplánováno na teď' : P > 0.5 ? 'dnes naplánováno a zatím neodučeno' : 'naplánováno později dnes']);
    if (X > 0.3) reasons.push([-W.X * X, 'nedávno na řadě – vhodné prostřídat']);

    out.push({
      key: `${subj.id}:${activity}`,
      subjectId: subj.id,
      activity,
      title,
      topic,
      topics: chosen,
      minutes: block.minutes,
      modeId: block.modeId,
      score,
      signals: { E, R, G, N, P, X },
      reasons: reasons.sort((a, b) => b[0] - a[0]).map((r) => r[1]),
      planBlockId: activity === 'plan' ? planBlock?.id : undefined,
    });
  }

  // Opakování po přednášce (volitelné): krátké shrnutí ještě ten den, dokud je látka čerstvá.
  if (!sim && data.settings.lectureRecap !== false) {
    for (const l of lecturesIn(data, today, now)) {
      const hoursAgo = (now - l.end) / HOUR;
      if (l.end > now || hoursAgo > 8) continue;
      const subjectId = lectureSubject(data, l.timetableId, l.series);
      if (!subjectId || sessions.some((s) => s.subjectId === subjectId && s.end > l.end)) continue;
      out.push({
        key: `recap:${l.key}`,
        subjectId,
        activity: 'recap',
        title: `Po přednášce: ${l.title}`,
        topic: '',
        topics: [],
        minutes: 15,
        modeId: 'stopwatch',
        score: 0.15 + 0.35 * clamp(1 - hoursAgo / 8),
        signals: { E: 0, R: 0, G: 0, N: 0, P: 0, X: 0 },
        reasons: [hoursAgo < 1 ? 'přednáška právě skončila' : `přednáška skončila před ${Math.floor(hoursAgo)} h`, 'krátké shrnutí, dokud je látka čerstvá'],
      });
    }
  }

  // Anki – lehká činnost, hodí se hlavně v „slabší“ denní době nebo mezi bloky
  const snap = data.anki.find((a) => a.id === 'snapshot' && !a.deletedAt);
  if (!sim && snap && startOfDay(snap.at) === today) {
    const due = snap.decks.reduce((a, d) => a + d.newCount + d.learnCount + d.reviewCount, 0);
    if (due > 0) {
      const secPerCard = snap.reviewedToday > 10 && snap.msToday > 0 ? snap.msToday / 1000 / snap.reviewedToday : 9;
      const minutes = Math.max(5, Math.min(60, Math.round((due * secPerCard) / 60 / 5) * 5));
      const score = 0.12 + 0.25 * clamp(due / 150) + (lowFocus ? 0.15 : 0);
      out.push({
        key: 'anki',
        subjectId: null,
        activity: 'anki',
        title: `Anki: ${due} karet`,
        topic: '',
        topics: [],
        minutes,
        modeId: 'stopwatch',
        score,
        signals: { E: 0, R: clamp(due / 150), G: 0, N: 0, P: 0, X: 0 },
        reasons: [`odhad ~${minutes} min`, ...(lowFocus ? ['teď ti soustředění obvykle jde hůř – kartičky jsou ideální'] : [])],
      });
    }
  }

  // V „slabší“ denní době mírně upřednostni lehčí činnosti (opakování), náročnou novou látku odsuň
  if (lowFocus) for (const r of out) if (r.activity === 'new' || r.activity === 'continue') r.score -= 0.05;

  return out.sort((a, b) => b.score - a.score);
}

/** Krátká hláška nad doporučením (pozdní hodina, splněný cíl…). */
export function contextNote(data: AppData, now = Date.now()): string | null {
  const today = startOfDay(now);
  const todaySec = alive(data.sessions).filter((s) => s.start >= today).reduce((a, s) => a + s.durationSec, 0);
  const goal = data.settings.dailyGoalMin * 60;
  const h = new Date(now).getHours();
  if (h >= 23 || h < 4) return 'Je pozdě – spánek je pro ukládání do paměti stejně důležitý jako učení. Když už, tak krátce.';
  if (goal > 0 && todaySec >= goal * 1.5) return 'Dnešní cíl máš splněný s rezervou. Klidně si dej volno – i odpočinek je součást učení.';
  if (lowFocusNow(alive(data.sessions), now)) return 'V tuhle denní dobu ti soustředění obvykle jde hůř – vhodné na opakování a kartičky.';
  return null;
}

export function subjectName(subjects: Subject[], id: string | null) {
  return id ? (subjects.find((s) => s.id === id)?.name ?? '?') : 'Anki';
}
