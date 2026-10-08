import { AppData, CollectionKey, Entity } from '../data/schema';
import { DAY, fmtDate, fmtDuration, fmtTime } from './time';

/**
 * Koš: mazání je v aplikaci měkké (deletedAt), takže smazané položky jde vrátit.
 * Obnovení = odebrání deletedAt a nové updatedAt → při synchronizaci vyhraje i na ostatních zařízeních.
 */

export const TRASH_DAYS = 30;

export type TrashKey = Extract<CollectionKey, 'sessions' | 'topics' | 'exams' | 'planBlocks' | 'subjects' | 'presets' | 'timetables' | 'reflections'>;

export const TRASH_LABEL: Record<TrashKey, string> = {
  sessions: 'Sezení',
  topics: 'Téma',
  exams: 'Zkouška',
  planBlocks: 'Blok plánu',
  subjects: 'Předmět',
  presets: 'Režim časovače',
  timetables: 'Rozvrh',
  reflections: 'Reflexe',
};

export interface TrashItem {
  key: TrashKey;
  id: string;
  deletedAt: number;
  title: string;
  detail: string;
}

/** Smazané položky za posledních 30 dní, nejnovější první. Systémová mazání (Anki, přegenerované bloky zkoušek) vynechá. */
export function trashItems(data: AppData, now = Date.now()): TrashItem[] {
  const since = now - TRASH_DAYS * DAY;
  const subj = (id: string) => data.subjects.find((s) => s.id === id)?.name ?? '?';
  const out: TrashItem[] = [];
  const add = (key: TrashKey, e: Entity, title: string, detail: string) => {
    if (e.deletedAt && e.deletedAt >= since) out.push({ key, id: e.id, deletedAt: e.deletedAt, title, detail });
  };
  for (const s of data.sessions) if (s.mode !== 'anki') add('sessions', s, subj(s.subjectId), `${fmtDate(s.start)} ${fmtTime(s.start)} · ${fmtDuration(s.durationSec)}${s.topic ? ' · ' + s.topic : ''}`);
  for (const t of data.topics) add('topics', t, t.name, subj(t.subjectId));
  for (const e of data.exams) add('exams', e, e.name, `${subj(e.subjectId)} · ${e.date.split('-').reverse().join('. ')}`);
  for (const b of data.planBlocks) if (!b.examId) add('planBlocks', b, subj(b.subjectId), `${fmtDate(b.start)} ${fmtTime(b.start)} · ${b.durationMin} min${b.title ? ' · ' + b.title : ''}`);
  for (const s of data.subjects) add('subjects', s, s.name, '');
  for (const p of data.presets) add('presets', p, p.name, `${p.workMin} / ${p.shortBreakMin}`);
  for (const t of data.timetables ?? []) add('timetables', t, t.name, `${t.events.length} termínů`);
  for (const r of data.reflections) add('reflections', r, `Týden od ${r.weekStart.split('-').reverse().join('. ')}`, '');
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

function undelete<T extends Entity>(e: T, now: number): T {
  const rest = { ...e };
  delete rest.deletedAt;
  return { ...rest, updatedAt: now };
}

/** Vrátí smazanou položku. U zkoušky vrátí i její naplánovaná opakování smazaná spolu s ní. */
export function restoreEntity(d: AppData, key: CollectionKey, id: string, now = Date.now()): AppData {
  const list = d[key] as Entity[];
  const target = list.find((e) => e.id === id);
  if (!target?.deletedAt) return d;
  const out = { ...d, [key]: list.map((e) => (e.id === id ? undelete(e, now) : e)) } as AppData;
  if (key === 'exams') {
    // bloky se mažou ve stejné chvíli jako zkouška (tolerance pro starší data, kde se mazalo ve dvou krocích)
    const at = target.deletedAt;
    out.planBlocks = d.planBlocks.map((b) => (b.examId === id && b.deletedAt && Math.abs(b.deletedAt - at) < 5000 ? undelete(b, now) : b));
  }
  return out;
}
