import { useEffect, useMemo } from 'react';
import { useStore } from '../../data/store';
import { useToast } from '../../components/ui';
import { navigate } from '../../lib/router';
import { describe, evaluate } from './achievements';

const KEY = 'st.ach.seen';

/** Hlídá nově odemčené úspěchy a krátce o nich dá vědět. Při prvním spuštění jen tiše uloží stav. */
export function AchievementWatcher() {
  const { data } = useStore();
  const toast = useToast();
  const ids = useMemo(() => evaluate(data).unlockedIds, [data]);

  useEffect(() => {
    let seen: string[] | null = null;
    try {
      seen = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    } catch {
      seen = null;
    }
    const fresh = seen ? ids.filter((id) => !seen!.includes(id)) : [];
    try {
      localStorage.setItem(KEY, JSON.stringify(ids));
    } catch {
      /* ignore */
    }
    if (fresh.length) {
      const d = describe(fresh[fresh.length - 1]);
      if (d) toast(`Odemčeno: ${d.name} – ${d.desc}${fresh.length > 1 ? ` (+${fresh.length - 1} další)` : ''}`, { label: 'Zobrazit', onClick: () => navigate('uspechy') });
    }
  }, [ids, toast]);

  return null;
}
