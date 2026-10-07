import { AlertTriangle, CheckCircle2, Info, Layers, Plug, RefreshCw } from 'lucide-react';
import { useStore } from '../../data/store';
import { alive } from '../../data/schema';
import { Switch } from '../../components/ui';
import { fmtTime } from '../../lib/time';
import { ANKI_SUBJECT_ID, syncAnkiNow, useAnkiStatus } from './useAnkiSync';

export function AnkiSettings() {
  const { data, setSettings } = useStore();
  const cfg = data.settings.anki;
  const status = useAnkiStatus();
  const snap = data.anki.find((a) => a.id === 'snapshot' && !a.deletedAt);
  const subjects = alive(data.subjects).filter((s) => !s.archived && s.id !== ANKI_SUBJECT_ID);
  const set = (patch: Partial<typeof cfg>) => setSettings({ anki: { ...cfg, ...patch } });

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
                <span className="label">balíček → předmět</span>
                {snap.decks.map((d) => (
                  <div key={d.name} className="row between" style={{ padding: '4px 0' }}>
                    <span className="ellipsis small">{d.name}</span>
                    <select
                      className="input"
                      style={{ width: 200 }}
                      value={cfg.deckSubjects[d.name] ?? ''}
                      onChange={(e) => set({ deckSubjects: { ...cfg.deckSubjects, [d.name]: e.target.value } })}
                    >
                      <option value="">Anki (samostatně)</option>
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <span className="small faint">Po změně přiřazení klikni na „Přepočítat historii“.</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
