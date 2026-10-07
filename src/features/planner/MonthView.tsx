import { useMemo } from 'react';
import { Check } from 'lucide-react';
import { AppData, PlanBlock, Session, alive } from '../../data/schema';
import { DAY, addDays, dayKey, fmtDuration, fmtTime, startOfDay, startOfWeek, WEEKDAYS_SHORT } from '../../lib/time';

/** Měsíční přehled: odučeno po předmětech (barevně), plán a zkoušky. Klik na den otevře jeho týden. */
export function MonthView({
  data,
  monthStart,
  layer,
  onOpenDay,
}: {
  data: AppData;
  monthStart: number;
  layer: 'all' | 'plan' | 'done';
  onOpenDay: (day: number) => void;
}) {
  const ms = new Date(monthStart);
  const gridStart = startOfWeek(monthStart);
  const monthEnd = new Date(ms.getFullYear(), ms.getMonth() + 1, 1).getTime();
  const weeks = Math.ceil((monthEnd - gridStart) / (7 * DAY) - 0.01);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
  const today = startOfDay(Date.now());

  const group = <T,>(list: T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>();
    for (const x of list) {
      const k = key(x);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(x);
    }
    return m;
  };
  const sessionsByDay = useMemo(() => group<Session>(alive(data.sessions), (s) => dayKey(s.start)), [data.sessions]);
  const blocksByDay = useMemo(() => {
    const m = group<PlanBlock>(alive(data.planBlocks), (b) => dayKey(b.start));
    for (const l of m.values()) l.sort((a, b) => a.start - b.start);
    return m;
  }, [data.planBlocks]);
  const examsByDay = useMemo(() => group(alive(data.exams), (e) => e.date), [data.exams]);
  const subj = useMemo(() => new Map(data.subjects.map((s) => [s.id, s])), [data.subjects]);

  const dayTotals = days.map((d) => (sessionsByDay.get(dayKey(d)) ?? []).reduce((a, s) => a + s.durationSec, 0));
  const maxDay = Math.max(3600, ...dayTotals);

  return (
    <div className="month-scroll">
      <div className="month">
        {WEEKDAYS_SHORT.map((w) => (
          <div key={w} className="month-wd label">
            {w}
          </div>
        ))}
        {days.map((d, i) => {
          const k = dayKey(d);
          const inMonth = new Date(d).getMonth() === ms.getMonth();
          const sessions = layer === 'plan' ? [] : (sessionsByDay.get(k) ?? []);
          const blocks = layer === 'done' ? [] : (blocksByDay.get(k) ?? []);
          const exams = examsByDay.get(k) ?? [];
          const total = layer === 'plan' ? 0 : dayTotals[i];
          const perSubj = new Map<string, number>();
          for (const s of sessions) perSubj.set(s.subjectId, (perSubj.get(s.subjectId) ?? 0) + s.durationSec);
          const subjRows = [...perSubj.entries()].sort((a, b) => b[1] - a[1]);
          return (
            <button key={d} className={`month-cell ${inMonth ? '' : 'out'} ${d === today ? 'today' : ''}`} onClick={() => onOpenDay(d)}>
              <div className="month-top">
                <span className="num month-dn">{new Date(d).getDate()}</span>
                {total > 0 && <span className="num month-sec">{fmtDuration(total, { short: true })}</span>}
              </div>
              {total > 0 && (
                <span className="month-mix" style={{ width: `${Math.max(8, (total / maxDay) * 100)}%` }}>
                  {subjRows.map(([id, sec]) => (
                    <i key={id} style={{ flexGrow: sec, background: subj.get(id)?.color }} />
                  ))}
                </span>
              )}
              {exams.map((e) => (
                <span key={e.id} className="month-exam ellipsis" style={{ borderColor: subj.get(e.subjectId)?.color }}>
                  {e.name}
                </span>
              ))}
              {subjRows.slice(0, 3).map(([id, sec]) => (
                <span key={id} className="month-row ellipsis">
                  <i className="sq" style={{ background: subj.get(id)?.color }} />
                  {subj.get(id)?.name} <span className="num faint">{fmtDuration(sec, { short: true })}</span>
                </span>
              ))}
              {blocks
                .filter((b) => !(layer === 'all' && b.done))
                .slice(0, 3)
                .map((b) => (
                  <span key={b.id} className={`month-row plan ellipsis ${b.done ? 'done' : ''}`}>
                    <i className="ring" style={{ borderColor: subj.get(b.subjectId)?.color }} />
                    <span className="num faint">{fmtTime(b.start)}</span> {subj.get(b.subjectId)?.name}
                    {b.done && <Check size={10} />}
                  </span>
                ))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
