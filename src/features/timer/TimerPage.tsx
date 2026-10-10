import { useEffect, useMemo, useRef, useState } from 'react';
import { BellOff, Check, Coffee, Maximize2, Minimize2, Pause, Play, SkipForward, Square } from 'lucide-react';
import { useStore } from '../../data/store';
import { NoiseType, alive } from '../../data/schema';
import { fmtClock, fmtHM, startOfDay } from '../../lib/time';
import { inRange, totalSec } from '../../lib/stats';
import { NOISE_LABEL, startNoise, stopNoise } from '../../lib/noise';
import { unlockAudio } from '../../lib/alerts';
import { Segmented } from '../../components/ui';
import { SubjectSelect } from '../subjects/SubjectSelect';
import { BREAK_TIPS, allModes } from './modes';
import { useTimer } from './TimerContext';
import { NextUpInline } from '../recommend/NextUp';
import './timer.css';

/** Oblouk kruhu (úhly ve stupních, 0° = vpravo, po směru hodin). */
function arcPath(cx: number, r: number, from: number, to: number) {
  const pt = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(2)} ${(cx + r * Math.sin(a)).toFixed(2)}`;
  };
  return `M${pt(from)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${pt(to)}`;
}

/** Kruh z dílků se stupnicí v minutách. Odpočet = délka fáze, stopky = jedna hodina. */
export function TimerRing({ size = 340 }: { size?: number }) {
  const { state, mode, elapsedMs, remainingMs, progress } = useTimer();
  const isBreak = state.phase !== 'work';
  const idle = state.status === 'idle';
  const countUp = idle ? mode.workMin == null : remainingMs == null;
  const p = idle ? 0 : countUp ? (elapsedMs % 3_600_000) / 3_600_000 : progress;
  const display = idle ? fmtClock((mode.workMin ?? 0) * 60_000) : countUp ? fmtClock(elapsedMs) : fmtClock(remainingMs ?? 0);
  const label = idle ? 'Připraveno' : state.phase === 'work' ? 'Učení' : state.phase === 'long' ? 'Dlouhá pauza' : 'Pauza';

  const phaseMs = idle ? (mode.workMin ?? 0) * 60_000 : (state.phaseDurationMs ?? elapsedMs + (remainingMs ?? 0));
  const totalMin = countUp ? 60 : Math.max(1, Math.round(phaseMs / 60_000));
  // Jeden dílek = minuta; u krátkých pauz půl minuty, u dlouhých bloků víc minut (max. ~60 dílků).
  const perSeg = totalMin < 10 ? 0.5 : totalMin > 60 ? Math.ceil(totalMin / 60) : 1;
  const n = Math.max(1, Math.round(totalMin / perSeg));
  const labelStep = totalMin <= 10 ? 1 : totalMin <= 30 ? 5 : totalMin <= 60 ? (countUp ? 15 : 10) : totalMin <= 120 ? 15 : 30;
  const done = p * n;

  const V = 200;
  const cx = V / 2;
  const r = 80;
  const step = 360 / n;
  const gap = Math.min(1.6, step * 0.22);
  const segs = Array.from({ length: n }, (_, i) => {
    const from = -90 + i * step + gap / 2;
    const to = -90 + (i + 1) * step - gap / 2;
    const cls = i < Math.floor(done) ? 'lit' : i === Math.floor(done) && done > 0 && done < n ? 'now' : '';
    return <path key={i} d={arcPath(cx, r, from, to)} className={`seg ${cls}`} />;
  });
  const labels: { m: number; x: number; y: number }[] = [];
  for (let m = 0; m < totalMin; m += labelStep) {
    const a = ((-90 + (m / totalMin) * 360) * Math.PI) / 180;
    labels.push({ m, x: cx + 94 * Math.cos(a), y: cx + 94 * Math.sin(a) + 2.6 });
  }

  return (
    <div className={`ring ${isBreak ? 'is-break' : ''} ${state.status}`} style={{ width: size }}>
      <svg viewBox={`0 0 ${V} ${V}`} aria-hidden="true">
        <g>{segs}</g>
        {labels.map((l) => (
          <text key={l.m} x={l.x} y={l.y} className="ring-label" textAnchor="middle">
            {l.m}
          </text>
        ))}
      </svg>
      <div className="ring-center">
        <span className="ring-phase">{label}</span>
        <div className="ring-time">{display}</div>
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
        <h2>Šum na soustředění</h2>
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
        <p className="small faint">Hraje automaticky jen během bloku učení. Hnědý je nejhlubší a nejméně rušivý.</p>
      </div>
    </div>
  );
}

export function TimerPage() {
  const { data, setSettings } = useStore();
  const t = useTimer();
  const { state } = t;
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
          </div>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <span className="label">Dnes</span>
            <span className="serif" style={{ fontSize: 24 }}>
              {fmtHM(todaySec)}
              {goal > 0 && <span className="faint" style={{ fontSize: 16 }}> ze {fmtHM(goal)}</span>}
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
          {state.status === 'idle' && <p className="faint small">{state.subjectId ? 'Mezerník spustí i pozastaví.' : 'Nejdřív vyber předmět.'}</p>}
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
            </div>

            <NoiseControl />
          </div>
        )}
      </div>
    </div>
  );
}
