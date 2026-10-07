import { useEffect, useMemo, useRef, useState } from 'react';
import { BellOff, Check, Coffee, Headphones, Maximize2, Minimize2, Pause, Play, SkipForward, Square } from 'lucide-react';
import { useStore } from '../../data/store';
import { NoiseType, alive } from '../../data/schema';
import { fmtClock, fmtDuration, startOfDay } from '../../lib/time';
import { inRange, totalSec } from '../../lib/stats';
import { NOISE_LABEL, startNoise, stopNoise } from '../../lib/noise';
import { unlockAudio } from '../../lib/alerts';
import { Segmented } from '../../components/ui';
import { SubjectSelect } from '../subjects/SubjectSelect';
import { BREAK_TIPS, Evidence, allModes } from './modes';
import { useTimer } from './TimerContext';
import { NextUpInline } from '../recommend/NextUp';
import './timer.css';

const EVIDENCE_CHIP: Record<Evidence, string> = {
  silné: 'ok',
  střední: 'accent',
  slabé: 'warn',
  nástroj: '',
};

/** Ciferník s ryskami po minutách – jako stopky. */
export function TimerRing({ size = 340 }: { size?: number }) {
  const { state, mode, elapsedMs, remainingMs, progress } = useTimer();
  const isBreak = state.phase !== 'work';
  const idle = state.status === 'idle';
  const countUp = idle ? mode.workMin == null : remainingMs == null;
  const p = idle ? 0 : countUp ? (elapsedMs % 3_600_000) / 3_600_000 : progress;
  const display = idle ? fmtClock((mode.workMin ?? 0) * 60_000) : countUp ? fmtClock(elapsedMs) : fmtClock(remainingMs ?? 0);
  const label = idle ? 'připraveno' : state.phase === 'work' ? 'učení' : state.phase === 'long' ? 'dlouhá pauza' : 'pauza';

  const V = 200; // viewBox
  const cx = V / 2;
  const rTicks = 96;
  const rArc = 84;
  const circ = 2 * Math.PI * rArc;
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const major = i % 5 === 0;
    const r1 = rTicks - (major ? 7 : 3.5);
    const lit = i / 60 < p;
    return (
      <line
        key={i}
        x1={cx + Math.cos(a) * r1}
        y1={cx + Math.sin(a) * r1}
        x2={cx + Math.cos(a) * rTicks}
        y2={cx + Math.sin(a) * rTicks}
        className={`tick ${major ? 'major' : ''} ${lit ? 'lit' : ''}`}
      />
    );
  });

  return (
    <div className={`ring ${isBreak ? 'is-break' : ''} ${state.status}`} style={{ width: size }}>
      <svg viewBox={`0 0 ${V} ${V}`}>
        <g>{ticks}</g>
        <circle cx={cx} cy={cx} r={rArc} className="ring-track" />
        <circle
          cx={cx}
          cy={cx}
          r={rArc}
          className="ring-progress"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - p)}
          transform={`rotate(-90 ${cx} ${cx})`}
        />
      </svg>
      <div className="ring-center">
        <span className="ring-phase label">{label}</span>
        <div className="ring-time num">{display}</div>
        <div className="ring-sub">
          <span className="label">{mode.name}</span>
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
        <button className={`btn primary ${sz}`} onClick={t.start} disabled={!canStart}>
          <Play size={16} fill="currentColor" /> Začít učení
        </button>
      </div>
    );
  }
  if (state.status === 'ready') {
    return (
      <div className="controls">
        <button className={`btn ${isWork ? 'primary' : 'break'} ${sz}`} onClick={t.start}>
          {isWork ? <Play size={16} fill="currentColor" /> : <Coffee size={16} />}
          {isWork ? 'Další blok' : 'Začít pauzu'}
        </button>
        {!isWork && (
          <button className={`btn ${sz}`} onClick={t.skip}>
            <SkipForward size={15} /> Bez pauzy
          </button>
        )}
        <button className={`btn ghost ${sz}`} onClick={t.discard}>
          Ukončit
        </button>
      </div>
    );
  }
  return (
    <div className="controls">
      {state.status === 'running' ? (
        <button className={`btn ${sz}`} onClick={t.pause}>
          <Pause size={16} fill="currentColor" /> Pozastavit
        </button>
      ) : (
        <button className={`btn ${isWork ? 'primary' : 'break'} ${sz}`} onClick={t.resume}>
          <Play size={16} fill="currentColor" /> Pokračovat
        </button>
      )}
      {isWork && mode.kind !== 'stopwatch' && (
        <button className={`btn ${sz}`} onClick={t.finishWork} title="Uložit blok a jít na pauzu">
          <Coffee size={15} /> {mode.kind === 'flowtime' ? 'Na pauzu' : 'Hotovo'}
        </button>
      )}
      {isWork ? (
        <button className={`btn ghost ${sz}`} onClick={t.stop} title="Uložit a ukončit">
          <Square size={13} fill="currentColor" /> Ukončit
        </button>
      ) : (
        <button className={`btn ghost ${sz}`} onClick={t.skip}>
          <SkipForward size={15} /> Přeskočit
        </button>
      )}
    </div>
  );
}

function NoiseControl() {
  const { data, setSettings } = useStore();
  const { state } = useTimer();
  const { noiseType, noiseVolume } = data.settings;
  const [preview, setPreview] = useState(false);
  const previewTimer = useRef<number | undefined>(undefined);
  const active = state.status === 'running' && state.phase === 'work';

  const tryIt = () => {
    if (noiseType === 'off') return;
    unlockAudio();
    startNoise(noiseType, noiseVolume);
    setPreview(true);
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      setPreview(false);
      stopNoise();
    }, 5000);
  };
  useEffect(() => () => window.clearTimeout(previewTimer.current), []);

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="row" style={{ gap: 8 }}>
          <Headphones size={15} /> Šum na soustředění
        </h2>
        <span className="chip warn">důkazy: smíšené</span>
      </div>
      <div className="stack">
        <Segmented<NoiseType>
          value={noiseType}
          onChange={(v) => setSettings({ noiseType: v })}
          options={(['off', 'brown', 'pink', 'white'] as NoiseType[]).map((v) => ({ value: v, label: NOISE_LABEL[v] }))}
        />
        {noiseType !== 'off' && (
          <div className="row">
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={noiseVolume}
              onChange={(e) => setSettings({ noiseVolume: Number(e.target.value) })}
              className="grow"
            />
            {!active && (
              <button className="btn sm" onClick={tryIt} disabled={preview}>
                {preview ? 'Hraje…' : 'Vyzkoušet'}
              </button>
            )}
          </div>
        )}
        <p className="small faint">
          Hraje automaticky jen během bloku učení. Některým lidem (hlavně s ADHD) šum pomáhá udržet pozornost, jiným spíš vadí.
          Hnědý je nejhlubší a nejméně rušivý.
        </p>
      </div>
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
  const subjectTopics = data.topics.filter((x) => !x.deletedAt && !x.mastered && x.subjectId === state.subjectId);

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
            <p>Vyber předmět a režim. Mezerník spustí nebo pozastaví.</p>
          </div>
          <div className="row">
            <span className="label">dnes</span>
            <span className="num" style={{ fontSize: 15 }}>
              {fmtDuration(todaySec, { short: true })}
              {goal > 0 && <span className="faint"> / {fmtDuration(goal, { short: true })}</span>}
            </span>
          </div>
        </div>
      )}

      <div className="g12" style={{ alignItems: 'start' }}>
        <div className={`card timer-card ${zen ? 'c-12' : 'c-7 xl-8'}`}>
          <button className="btn ghost icon sm zen-toggle" onClick={() => setZen(!zen)} title={zen ? 'Ukončit zen režim' : 'Zen režim'}>
            {zen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <TimerRing size={zen ? 440 : 360} />

          {subject && state.status !== 'idle' && (
            <div className="now-studying">
              <span className="dot" style={{ background: subject.color }} />
              <span>{subject.name}</span>
              {state.topic && <span className="faint">/ {state.topic}</span>}
            </div>
          )}

          <TimerControls />

          {state.phase === 'work' && state.status !== 'idle' && state.status !== 'ready' && (
            <button className="btn ghost sm" onClick={t.addInterruption} title="Zaznamenej, když tě něco vyruší">
              <BellOff size={13} /> Vyrušení <span className="num">{state.interruptions}</span>
            </button>
          )}

          {state.phase !== 'work' && (
            <div className="break-tip">
              <Coffee size={15} />
              <span>{BREAK_TIPS[(tip + state.round) % BREAK_TIPS.length]}</span>
            </div>
          )}
          {state.status === 'idle' && !state.subjectId && <p className="faint small">Nejdřív vyber předmět.</p>}
        </div>

        {!zen && (
          <div className="stack loose c-5 xl-4">
            <NextUpInline />
            <div className="card">
              <div className="card-head">
                <h2>Co se učíš</h2>
              </div>
              <div className="stack">
                <SubjectSelect
                  value={state.subjectId}
                  onChange={(id) => t.configure({ subjectId: id })}
                  disabled={locked && state.phase === 'work' && state.status !== 'ready'}
                />
                <input
                  className="input"
                  list="topic-suggestions"
                  placeholder="Téma (např. derivace, kapitola 4…)"
                  value={state.topic}
                  onChange={(e) => t.configure({ topic: e.target.value })}
                />
                <datalist id="topic-suggestions">
                  {subjectTopics.map((x) => (
                    <option key={x.id} value={x.name} />
                  ))}
                </datalist>
                <span className="small faint">Téma se uloží do Opakování a aplikace ti ho připomene ve správný čas.</span>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Režim</h2>
                {locked ? (
                  <span className="sub">změníš po ukončení</span>
                ) : (
                  data.settings.defaultMode !== state.modeId && (
                    <button className="btn ghost sm" onClick={() => setSettings({ defaultMode: state.modeId })}>
                      Nastavit jako výchozí
                    </button>
                  )
                )}
              </div>
              <div className="modes">
                {modes.map((m) => (
                  <button key={m.id} className={`mode ${m.id === state.modeId ? 'on' : ''}`} disabled={locked} onClick={() => t.configure({ modeId: m.id })}>
                    <div className="row between">
                      <span className="mode-name">{m.name}</span>
                      {m.id === state.modeId && <Check size={14} className="mode-check" />}
                    </div>
                    <span className="mode-tag num">{m.tagline}</span>
                  </button>
                ))}
              </div>
              <div className="mode-info">
                <div className="row between">
                  <span className="label">o metodě</span>
                  <span className={`chip ${EVIDENCE_CHIP[mode.evidence]}`}>
                    {mode.evidence === 'nástroj' ? 'nástroj' : `důkazy: ${mode.evidence}`}
                  </span>
                </div>
                <p className="small muted">{mode.description}</p>
              </div>
            </div>

            <NoiseControl />
          </div>
        )}
      </div>
    </div>
  );
}
