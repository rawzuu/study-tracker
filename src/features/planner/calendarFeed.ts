import { useEffect, useRef } from 'react';
import { AppData, CalendarFeed, alive } from '../../data/schema';
import { loadGithubConfig, updateGist } from '../../data/github';
import { addDays, startOfDay } from '../../lib/time';
import { buildIcs } from './ics';

/**
 * Odebíraný kalendář: plán se publikuje do tajného gistu a Apple Kalendář si ho sám
 * pravidelně stahuje. Kdo zná odkaz, plán uvidí – gist ale není nikde vypsaný ani vyhledatelný.
 */

export const FEED_FILE = 'studijni-plan.ics';

export function feedHttpsUrl(f: CalendarFeed): string {
  return `https://gist.githubusercontent.com/${f.owner}/${f.gistId}/raw/${FEED_FILE}`;
}

export function feedWebcalUrl(f: CalendarFeed): string {
  return feedHttpsUrl(f).replace(/^https:/, 'webcal:');
}

export function buildFeed(data: AppData, f: Pick<CalendarFeed, 'includeExams' | 'alarmMin'>): string {
  const from = addDays(startOfDay(Date.now()), -14);
  return buildIcs({
    blocks: alive(data.planBlocks).filter((b) => b.start >= from),
    exams: f.includeExams ? alive(data.exams).filter((e) => new Date(e.date).getTime() >= from) : [],
    subjects: data.subjects,
    alarmMin: f.alarmMin,
    feed: true,
  });
}

/** Otisk obsahu bez časového razítka – mění se jen při skutečné změně plánu. */
export function feedHash(ics: string): string {
  const s = ics.replace(/^DTSTAMP:.*$/gm, '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}

const HASH_KEY = 'st.feedHash';
export const FEED_STATUS_KEY = 'st.feedStatus';

export interface FeedStatus {
  at: number;
  error?: string;
}

export function readFeedStatus(): FeedStatus | null {
  try {
    return JSON.parse(localStorage.getItem(FEED_STATUS_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export async function publishFeed(data: AppData, f: CalendarFeed, force = false): Promise<boolean> {
  const cfg = loadGithubConfig();
  if (!cfg) throw new Error('Nejdřív připoj synchronizaci s GitHubem.');
  const ics = buildFeed(data, f);
  const hash = `${f.gistId}:${feedHash(ics)}`;
  if (!force && localStorage.getItem(HASH_KEY) === hash) return false;
  try {
    await updateGist(cfg.token, f.gistId, FEED_FILE, ics);
    localStorage.setItem(HASH_KEY, hash);
    localStorage.setItem(FEED_STATUS_KEY, JSON.stringify({ at: Date.now() }));
    return true;
  } catch (e) {
    localStorage.setItem(FEED_STATUS_KEY, JSON.stringify({ at: Date.now(), error: e instanceof Error ? e.message : String(e) }));
    throw e;
  }
}

/** Po každé změně plánu (s prodlevou) aktualizuje odebíraný kalendář. */
export function useCalendarFeedSync(data: AppData) {
  const feed = data.settings.calendarFeed;
  const timer = useRef<number | undefined>(undefined);
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    if (!feed) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      publishFeed(dataRef.current, feed).catch((e) => console.warn('Kalendář se nepodařilo aktualizovat', e));
    }, 6000);
    return () => window.clearTimeout(timer.current);
  }, [feed, data.planBlocks, data.exams, data.subjects]);
}
