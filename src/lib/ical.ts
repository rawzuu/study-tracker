import { TimetableEvent } from '../data/schema';

/**
 * Čtení kalendáře ve formátu iCalendar (.ics) – pro import školního rozvrhu.
 * Umí opakování (RRULE: DAILY/WEEKLY, INTERVAL, UNTIL, COUNT, BYDAY), výjimky (EXDATE),
 * přesunuté termíny (RECURRENCE-ID), zrušené akce (STATUS:CANCELLED) a časová pásma (TZID).
 * Celodenní akce (např. „zápočtový týden“) se přeskočí – nejsou to obsazené hodiny.
 */

export interface IcsResult {
  name: string;
  events: TimetableEvent[];
  skippedAllDay: number;
}

interface Prop {
  value: string;
  params: Record<string, string>;
}

interface RawEvent {
  props: Map<string, Prop[]>;
}

const MAX_HORIZON_DAYS = 200; // opakování bez konce rozbalíme nejvýš na ~semestr
const MAX_SPAN_DAYS = 400; // ani s koncem dál než ~rok dopředu
const MAX_OCCURRENCES = 2000;

/** Rozloží text na řádky a spojí pokračovací řádky (začínají mezerou nebo tabulátorem). */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) out[out.length - 1] += line.slice(1);
    else if (line.trim()) out.push(line);
  }
  return out;
}

function parseLine(line: string): { name: string; prop: Prop } | null {
  // Dvojtečka uvnitř uvozovek v parametrech není oddělovač hodnoty.
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [rawName, ...rawParams] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: rawName.toUpperCase(), prop: { value: line.slice(colon + 1), params } };
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

/** Posun časového pásma `tz` v okamžiku `utcMs` (ms). Neznámé pásmo → null. */
function tzOffset(utcMs: number, tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs;
  } catch {
    return null;
  }
}

interface Wall {
  y: number;
  mo: number; // 0–11
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** Místní („nástěnný“) čas v pásmu `tz` → okamžik v ms. Bez pásma = místní čas prohlížeče. */
function wallToMs(w: Wall, tz: string | null, utc: boolean): number {
  if (utc) return Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s);
  if (tz) {
    const guess = Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s);
    const o1 = tzOffset(guess, tz);
    if (o1 != null) {
      let t = guess - o1;
      const o2 = tzOffset(t, tz);
      if (o2 != null && o2 !== o1) t = guess - o2;
      return t;
    }
  }
  return new Date(w.y, w.mo, w.d, w.h, w.mi, w.s).getTime();
}

interface DateValue {
  wall: Wall;
  allDay: boolean;
  utc: boolean;
  tz: string | null;
}

function parseDate(p: Prop): DateValue | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(p.value.trim());
  if (!m) return null;
  const allDay = p.params.VALUE === 'DATE' || m[4] === undefined;
  return {
    wall: { y: +m[1], mo: +m[2] - 1, d: +m[3], h: m[4] ? +m[4] : 0, mi: m[5] ? +m[5] : 0, s: m[6] ? +m[6] : 0 },
    allDay,
    utc: m[7] === 'Z',
    tz: p.params.TZID ?? null,
  };
}

const toMs = (v: DateValue) => wallToMs(v.wall, v.tz, v.utc);

/** Posun data v nástěnném čase o `days` dní (správně přes změnu času i konce měsíců). */
function addWallDays(w: Wall, days: number): Wall {
  const d = new Date(Date.UTC(w.y, w.mo, w.d + days));
  return { ...w, y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate() };
}

const WEEKDAY: Record<string, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };
const wallWeekday = (w: Wall) => (new Date(Date.UTC(w.y, w.mo, w.d)).getUTCDay() + 6) % 7;

/** Začátky všech výskytů (nástěnný čas) podle RRULE. */
function expand(start: DateValue, rrule: string | undefined): Wall[] {
  if (!rrule) return [start.wall];
  const r: Record<string, string> = {};
  for (const part of rrule.split(';')) {
    const [k, v] = part.split('=');
    if (k && v) r[k.toUpperCase()] = v;
  }
  const freq = r.FREQ;
  if (freq !== 'WEEKLY' && freq !== 'DAILY') return [start.wall]; // jiné frekvence se v rozvrzích nevyskytují
  const interval = Math.max(1, Number(r.INTERVAL) || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const startMs = toMs(start);
  let until = startMs + MAX_HORIZON_DAYS * 86_400_000;
  if (r.UNTIL) {
    const u = parseDate({ value: r.UNTIL, params: {} });
    if (u) until = u.allDay ? wallToMs({ ...u.wall, h: 23, mi: 59, s: 59 }, start.tz, false) : wallToMs(u.wall, start.tz, u.utc);
  }
  until = Math.min(until, startMs + MAX_SPAN_DAYS * 86_400_000);
  const out: Wall[] = [];
  const push = (w: Wall) => {
    const t = wallToMs(w, start.tz, start.utc);
    if (t < startMs || t > until || out.length >= count) return false;
    out.push(w);
    return true;
  };
  if (freq === 'DAILY') {
    for (let k = 0; out.length < Math.min(count, MAX_OCCURRENCES); k += interval) {
      const w = addWallDays(start.wall, k);
      if (wallToMs(w, start.tz, start.utc) > until) break;
      push(w);
    }
    return out;
  }
  const days = (r.BYDAY ? r.BYDAY.split(',').map((d) => WEEKDAY[d.slice(-2).toUpperCase()]) : [wallWeekday(start.wall)])
    .filter((d) => d !== undefined)
    .sort((a, b) => a - b);
  const monday = addWallDays(start.wall, -wallWeekday(start.wall));
  for (let week = 0; out.length < Math.min(count, MAX_OCCURRENCES); week += interval) {
    const weekStart = addWallDays(monday, week * 7);
    if (wallToMs(weekStart, start.tz, start.utc) > until) break;
    for (const d of days) {
      if (out.length >= count) break;
      push(addWallDays(weekStart, d));
    }
  }
  return out;
}

const normSeries = (title: string) => title.trim().replace(/\s+/g, ' ');

export function parseIcs(text: string): IcsResult {
  const lines = unfold(text);
  if (!lines.some((l) => l.toUpperCase().startsWith('BEGIN:VCALENDAR'))) throw new Error('Soubor není kalendář ve formátu .ics.');
  let name = '';
  const raw: RawEvent[] = [];
  let cur: RawEvent | null = null;
  let depth = 0; // vnořené bloky (VALARM, VTIMEZONE) uvnitř VEVENT ignorujeme
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      if (p.prop.value.toUpperCase() === 'VEVENT' && !cur) {
        cur = { props: new Map() };
        depth = 0;
      } else if (cur) depth++;
      continue;
    }
    if (p.name === 'END') {
      if (cur && depth === 0 && p.prop.value.toUpperCase() === 'VEVENT') {
        raw.push(cur);
        cur = null;
      } else if (cur) depth--;
      continue;
    }
    if (cur && depth === 0) {
      if (!cur.props.has(p.name)) cur.props.set(p.name, []);
      cur.props.get(p.name)!.push(p.prop);
    } else if (!cur && p.name === 'X-WR-CALNAME') name = unescapeText(p.prop.value);
  }

  const first = (e: RawEvent, k: string) => e.props.get(k)?.[0];
  const overrides = new Map<string, RawEvent[]>(); // UID → přesunuté termíny
  const masters: RawEvent[] = [];
  for (const e of raw) {
    if (first(e, 'RECURRENCE-ID')) {
      const uid = first(e, 'UID')?.value ?? '';
      if (!overrides.has(uid)) overrides.set(uid, []);
      overrides.get(uid)!.push(e);
    } else masters.push(e);
  }

  const events: TimetableEvent[] = [];
  let skippedAllDay = 0;
  const emit = (e: RawEvent, startWall: Wall, base: DateValue, durMs: number) => {
    const title = unescapeText(first(e, 'SUMMARY')?.value ?? 'Bez názvu');
    const start = wallToMs(startWall, base.tz, base.utc);
    const series = normSeries(title);
    events.push({ key: `${series}|${start}`, series, title, location: unescapeText(first(e, 'LOCATION')?.value ?? ''), start, end: start + durMs });
  };
  const durationOf = (e: RawEvent, start: DateValue): number | null => {
    const endP = first(e, 'DTEND');
    if (endP) {
      const end = parseDate(endP);
      return end ? toMs(end) - toMs(start) : null;
    }
    const dur = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(first(e, 'DURATION')?.value ?? '');
    if (dur && (dur[1] || dur[2] || dur[3])) return ((+(dur[1] ?? 0) * 24 + +(dur[2] ?? 0)) * 60 + +(dur[3] ?? 0)) * 60_000;
    return null;
  };

  // Přesunuté termíny bez hlavní akce bereme jako samostatné akce.
  const masterUids = new Set(masters.map((e) => first(e, 'UID')?.value ?? ''));
  for (const [uid, list] of overrides) if (!masterUids.has(uid)) masters.push(...list);

  for (const e of masters) {
    const sp = first(e, 'DTSTART');
    const start = sp && parseDate(sp);
    if (!start) continue;
    if (start.allDay) {
      skippedAllDay++;
      continue;
    }
    if ((first(e, 'STATUS')?.value ?? '').toUpperCase() === 'CANCELLED') continue;
    const dur = durationOf(e, start);
    if (dur == null || dur <= 0) continue;
    const uid = first(e, 'UID')?.value ?? '';
    const excluded = new Set<number>();
    for (const ex of e.props.get('EXDATE') ?? []) {
      for (const v of ex.value.split(',')) {
        const d = parseDate({ value: v, params: { ...ex.params, TZID: ex.params.TZID ?? start.tz ?? '' } });
        if (d) excluded.add(d.allDay ? Date.UTC(d.wall.y, d.wall.mo, d.wall.d) : toMs({ ...d, tz: d.tz || null }));
      }
    }
    const moved = new Map<number, RawEvent>();
    for (const o of overrides.get(uid) ?? []) {
      const rid = parseDate(first(o, 'RECURRENCE-ID')!);
      if (rid) moved.set(toMs({ ...rid, tz: rid.tz ?? start.tz }), o);
    }
    for (const w of expand(start, first(e, 'RRULE')?.value)) {
      const t = wallToMs(w, start.tz, start.utc);
      if (excluded.has(t) || excluded.has(Date.UTC(w.y, w.mo, w.d))) continue;
      const o = moved.get(t);
      if (o) {
        if ((first(o, 'STATUS')?.value ?? '').toUpperCase() === 'CANCELLED') continue;
        const os = parseDate(first(o, 'DTSTART')!);
        if (!os || os.allDay) continue;
        emit(o, os.wall, os, durationOf(o, os) ?? dur);
      } else emit(e, w, start, dur);
    }
  }
  events.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
  // Stejný termín uvedený dvakrát (některé exporty to dělají) jen jednou
  const unique = events.filter((ev, i) => i === 0 || ev.key !== events[i - 1].key);
  return { name, events: unique, skippedAllDay };
}
