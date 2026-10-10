import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore } from '../../data/store';
import { Reflection, alive, uid } from '../../data/schema';
import { Chart, chartColors, useTheme } from '../../components/Chart';
import { Bar, useToast } from '../../components/ui';
import { addDays, dayKey, fmtDate, fmtDuration, parseDayKey, startOfWeek, WEEKDAYS_SHORT } from '../../lib/time';
import { pct, periodStats } from '../../lib/report';
import { navigate } from '../../lib/router';
import { highlightBars } from '../stats/charts';
import { SubjectTag } from '../subjects/SubjectSelect';

const RATINGS = ['', 'Špatný', 'Slabší', 'Průměrný', 'Dobrý', 'Výborný'];

/** Minulý týden (pondělí). Reflexe se dělá zpětně. */
export function lastWeekKey(): string {
  return dayKey(addDays(startOfWeek(Date.now()), -7));
}

/** Má smysl připomenout reflexi? (po–st, minulý týden měl učení a reflexe chybí) */
export function reflectionDue(reflections: Reflection[], sessionsLastWeek: number): boolean {
  const wd = (new Date().getDay() + 6) % 7;
  return wd <= 2 && sessionsLastWeek > 0 && !reflections.some((r) => !r.deletedAt && r.weekStart === lastWeekKey());
}

export function ReflectionPage() {
  const { data, upsert } = useStore();
  const theme = useTheme();
  const toast = useToast();
  const [week, setWeek] = useState(lastWeekKey);
  const from = parseDayKey(week).getTime();
  const to = addDays(from, 7);
  const sessions = useMemo(() => alive(data.sessions), [data.sessions]);
  const rules = useMemo(() => ({ restDays: data.settings.streakRestDays, minMin: data.settings.streakMinMin }), [data.settings.streakRestDays, data.settings.streakMinMin]);
  const cur = useMemo(() => periodStats(sessions, data.planBlocks, from, to, rules), [sessions, data.planBlocks, from, to, rules]);
  const prev = useMemo(() => periodStats(sessions, data.planBlocks, addDays(from, -7), from, rules), [sessions, data.planBlocks, from, rules]);
  const existing = data.reflections.find((r) => !r.deletedAt && r.weekStart === week);

  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [wentWell, setWentWell] = useState(existing?.wentWell ?? '');
  const [blocked, setBlocked] = useState(existing?.blocked ?? '');
  const [focusNext, setFocusNext] = useState(existing?.focusNext ?? '');

  useEffect(() => {
    setRating(existing?.rating ?? 0);
    setWentWell(existing?.wentWell ?? '');
    setBlocked(existing?.blocked ?? '');
    setFocusNext(existing?.focusNext ?? '');
  }, [week, existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const daily = useMemo(() => {
    const vals = Array.from({ length: 7 }, (_, i) => (cur.perDay.get(dayKey(addDays(from, i))) ?? 0) / 60);
    return highlightBars(chartColors(), WEEKDAYS_SHORT, vals);
  }, [cur, from, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const goals = alive(data.subjects).filter((s) => s.weeklyGoalMin > 0 && !s.archived);
  const goalsMet = goals.filter((s) => (cur.perSubject.get(s.id) ?? 0) >= s.weeklyGoalMin * 60).length;
  const change = pct(cur.total, prev.total);
  const isFuture = from > startOfWeek(Date.now());

  const save = () => {
    upsert('reflections', {
      id: existing?.id ?? uid(),
      weekStart: week,
      rating,
      wentWell: wentWell.trim(),
      blocked: blocked.trim(),
      focusNext: focusNext.trim(),
    });
    toast('Reflexe uložena');
  };

  const history = alive(data.reflections)
    .filter((r) => r.weekStart !== week)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
    .slice(0, 12);

  return (
    <div className="stack loose">
      <div className="page-head">
        <div>
          <div className="label eyebrow">Týdenní reflexe</div>
          <h1>
            {fmtDate(from, { day: 'numeric', month: 'long' })} – {fmtDate(addDays(from, 6), { day: 'numeric', month: 'long' })}
          </h1>
        </div>
        <div className="row">
          <button className="btn icon" onClick={() => setWeek(dayKey(addDays(from, -7)))} aria-label="Předchozí týden">
            <ChevronLeft size={16} />
          </button>
          <button className="btn icon" onClick={() => setWeek(dayKey(addDays(from, 7)))} disabled={isFuture || dayKey(addDays(from, 7)) > dayKey(startOfWeek(Date.now()))} aria-label="Další týden">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="strip" style={{ ['--n' as string]: 5 }}>
        <div className="cell">
          <span className="label">Celkem</span>
          <span className="value">{fmtDuration(cur.total, { short: true })}</span>
          <span className="foot">
            {change == null ? 'bez srovnání' : <span className={change >= 0 ? 'delta-up' : 'delta-down'}>{change >= 0 ? '▲' : '▼'} {Math.abs(change)} % vs. předchozí</span>}
          </span>
        </div>
        <div className="cell">
          <span className="label">Aktivní dny</span>
          <span className="value">
            {cur.activeDays}
            <small>/7</small>
          </span>
          <span className="foot">{cur.sessions} sezení</span>
        </div>
        <div className="cell">
          <span className="label">Cíle splněny</span>
          <span className="value">
            {goals.length ? goalsMet : '—'}
            {goals.length > 0 && <small>/{goals.length}</small>}
          </span>
          <span className="foot">týdenní cíle předmětů</span>
        </div>
        <div className="cell">
          <span className="label">Soustředění</span>
          <span className="value">{cur.focus ? cur.focus.toFixed(1) : '—'}</span>
          <span className="foot">{prev.focus ? `předtím ${prev.focus.toFixed(1)}` : '—'}</span>
        </div>
        <div className="cell">
          <span className="label">Plnění plánu</span>
          <span className="value">{cur.planAdherence == null ? '—' : `${Math.round(cur.planAdherence * 100)} %`}</span>
          <span className="foot">hotových bloků</span>
        </div>
      </div>

      <div className="g12">
        <div className="card c-7 xl-8">
          <div className="card-head">
            <h2>Jak se týden povedl?</h2>
            {existing && <span className="sub">uloženo</span>}
          </div>
          <div className="stack" style={{ gap: 16 }}>
            <div className="stack tight">
              <span className="label">Celkové hodnocení týdne</span>
              <div className="segmented" style={{ alignSelf: 'flex-start' }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} className={rating === n ? 'on' : ''} onClick={() => setRating(n)}>
                    {n} · {RATINGS[n]}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Co fungovalo? Čemu se chceš držet?</span>
              <textarea className="input" value={wentWell} onChange={(e) => setWentWell(e.target.value)} placeholder="např. ranní bloky před školou, mobil v jiné místnosti…" />
            </label>
            <label className="field">
              <span>Co tě brzdilo?</span>
              <textarea className="input" value={blocked} onChange={(e) => setBlocked(e.target.value)} placeholder="např. odkládání, únava večer, moc velké úkoly…" />
            </label>
            <label className="field">
              <span>Jedna konkrétní věc, kterou tento týden uděláš jinak</span>
              <input className="input" value={focusNext} onChange={(e) => setFocusNext(e.target.value)} placeholder="Konkrétně: kdy, kde, co. Zobrazí se ti na přehledu." />
            </label>
            <div className="row">
              <button className="btn primary" onClick={save} disabled={!rating && !wentWell && !blocked && !focusNext}>
                Uložit reflexi
              </button>
              <button className="btn" onClick={() => navigate('planovac')}>
                <CalendarDays size={14} /> Naplánovat týden
              </button>
            </div>
          </div>
        </div>

        <div className="stack loose c-5 xl-4">
          <div className="card">
            <div className="card-head">
              <h2>Po dnech</h2>
            </div>
            <Chart option={daily} height={170} />
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Předměty a cíle</h2>
            </div>
            <div className="stack">
              {[...new Set([...cur.perSubject.keys(), ...goals.map((g) => g.id)])].map((id) => {
                const s = data.subjects.find((x) => x.id === id);
                const done = cur.perSubject.get(id) ?? 0;
                const goal = (s?.weeklyGoalMin ?? 0) * 60;
                return (
                  <div key={id} className="stack tight">
                    <div className="row between small">
                      <SubjectTag id={id} />
                      <span className="num muted">
                        {fmtDuration(done, { short: true })}
                        {goal > 0 && ` / ${fmtDuration(goal, { short: true })}`}
                      </span>
                    </div>
                    <Bar value={goal ? done / goal : 1} color={s?.color} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {history.length > 0 && (
          <div className="card c-12">
            <div className="card-head">
              <h2>Předchozí reflexe</h2>
            </div>
            <div className="list">
              {history.map((r) => (
                <button key={r.id} className="list-item reflection-row" onClick={() => setWeek(r.weekStart)}>
                  <span className="num small muted" style={{ width: 110, flexShrink: 0, textAlign: 'left' }}>
                    {fmtDate(parseDayKey(r.weekStart).getTime())} – {fmtDate(addDays(parseDayKey(r.weekStart).getTime(), 6))}
                  </span>
                  {r.rating > 0 && <span className="chip">{r.rating}/5</span>}
                  <span className="grow ellipsis small" style={{ textAlign: 'left' }}>
                    {r.focusNext || r.wentWell || r.blocked}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
