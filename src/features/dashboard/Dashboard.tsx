import { useMemo } from 'react';
import { BookOpen, CalendarDays, Clock, Flame, GraduationCap, Play, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { useStore } from '../../data/store';
import { alive } from '../../data/schema';
import { Bar, Empty } from '../../components/ui';
import { Chart, chartColors, useTheme } from '../../components/Chart';
import { addDays, dayKey, fmtDuration, fmtTime, parseDayKey, plural, startOfDay, startOfWeek } from '../../lib/time';
import { avgFocus, byDay, bySubject, inRange, streaks, totalSec } from '../../lib/stats';
import { navigate } from '../../lib/router';
import { calendarHeatmap } from '../stats/charts';
import { SubjectTag } from '../subjects/SubjectSelect';
import { useTimer } from '../timer/TimerContext';
import { TimerControls, TimerRing } from '../timer/TimerPage';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Dobrou noc';
  if (h < 10) return 'Dobré ráno';
  if (h < 18) return 'Dobrý den';
  return 'Dobrý večer';
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
  const lastWeekSec = totalSec(inRange(sessions, addDays(week, -7), now - 7 * 86_400_000));
  const delta = lastWeekSec ? (weekSec - lastWeekSec) / lastWeekSec : null;
  const { current, best } = streaks(sessions);
  const focus7 = avgFocus(inRange(sessions, addDays(today, -6), now + 1));
  const goal = data.settings.dailyGoalMin * 60;

  const heat = useMemo(() => calendarHeatmap(chartColors(), byDay(sessions), 26 * 7, true), [sessions, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const weekBySubject = bySubject(weekSessions);
  const goals = subjects.filter((s) => s.weeklyGoalMin > 0);

  const todayBlocks = alive(data.planBlocks)
    .filter((b) => startOfDay(b.start) === today)
    .sort((a, b) => a.start - b.start);

  const exams = alive(data.exams)
    .filter((e) => parseDayKey(e.date).getTime() >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4);

  const recent = [...sessions].sort((a, b) => b.end - a.end).slice(0, 5);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>{greeting()} 👋</h1>
          <p>{new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        {timer.state.status === 'idle' && (
          <button className="btn primary" onClick={() => navigate('casovac')}>
            <Play size={16} fill="currentColor" /> Začít učení
          </button>
        )}
      </div>

      <div className="grid cols-4">
        <div className="card kpi">
          <span className="kpi-label">
            <Clock size={14} /> Dnes
          </span>
          <span className="kpi-value">{fmtDuration(todaySec, { short: true })}</span>
          {goal > 0 ? (
            <>
              <Bar value={todaySec / goal} color={todaySec >= goal ? 'var(--success)' : 'var(--accent)'} />
              <span className="kpi-foot">
                {todaySec >= goal ? 'Denní cíl splněn 🎉' : `Zbývá ${fmtDuration(goal - todaySec)} do cíle`}
              </span>
            </>
          ) : (
            <span className="kpi-foot">Bez denního cíle</span>
          )}
        </div>
        <div className="card kpi">
          <span className="kpi-label">
            <CalendarDays size={14} /> Tento týden
          </span>
          <span className="kpi-value">{fmtDuration(weekSec, { short: true })}</span>
          <span className="kpi-foot row" style={{ gap: 5 }}>
            {delta == null ? (
              'Minulý týden bez dat'
            ) : (
              <>
                {delta >= 0 ? <TrendingUp size={14} color="var(--success)" /> : <TrendingDown size={14} color="var(--danger)" />}
                <span style={{ color: delta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {delta >= 0 ? '+' : ''}
                  {Math.round(delta * 100)} %
                </span>
                oproti minulému týdnu
              </>
            )}
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">
            <Flame size={14} /> Série
          </span>
          <span className="kpi-value">
            {current} {plural(current, 'den', 'dny', 'dní')}
          </span>
          <span className="kpi-foot">Nejdelší: {best} {plural(best, 'den', 'dny', 'dní')}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">
            <Target size={14} /> Soustředění (7 dní)
          </span>
          <span className="kpi-value">{focus7 ? `${focus7.toFixed(1)} / 5` : '—'}</span>
          <span className="kpi-foot">{focus7 ? 'Průměr hodnocení po blocích' : 'Hodnoť bloky po dokončení'}</span>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div className="card-head" style={{ width: '100%', marginBottom: 0 }}>
            <h2>Časovač</h2>
            <a href="#/casovac" className="small">
              Otevřít
            </a>
          </div>
          <TimerRing size={200} />
          {timer.state.status === 'idle' && !timer.state.subjectId ? (
            <button className="btn primary round" onClick={() => navigate('casovac')}>
              <Play size={16} fill="currentColor" /> Vybrat předmět
            </button>
          ) : (
            <TimerControls compact />
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Dnešní plán</h2>
            <a href="#/planovac" className="small">
              Plánovač
            </a>
          </div>
          {todayBlocks.length === 0 ? (
            <Empty icon={<CalendarDays size={26} />} title="Na dnešek nic naplánováno">
              <a href="#/planovac" className="small">
                Naplánovat učení →
              </a>
            </Empty>
          ) : (
            <div className="list">
              {todayBlocks.map((b) => (
                <div className="list-item" key={b.id} style={{ opacity: b.done ? 0.5 : 1 }}>
                  <span className="num small muted" style={{ width: 42 }}>
                    {fmtTime(b.start)}
                  </span>
                  <div className="grow">
                    <SubjectTag id={b.subjectId} />
                    {b.title && <div className="small faint">{b.title}</div>}
                  </div>
                  <span className="small muted num">{b.durationMin} min</span>
                  {!b.done && timer.state.status === 'idle' && (
                    <button
                      className="btn icon sm"
                      title="Spustit časovač"
                      onClick={() => {
                        timer.configure({ subjectId: b.subjectId, topic: b.title, planBlockId: b.id });
                        navigate('casovac');
                      }}
                    >
                      <Play size={13} fill="currentColor" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Týdenní cíle</h2>
            <a href="#/predmety" className="small">
              Upravit
            </a>
          </div>
          {goals.length === 0 ? (
            <Empty icon={<Target size={26} />} title="Žádné týdenní cíle">
              <a href="#/predmety" className="small">
                Nastavit cíle u předmětů →
              </a>
            </Empty>
          ) : (
            <div className="stack">
              {goals.map((s) => {
                const done = weekBySubject.get(s.id) ?? 0;
                const g = s.weeklyGoalMin * 60;
                return (
                  <div key={s.id} className="stack tight">
                    <div className="row between small">
                      <SubjectTag id={s.id} />
                      <span className="num muted">
                        {fmtDuration(done, { short: true })} / {fmtDuration(g, { short: true })}
                      </span>
                    </div>
                    <Bar value={done / g} color={s.color} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Posledních 6 měsíců</h2>
          <a href="#/statistiky" className="small">
            Statistiky
          </a>
        </div>
        <Chart option={heat} height={150} />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <h2>Nadcházející zkoušky</h2>
          </div>
          {exams.length === 0 ? (
            <Empty icon={<GraduationCap size={26} />} title="Žádné zkoušky">
              <a href="#/planovac" className="small">
                Přidat zkoušku a vygenerovat opakování →
              </a>
            </Empty>
          ) : (
            <div className="list">
              {exams.map((e) => {
                const days = Math.round((parseDayKey(e.date).getTime() - today) / 86_400_000);
                return (
                  <div className="list-item" key={e.id}>
                    <div className="grow">
                      <b>{e.name}</b>
                      <div className="small">
                        <SubjectTag id={e.subjectId} />
                      </div>
                    </div>
                    <span className={`chip ${days <= 3 ? 'bad' : days <= 10 ? 'warn' : ''}`}>
                      {days === 0 ? 'dnes' : days === 1 ? 'zítra' : `za ${days} ${plural(days, 'den', 'dny', 'dní')}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Poslední sezení</h2>
            <a href="#/historie" className="small">
              Historie
            </a>
          </div>
          {recent.length === 0 ? (
            <Empty icon={<BookOpen size={26} />} title="Zatím žádná sezení">
              <span className="small">Spusť časovač – první záznam se objeví tady.</span>
            </Empty>
          ) : (
            <div className="list">
              {recent.map((s) => (
                <div className="list-item" key={s.id}>
                  <div className="grow">
                    <SubjectTag id={s.subjectId} />
                    <div className="small faint">
                      {dayKey(s.start) === dayKey(now) ? 'Dnes' : new Date(s.start).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })}{' '}
                      {fmtTime(s.start)}
                      {s.topic && ` · ${s.topic}`}
                    </div>
                  </div>
                  {s.focus && <span className="chip">{s.focus}/5</span>}
                  <span className="num small">{fmtDuration(s.durationSec)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
