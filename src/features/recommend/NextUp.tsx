import { useMemo, useState } from 'react';
import { ChevronDown, Compass, Layers, Play } from 'lucide-react';
import { useStore } from '../../data/store';
import { Recommendation, W, contextNote, recommend } from '../../lib/recommend';
import { navigate } from '../../lib/router';
import { modeName } from '../timer/modes';
import { useTimer } from '../timer/TimerContext';
import './nextup.css';

const ACTIVITY_LABEL: Record<Recommendation['activity'], string> = {
  review: 'vybavování',
  exam: 'příprava na zkoušku',
  new: 'nová látka',
  continue: 'pokračování',
  anki: 'kartičky',
  plan: 'podle plánu',
  recap: 'po přednášce',
};

const SIGNALS: { k: keyof Recommendation['signals']; label: string; hint: string }[] = [
  { k: 'E', label: 'Zkouška', hint: 'blízkost zkoušky' },
  { k: 'R', label: 'Opakování', hint: 'témata pod cílovou vybavitelností' },
  { k: 'G', label: 'Týdenní cíl', hint: 'zaostávání za cílem' },
  { k: 'N', label: 'Zanedbání', hint: 'dny bez učení' },
  { k: 'P', label: 'Plán', hint: 'naplánováno na teď' },
  { k: 'X', label: 'Prostřídat', hint: 'nedávno na řadě (snižuje skóre)' },
];

export function useRecommendations(): Recommendation[] {
  const { data } = useStore();
  // přepočet při změně dat; čas se zaokrouhlí na 5 min, aby se doporučení neměnilo pod rukama
  const bucket = Math.floor(Date.now() / 300_000);
  return useMemo(() => recommend({ data }), [data, bucket]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function startRecommendation(r: Recommendation, timer: ReturnType<typeof useTimer>) {
  if (!r.subjectId) return;
  timer.configure({ subjectId: r.subjectId, topic: r.topic, modeId: r.modeId, planBlockId: r.planBlockId });
  navigate('casovac');
}

function Color({ id }: { id: string | null }) {
  const { data } = useStore();
  const s = id ? data.subjects.find((x) => x.id === id) : null;
  return <span className="nx-color" style={{ background: s?.color ?? 'var(--text-3)' }} />;
}

/** Karta „Co teď?“ na přehledu. */
export function NextUp({ className = '' }: { className?: string }) {
  const { data } = useStore();
  const timer = useTimer();
  const recs = useRecommendations();
  const [why, setWhy] = useState(false);
  const note = contextNote(data);
  const top = recs[0];
  const alts = recs.slice(1, 4);
  const subjName = (id: string | null) => (id ? (data.subjects.find((s) => s.id === id)?.name ?? '?') : 'Anki');
  const busy = timer.state.status !== 'idle';

  return (
    <div className={`card nextup ${className}`}>
      <div className="card-head">
        <h2 className="row" style={{ gap: 8 }}>
          <Compass size={15} /> Co teď?
        </h2>
        {top && (
          <button className="btn ghost sm" onClick={() => setWhy(!why)}>
            Proč <ChevronDown size={13} style={{ transform: why ? 'rotate(180deg)' : undefined }} />
          </button>
        )}
      </div>
      {!top ? (
        <p className="small faint">Přidej předměty, cíle nebo zkoušky – doporučení se objeví tady.</p>
      ) : (
        <div className="nx">
          <div className="nx-main">
            <div className="nx-subject">
              <Color id={top.subjectId} />
              <span className="label">{subjName(top.subjectId)}</span>
              <span className="label faint">· {ACTIVITY_LABEL[top.activity]}</span>
            </div>
            <div className="nx-title">{top.title}</div>
            <div className="nx-reasons">
              {top.reasons.slice(0, 3).map((r) => (
                <span key={r}>{r}</span>
              ))}
            </div>
            {note && <div className="nx-note small">{note}</div>}
            <div className="row" style={{ marginTop: 12 }}>
              {top.activity === 'anki' ? (
                <span className="small muted row" style={{ gap: 6 }}>
                  <Layers size={14} /> Otevři Anki – čas se sem započítá sám.
                </span>
              ) : (
                <button className="btn primary" disabled={busy} onClick={() => startRecommendation(top, timer)}>
                  <Play size={13} fill="currentColor" /> Začít · {top.minutes} min
                </button>
              )}
              {top.activity !== 'anki' && <span className="small faint">{modeName(top.modeId, data.presets)}</span>}
            </div>
          </div>
          {alts.length > 0 && (
            <div className="nx-alts">
              <span className="label">nebo</span>
              {alts.map((r) => (
                <button key={r.key} className="nx-alt" disabled={busy || r.activity === 'anki'} onClick={() => startRecommendation(r, timer)} title={r.reasons.join(' · ')}>
                  <Color id={r.subjectId} />
                  <span className="grow ellipsis">
                    <b>{subjName(r.subjectId)}</b> <span className="faint">{r.title}</span>
                  </span>
                  <span className="num faint small">{r.minutes}m</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {why && top && (
        <div className="nx-why">
          <p className="small muted">
            Skóre = 0,30·zkouška + 0,25·opakování + 0,20·týdenní cíl + 0,10·zanedbání + 0,15·plán − 0,35·prostřídat (u blízké zkoušky se toleruje víc času na předmětu, ale ne stejný předmět hned po sobě). Všechny signály jsou 0–1.
            Prokládání předmětů a rozložené opakování patří k nejlépe podloženým metodám učení.
          </p>
          <table className="table nx-table">
            <thead>
              <tr>
                <th>předmět</th>
                {SIGNALS.map((s) => (
                  <th key={s.k} className="r" title={s.hint}>
                    {s.label}
                  </th>
                ))}
                <th className="r">skóre</th>
              </tr>
            </thead>
            <tbody>
              {recs.slice(0, 6).map((r) => (
                <tr key={r.key}>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <Color id={r.subjectId} /> {subjName(r.subjectId)}
                    </span>
                  </td>
                  {SIGNALS.map((s) => (
                    <td key={s.k} className="r">
                      <span className="sig">
                        <i style={{ width: `${Math.round(r.signals[s.k] * 100)}%`, background: s.k === 'X' ? 'var(--danger)' : 'var(--text-2)' }} />
                      </span>
                    </td>
                  ))}
                  <td className="r">{r.score.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <span className="small faint">Váhy: {Object.entries(W).map(([k, v]) => `${k} ${v}`).join(' · ')}</span>
        </div>
      )}
    </div>
  );
}

/** Kompaktní doporučení na stránce časovače. */
export function NextUpInline() {
  const { data } = useStore();
  const timer = useTimer();
  const recs = useRecommendations().filter((r) => r.subjectId);
  const top = recs[0];
  if (!top || timer.state.status !== 'idle') return null;
  const s = data.subjects.find((x) => x.id === top.subjectId);
  return (
    <div className="nx-inline">
      <Compass size={14} />
      <span className="grow">
        <span className="label">doporučuji</span>{' '}
        <b style={{ color: s?.color }}>{s?.name}</b> · {top.title} · <span className="num">{top.minutes} min</span>
      </span>
      <button className="btn sm" onClick={() => timer.configure({ subjectId: top.subjectId!, topic: top.topic, modeId: top.modeId, planBlockId: top.planBlockId })}>
        Použít
      </button>
    </div>
  );
}
