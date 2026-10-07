import { Card, FSRS, Rating, State, createEmptyCard, fsrs, generatorParameters } from 'ts-fsrs';
import { AppData, Exam, Topic, uid } from '../../data/schema';
import { DAY, parseDayKey, startOfDay } from '../../lib/time';

/**
 * Rozložené opakování témat – algoritmus FSRS-6 (stejný jako v Anki), knihovna ts-fsrs.
 *
 * Každé téma má paměťový stav:
 *  - Stabilita S: za kolik dní klesne pravděpodobnost vybavení na 90 %
 *  - Obtížnost D: 1–10
 *  - Vybavitelnost R: aktuální pravděpodobnost vybavení (klesá podle mocninné křivky zapomínání)
 * Opakování se naplánuje na chvíli, kdy R klesne na cílovou hodnotu (výchozí 90 %).
 */

export type RecallRating = 'again' | 'hard' | 'ok' | 'easy';

export const RATINGS: RecallRating[] = ['again', 'hard', 'ok', 'easy'];

export const RATING_LABEL: Record<RecallRating, string> = {
  again: 'Znovu',
  hard: 'Těžko',
  ok: 'Dobře',
  easy: 'Snadno',
};

export const RATING_HINT: Record<RecallRating, string> = {
  again: 'Nevybavil jsem si to',
  hard: 'S velkým úsilím',
  ok: 'Po chvilce přemýšlení',
  easy: 'Hned a bez námahy',
};

const GRADE = { again: Rating.Again, hard: Rating.Hard, ok: Rating.Good, easy: Rating.Easy } as const;

/** Starý žebřík (v2.0) – jen pro převod existujících témat a pro kompatibilitu se staršími verzemi. */
export const INTERVALS = [1, 3, 7, 14, 30, 60, 120];

export interface ScheduleCtx {
  retention: number;
  maxDays: number;
  exams: Exam[];
}

export function ctxFrom(data: AppData): ScheduleCtx {
  return {
    retention: data.settings.desiredRetention ?? 0.9,
    maxDays: data.settings.maxIntervalDays ?? 365,
    exams: data.exams.filter((e) => !e.deletedAt),
  };
}

const schedulers = new Map<string, FSRS>();
function scheduler(retention: number, maxDays: number): FSRS {
  const key = `${retention}:${maxDays}`;
  let f = schedulers.get(key);
  if (!f) {
    // Bez krátkodobých kroků (minuty) – témata se plánují po dnech. Fuzz rozprostře opakování, aby se nekupila.
    f = fsrs(generatorParameters({ request_retention: retention, maximum_interval: maxDays, enable_fuzz: true, enable_short_term: false }));
    schedulers.set(key, f);
  }
  return f;
}

/** Převede téma na kartu FSRS. Témata z v2.0 (žebřík) se převedou: aktuální interval = počáteční stabilita. */
export function toCard(t: Topic): Card {
  if (t.fsrs) {
    return {
      due: new Date(t.fsrs.due),
      stability: t.fsrs.s,
      difficulty: t.fsrs.d,
      elapsed_days: 0,
      scheduled_days: t.fsrs.scheduledDays,
      learning_steps: 0,
      reps: t.fsrs.reps,
      lapses: t.fsrs.lapses,
      state: t.fsrs.state as State,
      last_review: t.fsrs.lastReview != null ? new Date(t.fsrs.lastReview) : undefined,
    };
  }
  if (t.stage < 0 || t.lastStudiedAt == null) return createEmptyCard(new Date(t.createdAt));
  const s = INTERVALS[Math.min(t.stage, INTERVALS.length - 1)];
  return {
    due: new Date(t.nextReviewAt ?? t.lastStudiedAt + s * DAY),
    stability: s,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: s,
    learning_steps: 0,
    reps: Math.max(1, t.reviews),
    lapses: 0,
    state: State.Review,
    last_review: new Date(t.lastStudiedAt),
  };
}

function nextExamStart(exams: Exam[], subjectId: string, after: number): number | null {
  let best: number | null = null;
  for (const e of exams) {
    if (e.subjectId !== subjectId) continue;
    const t = parseDayKey(e.date).getTime();
    if (t > after && (best == null || t < best)) best = t;
  }
  return best;
}

/** Vrátí téma po opakování s daným hodnocením. Nemutuje vstup. */
export function applyStudy(t: Topic, at: number, rating: RecallRating, ctx: ScheduleCtx): Topic {
  const f = scheduler(ctx.retention, ctx.maxDays);
  const { card } = f.next(toCard(t), new Date(at), GRADE[rating]);
  let due = card.due.getTime();

  // Hlídání zkoušky: poslední opakování nejpozději den před zkouškou.
  const exam = nextExamStart(ctx.exams, t.subjectId, at);
  if (exam != null) {
    const dayBefore = exam - DAY;
    if (due > dayBefore && dayBefore > startOfDay(at) + DAY / 2) due = dayBefore + 8 * 3600_000;
  }

  // `stage` = nejbližší stupeň starého žebříku – aby téma správně zobrazila i v2.0 / v1.
  const days = Math.max(1, Math.round((due - at) / DAY));
  const stage = INTERVALS.reduce((b, v, i) => (Math.abs(v - days) < Math.abs(INTERVALS[b] - days) ? i : b), 0);

  return {
    ...t,
    stage,
    lastStudiedAt: at,
    nextReviewAt: due,
    reviews: t.reviews + 1,
    fsrs: {
      s: card.stability,
      d: card.difficulty,
      state: card.state,
      reps: card.reps,
      lapses: card.lapses,
      scheduledDays: card.scheduled_days,
      lastReview: at,
      due,
    },
  };
}

/** Aktuální pravděpodobnost vybavení (0–1), u nového tématu null. */
export function retrievability(t: Topic, ctx: Pick<ScheduleCtx, 'retention' | 'maxDays'>, now = Date.now()): number | null {
  if (!t.fsrs && (t.stage < 0 || t.lastStudiedAt == null)) return null;
  const card = toCard(t);
  if (card.state === State.New) return null;
  return scheduler(ctx.retention, ctx.maxDays).get_retrievability(card, new Date(now), false);
}

/** Stabilita ve dnech (u témat z v2.0 odhad z žebříku). */
export function stability(t: Topic): number | null {
  if (t.fsrs) return t.fsrs.s;
  if (t.stage < 0) return null;
  return INTERVALS[Math.min(t.stage, INTERVALS.length - 1)];
}

export function difficulty(t: Topic): number | null {
  return t.fsrs ? t.fsrs.d : null;
}

export function newTopic(subjectId: string, name: string): Topic {
  const now = Date.now();
  return { id: uid(), subjectId, name: name.trim(), stage: -1, reviews: 0, mastered: false, note: '', createdAt: now, updatedAt: now };
}

export function findTopic(topics: Topic[], subjectId: string, name: string): Topic | undefined {
  const n = name.trim().toLocaleLowerCase('cs');
  return topics.find((t) => !t.deletedAt && t.subjectId === subjectId && t.name.toLocaleLowerCase('cs') === n);
}

/** Je téma k zopakování do konce daného dne? */
export function isDue(t: Topic, dayEnd: number): boolean {
  return !t.deletedAt && !t.mastered && t.nextReviewAt != null && t.nextReviewAt < dayEnd;
}

/** Kolik dní je po termínu (záporné = do termínu). */
export function overdueDays(t: Topic, now = Date.now()): number {
  if (t.nextReviewAt == null) return 0;
  return Math.round((startOfDay(now) - startOfDay(t.nextReviewAt)) / DAY);
}

/** Stav tématu před posledním uloženým sezením – kvůli zpětné úpravě podle hodnocení vybavení. */
export const topicSnapshots = new Map<string, Topic>();
