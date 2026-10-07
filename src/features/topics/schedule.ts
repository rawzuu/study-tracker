import { Topic, uid } from '../../data/schema';
import { DAY, startOfDay } from '../../lib/time';

/**
 * Rozložené opakování témat (spacing effect).
 * Intervaly se s každým úspěšným opakováním prodlužují (expanding retrieval practice,
 * Landauer & Bjork 1978; Cepeda et al. 2008). Těžké vybavení interval zkrátí.
 */
export const INTERVALS = [1, 3, 7, 14, 30, 60, 120];

export type RecallRating = 'hard' | 'ok' | 'easy';

export const RATING_LABEL: Record<RecallRating, string> = {
  hard: 'Těžko',
  ok: 'Dobře',
  easy: 'Snadno',
};

/** Vrátí téma po dalším studiu/opakování. Nemutuje vstup. */
export function applyStudy(t: Topic, at: number, rating: RecallRating = 'ok'): Topic {
  let stage: number;
  if (t.stage < 0 || t.lastStudiedAt == null) {
    stage = rating === 'easy' ? 1 : 0;
  } else {
    const due = t.nextReviewAt == null || at >= t.nextReviewAt - DAY / 2;
    if (rating === 'hard') stage = Math.max(0, t.stage - 1);
    else if (!due) stage = t.stage; // učení před termínem interval neprodlužuje
    else stage = t.stage + (rating === 'easy' ? 2 : 1);
  }
  stage = Math.min(stage, INTERVALS.length - 1);
  return {
    ...t,
    stage,
    lastStudiedAt: at,
    nextReviewAt: startOfDay(at) + INTERVALS[stage] * DAY,
    reviews: t.reviews + 1,
  };
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
