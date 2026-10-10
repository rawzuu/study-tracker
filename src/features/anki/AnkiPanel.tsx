import { Layers, RefreshCw } from 'lucide-react';
import { useStore } from '../../data/store';
import { Empty } from '../../components/ui';
import { fmtDuration, fmtTime, startOfDay } from '../../lib/time';
import { syncAnkiNow, useAnkiStatus } from './useAnkiSync';
import './anki.css';

/** Panel „Anki dnes“ – kolik karet zbývá a kolik je hotovo. */
export function AnkiPanel({ className = '' }: { className?: string }) {
  const { data } = useStore();
  const status = useAnkiStatus();
  const snap = data.anki.find((a) => a.id === 'snapshot' && !a.deletedAt);
  const fresh = snap && startOfDay(snap.at) === startOfDay(Date.now());
  const decks = snap?.decks ?? [];
  const totals = decks.reduce((a, d) => ({ n: a.n + d.newCount, l: a.l + d.learnCount, r: a.r + d.reviewCount }), { n: 0, l: 0, r: 0 });
  const due = totals.n + totals.l + totals.r;

  const statusText =
    status.state === 'syncing'
      ? 'načítám…'
      : status.state === 'ok'
        ? `živě · ${fmtTime(status.at)}`
        : snap
          ? `${status.state === 'off' ? 'stav' : 'Anki neběží · stav'} z ${fmtTime(snap.at)}${fresh ? '' : ` (${new Date(snap.at).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })})`}`
          : status.state === 'off'
            ? 'vypnuto'
            : 'Anki neběží';

  return (
    <div className={`card ${className}`}>
      <div className="card-head">
        <h2>Anki dnes</h2>
        <div className="row" style={{ gap: 4 }}>
          <span className={`sub anki-status s-${status.state}`}>{statusText}</span>
          {data.settings.anki.enabled && (
            <button className="btn ghost icon sm" onClick={() => syncAnkiNow()} title="Načíst znovu" disabled={status.state === 'syncing'}>
              <RefreshCw size={13} className={status.state === 'syncing' ? 'spin' : ''} />
            </button>
          )}
        </div>
      </div>
      {!snap ? (
        <Empty icon={<Layers size={22} strokeWidth={1.5} />} title={data.settings.anki.enabled ? 'Čekám na Anki' : 'Anki není propojená'}>
          <a href="#/nastaveni" className="small">
            {data.settings.anki.enabled ? 'Spusť Anki na počítači · nastavení →' : 'Propojit v Nastavení →'}
          </a>
        </Empty>
      ) : (
        <div className="stack">
          <div className="anki-hero">
            <div>
              <div className="anki-big num">{fresh ? due : '—'}</div>
              <div className="label">{fresh ? 'Zbývá dnes' : 'Stav není z dneška'}</div>
            </div>
            <div className="anki-counts num">
              <span className="c-new" title="Nové">{totals.n}</span>
              <span className="c-learn" title="Učené">{totals.l}</span>
              <span className="c-rev" title="K opakování">{totals.r}</span>
            </div>
          </div>
          <div className="list">
            {decks.slice(0, 6).map((d) => (
              <div key={d.name} className="list-item anki-deck">
                <span className="grow ellipsis">{d.name}</span>
                <span className="anki-counts small num">
                  <span className="c-new">{d.newCount}</span>
                  <span className="c-learn">{d.learnCount}</span>
                  <span className="c-rev">{d.reviewCount}</span>
                </span>
              </div>
            ))}
          </div>
          {fresh && (
            <div className="small faint num">
              dnes hotovo {snap.reviewedToday} karet · {fmtDuration(snap.msToday / 1000, { short: true })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
