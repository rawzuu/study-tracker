import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, BookOpen, CalendarDays, Check, FileText, GraduationCap, NotebookPen, Play, Sunrise, Target, X } from 'lucide-react';
import { useStore } from '../../data/store';
import { loadGithubConfig, tokenDaysLeft } from '../../data/github';
import { alive } from '../../data/schema';
import { Empty } from '../../components/ui';
import { Chart, chartColors, useTheme } from '../../components/Chart';
import { DAY, addDays, dayKey, fmtClock, fmtDuration, fmtHM, fmtTime, isoWeek, parseDayKey, plural, startOfDay, startOfWeek, WEEKDAYS_SHORT } from '../../lib/time';
import { avgFocus, byDay, bySubject, inRange, streaks, totalSec } from '../../lib/stats';
import { navigate } from '../../lib/router';
import { calendarHeatmap } from '../stats/charts';
import { SubjectTag } from '../subjects/SubjectSelect';
import { useTimer } from '../timer/TimerContext';
import { TimerControls } from '../timer/TimerPage';
import { isDue, overdueDays } from '../topics/schedule';
import { StageMeter } from '../topics/TopicsPage';
import { lastWeekKey, reflectionDue } from '../reflection/ReflectionPage';
import { modeName } from '../timer/modes';
import { AnkiPanel } from '../anki/AnkiPanel';
import { NextUp } from '../recommend/NextUp';
import { DayPlanModal } from '../dayplan/DayPlanModal';
import { pendingSuggestions } from '../../lib/calibrate';
import './dashboard.css';

/** Dnešní datum jako nadpis přehledu („Sobota 10. října“). */
function todayTitle() {
  const s = new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const fmtExamDay = (key: string) => parseDayKey(key).toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' });

/** Oblouk měřidla (úhly ve stupních, 0° = vpravo, po směru hodin). */
function gaugeArc(c: number, r: number, from: number, to: number) {
  const pt = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(c + r * Math.cos(a)).toFixed(1)} ${(c + r * Math.sin(a)).toFixed(1)}`;
  };
  return `M${pt(from)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${pt(to)}`;
}

/**
 * Měřidlo dneška: tři tenké oblouky (270°, otevřené dole) se stupnicí po čtvrtinách
 * a popisky přímo u začátků oblouků.
 */
function DayGauge({ rings, center, sub }: { rings: { label: string; value: number; color: string }[]; center: string; sub: string }) {
  const C = 115;
  const radii = [100, 84, 68];
  const ticks = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const a = ((135 + 270 * f) * Math.PI) / 180;
      return `M${(C + 107 * Math.cos(a)).toFixed(1)} ${(C + 107 * Math.sin(a)).toFixed(1)}L${(C + 113 * Math.cos(a)).toFixed(1)} ${(C + 113 * Math.sin(a)).toFixed(1)}`;
    })
    .join('');
  return (
    <div className="gauge">
      <svg viewBox="0 0 230 230" role="img" aria-label={rings.map((r) => `${r.label} ${Math.round(Math.min(1, r.value) * 100)} %`).join(', ')}>
        <path d={ticks} className="gauge-tick" />
        {rings.map((r, i) => {
          const rad = radii[i];
          const f = Math.min(1, Math.max(0, r.value));
          const a = (135 * Math.PI) / 180;
          return (
            <g key={r.label}>
              <path d={gaugeArc(C, rad, 135, 405)} className="gauge-track" />
              {f > 0.004 && <path d={gaugeArc(C, rad, 135, 135 + 270 * f)} className="gauge-arc" style={{ stroke: r.color }} />}
              <text x={C + rad * Math.cos(a) + 9} y={C + rad * Math.sin(a) + 4} className="gauge-label">
                {r.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="gauge-center">
        <span className="serif gauge-value">{center}</span>
        <span className="gauge-sub">{sub}</span>
      </div>
    </div>
  );
}

/** Časovač na přehledu – jen čas, stav a ovládání; celý ciferník je na stránce Časovač. */
function DashTimer() {
  const { data } = useStore();
  const timer = useTimer();
  const { state, mode, remainingMs, elapsedMs } = timer;
  const idle = state.status === 'idle';
  const subject = data.subjects.find((s) => s.id === state.subjectId);
  const display = idle ? fmtClock((mode.workMin ?? 0) * 60_000) : fmtClock(remainingMs ?? elapsedMs);
  const status = idle
    ? 'Časovač připravený'
    : state.status === 'paused'
      ? 'Pozastaveno'
      : state.status === 'ready'
        ? state.phase === 'work'
          ? 'Připraveno na další blok'
          : 'Připravená pauza'
        : state.phase === 'work'
          ? 'Učení'
          : 'Pauza';
  return (
    <section className={`card dash-timer ${state.status} ${state.phase !== 'work' ? 'is-break' : ''}`} aria-label="Časovač">
      <div className="card-head">
        <h2>Časovač</h2>
        <a href="#/casovac">Otevřít</a>
      </div>
      <div className="dash-timer-body">
        <span className="serif dash-timer-time">{display}</span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div>{status}</div>
          <div className="small faint ellipsis">
            {mode.name}
            {subject ? ` · ${subject.name}` : ''}
          </div>
        </div>
      </div>
      {idle && !state.subjectId ? (
        <button className="btn" onClick={() => navigate('casovac')}>
          Vybrat předmět
        </button>
      ) : (
        <TimerControls compact />
      )}
    </section>
  );
}

const MONTHS_GEN = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];

function useDismiss(key: string): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  return [
    dismissed,
    () => {
      try {
        localStorage.setItem(key, '1');
      } catch {
        /* ignore */
      }
      setDismissed(true);
    },
  ];
}

export function Dashboard() {
  const { data } = useStore();
  const theme = useTheme();
  const timer = useTimer();
  const sessions = useMemo(() => alive(data.sessions), [data.sessions]);
  const subjects = alive(data.subjects).filter((s) => !s.archived);
  const now = Date.now();
  const today = startOfDay(now);
  const week = startOfWeek(now);

  const todaySec = totalSec(inRange(sessions, today, now + 1));
  const weekSessions = inRange(sessions, week, now + 1);
  const weekSec = totalSec(weekSessions);
  // Minulý týden do stejného okamžiku – férové srovnání.
  const lastWeekSec = totalSec(inRange(sessions, addDays(week, -7), now - 7 * DAY));
  const delta = lastWeekSec ? (weekSec - lastWeekSec) / lastWeekSec : null;
  const { current, best } = streaks(sessions, { restDays: data.settings.streakRestDays, minMin: data.settings.streakMinMin }, now);
  const focus7 = avgFocus(inRange(sessions, addDays(today, -6), now + 1));
  const goal = data.settings.dailyGoalMin * 60;

  const dueTopics = data.topics.filter((t) => isDue(t, addDays(today, 1))).sort((a, b) => (a.nextReviewAt ?? 0) - (b.nextReviewAt ?? 0));

  const charts = useMemo(() => {
    const c = chartColors();
    return { heat: calendarHeatmap(c, byDay(sessions), 26 * 7, true) };
  }, [sessions, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const weekBySubject = bySubject(weekSessions);
  // Týdenní plán = součet týdenních cílů předmětů.
  const weekGoal = subjects.reduce((a, s) => a + s.weeklyGoalMin * 60, 0);
  const weekDays = WEEKDAYS_SHORT.map((label, i) => {
    const from = addDays(week, i);
    return { label, sec: totalSec(inRange(sessions, from, addDays(week, i + 1))), today: from === today };
  });
  const weekDayMax = Math.max(1, ...weekDays.map((d) => d.sec));
  // Předměty s cílem (v pořadí z Předmětů), pak ostatní, na kterých se tento týden pracovalo.
  const weekRows = subjects
    .filter((s) => s.weeklyGoalMin > 0 || (weekBySubject.get(s.id) ?? 0) > 0)
    .map((s) => ({ id: s.id, name: s.name, color: s.color, sec: weekBySubject.get(s.id) ?? 0, goal: s.weeklyGoalMin * 60 }))
    .sort((a, b) => Number(b.goal > 0) - Number(a.goal > 0));

  const todayBlocks = alive(data.planBlocks)
    .filter((b) => startOfDay(b.start) === today)
    .sort((a, b) => a.start - b.start);

  const exams = alive(data.exams)
    .filter((e) => parseDayKey(e.date).getTime() >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  const recent = [...sessions].sort((a, b) => b.end - a.end).slice(0, 8);

  // Bannery: reflexe a měsíční report
  const lastWeekCount = inRange(sessions, addDays(week, -7), week).length;
  const [reflDismissed, dismissRefl] = useDismiss(`st.dismiss.refl.${lastWeekKey()}`);
  const reflectionHidden = (data.settings.hiddenPages ?? []).includes('reflexe');
  const showReflection = !reflectionHidden && data.settings.weeklyReflection && !reflDismissed && reflectionDue(data.reflections, lastWeekCount);
  const prevMonth = new Date(new Date(now).getFullYear(), new Date(now).getMonth() - 1, 1);
  const prevMonthCount = inRange(sessions, prevMonth.getTime(), new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 1).getTime()).length;
  const [reportDismissed, dismissReport] = useDismiss(`st.dismiss.report.${prevMonth.getFullYear()}-${prevMonth.getMonth()}`);
  const showReport = new Date(now).getDate() <= 7 && prevMonthCount > 0 && !reportDismissed;
  const reportSuggestions = useMemo(
    () => (showReport ? pendingSuggestions(data, prevMonth.getFullYear(), prevMonth.getMonth()).length : 0),
    [showReport, data], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const thisWeekReflection = reflectionHidden ? undefined : data.reflections.find((r) => !r.deletedAt && r.weekStart === lastWeekKey() && r.focusNext);

  const [planOpen, setPlanOpen] = useState(false);
  const [morningDismissed, dismissMorning] = useDismiss(`st.dismiss.morning.${dayKey(now)}`);
  const showMorning = data.settings.morningPrompt !== false && !morningDismissed && new Date(now).getHours() >= 5 && new Date(now).getHours() < 13 && todayBlocks.length === 0 && alive(data.subjects).length > 0;
  // Záloha na GitHub: upozornit jen na skutečný problém (neplatný/prošlý token, chybí přístup), ne na výpadek internetu
  const { sync } = useStore();
  const tokenDays = tokenDaysLeft(loadGithubConfig(), now);
  const [syncDismissed, dismissSync] = useDismiss(`st.dismiss.sync.${dayKey(now)}`);
  const syncBroken = sync.status === 'error' && (sync.code === 401 || sync.code === 403 || sync.code === 404);
  const showSync = data.settings.tokenWarning !== false && !syncDismissed && (syncBroken || (sync.status !== 'off' && tokenDays != null && tokenDays <= 7));
  const showAnki = data.settings.anki.enabled || data.anki.some((a) => a.id === 'snapshot' && !a.deletedAt);

  const startTopic = (subjectId: string, topic: string, planBlockId?: string) => {
    timer.configure({ subjectId, topic, planBlockId });
    navigate('casovac');
  };

  return (
    <div className="stack loose dash">
      <div className="page-head">
        <div>
          <h1>{todayTitle()}</h1>
          <p>
            Týden {isoWeek(now)}
            {thisWeekReflection && <> · záměr: {thisWeekReflection.focusNext}</>}
          </p>
        </div>
        {timer.state.status === 'idle' && (
          <button className="btn" onClick={() => navigate('casovac')}>
            Začít učení
          </button>
        )}
      </div>

      {(showReflection || showReport || showMorning || showSync) && (
        <div className="stack tight">
          {showSync && (
            <div className="banner">
              <AlertTriangle size={16} />
              <span className="grow">
                {syncBroken
                  ? `Záloha na GitHub teď nefunguje: ${sync.status === 'error' ? sync.message : ''} Data jsou zatím jen v tomto prohlížeči.`
                  : tokenDays! <= 0
                    ? 'Token pro zálohu na GitHub vypršel – vytvoř nový, ať se záloha nezastaví.'
                    : `Token pro zálohu na GitHub vyprší za ${tokenDays} ${plural(tokenDays!, 'den', 'dny', 'dní')} – vytvoř nový, ať se záloha nezastaví.`}
              </span>
              <a className="btn sm" href="#/nastaveni">
                Nastavení <ArrowRight size={13} />
              </a>
              <button className="btn ghost icon sm" onClick={dismissSync} aria-label="Skrýt">
                <X size={14} />
              </button>
            </div>
          )}
          {showMorning && (
            <div className="banner">
              <Sunrise size={16} />
              <span className="grow">Dobré ráno – naplánuj si dnešek. Navrhnu bloky podle zkoušek, opakování a cílů, ty jen potvrdíš.</span>
              <button className="btn sm" onClick={() => setPlanOpen(true)}>
                Naplánovat den
              </button>
              <button className="btn ghost icon sm" onClick={dismissMorning} aria-label="Skrýt">
                <X size={14} />
              </button>
            </div>
          )}
          {showReport && (
            <div className="banner">
              <FileText size={16} />
              <span className="grow">
                Report za <b>{MONTHS_GEN[prevMonth.getMonth()]}</b> je připravený – co, kdy a jak dlouho.
                {reportSuggestions > 0 && (
                  <span className="muted">
                    {' '}
                    Obsahuje {reportSuggestions} {plural(reportSuggestions, 'návrh', 'návrhy', 'návrhů')} na úpravu cílů.
                  </span>
                )}
              </span>
              <a className="btn sm" href="#/report">
                Otevřít <ArrowRight size={13} />
              </a>
              <button className="btn ghost icon sm" onClick={dismissReport} aria-label="Skrýt">
                <X size={14} />
              </button>
            </div>
          )}
          {showReflection && (
            <div className="banner">
              <NotebookPen size={16} />
              <span className="grow">Nový týden – 3 minuty na reflexi minulého týdne?</span>
              <a className="btn sm" href="#/reflexe">
                Reflexe <ArrowRight size={13} />
              </a>
              <button className="btn ghost icon sm" onClick={dismissRefl} aria-label="Skrýt">
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="dash-row">
        <section className="card dash-today" aria-label="Dnešek">
          <div className="card-head">
            <h2>Dnešek</h2>
            <a href="#/statistiky">Statistiky</a>
          </div>
          <div className="dash-today-body">
            <DayGauge
              rings={[
                { label: 'Dnes', value: goal > 0 ? todaySec / goal : 0, color: 'var(--accent)' },
                { label: 'Týden', value: weekGoal > 0 ? weekSec / weekGoal : 0, color: 'var(--break)' },
                { label: 'Soustředění', value: focus7 ? focus7 / 5 : 0, color: 'var(--focus)' },
              ]}
              center={fmtHM(todaySec)}
              sub={goal > 0 ? `ze ${fmtHM(goal)}` : 'dnes'}
            />
            <div className="dash-legend">
              <div className="legend-row">
                <i style={{ background: 'var(--accent)' }} />
                <span className="grow muted">Dnes</span>
                <span className="serif legend-val">{fmtHM(todaySec)}</span>
                <span className="legend-of">{goal > 0 ? (todaySec >= goal ? 'cíl splněn' : `ze ${fmtHM(goal)}`) : 'bez cíle'}</span>
              </div>
              <div className="legend-row">
                <i style={{ background: 'var(--break)' }} />
                <span className="grow muted">Týden</span>
                <span className="serif legend-val">{fmtHM(weekSec)}</span>
                <span className="legend-of">{weekGoal > 0 ? `z ${fmtHM(weekGoal)}` : 'bez cíle'}</span>
              </div>
              <div className="legend-row">
                <i style={{ background: 'var(--focus)' }} />
                <span className="grow muted">Soustředění</span>
                <span className="serif legend-val">{focus7 ? focus7.toFixed(1).replace('.', ',') : '—'}</span>
                <span className="legend-of">{focus7 ? 'z 5 · 7 dní' : 'bez hodnocení'}</span>
              </div>
              <div className="legend-foot">
                <span>
                  Série <b className="num">{current}</b> {plural(current, 'den', 'dny', 'dní')}
                  {best > current && <span className="faint"> · rekord {best}</span>}
                </span>
                <a href="#/opakovani">
                  K zopakování <b className="num">{dueTopics.length}</b>
                </a>
                {delta != null && (
                  <span className={delta >= 0 ? 'delta-up' : 'delta-down'}>
                    {delta >= 0 ? '+' : '−'}
                    {Math.abs(Math.round(delta * 100))} % proti minulému týdnu
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        <NextUp className="dash-next" />
      </div>

      <div className="dash-row">
        <section className="card dash-a" aria-label="Dnešní plán">
          <div className="card-head">
            <h2>Dnešní plán</h2>
            <button className="btn ghost sm" onClick={() => setPlanOpen(true)}>
              Naplánovat
            </button>
          </div>
          {todayBlocks.length === 0 ? (
            <Empty icon={<CalendarDays size={22} strokeWidth={1.5} />} title="Na dnešek nic">
              <a href="#/planovac" className="small">
                Naplánovat učení →
              </a>
            </Empty>
          ) : (
            <div className="list">
              {todayBlocks.map((b) => (
                <div className={`list-item dash-plan ${b.done ? 'done' : ''}`} key={b.id}>
                  <span className="serif dash-time">{fmtTime(b.start)}</span>
                  <div className="grow">
                    <SubjectTag id={b.subjectId} />
                    {b.title && <div className="small faint ellipsis">{b.title}</div>}
                  </div>
                  <span className="small faint num">{b.durationMin} min</span>
                  {b.done ? (
                    <Check size={14} color="var(--success)" aria-label="Hotovo" />
                  ) : (
                    timer.state.status === 'idle' && (
                      <button className="btn icon sm" title="Spustit časovač" aria-label="Spustit časovač" onClick={() => startTopic(b.subjectId, b.title, b.id)}>
                        <Play size={11} fill="currentColor" />
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card dash-b" aria-label="K zopakování">
          <div className="card-head">
            <h2>
              K zopakování {dueTopics.length > 0 && <span className="head-count">{dueTopics.length}</span>}
            </h2>
            <a href="#/opakovani">Vše</a>
          </div>
          {dueTopics.length === 0 ? (
            <Empty icon={<Check size={22} strokeWidth={1.5} />} title="Dnes nic k opakování">
              <span className="small faint">Témata z časovače se sem vrátí ve správný čas.</span>
            </Empty>
          ) : (
            <div className="list">
              {dueTopics.slice(0, 6).map((t) => {
                const late = overdueDays(t);
                return (
                  <div className="list-item" key={t.id}>
                    <div className="grow">
                      <div className="ellipsis">{t.name}</div>
                      <div className="small faint row" style={{ gap: 6 }}>
                        <SubjectTag id={t.subjectId} />
                        {late > 0 && <span className="danger-text num">+{late} d</span>}
                      </div>
                    </div>
                    <StageMeter t={t} />
                    {timer.state.status === 'idle' && (
                      <button className="btn icon sm" title="Opakovat s časovačem" aria-label="Opakovat s časovačem" onClick={() => startTopic(t.subjectId, t.name)}>
                        <Play size={11} fill="currentColor" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="dash-row">
        <section className="card dash-b" aria-label="Tento týden">
          <div className="card-head">
            <h2>Tento týden</h2>
            <span className="sub num">
              {fmtHM(weekSec)}
              {weekGoal > 0 && ` z ${fmtHM(weekGoal)}`}
            </span>
          </div>
          <div className="week-days" aria-label="Učení po dnech tohoto týdne">
            {weekDays.map((d) => (
              <div key={d.label} className={`week-day ${d.today ? 'today' : ''}`} title={`${d.label}: ${fmtDuration(d.sec)}`}>
                <span className="week-bar" style={{ height: `${Math.max(2, Math.round((d.sec / weekDayMax) * 40))}px` }} />
                <span className="week-label">{d.label}</span>
              </div>
            ))}
          </div>
          {weekRows.length === 0 ? (
            <Empty icon={<Target size={22} strokeWidth={1.5} />} title="Tento týden zatím nic">
              <a href="#/predmety" className="small">
                Nastavit týdenní cíle u předmětů →
              </a>
            </Empty>
          ) : (
            <div className="list">
              {weekRows.map((r) => (
                <div className="list-item week-row" key={r.id}>
                  <span className="dot" style={{ background: r.color }} />
                  <span className="grow ellipsis">{r.name}</span>
                  {r.goal > 0 && (
                    <span className="goal-line" aria-hidden="true">
                      <i style={{ width: `${Math.min(100, Math.round((r.sec / r.goal) * 100))}%`, background: r.color }} />
                    </span>
                  )}
                  <span className="small num week-val">
                    {fmtHM(r.sec)} <span className="faint">{r.goal > 0 ? `z ${fmtHM(r.goal)}` : 'bez cíle'}</span>
                  </span>
                </div>
              ))}
              <a href="#/predmety" className="small faint dash-more">
                Upravit týdenní cíle
              </a>
            </div>
          )}
        </section>

        <div className="dash-a stack loose">
          <section className="card" aria-label="Zkoušky">
            <div className="card-head">
              <h2>Zkoušky</h2>
              <a href="#/planovac">Přidat</a>
            </div>
            {exams.length === 0 ? (
              <Empty icon={<GraduationCap size={22} strokeWidth={1.5} />} title="Žádné zkoušky">
                <span className="small faint">V kalendáři ti naplánuju opakování.</span>
              </Empty>
            ) : (
              <div className="list">
                {exams.map((e) => {
                  const days = Math.round((parseDayKey(e.date).getTime() - today) / DAY);
                  return (
                    <div className="list-item" key={e.id}>
                      <div className="countdown">
                        <b className={`serif ${days <= 3 ? 'danger-text' : days <= 10 ? 'warn-text' : ''}`}>{days}</b>
                        <span className="label">{plural(days, 'den', 'dny', 'dní')}</span>
                      </div>
                      <div className="grow">
                        <div className="ellipsis">{e.name}</div>
                        <div className="small">
                          <SubjectTag id={e.subjectId} />
                        </div>
                      </div>
                      <span className="small faint num">{fmtExamDay(e.date)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <DashTimer />
        </div>
      </div>

      <div className="dash-row">
        {showAnki && <AnkiPanel className="dash-a" />}
        <section className="card dash-b" aria-label="Posledních 26 týdnů">
          <div className="card-head">
            <h2>Posledních 26 týdnů</h2>
            <a href="#/statistiky">Statistiky</a>
          </div>
          <Chart option={charts.heat} height={150} />
        </section>
      </div>

      <section className="card" aria-label="Poslední sezení">
        <div className="card-head">
          <h2>Poslední sezení</h2>
          <a href="#/historie">Historie</a>
        </div>
        {recent.length === 0 ? (
          <Empty icon={<BookOpen size={22} strokeWidth={1.5} />} title="Zatím žádná sezení">
            <span className="small faint">Spusť časovač – první záznam se objeví tady.</span>
          </Empty>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Kdy</th>
                  <th>Předmět</th>
                  <th>Téma</th>
                  <th>Režim</th>
                  <th className="r">Soustředění</th>
                  <th className="r">Čas</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => (
                  <tr key={s.id}>
                    <td className="num faint" style={{ whiteSpace: 'nowrap' }}>
                      {dayKey(s.start) === dayKey(now) ? 'dnes' : new Date(s.start).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })} {fmtTime(s.start)}
                    </td>
                    <td>
                      <SubjectTag id={s.subjectId} />
                    </td>
                    <td className="muted">{s.topic || <span className="faint">—</span>}</td>
                    <td className="faint">{modeName(s.mode, data.presets)}</td>
                    <td className="r">{s.focus ? `${s.focus}/5` : '—'}</td>
                    <td className="r">{fmtDuration(s.durationSec, { short: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {planOpen && <DayPlanModal onClose={() => setPlanOpen(false)} />}
    </div>
  );
}
