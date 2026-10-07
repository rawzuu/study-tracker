import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useStore } from '../../data/store';
import { AppData, Session } from '../../data/schema';
import { AnkiError, clusterReviews, fetchAnki } from '../../lib/anki';
import { addDays, startOfDay } from '../../lib/time';

/**
 * Synchronizace s Anki: každé 2 minuty (a při návratu na stránku) načte počty k opakování
 * a z historie opakování vytvoří sezení (předmět podle balíčku), takže se čas z Anki
 * objeví ve statistikách i v kalendáři. Zapisuje jen při skutečné změně.
 */

export const ANKI_SUBJECT_ID = 'anki';

export type AnkiStatus =
  | { state: 'off' }
  | { state: 'syncing' }
  | { state: 'ok'; at: number }
  | { state: 'offline' | 'denied' | 'error'; message: string; at: number };

let status: AnkiStatus = { state: 'off' };
const listeners = new Set<() => void>();
function setStatus(s: AnkiStatus) {
  status = s;
  listeners.forEach((l) => l());
}
export function useAnkiStatus(): AnkiStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

let requestRun: ((fullHistory?: boolean) => void) | null = null;
/** Spustí synchronizaci hned (např. z tlačítka). */
export function syncAnkiNow(fullHistory = false) {
  requestRun?.(fullHistory);
}

type Store = Pick<ReturnType<typeof useStore>, 'upsert' | 'upsertMany' | 'remove'>;

/** Poslední známý počet dnešních opakování – když se nezmění, historie se nestahuje znovu. */
let lastSeen: { day: number; reviewedToday: number } | null = null;

/** Jedno kolo synchronizace (exportováno kvůli testům). */
export async function runAnkiSync(store: Store, data: AppData, fullHistory: boolean) {
  const cfg = data.settings.anki;
  const hasAnkiSessions = data.sessions.some((s) => s.mode === 'anki' && !s.deletedAt);
  const days = fullHistory || !hasAnkiSessions ? cfg.importDays : 2;
  const since = addDays(startOfDay(Date.now()), -(days - 1));

  setStatus({ state: 'syncing' });
  try {
    const day = startOfDay(Date.now());
    const known = !fullHistory && lastSeen?.day === day ? lastSeen.reviewedToday : undefined;
    // Historii bereme o den delší, aby se blok přes půlnoc na hranici okna nerozpůlil (a nezapočítal dvakrát).
    const res = await fetchAnki(addDays(since, -1), { knownReviewedToday: known });

    // Snapshot – jen když se změnila čísla (aby se zbytečně necommitovalo na GitHub)
    const today = startOfDay(Date.now());
    const prev = data.anki.find((a) => a.id === 'snapshot');
    const msToday = res.reviewsFetched ? res.reviews.filter((r) => r.time >= today).reduce((a, r) => a + r.durationMs, 0) : (prev?.msToday ?? 0);
    const sig = (x: { decks: unknown; reviewedToday: number; msToday: number }) => JSON.stringify([x.decks, x.reviewedToday, Math.round(x.msToday / 60000)]);
    if (!prev || sig(prev) !== sig({ decks: res.decks, reviewedToday: res.reviewedToday, msToday })) {
      store.upsert('anki', { id: 'snapshot', at: Date.now(), decks: res.decks, reviewedToday: res.reviewedToday, msToday });
    }

    if (cfg.countTime && res.reviewsFetched) {
      // Předmět „Anki“ pro balíčky bez přiřazení
      const unmapped = res.reviews.some((r) => !cfg.deckSubjects[r.deck]);
      if (unmapped && !data.subjects.some((s) => s.id === ANKI_SUBJECT_ID && !s.deletedAt)) {
        store.upsert('subjects', { id: ANKI_SUBJECT_ID, name: 'Anki', color: '#9ca3af', weeklyGoalMin: 0, archived: false });
      }
      // Okno spravuje bloky, které do něj aspoň zasahují (i ty začaté před půlnocí).
      const blocks = clusterReviews(res.reviews).filter((b) => b.durationMs >= 30_000 && b.end >= since);
      const wanted = new Map<string, Omit<Session, 'createdAt' | 'updatedAt'>>();
      for (const b of blocks) {
        const id = `anki-${b.deck.replace(/[^\p{L}\p{N}]+/gu, '_')}-${b.start}`;
        wanted.set(id, {
          id,
          subjectId: cfg.deckSubjects[b.deck] || ANKI_SUBJECT_ID,
          topic: b.deck,
          start: b.start,
          end: Math.max(b.end, b.start + b.durationMs),
          durationSec: Math.round(b.durationMs / 1000),
          mode: 'anki',
          interruptions: 0,
          note: `${b.count} karet`,
        });
      }
      const existing = data.sessions.filter((s) => s.mode === 'anki' && (s.start >= since || s.end >= since));
      const changed = [...wanted.values()].filter((w) => {
        const e = existing.find((x) => x.id === w.id);
        if (e?.deletedAt) return false; // smazané sezení nevracíme a zbytečně ho nepřepisujeme
        return !e || e.end !== w.end || e.durationSec !== w.durationSec || e.subjectId !== w.subjectId;
      });
      if (changed.length) store.upsertMany('sessions', changed);
      // Bloky, které po přepočtu už neexistují (v daném okně), smažeme. Pojistka: když Anki nevrátí
      // vůbec žádnou historii (jiný profil, čerstvá instalace), nemažeme nic.
      if (res.reviews.length > 0) for (const e of existing) if (!e.deletedAt && !wanted.has(e.id)) store.remove('sessions', e.id);
    }
    lastSeen = { day, reviewedToday: res.reviewedToday };
    setStatus({ state: 'ok', at: Date.now() });
  } catch (e) {
    const kind = e instanceof AnkiError ? e.kind : 'error';
    setStatus({ state: kind === 'offline' ? 'offline' : kind, message: e instanceof Error ? e.message : String(e), at: Date.now() });
  }
}

export function useAnkiSync() {
  const store = useStore();
  const enabled = store.data.settings.anki.enabled;
  const ref = useRef(store);
  ref.current = store;
  const busy = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setStatus({ state: 'off' });
      requestRun = null;
      return;
    }
    const go = async (full = false) => {
      if (busy.current) return;
      busy.current = true;
      try {
        await runAnkiSync(ref.current, ref.current.data, full);
      } finally {
        busy.current = false;
      }
    };
    requestRun = (full) => void go(full);
    void go();
    const onVis = () => document.visibilityState === 'visible' && void go();
    document.addEventListener('visibilitychange', onVis);
    const id = window.setInterval(() => document.visibilityState === 'visible' && void go(), 2 * 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(id);
      requestRun = null;
    };
  }, [enabled]);
}
