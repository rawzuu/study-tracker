import { useEffect, useRef } from 'react';
import { useStore } from '../../data/store';
import { alive } from '../../data/schema';
import { norm } from '../../lib/timetable';
import { useTimer } from './TimerContext';

/**
 * Odkaz, který rovnou spustí časovač – pro zkratku na ikoně aplikace, Siri nebo Zkratky:
 *   #/casovac?start=1                     → poslední použitý předmět
 *   #/casovac?start=1&predmet=Matematika  → předmět podle názvu (stačí začátek, bez diakritiky)
 *   …&tema=Derivace                       → předvyplní téma
 * Parametry se po použití z adresy odstraní, aby obnovení stránky blok nespustilo znovu.
 */
export function useTimerDeepLink() {
  const timer = useTimer();
  const { data } = useStore();
  const ref = useRef({ timer, data });
  ref.current = { timer, data };

  useEffect(() => {
    const run = () => {
      const [path, query] = window.location.hash.replace(/^#\/?/, '').split('?');
      if (path !== 'casovac' || !query) return;
      const p = new URLSearchParams(query);
      if (!p.has('start')) return;
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/casovac`);
      const { timer: t, data: d } = ref.current;
      if (t.state.status !== 'idle') return; // běžící blok nikdy nepřerušíme
      const wanted = p.get('predmet');
      const subjects = alive(d.subjects).filter((s) => !s.archived);
      const match = wanted ? subjects.find((s) => norm(s.name) === norm(wanted)) ?? subjects.find((s) => norm(s.name).startsWith(norm(wanted))) : null;
      const subjectId = match?.id ?? (subjects.some((s) => s.id === t.state.subjectId) ? t.state.subjectId : '');
      if (!subjectId) return; // bez předmětu se blok spustit nedá – stránka časovače zůstane otevřená
      t.configure({ subjectId, ...(p.get('tema') ? { topic: p.get('tema')! } : {}) });
      t.start();
    };
    run();
    window.addEventListener('hashchange', run);
    return () => window.removeEventListener('hashchange', run);
  }, []);
}
