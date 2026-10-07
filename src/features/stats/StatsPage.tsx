import { useMemo, useState } from 'react';
import { BarChart3, Lightbulb } from 'lucide-react';
import { useStore } from '../../data/store';
import { Session, alive } from '../../data/schema';
import { Chart, chartColors, useTheme } from '../../components/Chart';
import { Empty, Segmented } from '../../components/ui';
import { addDays, dayKey, fmtDate, fmtDuration, fmtHours, startOfDay, startOfMonth, startOfWeek } from '../../lib/time';
import { avgFocus, bestWindow, byDay, byHour, bySubject, focusByHour, hourWeekdayMatrix, inRange, totalSec } from '../../lib/stats';
import { SubjectSelect } from '../subjects/SubjectSelect';
import { calendarHeatmap, donut, hourBars, stackedBars, trendLine, weekHourHeatmap } from './charts';

type Period = '7' | '30' | '90' | '365' | 'all';

const PERIODS: { value: Period; label: string }[] = [
  { value: '7', label: '7 dní' },
  { value: '30', label: '30 dní' },
  { value: '90', label: '3 měs.' },
  { value: '365', label: 'Rok' },
  { value: 'all', label: 'Vše' },
];

export function StatsPage() {
  const { data } = useStore();
  const theme = useTheme();
  const [period, setPeriod] = useState<Period>('30');
  const [subjectId, setSubjectId] = useState('');

  const all = useMemo(() => alive(data.sessions), [data.sessions]);
  const subjById = useMemo(() => new Map(data.subjects.map((s) => [s.id, s])), [data.subjects]);

  const now = Date.now();
  const end = startOfDay(now) + 86_400_000;
  const firstSession = all.reduce((m, s) => Math.min(m, s.start), now);
  const from = period === 'all' ? startOfDay(firstSession) : addDays(end, -Number(period));
  const filtered = useMemo(
    () => inRange(all, from, end).filter((s) => !subjectId || s.subjectId === subjectId),
    [all, from, end, subjectId],
  );
  const prev = inRange(all, from - (end - from), from).filter((s) => !subjectId || s.subjectId === subjectId);

  const total = totalSec(filtered);
  const prevTotal = totalSec(prev);
  const days = Math.max(1, Math.round((end - from) / 86_400_000));
  const activeDays = new Set(filtered.map((s) => dayKey(s.start))).size;
  const blocks = filtered.filter((s) => s.mode !== 'anki'); // krátké bloky z Anki průměr nezkreslují
  const avgLen = blocks.length ? totalSec(blocks) / blocks.length : 0;
  const focus = avgFocus(filtered);
  const peak = bestWindow(filtered);
  const subjTotals = [...bySubject(filtered).entries()].sort((a, b) => b[1] - a[1]);
  const change = prevTotal ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;

  const options = useMemo(() => {
    const c = chartColors();
    const perDay = byDay(filtered);

    const trendDays = Math.min(days, 90);
    const trendLabels: string[] = [];
    const trendVals: number[] = [];
    for (let i = trendDays - 1; i >= 0; i--) {
      const t = addDays(end, -i - 1);
      trendLabels.push(fmtDate(t));
      trendVals.push((perDay.get(dayKey(t)) ?? 0) / 60);
    }

    const useMonths = days > 120;
    const buckets: { start: number; label: string }[] = [];
    if (useMonths) {
      for (let t = startOfMonth(from); t < end; t = new Date(new Date(t).getFullYear(), new Date(t).getMonth() + 1, 1).getTime()) {
        buckets.push({ start: t, label: new Date(t).toLocaleDateString('cs-CZ', { month: 'short', year: '2-digit' }) });
      }
    } else {
      for (let t = startOfWeek(from); t < end; t = addDays(t, 7)) buckets.push({ start: t, label: fmtDate(t) });
    }
    const bucketIdx = (t: number) => {
      let i = buckets.length - 1;
      while (i > 0 && buckets[i].start > t) i--;
      return i;
    };
    const perSubj = new Map<string, number[]>();
    for (const s of filtered) {
      if (!perSubj.has(s.subjectId)) perSubj.set(s.subjectId, new Array(buckets.length).fill(0));
      perSubj.get(s.subjectId)![bucketIdx(s.start)] += s.durationSec / 60;
    }
    const series = [...perSubj.entries()]
      .sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0))
      .map(([id, values]) => ({ name: subjById.get(id)?.name ?? '?', color: subjById.get(id)?.color ?? c.text3, values }));

    return {
      trend: trendLine(c, trendLabels, trendVals, subjectId ? 0 : data.settings.dailyGoalMin),
      stacked: stackedBars(c, buckets.map((b) => b.label), series),
      donut: donut(
        c,
        [...bySubject(filtered).entries()].map(([id, sec]) => ({
          name: subjById.get(id)?.name ?? '?',
          color: subjById.get(id)?.color ?? c.text3,
          min: sec / 60,
        })),
      ),
      weekHour: weekHourHeatmap(c, hourWeekdayMatrix(filtered)),
      hours: hourBars(c, byHour(filtered), focusByHour(filtered)),
      calendar: calendarHeatmap(c, byDay(all.filter((s) => !subjectId || s.subjectId === subjectId)), 365),
      useMonths,
    };
  }, [filtered, all, days, end, from, subjById, subjectId, data.settings.dailyGoalMin, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack loose">
      <div className="page-head">
        <div>
          <h1>Statistiky</h1>
          <p>Co, kdy a jak dlouho se učíš.</p>
        </div>
        <div className="row wrap">
          <div style={{ width: 210 }}>
            <SubjectSelect value={subjectId} onChange={setSubjectId} allowAll />
          </div>
          <Segmented value={period} options={PERIODS} onChange={setPeriod} />
        </div>
      </div>

      {all.length === 0 ? (
        <div className="card">
          <Empty icon={<BarChart3 size={26} strokeWidth={1.5} />} title="Zatím tu nic není">
            <span className="small">Jakmile odučíš první blok, objeví se tu grafy.</span>
          </Empty>
        </div>
      ) : (
        <>
          <div className="strip" style={{ ['--n' as string]: 6 }}>
            <div className="cell">
              <span className="label">celkem</span>
              <span className="value">{fmtHours(total)}</span>
              <span className="foot">
                {change == null ? (
                  'bez srovnání'
                ) : (
                  <span className={change >= 0 ? 'delta-up' : 'delta-down'}>
                    {change >= 0 ? '▲' : '▼'} {Math.abs(change)} % vs. předchozí
                  </span>
                )}
              </span>
            </div>
            <div className="cell">
              <span className="label">ø na den</span>
              <span className="value">{fmtDuration(total / days, { short: true })}</span>
              <span className="foot">za celé období</span>
            </div>
            <div className="cell">
              <span className="label">aktivní dny</span>
              <span className="value">
                {activeDays}
                <small>/{days}</small>
              </span>
              <span className="foot">{Math.round((activeDays / days) * 100)} % pravidelnost</span>
            </div>
            <div className="cell">
              <span className="label">ø blok</span>
              <span className="value">{fmtDuration(avgLen, { short: true })}</span>
              <span className="foot">{blocks.length} bloků{filtered.length > blocks.length ? ` + ${filtered.length - blocks.length}× Anki` : ''}</span>
            </div>
            <div className="cell">
              <span className="label">soustředění</span>
              <span className="value">
                {focus ? focus.toFixed(1) : '—'}
                {focus && <small>/5</small>}
              </span>
              <span className="foot">průměr hodnocení</span>
            </div>
            <div className="cell">
              <span className="label">nejsilnější okno</span>
              <span className="value">{peak ? `${peak.from}–${peak.to}h` : '—'}</span>
              <span className="foot">kdy se učíš nejvíc</span>
            </div>
          </div>

          <Insights filtered={filtered} />

          <div className="g12">
            <div className="card c-12 xl-8">
              <div className="card-head">
                <h2>Vývoj v čase</h2>
                <span className="sub">{days > 90 ? 'posledních 90 dní' : 'po dnech'}</span>
              </div>
              <Chart option={options.trend} height={270} />
            </div>
            <div className="card c-5 xl-4">
              <div className="card-head">
                <h2>Rozložení</h2>
              </div>
              <Chart option={options.donut} height={170} />
              <div className="list" style={{ marginTop: 12 }}>
                {subjTotals.slice(0, 6).map(([id, sec]) => (
                  <div className="row between small" key={id} style={{ padding: '5px 0', borderTop: '1px solid var(--line)' }}>
                    <span className="row" style={{ gap: 7, minWidth: 0 }}>
                      <span className="dot" style={{ background: subjById.get(id)?.color }} />
                      <span className="ellipsis">{subjById.get(id)?.name ?? '?'}</span>
                    </span>
                    <span className="num muted">
                      {fmtDuration(sec, { short: true })} <span className="faint">· {Math.round((sec / Math.max(1, total)) * 100)}%</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card c-7 xl-6">
              <div className="card-head">
                <h2>Předměty v čase</h2>
                <span className="sub">{options.useMonths ? 'po měsících' : 'po týdnech'}</span>
              </div>
              <Chart option={options.stacked} height={280} />
            </div>
            <div className="card c-6 xl-6">
              <div className="card-head">
                <h2>Kdy se učíš</h2>
                <span className="sub">den × hodina</span>
              </div>
              <Chart option={options.weekHour} height={280} />
            </div>
            <div className="card c-6 xl-6">
              <div className="card-head">
                <h2>Hodiny dne a soustředění</h2>
              </div>
              <Chart option={options.hours} height={250} />
            </div>
            <div className="card c-12 xl-6">
              <div className="card-head">
                <h2>Celý rok</h2>
              </div>
              <Chart option={options.calendar} height={175} />
            </div>

            <div className="card c-12">
              <div className="card-head">
                <h2>Podle předmětů</h2>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Předmět</th>
                      <th className="r">Čas</th>
                      <th className="r">Podíl</th>
                      <th className="r">Sezení</th>
                      <th className="r">Ø blok</th>
                      <th className="r">Soustředění</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjTotals.map(([id, sec]) => {
                      const list = filtered.filter((s) => s.subjectId === id);
                      const f = avgFocus(list);
                      return (
                        <tr key={id}>
                          <td>
                            <span className="row" style={{ gap: 7 }}>
                              <span className="dot" style={{ background: subjById.get(id)?.color }} />
                              {subjById.get(id)?.name ?? '?'}
                            </span>
                          </td>
                          <td className="r">{fmtDuration(sec)}</td>
                          <td className="r">{Math.round((sec / Math.max(1, total)) * 100)} %</td>
                          <td className="r">{list.length}</td>
                          <td className="r">{fmtDuration(sec / list.length)}</td>
                          <td className="r">{f ? f.toFixed(1) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Krátké, daty podložené postřehy. */
function Insights({ filtered }: { filtered: Session[] }) {
  const tips: string[] = [];
  if (filtered.length >= 5) {
    const long = filtered.filter((s) => s.durationSec >= 45 * 60 && s.focus);
    const short = filtered.filter((s) => s.durationSec < 45 * 60 && s.focus);
    const fl = avgFocus(long);
    const fs = avgFocus(short);
    if (fl && fs && long.length >= 3 && short.length >= 3 && Math.abs(fl - fs) >= 0.4) {
      tips.push(
        fl > fs
          ? `U delších bloků (45+ min) máš vyšší soustředění (${fl.toFixed(1)} vs ${fs.toFixed(1)}). Zkus Dlouhé Pomodoro nebo Flowtime.`
          : `U kratších bloků máš vyšší soustředění (${fs.toFixed(1)} vs ${fl.toFixed(1)}). Klasické Pomodoro ti asi sedí víc.`,
      );
    }
    const late = filtered.filter((s) => new Date(s.start).getHours() >= 22);
    if (late.length / filtered.length > 0.3) {
      tips.push('Víc než 30 % učení máš po 22. hodině. Spánek je klíčový pro ukládání do paměti – zkus část přesunout dřív.');
    }
    const days = new Set(filtered.map((s) => dayKey(s.start)));
    const maxDay = Math.max(...byDay(filtered).values());
    if (days.size <= 3 && maxDay > 4 * 3600) {
      tips.push('Učení máš nahuštěné do pár dní. Rozložené opakování vede k výrazně lepšímu dlouhodobému zapamatování než „nárazovka“.');
    }
    const interrupted = filtered.filter((s) => s.interruptions > 0);
    if (interrupted.length / filtered.length > 0.5) {
      tips.push('Ve více než polovině bloků tě něco vyrušilo. Zkus mobil do jiné místnosti a vypnout notifikace.');
    }
  }
  if (!tips.length) return null;
  return (
    <div className="stack tight">
      {tips.map((t) => (
        <div className="callout" key={t}>
          <Lightbulb size={15} />
          <span>{t}</span>
        </div>
      ))}
    </div>
  );
}
