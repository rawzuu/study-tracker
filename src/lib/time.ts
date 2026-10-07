export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const WEEKDAYS_SHORT = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
export const WEEKDAYS_LONG = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Lokální klíč dne YYYY-MM-DD. */
export function dayKey(t: number | Date): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfDay(t: number | Date): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(t: number, n: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Týden začíná pondělím. */
export function startOfWeek(t: number | Date): number {
  const d = new Date(startOfDay(t));
  const wd = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - wd);
  return d.getTime();
}

export function startOfMonth(t: number | Date): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** 0 = pondělí … 6 = neděle */
export function weekdayIdx(t: number | Date): number {
  return (new Date(t).getDay() + 6) % 7;
}

/** Délka v čitelném tvaru: "2 h 15 min", "45 min", "30 s" */
export function fmtDuration(sec: number, opts: { short?: boolean } = {}): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0 && m === 0) return s > 0 ? `${s} s` : '0 min';
  if (opts.short) return h ? `${h}h ${pad(m)}m` : `${m}m`;
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Hodiny s jedním desetinným místem: "3,5 h" */
export function fmtHours(sec: number): string {
  return `${(sec / 3600).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} h`;
}

/** Odpočet "24:13" nebo "1:02:05" */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(t: number, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'numeric' }): string {
  return new Date(t).toLocaleDateString('cs-CZ', opts);
}

export function fmtDayLabel(t: number): string {
  const today = startOfDay(Date.now());
  const d = startOfDay(t);
  if (d === today) return 'Dnes';
  if (d === addDays(today, -1)) return 'Včera';
  if (d === addDays(today, 1)) return 'Zítra';
  return new Date(t).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Hodnota pro <input type="datetime-local"> */
export function toLocalInput(t: number): string {
  const d = new Date(t);
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number {
  return new Date(v).getTime();
}

export function toTimeInput(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Sklonování: plural(3, 'den', 'dny', 'dní') */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}
