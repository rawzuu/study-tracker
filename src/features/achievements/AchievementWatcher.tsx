import { useEffect, useMemo } from 'react';
import { useStore } from '../../data/store';
import { useToast } from '../../components/ui';
import { navigate } from '../../lib/router';
import { describe, evaluate, toPersist } from './achievements';

const KEY = 'st.ach.seen';

/**
 * Hlídá nově odemčené úspěchy: uloží je natrvalo do dat (aby je pozdější změna cílů nevzala)
 * a krátce o nich dá vědět. Při prvním spuštění na zařízení jen tiše uloží stav.
 */
export function AchievementWatcher() {
  const { data, upsertMany } = useStore();
  const toast = useToast();
  const res = useMemo(() => evaluate(data), [data]);
  const ids = res.unlockedIds;

  useEffect(() => {
    const pending = toPersist(data, res);
    if (pending.length) upsertMany('achievements', pending);
  }, [data, res, upsertMany]);

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
