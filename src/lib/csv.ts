import { Session, Subject, TimerPreset } from '../data/schema';
import { modeName } from '../features/timer/modes';
import { dayKey, fmtTime } from './time';

function cell(v: string | number | undefined): string {
  let s = v == null ? '' : String(v);
  // Ochrana proti „formula injection“: text začínající =, +, -, @ by Excel spustil jako vzorec.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV se středníkem a BOM – Excel v češtině i Numbers ho otevřou správně. */
export function sessionsToCsv(sessions: Session[], subjects: Subject[], presets: TimerPreset[]): string {
  const subj = new Map(subjects.map((s) => [s.id, s.name]));
  const head = ['Datum', 'Začátek', 'Konec', 'Předmět', 'Téma', 'Minuty', 'Režim', 'Soustředění', 'Vyrušení', 'Poznámka', 'Vybavení'];
  const rows = [...sessions]
    .filter((s) => !s.deletedAt)
    .sort((a, b) => a.start - b.start)
    .map((s) => [
      dayKey(s.start),
      fmtTime(s.start),
      fmtTime(s.end),
      subj.get(s.subjectId) ?? '',
      s.topic,
      (s.durationSec / 60).toFixed(1).replace('.', ','),
      modeName(s.mode, presets),
      s.focus ?? '',
      s.interruptions,
      s.note,
      s.recall ?? '',
    ]);
  return '﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}
