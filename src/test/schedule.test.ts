import { describe, expect, it } from 'vitest';
import { applyStudy, ctxFrom, isDue, retrievability, toCard } from '../features/topics/schedule';
import { D, NOW, data, exam, topic } from './helpers';

const ctx = { retention: 0.9, maxDays: 365, exams: [] };

describe('FSRS opakování', () => {
  it('nové téma s „Dobře“ se naplánuje za pár dní', () => {
    const t = applyStudy(topic(), NOW, 'ok', ctx);
    const days = (t.nextReviewAt! - NOW) / D;
    expect(days).toBeGreaterThanOrEqual(1);
    expect(days).toBeLessThanOrEqual(5);
    expect(t.fsrs!.s).toBeGreaterThan(1);
    expect(t.reviews).toBe(1);
  });
  it('„Znovu“ sníží stabilitu a zvýší počet zapomenutí', () => {
    let t = applyStudy(topic(), NOW, 'ok', ctx);
    t = applyStudy(t, t.nextReviewAt!, 'ok', ctx);
    const before = t.fsrs!.s;
    const after = applyStudy(t, t.nextReviewAt!, 'again', ctx);
    expect(after.fsrs!.s).toBeLessThan(before);
    expect(after.fsrs!.lapses).toBe(1);
  });
  it('„Snadno“ dá delší interval než „Těžko“', () => {
    const easy = applyStudy(topic(), NOW, 'easy', ctx);
    const hard = applyStudy(topic(), NOW, 'hard', ctx);
    expect(easy.nextReviewAt!).toBeGreaterThan(hard.nextReviewAt!);
  });
  it('opakování se nenaplánuje až po zkoušce', () => {
    let t = applyStudy(topic({ subjectId: 'm' }), NOW - 20 * D, 'easy', ctx);
    const exams = [exam({ subjectId: 'm', date: '2026-10-12' })];
    t = applyStudy(t, NOW, 'easy', { ...ctx, exams });
    expect(t.nextReviewAt!).toBeLessThan(new Date(2026, 9, 12).getTime());
  });
  it('převede téma ze starého žebříku (v2.0)', () => {
    const legacy = topic({ stage: 2, lastStudiedAt: NOW - 7 * D, nextReviewAt: NOW, reviews: 3 });
    const card = toCard(legacy);
    expect(card.stability).toBe(7);
    const r = retrievability(legacy, ctx, NOW)!;
    expect(r).toBeGreaterThan(0.85);
    expect(r).toBeLessThan(0.95);
  });
  it('isDue / ctxFrom', () => {
    expect(isDue(topic({ nextReviewAt: NOW }), NOW + D)).toBe(true);
    expect(isDue(topic({ nextReviewAt: NOW, mastered: true }), NOW + D)).toBe(false);
    expect(ctxFrom(data()).retention).toBe(0.9);
  });
});
