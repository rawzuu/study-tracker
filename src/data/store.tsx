import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { get, set, update as idbUpdate } from 'idb-keyval';
import { AppData, CollectionKey, Entity, SCHEMA_VERSION, Settings, emptyData } from './schema';
import { migrate, needsMigration } from './migrations';
import { hasNewer, mergeData, serialize } from './merge';
import { GithubError, fetchRemote, loadGithubConfig, pushRemote } from './github';

/**
 * Jediné místo, přes které aplikace čte a zapisuje data.
 * - lokálně: IndexedDB (rychlé, funguje offline)
 * - vzdáleně: soukromé GitHub repo (bezpečná kopie + historie + víc zařízení)
 *
 * Víc otevřených záložek (nebo PWA + záložka) sdílí jednu IndexedDB. Proto se při ukládání
 * data vždy SLOUČÍ s tím, co tam mezitím zapsala jiná záložka (nikdy se nepřepíší),
 * a ostatní záložky se o změně dozví přes BroadcastChannel.
 */

const DB_KEY = 'appData';
const CHANNEL = 'st-data';

/** Zapíše data do IndexedDB sloučená s uloženým stavem – změny z jiné záložky se neztratí. */
function persist(data: AppData): Promise<void> {
  return idbUpdate<AppData>(DB_KEY, (stored) => (stored ? mergeData(data, migrate(stored)) : data));
}

export type SyncState =
  | { status: 'off' }
  | { status: 'idle'; at?: number }
  | { status: 'syncing' }
  | { status: 'ok'; at: number }
  | { status: 'error'; message: string; at: number };

type ItemOf<K extends CollectionKey> = AppData[K][number];
type NewItem<K extends CollectionKey> = Omit<ItemOf<K>, 'createdAt' | 'updatedAt'> & Partial<Entity>;

interface StoreValue {
  data: AppData;
  update: (fn: (d: AppData) => AppData) => void;
  upsert: <K extends CollectionKey>(key: K, item: NewItem<K>) => void;
  upsertMany: <K extends CollectionKey>(key: K, items: NewItem<K>[]) => void;
  remove: (key: CollectionKey, id: string) => void;
  setSettings: (patch: Partial<Settings>) => void;
  replaceAll: (d: AppData) => void;
  sync: SyncState;
  syncNow: () => Promise<void>;
  refreshSyncConfig: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore musí být uvnitř <StoreProvider>');
  return ctx;
}

function stamp<T extends Partial<Entity>>(item: T, existing: Entity | undefined, now: number) {
  return { ...item, createdAt: existing?.createdAt ?? item.createdAt ?? now, updatedAt: now };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncState>(() => (loadGithubConfig() ? { status: 'idle' } : { status: 'off' }));
  const dataRef = useRef<AppData | null>(null);
  dataRef.current = data;

  // ---------- načtení ----------
  useEffect(() => {
    (async () => {
      try {
        const raw = await get(DB_KEY);
        if (raw && needsMigration(raw)) {
          // Před migrací vždy uložíme zálohu původních dat.
          await set(`backup-before-v${SCHEMA_VERSION}-${Date.now()}`, raw);
        }
        setData(raw ? migrate(raw) : emptyData());
        // Požádá prohlížeč, aby data nemazal při nedostatku místa.
        navigator.storage?.persist?.().catch(() => {});
      } catch (e) {
        setFatal(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const ready = data !== null;

  // ---------- ukládání do IndexedDB ----------
  const channel = useRef<BroadcastChannel | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!data) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      persist(data)
        .then(() => channel.current?.postMessage('saved'))
        .catch((e) => console.error('Uložení selhalo', e));
    }, 150);
    try {
      localStorage.setItem('st.theme', data.settings.theme);
    } catch {
      /* ignore */
    }
  }, [data]);

  useEffect(() => {
    const flush = () => {
      if (dataRef.current) persist(dataRef.current).catch(() => {});
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // ---------- změny z jiných záložek ----------
  useEffect(() => {
    if (!ready) return;
    const pull = async () => {
      try {
        const raw = await get(DB_KEY);
        if (!raw) return;
        const stored = migrate(raw);
        setData((cur) => (cur && hasNewer(cur, stored) ? mergeData(cur, stored) : cur));
      } catch (e) {
        console.error('Načtení změn z jiné záložky selhalo', e);
      }
    };
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel(CHANNEL);
      channel.current.onmessage = () => void pull();
    }
    const onVisible = () => document.visibilityState === 'visible' && void pull();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      channel.current?.close();
      channel.current = null;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready]);

  // ---------- synchronizace s GitHubem ----------
  const syncing = useRef(false);
  const syncAgain = useRef(false);

  const syncNow = useCallback(async () => {
    const cfg = loadGithubConfig();
    if (!cfg) {
      setSync({ status: 'off' });
      return;
    }
    if (!dataRef.current) return;
    if (syncing.current) {
      syncAgain.current = true;
      return;
    }
    syncing.current = true;
    setSync({ status: 'syncing' });
    try {
      for (let attempt = 0; ; attempt++) {
        const remote = await fetchRemote(cfg);
        const local = dataRef.current!;
        let merged = local;
        let remoteText: string | null = null;
        if (remote) {
          const r = migrate(JSON.parse(remote.text));
          remoteText = serialize(r);
          merged = mergeData(local, r);
        }
        const text = serialize(merged);
        if (text !== serialize(local)) {
          // Přišly změny z jiného zařízení – sloučíme je i s případnými úpravami během synchronizace.
          setData((cur) => (cur ? mergeData(cur, merged) : merged));
        }
        if (remoteText === text) break;
        try {
          const when = new Date().toLocaleString('cs-CZ');
          await pushRemote(cfg, text, remote?.sha ?? null, `Sync dat · ${when}`);
          break;
        } catch (e) {
          const conflict = e instanceof GithubError && (e.status === 409 || e.status === 422);
          if (!conflict || attempt >= 3) throw e;
        }
      }
      setSync({ status: 'ok', at: Date.now() });
    } catch (e) {
      setSync({ status: 'error', message: e instanceof Error ? e.message : String(e), at: Date.now() });
    } finally {
      syncing.current = false;
      if (syncAgain.current) {
        syncAgain.current = false;
        void syncNow();
      }
    }
  }, []);

  const syncTimer = useRef<number | undefined>(undefined);
  const scheduleSync = useCallback(() => {
    if (!loadGithubConfig()) return;
    window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => void syncNow(), 3000);
  }, [syncNow]);

  useEffect(() => {
    if (!ready) return;
    void syncNow();
    const onVisible = () => document.visibilityState === 'visible' && void syncNow();
    const onOnline = () => void syncNow();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    // Pravidelná kontrola jen když je stránka vidět – na pozadí zbytečně nežere baterku ani data.
    const interval = window.setInterval(() => document.visibilityState === 'visible' && void syncNow(), 5 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.clearInterval(interval);
    };
  }, [ready, syncNow]);

  // ---------- zápisy ----------
  const update = useCallback(
    (fn: (d: AppData) => AppData) => {
      setData((cur) => (cur ? fn(cur) : cur));
      scheduleSync();
    },
    [scheduleSync],
  );

  const upsertMany = useCallback(
    <K extends CollectionKey>(key: K, items: NewItem<K>[]) => {
      const now = Date.now();
      update((d) => {
        const list = [...(d[key] as Entity[])];
        for (const item of items) {
          const idx = list.findIndex((e) => e.id === item.id);
          const stamped = stamp(item, idx >= 0 ? list[idx] : undefined, now) as unknown as Entity;
          if (idx >= 0) list[idx] = { ...list[idx], ...stamped };
          else list.push(stamped);
        }
        return { ...d, [key]: list };
      });
    },
    [update],
  );

  const upsert = useCallback(
    <K extends CollectionKey>(key: K, item: NewItem<K>) => upsertMany(key, [item]),
    [upsertMany],
  );

  const remove = useCallback(
    (key: CollectionKey, id: string) => {
      const now = Date.now();
      update((d) => ({
        ...d,
        [key]: (d[key] as Entity[]).map((e) => (e.id === id ? { ...e, deletedAt: now, updatedAt: now } : e)),
      }));
    },
    [update],
  );

  const setSettings = useCallback(
    (patch: Partial<Settings>) => update((d) => ({ ...d, settings: { ...d.settings, ...patch, updatedAt: Date.now() } })),
    [update],
  );

  const replaceAll = useCallback(
    (incoming: AppData) => update((d) => mergeData(d, incoming)),
    [update],
  );

  const refreshSyncConfig = useCallback(() => {
    setSync(loadGithubConfig() ? { status: 'idle' } : { status: 'off' });
    void syncNow();
  }, [syncNow]);

  const value = useMemo<StoreValue | null>(
    () =>
      data
        ? { data, update, upsert, upsertMany, remove, setSettings, replaceAll, sync, syncNow, refreshSyncConfig }
        : null,
    [data, update, upsert, upsertMany, remove, setSettings, replaceAll, sync, syncNow, refreshSyncConfig],
  );

  if (fatal) {
    return (
      <div className="fatal">
        <h1>Data se nepodařilo načíst</h1>
        <p>{fatal}</p>
        <p>Tvoje data zůstala nedotčená. Zkus stránku obnovit (⌘⇧R).</p>
      </div>
    );
  }
  if (!value) return <div className="boot" />;
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
