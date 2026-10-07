import { addDays, parseDayKey, startOfDay } from '../../lib/time';

/**
 * Rozložené opakování před zkouškou (spacing effect).
 *
 * Podklad: Cepeda et al. (2006, 2008) – optimální mezera mezi opakováními roste s tím,
 * jak daleko je test; opakování blízko zkoušky má být hustší, vzdálenější řidší.
 * Proto plánujeme "pozpátku" od zkoušky s rozšiřujícími se intervaly.
 */
export const REVIEW_OFFSETS = [1, 2, 4, 7, 11, 16, 23, 32, 45, 60];

export interface ReviewSlot {
  day: number; // epoch ms začátku dne
  daysBefore: number;
}

/** Vrátí dny opakování mezi dneškem a zkouškou (bez dne zkoušky). */
export function reviewDays(examDate: string, opts: { from?: number; skipWeekends?: boolean } = {}): ReviewSlot[] {
  const exam = parseDayKey(examDate).getTime();
  const from = startOfDay(opts.from ?? Date.now());
  const out: ReviewSlot[] = [];
  const used = new Set<number>();
  for (const off of REVIEW_OFFSETS) {
    let day = addDays(exam, -off);
    if (opts.skipWeekends) {
      // posuň víkendový den na předchozí pátek
      const wd = new Date(day).getDay();
      if (wd === 6) day = addDays(day, -1);
      if (wd === 0) day = addDays(day, -2);
    }
    if (day < from || used.has(day)) continue;
    used.add(day);
    out.push({ day, daysBefore: Math.round((exam - day) / 86_400_000) });
  }
  return out.sort((a, b) => a.day - b.day);
}
