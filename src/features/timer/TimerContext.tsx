import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../data/store';
import { Topic, uid } from '../../data/schema';
import { chime, notify, unlockAudio } from '../../lib/alerts';
import { fmtClock } from '../../lib/time';
import { BUILTIN_MODES, TimerMode, allModes } from './modes';
import { applyStudy, ctxFrom, extraTopicSnapshots, findTopic, newTopic, topicSnapshots } from '../topics/schedule';
import { matchPlanBlocks } from '../planner/match';

/**
 * Časovač je řízený časovými značkami (ne odpočítáváním po sekundách),
 * takže je přesný i v pozadí a přežije obnovení stránky.
 */

export type Phase = 'work' | 'short' | 'long';
export type Status = 'idle' | 'running' | 'paused' | 'ready';

export interface TimerState {
  status: Status;
  phase: Phase;
  modeId: string;
  subjectId: string;
  topic: string;
  planBlockId?: string;
  extraTopics?: string[]; // další témata bloku „Opakování: A, B, C“ (hlavní je `topic`)
  segmentStart: number | null;
  accumulated: number;
  phaseDurationMs: number | null;
  round: number;
  interruptions: number;
  workStartedAt: number | null;
  readyAt?: number | null; // od kdy časovač čeká na další blok / pauzu (kvůli automatickému ukončení série)
}

const STORAGE_KEY = 'st.timer';

function loadState(defaultMode: string): TimerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as TimerState;
  } catch {
    /* ignore */
  }
  return {
    status: 'idle',
    phase: 'work',
    modeId: defaultMode,
    subjectId: '',
    topic: '',
    segmentStart: null,
    accumulated: 0,
    phaseDurationMs: null,
    round: 0,
    interruptions: 0,
    workStartedAt: null,
  };
}

const workDurationMs = (m: TimerMode) => (m.workMin == null ? null : m.workMin * 60_000);

function elapsedOf(s: TimerState, now: number): number {
  return s.accumulated + (s.status === 'running' && s.segmentStart ? now - s.segmentStart : 0);
}

type ConfigPatch = Partial<Pick<TimerState, 'modeId' | 'subjectId' | 'topic' | 'planBlockId' | 'extraTopics'>>;

/** Nastavení časovače (předmět, téma, režim…) – sdílené pro ruční úpravu i spuštění z doporučení. */
function withConfig(p: TimerState, patch: ConfigPatch): TimerState {
  const next = { ...p, ...patch };
  if (patch.modeId && patch.modeId !== p.modeId && p.status === 'idle') next.round = 0;
  // Další témata patří jen k nastavení, se kterým přišla – ruční změna předmětu nebo tématu je zahodí.
  if (!('extraTopics' in patch) && (patch.subjectId !== undefined || patch.topic !== undefined)) next.extraTopics = undefined;
  return next;
}

/** Jde teď začít něco nového? Ano, když nic neběží – i mezi bloky („Další blok“), kdy je vše hotové už uložené. */
export function canSwitch(s: TimerState): boolean {
  return s.status === 'idle' || s.status === 'ready';
}

interface TimerValue {
  state: TimerState;
  mode: TimerMode;
  elapsedMs: number;
  remainingMs: number | null;
  progress: number; // 0–1 (u počítání nahoru 0)
  configure: (patch: ConfigPatch) => void;
  /** Připraví nový blok z doporučení nebo plánu; mezi bloky nejdřív ukončí dosavadní sérii. Běžící blok nepřeruší. */
  setup: (patch: ConfigPatch) => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  finishWork: () => boolean; // ukončí blok práce a přejde na pauzu; true = blok byl moc krátký a neuložil se
  stop: () => boolean; // uloží a ukončí úplně; true = blok byl moc krátký a neuložil se
  skip: () => void; // přeskočí pauzu
  discard: () => void; // zahodí aktuální blok bez uložení
  addInterruption: () => void;
  pendingRating: string | null;
  clearRating: () => void;
}

const TimerContext = createContext<TimerValue | null>(null);

export function useTimer(): TimerValue {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error('useTimer musí být uvnitř <TimerProvider>');
  return ctx;
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const { data, upsert, upsertMany } = useStore();
  const settings = data.settings;
  const [state, setState] = useState<TimerState>(() => loadState(settings.defaultMode));
  const [now, setNow] = useState(Date.now());
  const [pendingRating, setPendingRating] = useState<string | null>(null);

  const modes = useMemo(() => allModes(data.presets), [data.presets]);
  const mode = modes.find((m) => m.id === state.modeId) ?? BUILTIN_MODES[0];

  const ref = useRef({ state, mode, settings, data });
  ref.current = { state, mode, settings, data };

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  // Víc otevřených záložek ukazuje stejný časovač (pauza v jedné = pauza ve všech).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        setState(JSON.parse(e.newValue) as TimerState);
        setNow(Date.now());
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /** Uloží sezení. Vrací id nebo null, když bylo moc krátké. */
  const saveSession = useCallback(
    (s: TimerState, endAt: number, elapsed: number): string | null => {
      const { settings: st, data: d } = ref.current;
      if (!s.subjectId || elapsed / 1000 < st.minSessionSec) return null;
      // Id odvozené od začátku bloku: když blok dokončí víc záložek najednou, uloží se jen jednou.
      const id = s.workStartedAt ? `timer-${s.workStartedAt}` : uid();
      // Téma: najdi existující nebo založ nové a posuň jeho plán opakování.
      let topicId: string | undefined;
      const topicName = s.topic.trim();
      if (topicName) {
        const base = findTopic(d.topics, s.subjectId, topicName) ?? newTopic(s.subjectId, topicName);
        topicSnapshots.set(id, base);
        const next = applyStudy(base, endAt, 'ok', ctxFrom(d), { auto: true });
        upsert('topics', next);
        topicId = next.id;
      }
      // Blok s více tématy: zapíše opakování i ostatních (jen existujících) témat; v okně po bloku jde kterékoli vrátit.
      const extras: Topic[] = [];
      if (topicId && st.multiTopicReview !== false) {
        for (const name of s.extraTopics ?? []) {
          const t = findTopic(d.topics, s.subjectId, name);
          if (!t || t.id === topicId || t.mastered || extras.some((x) => x.id === t.id)) continue;
          extras.push(t);
          upsert('topics', applyStudy(t, endAt, 'ok', ctxFrom(d), { auto: true }));
        }
        if (extras.length) {
          extraTopicSnapshots.set(id, extras);
          setState((p) => ({ ...p, extraTopics: undefined })); // další blok stejného sezení už je nezapočítá znovu
        }
      }
      upsert('sessions', {
        id,
        subjectId: s.subjectId,
        topic: topicName,
        topicId,
        start: s.workStartedAt ?? endAt - elapsed,
        end: endAt,
        durationSec: Math.round(elapsed / 1000),
        mode: s.modeId,
        interruptions: s.interruptions,
        note: '',
      });
      // Odškrtni blok, ze kterého byl časovač spuštěn, i všechny naplánované bloky, se kterými se sezení časově kryje.
      const startAt = s.workStartedAt ?? endAt - elapsed;
      const linked = s.planBlockId ? d.planBlocks.filter((b) => b.id === s.planBlockId && !b.done) : [];
      const matched = matchPlanBlocks(d.planBlocks, s.subjectId, startAt, endAt).filter((b) => b.id !== s.planBlockId);
      if (linked.length || matched.length) upsertMany('planBlocks', [...linked, ...matched].map((b) => ({ ...b, done: true })));
      if (st.askFocusRating || st.askRecall || topicId) setPendingRating(id);
      return id;
    },
    [upsert, upsertMany],
  );

  /** Konec bloku práce → uložit a připravit pauzu. */
  const endWork = useCallback(
    (endAt: number, natural: boolean) => {
      const { state: s, mode: m, settings: st } = ref.current;
      const elapsed = Math.min(elapsedOf(s, endAt), s.phaseDurationMs ?? Infinity);
      saveSession(s, endAt, elapsed);
      if (natural) {
        if (st.sound) chime(st.volume, 'work-end');
        notify('Blok práce hotový', 'Dej si pauzu – zasloužíš si ji.');
      }
      if (m.kind === 'stopwatch') {
        setState((p) => ({ ...p, status: 'idle', phase: 'work', segmentStart: null, accumulated: 0, phaseDurationMs: null, interruptions: 0, workStartedAt: null, planBlockId: undefined, extraTopics: undefined }));
        return;
      }
      let phase: Phase = 'short';
      let breakMs: number;
      const round = s.round + 1;
      if (m.kind === 'flowtime') {
        breakMs = Math.max(60_000, Math.round(elapsed / st.flowtimeRatio / 60_000) * 60_000);
      } else if (round % m.roundsBeforeLong === 0) {
        phase = 'long';
        breakMs = m.longBreakMin * 60_000;
      } else {
        breakMs = m.shortBreakMin * 60_000;
      }
      setState((p) => ({
        ...p,
        phase,
        round,
        status: st.autoStartBreaks ? 'running' : 'ready',
        readyAt: st.autoStartBreaks ? null : endAt,
        segmentStart: st.autoStartBreaks ? endAt : null,
        accumulated: 0,
        phaseDurationMs: breakMs,
        interruptions: 0,
        workStartedAt: null,
        planBlockId: undefined,
      }));
    },
    [saveSession],
  );

  const endBreak = useCallback((endAt: number, natural: boolean) => {
    const { mode: m, settings: st } = ref.current;
    if (natural) {
      if (st.sound) chime(st.volume, 'break-end');
      notify('Pauza skončila', 'Jdeme na další blok.');
    }
    // Když pauza skončila dávno (zavřená stránka, uspaný počítač), další blok se sám nespustí –
    // jinak by se za dobu nepřítomnosti uložila vymyšlená sezení.
    const auto = st.autoStartWork && (!natural || Date.now() - endAt < 60_000);
    setState((p) => ({
      ...p,
      phase: 'work',
      status: auto ? 'running' : 'ready',
      readyAt: auto ? null : endAt,
      segmentStart: auto ? endAt : null,
      accumulated: 0,
      phaseDurationMs: workDurationMs(m),
      interruptions: 0,
      workStartedAt: auto ? endAt : null,
    }));
  }, []);

  // ---------- tik ----------
  useEffect(() => {
    if (state.status !== 'running') return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [state.status]);

  // Pojistka, aby se jedna fáze nikdy nedokončila (a neuložila) dvakrát.
  const completed = useRef<string | null>(null);
  useEffect(() => {
    const s = state;
    if (s.status !== 'running' || s.phaseDurationMs == null || !s.segmentStart) return;
    const elapsed = elapsedOf(s, now);
    if (elapsed >= s.phaseDurationMs) {
      const key = `${s.phase}:${s.segmentStart}:${s.accumulated}`;
      if (completed.current === key) return;
      completed.current = key;
      const endAt = s.segmentStart + (s.phaseDurationMs - s.accumulated);
      if (s.phase === 'work') endWork(endAt, true);
      else endBreak(endAt, true);
    }
  }, [now, state, endWork, endBreak]);

  const elapsedMs = elapsedOf(state, now);
  const remainingMs = state.phaseDurationMs == null ? null : Math.max(0, state.phaseDurationMs - elapsedMs);
  const progress = state.phaseDurationMs ? Math.min(1, elapsedMs / state.phaseDurationMs) : 0;

  // Titulek záložky ukazuje zbývající čas.
  useEffect(() => {
    if (state.status === 'idle') {
      document.title = 'Study Tracker';
      return;
    }
    const label = state.status === 'paused' ? 'pozastaveno' : state.phase === 'work' ? 'učení' : 'pauza';
    const t = remainingMs != null ? fmtClock(remainingMs) : fmtClock(elapsedMs);
    document.title = `${t} ${label} · Study Tracker`;
  }, [state.status, state.phase, remainingMs, elapsedMs]);

  // ---------- akce ----------
  const configure = useCallback<TimerValue['configure']>((patch) => setState((p) => withConfig(p, patch)), []);

  const start = useCallback(() => {
    unlockAudio();
    const t = Date.now();
    setNow(t);
    setState((p) => {
      if (p.status === 'ready') {
        return { ...p, status: 'running', readyAt: null, segmentStart: t, accumulated: 0, workStartedAt: p.phase === 'work' ? t : null };
      }
      return {
        ...p,
        status: 'running',
        phase: 'work',
        segmentStart: t,
        accumulated: 0,
        phaseDurationMs: workDurationMs(ref.current.mode),
        interruptions: 0,
        workStartedAt: t,
      };
    });
  }, []);

  const pause = useCallback(() => {
    const t = Date.now();
    setState((p) => (p.status === 'running' ? { ...p, status: 'paused', accumulated: elapsedOf(p, t), segmentStart: null } : p));
  }, []);

  const resume = useCallback(() => {
    unlockAudio();
    const t = Date.now();
    setNow(t);
    setState((p) => (p.status === 'paused' ? { ...p, status: 'running', segmentStart: t } : p));
  }, []);

  /** Uloží se blok? Kratší než nastavené minimum se zahodí – ovládání pak dá vědět. */
  const tooShort = (s: TimerState, t: number) => !!s.subjectId && Math.min(elapsedOf(s, t), s.phaseDurationMs ?? Infinity) / 1000 < ref.current.settings.minSessionSec;

  const finishWork = useCallback(() => {
    const s = ref.current.state;
    if (s.phase !== 'work' || s.status === 'idle' || s.status === 'ready') return false;
    const key = `${s.phase}:${s.segmentStart}:${s.accumulated}`;
    if (completed.current === key) return false;
    completed.current = key;
    const t = Date.now();
    const short = tooShort(s, t);
    endWork(t, false);
    return short;
  }, [endWork]);

  const reset = (p: TimerState): TimerState => ({
    ...p,
    status: 'idle',
    phase: 'work',
    segmentStart: null,
    accumulated: 0,
    phaseDurationMs: null,
    round: 0,
    interruptions: 0,
    workStartedAt: null,
    planBlockId: undefined,
    extraTopics: undefined,
    readyAt: null,
  });

  // Série, která čeká na další blok déle než nastavenou dobu, se ukončí sama – jinak by časovač
  // „mezi bloky“ zůstal viset třeba do druhého dne. Hotové bloky jsou už uložené, nic se neztratí.
  const seriesTimeoutMin = settings.seriesTimeoutMin ?? 20;
  useEffect(() => {
    if (state.status !== 'ready' || !seriesTimeoutMin) return;
    const since = state.readyAt ?? Date.now(); // stav uložený starší verzí čas nemá – počítá se od načtení
    const id = window.setTimeout(
      () => setState((p) => (p.status === 'ready' ? reset(p) : p)),
      Math.max(0, since + seriesTimeoutMin * 60_000 - Date.now()),
    );
    return () => window.clearTimeout(id);
  }, [state.status, state.readyAt, seriesTimeoutMin]); // eslint-disable-line react-hooks/exhaustive-deps

  const setup = useCallback<TimerValue['setup']>((patch) => {
    setState((p) => (canSwitch(p) ? withConfig(p.status === 'ready' ? reset(p) : p, patch) : p));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => {
    const s = ref.current.state;
    const t = Date.now();
    let short = false;
    if (s.phase === 'work' && (s.status === 'running' || s.status === 'paused')) {
      short = tooShort(s, t);
      saveSession(s, t, Math.min(elapsedOf(s, t), s.phaseDurationMs ?? Infinity));
    }
    setState(reset);
    return short;
  }, [saveSession]);

  const discard = useCallback(() => setState(reset), []);

  const skip = useCallback(() => {
    if (ref.current.state.phase !== 'work') endBreak(Date.now(), false);
  }, [endBreak]);

  const addInterruption = useCallback(() => setState((p) => ({ ...p, interruptions: p.interruptions + 1 })), []);
  const clearRating = useCallback(() => setPendingRating(null), []);

  const value: TimerValue = {
    state,
    mode,
    elapsedMs,
    remainingMs,
    progress,
    configure,
    setup,
    start,
    pause,
    resume,
    finishWork,
    stop,
    skip,
    discard,
    addInterruption,
    pendingRating,
    clearRating,
  };

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}
