import { PlanBlock } from '../../data/schema';
import { MIN } from '../../lib/time';

/**
 * Najde naplánované bloky, které odpovídají odučenému sezení
 * (stejný předmět a dostatečný časový překryv) – ty se automaticky odškrtnou.
 */
export function matchPlanBlocks(blocks: PlanBlock[], subjectId: string, start: number, end: number): PlanBlock[] {
  return blocks.filter((b) => {
    if (b.deletedAt || b.done || b.subjectId !== subjectId) return false;
    const bEnd = b.start + b.durationMin * MIN;
    const overlap = Math.min(end, bEnd) - Math.max(start, b.start);
    return overlap >= Math.min(15 * MIN, (b.durationMin * MIN) / 2);
  });
}
