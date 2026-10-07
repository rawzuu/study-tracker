import { Exam, PlanBlock, Subject } from '../../data/schema';
import { parseDayKey } from '../../lib/time';

/**
 * Generátor iCalendar (.ics) souborů – Apple Kalendář, Google i Outlook je umí importovat.
 * Časy ukládáme v UTC (sufix Z), takže nezáleží na časovém pásmu zařízení.
 */

const pad = (n: number) => String(n).padStart(2, '0');

function utc(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function dateOnly(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/** RFC 5545: řádky delší než 75 bajtů se zalamují. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curLen = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    if (curLen + len > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      curLen = 0;
    }
    cur += ch;
    curLen += len;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function buildIcs(opts: {
  blocks: PlanBlock[];
  exams: Exam[];
  subjects: Subject[];
  alarmMin: number | null;
}): string {
  const subj = new Map(opts.subjects.map((s) => [s.id, s]));
  const now = utc(Date.now());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Study Tracker//CS',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Studijní plán',
  ];

  for (const b of opts.blocks) {
    const name = subj.get(b.subjectId)?.name ?? 'Učení';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${b.id}@study-tracker`,
      `DTSTAMP:${now}`,
      `DTSTART:${utc(b.start)}`,
      `DTEND:${utc(b.start + b.durationMin * 60_000)}`,
      `SUMMARY:${esc(`📚 ${name}${b.title ? ` – ${b.title}` : ''}`)}`,
      `CATEGORIES:${esc(name)}`,
    );
    if (b.note) lines.push(`DESCRIPTION:${esc(b.note)}`);
    if (opts.alarmMin != null) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(name)}`, `TRIGGER:-PT${opts.alarmMin}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }

  for (const e of opts.exams) {
    const name = subj.get(e.subjectId)?.name ?? '';
    lines.push('BEGIN:VEVENT', `UID:exam-${e.id}@study-tracker`, `DTSTAMP:${now}`);
    if (e.time) {
      const [h, m] = e.time.split(':').map(Number);
      const d = parseDayKey(e.date);
      d.setHours(h, m, 0, 0);
      lines.push(`DTSTART:${utc(d.getTime())}`, `DTEND:${utc(d.getTime() + 90 * 60_000)}`);
    } else {
      const d = parseDayKey(e.date);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(d)}`, `DTEND;VALUE=DATE:${dateOnly(next)}`);
    }
    lines.push(`SUMMARY:${esc(`🎓 ${e.name}${name ? ` (${name})` : ''}`)}`);
    if (e.note) lines.push(`DESCRIPTION:${esc(e.note)}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.name)}`, 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
