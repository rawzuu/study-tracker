import { useRef } from 'react';
import { AlertTriangle, CheckCircle2, Info, Layers, Plug, Plus, RefreshCw } from 'lucide-react';
import { useStore } from '../../data/store';
import { SUBJECT_COLORS, alive, uid } from '../../data/schema';
import { Switch } from '../../components/ui';
import { fmtTime, plural } from '../../lib/time';
import { ANKI_SUBJECT_ID, syncAnkiNow, useAnkiStatus } from './useAnkiSync';

const NEW = '__new__';

/** „algoritmizace“ → „Algoritmizace“ */
const prettyName = (deck: string) => deck.charAt(0).toLocaleUpperCase('cs') + deck.slice(1);
/** Porovnání názvů bez ohledu na velikost písmen a diakritiku. */
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('cs').trim();

export function AnkiSettings() {
  const { data, setSettings, upsert } = useStore();
  const cfg = data.settings.anki;
  const status = useAnkiStatus();
  const snap = data.anki.find((a) => a.id === 'snapshot' && !a.deletedAt);
  const subjects = alive(data.subjects).filter((s) => !s.archived && s.id !== ANKI_SUBJECT_ID);
  const set = (patch: Partial<typeof cfg>) => setSettings({ anki: { ...cfg, ...patch } });

  // Přiřazení balíčků k předmětům; po změně se historie přepočítá (s prodlevou, aby se změny stihly uložit).
  const recompute = useRef<number | undefined>(undefined);
  const scheduleRecompute = () => {
    window.clearTimeout(recompute.current);
    recompute.current = window.setTimeout(() => syncAnkiNow(true), 400);
  };
  const mapDeck = (deck: string, subjectId: string) => {
    set({ deckSubjects: { ...cfg.deckSubjects, [deck]: subjectId } });
    scheduleRecompute();
  };
  const usedColors = () => new Set(alive(data.subjects).map((s) => s.color));
  const createSubjectFor = (deck: string, used = usedColors()): string => {
    const name = prettyName(deck);
    const existing = alive(data.subjects).find((s) => norm(s.name) === norm(name) && s.id !== ANKI_SUBJECT_ID);
    if (existing) return existing.id;
    const color = SUBJECT_COLORS.find((c) => !used.has(c)) ?? SUBJECT_COLORS[used.size % SUBJECT_COLORS.length];
    used.add(color);
    const id = uid();
    upsert('subjects', { id, name, color, weeklyGoalMin: 0, archived: false });
    return id;
  };
  const unmapped = (snap?.decks ?? []).filter((d) => {
    const m = cfg.deckSubjects[d.name];
    return !m || !subjects.some((s) => s.id === m);
  });
  const createAllMissing = () => {
    const used = usedColors();
    const next = { ...cfg.deckSubjects };
    for (const d of unmapped) next[d.name] = createSubjectFor(d.name, used);
    set({ deckSubjects: next });
    scheduleRecompute();
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="row" style={{ gap: 8 }}>
          <Layers size={15} /> Anki
        </h2>
        {status.state === 'ok' ? (
          <span className="chip ok">
            <CheckCircle2 size={12} /> připojeno {fmtTime(status.at)}
          </span>
        ) : status.state === 'syncing' ? (
          <span className="chip accent">připojuji…</span>
        ) : cfg.enabled ? (
          <span className="chip warn">nepřipojeno</span>
        ) : (
          <span className="chip">vypnuto</span>
        )}
      </div>
      <div className="stack">
        <p className="small muted">
          Na přehledu uvidíš, kolik karet ti dnes zbývá, a čas strávený v Anki se započítá do statistik i kalendáře. Funguje na počítači,
          kde běží desktopová Anki. Na mobilu se zobrazí poslední stav z počítače.
        </p>
        <div className="callout">
          <Info size={15} />
          <div className="stack tight small">
            <b>Jak propojit (jednou):</b>
            <span>
              1. V Anki: <i>Nástroje → Doplňky → Získat doplňky</i> → kód <code>2055492159</code> (AnkiConnect) → restartuj Anki.
            </span>
            <span>2. Nech Anki běžet a zapni přepínač níže.</span>
            <span>3. Anki se zeptá, jestli povolit tuto stránku → <b>Yes</b>. Prohlížeč se může zeptat na přístup k místní síti → <b>Povolit</b>.</span>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="label">Propojit s Anki</div>
            <div className="desc">Kontroluje Anki každé 2 minuty, když je stránka otevřená.</div>
          </div>
          <Switch checked={cfg.enabled} onChange={(v) => set({ enabled: v })} />
        </div>

        {cfg.enabled && (
          <>
            {(status.state === 'offline' || status.state === 'denied' || status.state === 'error') && (
              <div className="callout bad">
                <AlertTriangle size={15} />
                <span>{status.message}</span>
              </div>
            )}
            <div className="row wrap">
              <button className="btn" onClick={() => syncAnkiNow()} disabled={status.state === 'syncing'}>
                <Plug size={14} /> Připojit / načíst
              </button>
              <button className="btn ghost" onClick={() => syncAnkiNow(true)} disabled={status.state === 'syncing'} title="Znovu načte historii a přepočítá bloky">
                <RefreshCw size={14} /> Přepočítat historii
              </button>
            </div>

            <div className="setting-row">
              <div>
                <div className="label">Započítávat čas z Anki</div>
                <div className="desc">Opakování v Anki se zapíše jako sezení (blok = opakování bez pauzy delší než 10 min).</div>
              </div>
              <Switch checked={cfg.countTime} onChange={(v) => set({ countTime: v })} />
            </div>
            <div className="setting-row">
              <div>
                <div className="label">Načíst historii</div>
                <div className="desc">Kolik dní zpětně načíst při prvním propojení nebo přepočtu.</div>
              </div>
              <select className="input" style={{ width: 130 }} value={cfg.importDays} onChange={(e) => set({ importDays: Number(e.target.value) })}>
                {[7, 30, 60, 180, 365].map((d) => (
                  <option key={d} value={d}>
                    {d} dní
                  </option>
                ))}
              </select>
            </div>

            {snap && snap.decks.length > 0 && (
              <div className="stack tight">
                <div className="row between">
                  <span className="label">balíček → předmět</span>
                  {unmapped.length > 0 && (
                    <button className="btn sm" onClick={createAllMissing}>
                      <Plus size={13} /> Založit předměty pro {unmapped.length} {plural(unmapped.length, 'balíček', 'balíčky', 'balíčků')}
                    </button>
                  )}
                </div>
                {snap.decks.map((d) => {
                  const mapped = cfg.deckSubjects[d.name];
                  const valid = mapped && subjects.some((s) => s.id === mapped);
                  return (
                    <div key={d.name} className="deck-map">
                      <span className="ellipsis small">
                        {d.name}
                        <span className="faint num"> · {d.total} karet</span>
                      </span>
                      <select
                        className={`input ${valid ? '' : 'unmapped'}`}
                        value={valid ? mapped : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === NEW) mapDeck(d.name, createSubjectFor(d.name));
                          else mapDeck(d.name, v);
                        }}
                      >
                        <option value="">Anki (samostatně)</option>
                        {subjects.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                        <option value={NEW}>＋ Nový předmět „{prettyName(d.name)}“</option>
                      </select>
                    </div>
                  );
                })}
                <span className="small faint">
                  Čas strávený v balíčku se zapíše k vybranému předmětu – započítá se do jeho týdenního cíle, statistik, reportu a v kalendáři
                  bude mít jeho barvu. Na samotnou Anki to nemá vliv. Po změně se historie přepočítá automaticky.
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
