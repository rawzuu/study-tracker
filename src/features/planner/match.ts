import { PlanBlock, Session } from '../../data/schema';
import { MIN } from '../../lib/time';

/** Sezení a blok se kryjí: aspoň 15 minut, u krátkého bloku aspoň jeho polovina. */
function covers(b: PlanBlock, start: number, end: number): boolean {
  const bEnd = b.start + b.durationMin * MIN;
  const overlap = Math.min(end, bEnd) - Math.max(start, b.start);
  return overlap >= Math.min(15 * MIN, (b.durationMin * MIN) / 2);
}

/**
 * Najde naplánované bloky, které odpovídají odučenému sezení
 * (stejný předmět a dostatečný časový překryv) – ty se automaticky odškrtnou.
 */
export function matchPlanBlocks(blocks: PlanBlock[], subjectId: string, start: number, end: number): PlanBlock[] {
  return blocks.filter((b) => !b.deletedAt && !b.done && b.subjectId === subjectId && covers(b, start, end));
}

/** Je k bloku už zapsané sezení (třeba z časovače)? Pak se při „Hotovo“ nic nezapisuje znovu. */
export function blockHasSession(sessions: Session[], b: PlanBlock): boolean {
  return sessions.some((s) => !s.deletedAt && s.subjectId === b.subjectId && covers(b, s.start, s.end));
}
