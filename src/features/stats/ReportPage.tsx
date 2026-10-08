import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Printer, Sparkles } from 'lucide-react';
import { useStore } from '../../data/store';
import { alive } from '../../data/schema';
import { Chart, chartColors, useTheme } from '../../components/Chart';
import { Empty } from '../../components/ui';
import { addDays, dayKey, fmtDuration, fmtHours, WEEKDAYS_SHORT } from '../../lib/time';
import { highlights, monthRange, pct, periodStats } from '../../lib/report';
import { compareBars, donut, highlightBars, hourBars } from './charts';
import { focusByHour, inRange } from '../../lib/stats';
import { CalibrationCard } from './CalibrationCard';

const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const MONTHS_GEN = ['lednu', 'únoru', 'březnu', 'dubnu', 'květnu', 'červnu', 'červenci', 'srpnu', 'září', 'říjnu', 'listopadu', 'prosinci'];

/** Výchozí měsíc: první týden v měsíci ukazuje uzavřený minulý měsíc, jinak aktuální. */
export function defaultReportMonth(): { y: number; m: number } {
  const d = new Date();
  if (d.getDate() <= 7) {
    const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return { y: p.getFullYear(), m: p.getMonth() };
  }
  return { y: d.getFullYear(), m: d.getMonth() };
}

function Delta({ cur, prev, suffix = '' }: { cur: number; prev: number; suffix?: string }) {
  const p = pct(cur, prev);
  if (p == null) return <span>bez srovnání</span>;
  return (
    <span className={p >= 0 ? 'delta-up' : 'delta-down'}>
      {p >= 0 ? '▲' : '▼'} {Math.abs(p)} %{suffix}
    </span>
  );
}

export function ReportPage() {
  const { data } = useStore();
  const theme = useTheme();
  const [{ y, m }, setYm] = useState(defaultReportMonth);
  const sessions = useMemo(() => alive(data.sessions), [data.sessions]);
  const subjById = useMemo(() => new Map(data.subjects.map((s) => [s.id, s])), [data.subjects]);

  const { from, to } = monthRange(y, m);
  const prevRange = monthRange(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1);
  const cur = useMemo(() => periodStats(sessions, data.planBlocks, from, to), [sessions, data.planBlocks, from, to]);
  const prev = useMemo(() => periodStats(sessions, data.planBlocks, prevRange.from, prevRange.to), [sessions, data.planBlocks, prevRange.from, prevRange.to]);
  const notes = highlights(cur, prev, data.subjects);
  const now = new Date();
  const isFuture = from > now.getTime();
  const inProgress = now.getTime() >= from && now.getTime() < to;
  // Návrhy úprav patří k poslednímu uzavřenému měsíci
  const isLastClosed = to === new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const topicsStudied = new Set(inRange(sessions, from, to).filter((s) => s.topic).map((s) => `${s.subjectId}|${s.topic.toLowerCase()}`)).size;

  const shift = (n: number) => {
    const d = new Date(y, m + n, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  };

  const options = useMemo(() => {
    const c = chartColors();
    const daysIn = new Date(y, m + 1, 0).getDate();
    const dayLabels: string[] = [];
    const dayVals: number[] = [];
    for (let i = 0; i < daysIn; i++) {
      const t = addDays(from, i);
      dayLabels.push(String(i + 1));
      dayVals.push((cur.perDay.get(dayKey(t)) ?? 0) / 60);
    }
    const ids = new Set([...cur.perSubject.keys(), ...prev.perSubject.keys()]);
    const compareItems = [...ids].map((id) => ({
      name: subjById.get(id)?.name ?? '?',
      color: subjById.get(id)?.color ?? c.text3,
      cur: (cur.perSubject.get(id) ?? 0) / 60,
      prev: (prev.perSubject.get(id) ?? 0) / 60,
    }));
    return {
      daily: highlightBars(c, dayLabels, dayVals),
      weekday: highlightBars(c, WEEKDAYS_SHORT, cur.weekdayAvg),
      hours: hourBars(c, cur.hourMinutes, focusByHour(inRange(sessions, from, to))),
      compare: compareBars(c, compareItems, MONTHS[prevRange.from ? new Date(prevRange.from).getMonth() : 0], MONTHS[m]),
      donut: donut(
        c,
        [...cur.perSubject.entries()].map(([id, sec]) => ({ name: subjById.get(id)?.name ?? '?', color: subjById.get(id)?.color ?? c.text3, min: sec / 60 })),
      ),
    };
  }, [cur, prev, y, m, from, subjById, sessions, to, prevRange.from, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const subjRows = [...new Set([...cur.perSubject.keys(), ...prev.perSubject.keys()])]
    .map((id) => ({ id, cur: cur.perSubject.get(id) ?? 0, prev: prev.perSubject.get(id) ?? 0 }))
    .sort((a, b) => b.cur - a.cur);

  return (
    <div className="stack loose report">
      <div className="page-head">
        <div>
          <div className="label eyebrow">měsíční report{inProgress ? ' · průběžný' : ''}</div>
          <h1 style={{ textTransform: 'capitalize' }}>
            {MONTHS[m]} {y}
          </h1>
        </div>
        <div className="row no-print">
          <button className="btn icon" onClick={() => shift(-1)} aria-label="Předchozí měsíc">
            <ChevronLeft size={16} />
          </button>
          <button className="btn icon" onClick={() => shift(1)} aria-label="Další měsíc" disabled={isFuture || inProgress}>
            <ChevronRight size={16} />
          </button>
          <button className="btn" onClick={() => window.print()}>
            <Printer size={14} /> Tisk / PDF
          </button>
        </div>
      </div>

      {cur.sessions === 0 ? (
        <div className="card">
          <Empty icon={<FileText size={26} />} title={`V ${MONTHS_GEN[m]} žádné učení`}>
            <span className="small">Vyber jiný měsíc šipkami.</span>
          </Empty>
        </div>
      ) : (
        <>
          <div className="strip" style={{ ['--n' as string]: 6 }}>
            <div className="cell">
              <span className="label">celkem</span>
              <span className="value">{fmtHours(cur.total)}</span>
              <span className="foot">
                <Delta cur={cur.total} prev={prev.total} />
              </span>
            </div>
            <div className="cell">
              <span className="label">aktivní dny</span>
              <span className="value">
                {cur.activeDays}
                <small>/{cur.days}</small>
              </span>
              <span className="foot">{Math.round(cur.consistency * 100)} % pravidelnost</span>
            </div>
            <div className="cell">
              <span className="label">ø na aktivní den</span>
              <span className="value">{fmtDuration(cur.avgPerActiveDay, { short: true })}</span>
              <span className="foot">
                <Delta cur={cur.avgPerActiveDay} prev={prev.avgPerActiveDay} />
              </span>
            </div>
            <div className="cell">
              <span className="label">ø blok</span>
              <span className="value">{fmtDuration(cur.avgSession, { short: true })}</span>
              <span className="foot">{cur.sessions} sezení</span>
            </div>
            <div className="cell">
              <span className="label">soustředění</span>
              <span className="value">
                {cur.focus ? cur.focus.toFixed(1) : '—'}
                <small>/5</small>
              </span>
              <span className="foot">{prev.focus && cur.focus ? `minule ${prev.focus.toFixed(1)}` : 'průměr hodnocení'}</span>
            </div>
            <div className="cell">
              <span className="label">nejdelší série</span>
              <span className="value">
                {cur.longestStreak}
                <small> d</small>
              </span>
              <span className="foot">dní v řadě</span>
            </div>
          </div>

          {isLastClosed && <CalibrationCard y={y} m={m} />}

          <div className="g12">
            <div className="card c-5 xl-4">
              <div className="card-head">
                <h2 className="row" style={{ gap: 7 }}>
                  <Sparkles size={14} color="var(--accent)" /> Postřehy
                </h2>
              </div>
              <ol className="insights">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ol>
            </div>
            <div className="card c-7 xl-8">
              <div className="card-head">
                <h2>Den po dni</h2>
                <span className="sub">minuty učení · nejlepší den zvýrazněn</span>
              </div>
              <Chart option={options.daily} height={250} />
            </div>

            <div className="card c-4">
              <div className="card-head">
                <h2>Dny v týdnu</h2>
                <span className="sub">průměr</span>
              </div>
              <Chart option={options.weekday} height={210} />
            </div>
            <div className="card c-4">
              <div className="card-head">
                <h2>Hodiny dne</h2>
                <span className="sub">{cur.peakWindow ? `špička ${cur.peakWindow.from}–${cur.peakWindow.to} h` : ''}</span>
              </div>
              <Chart option={options.hours} height={210} />
            </div>
            <div className="card c-4">
              <div className="card-head">
                <h2>Část dne</h2>
                <span className="sub">{cur.chronotype}</span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th></th>
                    <th className="r">čas</th>
                    <th className="r">podíl</th>
                    <th className="r">focus</th>
                  </tr>
                </thead>
                <tbody>
                  {cur.dayparts.map((p) => (
                    <tr key={p.label}>
                      <td>{p.label}</td>
                      <td className="r">{fmtDuration(p.min * 60, { short: true })}</td>
                      <td className="r">{Math.round((p.min / Math.max(1, cur.total / 60)) * 100)} %</td>
                      <td className="r">{p.focus ? p.focus.toFixed(1) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card c-6">
              <div className="card-head">
                <h2>Předměty vs. minulý měsíc</h2>
              </div>
              <Chart option={options.compare} height={Math.max(200, subjRows.length * 46 + 60)} />
            </div>
            <div className="card c-6">
              <div className="card-head">
                <h2>Rozložení</h2>
              </div>
              <div className="g12" style={{ alignItems: 'center' }}>
                <div className="c-5">
                  <Chart option={options.donut} height={200} />
                </div>
                <div className="c-7">
                  <table className="table">
                    <tbody>
                      {subjRows.map((r) => (
                        <tr key={r.id}>
                          <td className="name">
                            <span className="row" style={{ gap: 7 }}>
                              <span className="dot" style={{ background: subjById.get(r.id)?.color }} />
                              <span className="ellipsis">{subjById.get(r.id)?.name ?? '?'}</span>
                            </span>
                          </td>
                          <td className="r">{fmtDuration(r.cur, { short: true })}</td>
                          <td className="r">
                            {r.prev ? (
                              <span className={r.cur >= r.prev ? 'delta-up' : 'delta-down'}>
                                {r.cur >= r.prev ? '+' : '−'}
                                {fmtDuration(Math.abs(r.cur - r.prev), { short: true })}
                              </span>
                            ) : (
                              <span className="faint">nové</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="strip" style={{ ['--n' as string]: 5 }}>
            <div className="cell">
              <span className="label">hluboká práce</span>
              <span className="value">{Math.round(cur.deepShare * 100)} %</span>
              <span className="foot">času v blocích 45+ min</span>
            </div>
            <div className="cell">
              <span className="label">vyrušení / hod</span>
              <span className="value">{cur.interruptionsPerHour.toFixed(1)}</span>
              <span className="foot">{prev.sessions ? `minule ${prev.interruptionsPerHour.toFixed(1)}` : '—'}</span>
            </div>
            <div className="cell">
              <span className="label">plnění plánu</span>
              <span className="value">{cur.planAdherence == null ? '—' : `${Math.round(cur.planAdherence * 100)} %`}</span>
              <span className="foot">{cur.plannedSec ? `naplánováno ${fmtDuration(cur.plannedSec, { short: true })}` : 'bez plánu'}</span>
            </div>
            <div className="cell">
              <span className="label">témata</span>
              <span className="value">{topicsStudied}</span>
              <span className="foot">různých témat</span>
            </div>
            <div className="cell">
              <span className="label">nejsilnější den</span>
              <span className="value">{cur.bestDay ? fmtDuration(cur.bestDay.sec, { short: true }) : '—'}</span>
              <span className="foot">
                {cur.bestDay ? new Date(cur.bestDay.key).toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' }) : ''}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
