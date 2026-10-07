import { useEffect, useMemo, useState } from 'react';
import { Coffee, Maximize2, Minimize2, Pause, Play, SkipForward, Square, Zap, BellOff, Check, Info } from 'lucide-react';
import { useStore } from '../../data/store';
import { alive } from '../../data/schema';
import { fmtClock, fmtDuration, startOfDay } from '../../lib/time';
import { inRange, totalSec } from '../../lib/stats';
import { SubjectSelect } from '../subjects/SubjectSelect';
import { BREAK_TIPS, Evidence, allModes } from './modes';
import { useTimer } from './TimerContext';
import './timer.css';

const EVIDENCE_CHIP: Record<Evidence, string> = {
  silné: 'ok',
  střední: 'accent',
  slabé: 'warn',
  nástroj: '',
};

export function TimerRing({ size = 320 }: { size?: number }) {
  const { state, mode, elapsedMs, remainingMs, progress } = useTimer();
  const isBreak = state.phase !== 'work';
  const r = (size - 24) / 2;
  const c = 2 * Math.PI * r;
  const idle = state.status === 'idle';
  const countUp = idle ? mode.workMin == null : remainingMs == null;
  const p = idle ? 0 : countUp ? (elapsedMs % 3_600_000) / 3_600_000 : progress;
  const display = idle ? fmtClock((mode.workMin ?? 0) * 60_000) : countUp ? fmtClock(elapsedMs) : fmtClock(remainingMs ?? 0);
  const label =
    state.status === 'idle'
      ? 'Připraveno'
      : state.phase === 'work'
        ? 'Učení'
        : state.phase === 'long'
          ? 'Dlouhá pauza'
          : 'Pauza';

  return (
    <div className={`ring ${isBreak ? 'is-break' : ''} ${state.status}`} style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={isBreak ? 'var(--break)' : 'var(--accent)'} />
            <stop offset="100%" stopColor={isBreak ? '#86efac' : '#c084fc'} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="ring-progress"
          stroke="url(#ringGrad)"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-center">
        <span className={`chip ${isBreak ? 'break' : 'accent'}`}>{label}</span>
        <div className="ring-time num">{display}</div>
        <div className="ring-sub">
          {mode.name}
          {mode.kind === 'interval' && mode.roundsBeforeLong < 99 && (
            <span className="rounds">
              {Array.from({ length: mode.roundsBeforeLong }, (_, i) => (
                <i key={i} className={i < (state.phase === 'long' ? mode.roundsBeforeLong : state.round % mode.roundsBeforeLong) ? 'on' : ''} />
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function TimerControls({ compact }: { compact?: boolean }) {
  const t = useTimer();
  const { state, mode } = t;
  const isWork = state.phase === 'work';
  const canStart = !!state.subjectId;
  const sz = compact ? '' : 'lg';

  if (state.status === 'idle') {
    return (
      <div className="controls">
        <button className={`btn primary ${sz} round`} onClick={t.start} disabled={!canStart}>
          <Play size={18} fill="currentColor" /> Začít učení
        </button>
      </div>
    );
  }
  if (state.status === 'ready') {
    return (
      <div className="controls">
        <button className={`btn ${isWork ? 'primary' : 'break'} ${sz} round`} onClick={t.start}>
          {isWork ? <Play size={18} fill="currentColor" /> : <Coffee size={18} />}
          {isWork ? 'Další blok' : 'Začít pauzu'}
        </button>
        {!isWork && (
          <button className={`btn ${sz} round`} onClick={t.skip}>
            <SkipForward size={17} /> Bez pauzy
          </button>
        )}
        <button className={`btn ghost ${sz} round`} onClick={t.discard}>
          Ukončit
        </button>
      </div>
    );
  }
  return (
    <div className="controls">
      {state.status === 'running' ? (
        <button className={`btn ${sz} round`} onClick={t.pause}>
          <Pause size={18} fill="currentColor" /> Pauza
        </button>
      ) : (
        <button className={`btn ${isWork ? 'primary' : 'break'} ${sz} round`} onClick={t.resume}>
          <Play size={18} fill="currentColor" /> Pokračovat
        </button>
      )}
      {isWork && mode.kind !== 'stopwatch' && (
        <button className={`btn ${sz} round`} onClick={t.finishWork} title="Uložit blok a jít na pauzu">
          <Coffee size={17} /> {mode.kind === 'flowtime' ? 'Na pauzu' : 'Hotovo'}
        </button>
      )}
      {isWork ? (
        <button className={`btn ghost ${sz} round`} onClick={t.stop} title="Uložit a ukončit">
          <Square size={15} fill="currentColor" /> Ukončit
        </button>
      ) : (
        <button className={`btn ghost ${sz} round`} onClick={t.skip}>
          <SkipForward size={17} /> Přeskočit
        </button>
      )}
    </div>
  );
}

export function TimerPage() {
  const { data, setSettings } = useStore();
  const t = useTimer();
  const { state, mode } = t;
  const modes = useMemo(() => allModes(data.presets), [data.presets]);
  const [zen, setZen] = useState(false);
  const [tip] = useState(() => Math.floor(Math.random() * BREAK_TIPS.length));
  const locked = state.status !== 'idle';
  const sessions = alive(data.sessions);
  const todaySec = totalSec(inRange(sessions, startOfDay(Date.now()), Date.now() + 1));
  const subject = data.subjects.find((s) => s.id === state.subjectId);

  // Mezerník = start / pauza
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code !== 'Space' || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) return;
      e.preventDefault();
      if (state.status === 'running') t.pause();
      else if (state.status === 'paused') t.resume();
      else if (state.subjectId) t.start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.status, state.subjectId, t]);

  const goal = data.settings.dailyGoalMin * 60;

  return (
    <div className={zen ? 'zen' : ''}>
      {!zen && (
        <div className="page-head">
          <div>
            <h1>Časovač</h1>
            <p>Vyber předmět a režim, pak se pusť do práce. Mezerník spustí nebo pozastaví.</p>
          </div>
          <div className="chip accent num">
            Dnes {fmtDuration(todaySec)}
            {goal > 0 && ` / ${fmtDuration(goal)}`}
          </div>
        </div>
      )}

      <div className="timer-layout">
        <div className="card timer-card">
          <button className="btn ghost icon sm zen-toggle" onClick={() => setZen(!zen)} title={zen ? 'Ukončit zen režim' : 'Zen režim'}>
            {zen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <TimerRing size={zen ? 380 : 320} />

          {subject && state.status !== 'idle' && (
            <div className="now-studying">
              <span className="dot" style={{ background: subject.color }} />
              <b>{subject.name}</b>
              {state.topic && <span className="muted">· {state.topic}</span>}
            </div>
          )}

          <TimerControls />

          {state.phase === 'work' && state.status !== 'idle' && state.status !== 'ready' && (
            <button className="btn ghost sm" onClick={t.addInterruption} title="Zaznamenej, když tě něco vyruší">
              <BellOff size={14} /> Vyrušení{state.interruptions > 0 && `: ${state.interruptions}`}
            </button>
          )}

          {state.phase !== 'work' && (
            <div className="break-tip">
              <Coffee size={16} />
              <span>{BREAK_TIPS[(tip + state.round) % BREAK_TIPS.length]}</span>
            </div>
          )}
          {state.status === 'idle' && !state.subjectId && <p className="faint small">Nejdřív vyber předmět vpravo.</p>}
        </div>

        {!zen && (
          <div className="stack">
            <div className="card stack">
              <h2>Co se učíš</h2>
              <SubjectSelect value={state.subjectId} onChange={(id) => t.configure({ subjectId: id })} disabled={locked && state.phase === 'work' && state.status !== 'ready'} />
              <input
                className="input"
                placeholder="Téma (např. derivace, kapitola 4…)"
                value={state.topic}
                onChange={(e) => t.configure({ topic: e.target.value })}
              />
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Režim</h2>
                {locked && <span className="sub">Změníš po ukončení</span>}
              </div>
              <div className="modes">
                {modes.map((m) => (
                  <button
                    key={m.id}
                    className={`mode ${m.id === state.modeId ? 'on' : ''}`}
                    disabled={locked}
                    onClick={() => {
                      t.configure({ modeId: m.id });
                    }}
                  >
                    <div className="row between">
                      <b>{m.name}</b>
                      {m.id === state.modeId && <Check size={15} className="mode-check" />}
                    </div>
                    <span className="small muted">{m.tagline}</span>
                  </button>
                ))}
              </div>
              <div className="mode-info">
                <div className="row between">
                  <b className="row" style={{ gap: 6 }}>
                    <Info size={15} /> {mode.name}
                  </b>
                  <span className={`chip ${EVIDENCE_CHIP[mode.evidence]}`}>
                    {mode.evidence === 'nástroj' ? 'nástroj' : `důkazy: ${mode.evidence}`}
                  </span>
                </div>
                <p className="small muted">{mode.description}</p>
              </div>
              {!locked && data.settings.defaultMode !== state.modeId && (
                <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setSettings({ defaultMode: state.modeId })}>
                  <Zap size={14} /> Nastavit jako výchozí
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
