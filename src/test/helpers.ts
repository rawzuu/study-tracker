import { AppData, Exam, PlanBlock, Session, Subject, Topic, emptyData } from '../data/schema';

export const D = 86_400_000;
export const H = 3_600_000;
export const M = 60_000;
/** Pevné „teď“: středa 7. 10. 2026 10:00 místního času. */
export const NOW = new Date(2026, 9, 7, 10, 0).getTime();
export const TODAY = new Date(2026, 9, 7).getTime();

let n = 0;
const id = (p: string) => `${p}${++n}`;

export function data(patch: Partial<AppData> = {}): AppData {
  const d = emptyData();
  return { ...d, ...patch, settings: { ...d.settings, ...(patch.settings ?? {}) } };
}
export const subject = (p: Partial<Subject> = {}): Subject => ({ id: id('s'), name: 'Předmět', color: '#7c8cff', weeklyGoalMin: 0, archived: false, createdAt: 1, updatedAt: 1, ...p });
export const session = (p: Partial<Session> = {}): Session => {
  const start = p.start ?? NOW - 2 * H;
  const dur = p.durationSec ?? 1500;
  return { id: id('x'), subjectId: 's', topic: '', start, end: p.end ?? start + dur * 1000, durationSec: dur, mode: 'pomodoro', interruptions: 0, note: '', createdAt: 1, updatedAt: 1, ...p };
};
export const topic = (p: Partial<Topic> = {}): Topic => ({ id: id('t'), subjectId: 's', name: 'Téma', stage: -1, reviews: 0, mastered: false, note: '', createdAt: 1, updatedAt: 1, ...p });
export const block = (p: Partial<PlanBlock> = {}): PlanBlock => ({ id: id('b'), subjectId: 's', title: '', start: NOW, durationMin: 50, done: false, note: '', createdAt: 1, updatedAt: 1, ...p });
export const exam = (p: Partial<Exam> = {}): Exam => ({ id: id('e'), subjectId: 's', name: 'Zkouška', date: '2026-10-10', time: '', note: '', createdAt: 1, updatedAt: 1, ...p });
