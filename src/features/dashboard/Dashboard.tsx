import { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, CalendarDays, CalendarRange, Check, FileText, GraduationCap, NotebookPen, Play, Sunrise, Target, X } from 'lucide-react';
import { useStore } from '../../data/store';
import { alive } from '../../data/schema';
import { Bar, Empty } from '../../components/ui';
import { Chart, chartColors, useTheme } from '../../components/Chart';
import { DAY, addDays, dayKey, fmtDuration, fmtTime, parseDayKey, plural, startOfDay, startOfWeek, WEEKDAYS_SHORT } from '../../lib/time';
import { avgFocus, byDay, bySubject, inRange, streaks, totalSec } from '../../lib/stats';
import { navigate } from '../../lib/router';
import { calendarHeatmap, stackedBars } from '../stats/charts';
import { SubjectTag } from '../subjects/SubjectSelect';
import { useTimer } from '../timer/TimerContext';
import { TimerControls, TimerRing } from '../timer/TimerPage';
import { isDue, overdueDays } from '../topics/schedule';
import { StageMeter } from '../topics/TopicsPage';
import { lastWeekKey, reflectionDue } from '../reflection/ReflectionPage';
import { modeName } from '../timer/modes';
import { AnkiPanel } from '../anki/AnkiPanel';
import { NextUp } from '../recommend/NextUp';
import { DayPlanModal } from '../dayplan/DayPlanModal';
import './dashboard.css';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Dobrou noc';
  if (h < 10) return 'Dobré ráno';
  if (h < 18) return 'Dobrý den';
  return 'Dobrý večer';
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
  const { current, best } = streaks(sessions);
  const focus7 = avgFocus(inRange(sessions, addDays(today, -6), now + 1));
  const goal = data.settings.dailyGoalMin * 60;

  const dueTopics = data.topics.filter((t) => isDue(t, addDays(today, 1))).sort((a, b) => (a.nextReviewAt ?? 0) - (b.nextReviewAt ?? 0));

  const charts = useMemo(() => {
    const c = chartColors();
    const ws = inRange(sessions, week, addDays(week, 7));
    const per = new Map<string, number[]>();
    for (const s of ws) {
      if (!per.has(s.subjectId)) per.set(s.subjectId, new Array(7).fill(0));
      per.get(s.subjectId)![Math.floor((startOfDay(s.start) - week) / DAY)] += s.durationSec / 60;
    }
    const series = [...per.entries()].map(([id, values]) => {
      const s = data.subjects.find((x) => x.id === id);
      return { name: s?.name ?? '?', color: s?.color ?? c.text3, values };
    });
    const weekOpt = stackedBars(c, WEEKDAYS_SHORT, series);
    return { heat: calendarHeatmap(c, byDay(sessions), 26 * 7, true), week: { ...weekOpt, legend: undefined, grid: { left: 4, right: 4, top: 10, bottom: 2 } } };
  }, [sessions, week, data.subjects, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const weekBySubject = bySubject(weekSessions);
  const goals = subjects.filter((s) => s.weeklyGoalMin > 0);

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
  const showReflection = data.settings.weeklyReflection && !reflDismissed && reflectionDue(data.reflections, lastWeekCount);
  const prevMonth = new Date(new Date(now).getFullYear(), new Date(now).getMonth() - 1, 1);
  const prevMonthCount = inRange(sessions, prevMonth.getTime(), new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 1).getTime()).length;
  const [reportDismissed, dismissReport] = useDismiss(`st.dismiss.report.${prevMonth.getFullYear()}-${prevMonth.getMonth()}`);
  const showReport = new Date(now).getDate() <= 7 && prevMonthCount > 0 && !reportDismissed;
  const thisWeekReflection = data.reflections.find((r) => !r.deletedAt && r.weekStart === lastWeekKey() && r.focusNext);

  const [planOpen, setPlanOpen] = useState(false);
  const [morningDismissed, dismissMorning] = useDismiss(`st.dismiss.morning.${dayKey(now)}`);
  const showMorning = !morningDismissed && new Date(now).getHours() >= 5 && new Date(now).getHours() < 13 && todayBlocks.length === 0 && alive(data.subjects).length > 0;
  const showAnki = data.settings.anki.enabled || data.anki.some((a) => a.id === 'snapshot' && !a.deletedAt);

  const startTopic = (subjectId: string, topic: string, planBlockId?: string) => {
    timer.configure({ subjectId, topic, planBlockId });
    navigate('casovac');
  };

  return (
    <div className="stack loose">
      <div className="page-head">
        <div>
          <div className="label eyebrow">{new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1>{greeting()}</h1>
        </div>
        {timer.state.status === 'idle' && (
          <button className="btn primary" onClick={() => navigate('casovac')}>
            <Play size={14} fill="currentColor" /> Začít učení
          </button>
        )}
      </div>

      {(showReflection || showReport || thisWeekReflection || showMorning) && (
        <div className="stack tight">
          {showMorning && (
            <div className="banner">
              <Sunrise size={16} />
              <span className="grow">Dobré ráno – naplánuj si dnešek. Navrhnu bloky podle zkoušek, opakování a cílů, ty jen potvrdíš.</span>
              <button className="btn sm primary" onClick={() => setPlanOpen(true)}>
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
          {thisWeekReflection && (
            <div className="intent">
              <span className="label">tento týden</span>
              <span>{thisWeekReflection.focusNext}</span>
            </div>
          )}
        </div>
      )}

      <div className="strip" style={{ ['--n' as string]: 5 }}>
        <div className="cell">
          <span className="label">dnes</span>
          <span className="value">{fmtDuration(todaySec, { short: true })}</span>
          {goal > 0 ? (
            <div className="stack tight" style={{ gap: 5 }}>
              <Bar value={todaySec / goal} color={todaySec >= goal ? 'var(--success)' : 'var(--accent)'} />
              <span className="foot">{todaySec >= goal ? 'denní cíl splněn' : `zbývá ${fmtDuration(goal - todaySec)}`}</span>
            </div>
          ) : (
            <span className="foot">bez denního cíle</span>
          )}
        </div>
        <div className="cell">
          <span className="label">tento týden</span>
          <span className="value">{fmtDuration(weekSec, { short: true })}</span>
          <span className="foot">
            {delta == null ? (
              'minulý týden bez dat'
            ) : (
              <>
                <span className={delta >= 0 ? 'delta-up' : 'delta-down'}>
                  {delta >= 0 ? '▲' : '▼'} {Math.abs(Math.round(delta * 100))} %
                </span>
                vs. minulý týden
              </>
            )}
          </span>
        </div>
        <div className="cell">
          <span className="label">série</span>
          <span className="value">
            {current}
            <small> {plural(current, 'den', 'dny', 'dní')}</small>
          </span>
          <span className="foot">rekord {best}</span>
        </div>
        <div className="cell">
          <span className="label">soustředění · 7 dní</span>
          <span className="value">
            {focus7 ? focus7.toFixed(1) : '—'}
            {focus7 && <small>/5</small>}
          </span>
          <span className="foot">{focus7 ? 'průměr hodnocení' : 'hodnoť bloky po dokončení'}</span>
        </div>
        <div className="cell">
          <span className="label">k zopakování</span>
          <span className="value" style={{ color: dueTopics.length ? 'var(--accent)' : undefined }}>
            {dueTopics.length}
          </span>
          <span className="foot">
            <a href="#/opakovani">{dueTopics.length ? 'otevřít opakování' : 'vše hotovo'}</a>
          </span>
        </div>
      </div>

      <NextUp />

      <div className="g12">
        <div className="card c-4 xl-3 dash-timer">
          <div className="card-head">
            <h2>Časovač</h2>
            <a href="#/casovac">Otevřít</a>
          </div>
          <div className="dash-timer-body">
            <TimerRing size={210} />
            {timer.state.status === 'idle' && !timer.state.subjectId ? (
              <button className="btn primary" onClick={() => navigate('casovac')}>
                Vybrat předmět
              </button>
            ) : (
              <TimerControls compact />
            )}
          </div>
        </div>

        <div className="card c-4 xl-3">
          <div className="card-head">
            <h2>Dnešní plán</h2>
            <button className="btn ghost sm" onClick={() => setPlanOpen(true)}>
              <CalendarRange size={13} /> Naplánovat
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
                <div className="list-item" key={b.id} style={{ opacity: b.done ? 0.45 : 1 }}>
                  <span className="num small muted" style={{ width: 40 }}>
                    {fmtTime(b.start)}
                  </span>
                  <div className="grow">
                    <SubjectTag id={b.subjectId} />
                    {b.title && <div className="small faint ellipsis">{b.title}</div>}
                  </div>
                  <span className="small faint num">{b.durationMin}m</span>
                  {b.done ? (
                    <Check size={14} color="var(--success)" />
                  ) : (
                    timer.state.status === 'idle' && (
                      <button className="btn icon sm" title="Spustit časovač" onClick={() => startTopic(b.subjectId, b.title, b.id)}>
                        <Play size={11} fill="currentColor" />
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card c-4 xl-3">
          <div className="card-head">
            <h2>K zopakování</h2>
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
                      <div className="ellipsis" style={{ fontWeight: 500 }}>
                        {t.name}
                      </div>
                      <div className="small faint row" style={{ gap: 6 }}>
                        <SubjectTag id={t.subjectId} />
                        {late > 0 && <span className="danger-text num">+{late} d</span>}
                      </div>
                    </div>
                    <StageMeter t={t} />
                    {timer.state.status === 'idle' && (
                      <button className="btn icon sm" title="Opakovat s časovačem" onClick={() => startTopic(t.subjectId, t.name)}>
                        <Play size={11} fill="currentColor" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card c-4 xl-3">
          <div className="card-head">
            <h2>Týdenní cíle</h2>
            <a href="#/predmety">Upravit</a>
          </div>
          {goals.length === 0 ? (
            <Empty icon={<Target size={22} strokeWidth={1.5} />} title="Žádné týdenní cíle">
              <a href="#/predmety" className="small">
                Nastavit u předmětů →
              </a>
            </Empty>
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              {goals.map((s) => {
                const done = weekBySubject.get(s.id) ?? 0;
                const g = s.weeklyGoalMin * 60;
                return (
                  <div key={s.id} className="stack tight">
                    <div className="row between small">
                      <SubjectTag id={s.id} />
                      <span className="num faint">
                        <span style={{ color: 'var(--text)' }}>{fmtDuration(done, { short: true })}</span> / {fmtDuration(g, { short: true })}
                      </span>
                    </div>
                    <Bar value={done / g} color={s.color} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={`card c-4 ${showAnki ? 'xl-4' : 'xl-3'}`}>
          <div className="card-head">
            <h2>Tento týden</h2>
            <span className="sub num">{fmtDuration(weekSec, { short: true })}</span>
          </div>
          <Chart option={charts.week} height={190} />
        </div>

        <div className={`card c-4 ${showAnki ? 'xl-4' : 'xl-3'}`}>
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
                    <div className="countdown num">
                      <b className={days <= 3 ? 'danger-text' : days <= 10 ? 'warn-text' : ''}>{days}</b>
                      <span className="label">{plural(days, 'den', 'dny', 'dní')}</span>
                    </div>
                    <div className="grow">
                      <div className="ellipsis" style={{ fontWeight: 500 }}>
                        {e.name}
                      </div>
                      <div className="small">
                        <SubjectTag id={e.subjectId} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {showAnki && <AnkiPanel className="c-4 xl-4" />}

        <div className={`card ${showAnki ? 'c-8 xl-12' : 'c-12 xl-6'}`}>
          <div className="card-head">
            <h2>Posledních 26 týdnů</h2>
            <a href="#/statistiky">Statistiky</a>
          </div>
          <Chart option={charts.heat} height={150} />
        </div>

        <div className="card c-12">
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
                    <th className="r">Focus</th>
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
        </div>
      </div>
      {planOpen && <DayPlanModal onClose={() => setPlanOpen(false)} />}
    </div>
  );
}
