import { useMemo } from 'react';
import { AppData, alive } from '../../data/schema';
import { DAY, addDays, dayKey, fmtDuration, fmtTime, startOfDay, startOfWeek, WEEKDAYS_SHORT } from '../../lib/time';
import { byDay } from '../../lib/stats';

/** Měsíční přehled: plán, zkoušky a odučený čas po dnech. Klik na den otevře jeho týden. */
export function MonthView({
  data,
  monthStart,
  onOpenDay,
}: {
  data: AppData;
  monthStart: number;
  onOpenDay: (day: number) => void;
}) {
  const ms = new Date(monthStart);
  const gridStart = startOfWeek(monthStart);
  const monthEnd = new Date(ms.getFullYear(), ms.getMonth() + 1, 1).getTime();
  const weeks = Math.ceil((monthEnd - gridStart) / (7 * DAY) - 0.01);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
  const today = startOfDay(Date.now());

  const studied = useMemo(() => byDay(alive(data.sessions)), [data.sessions]);
  const blocksByDay = useMemo(() => {
    const m = new Map<string, typeof data.planBlocks>();
    for (const b of alive(data.planBlocks)) {
      const k = dayKey(b.start);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(b);
    }
    for (const list of m.values()) list.sort((a, b) => a.start - b.start);
    return m;
  }, [data.planBlocks]);
  const examsByDay = useMemo(() => {
    const m = new Map<string, typeof data.exams>();
    for (const e of alive(data.exams)) {
      if (!m.has(e.date)) m.set(e.date, []);
      m.get(e.date)!.push(e);
    }
    return m;
  }, [data.exams]);
  const subj = useMemo(() => new Map(data.subjects.map((s) => [s.id, s])), [data.subjects]);
  const maxStudied = Math.max(3600, ...days.map((d) => studied.get(dayKey(d)) ?? 0));

  return (
    <div className="month-scroll">
      <div className="month">
        {WEEKDAYS_SHORT.map((w) => (
          <div key={w} className="month-wd label">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const k = dayKey(d);
          const inMonth = new Date(d).getMonth() === ms.getMonth();
          const blocks = blocksByDay.get(k) ?? [];
          const exams = examsByDay.get(k) ?? [];
          const sec = studied.get(k) ?? 0;
          return (
            <button
              key={d}
              className={`month-cell ${inMonth ? '' : 'out'} ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}`}
              onClick={() => onOpenDay(d)}
            >
              <div className="month-top">
                <span className="num month-dn">{new Date(d).getDate()}</span>
                {sec > 0 && <span className="num month-sec">{fmtDuration(sec, { short: true })}</span>}
              </div>
              {sec > 0 && (
                <span className="month-bar">
                  <i style={{ width: `${Math.min(1, sec / maxStudied) * 100}%` }} />
                </span>
              )}
              {exams.map((e) => (
                <span key={e.id} className="month-exam ellipsis" style={{ borderColor: subj.get(e.subjectId)?.color }}>
                  {e.name}
                </span>
              ))}
              {blocks.slice(0, 3).map((b) => (
                <span key={b.id} className={`month-block ellipsis ${b.done ? 'done' : ''}`}>
                  <i style={{ background: subj.get(b.subjectId)?.color }} />
                  <span className="num">{fmtTime(b.start)}</span> {subj.get(b.subjectId)?.name}
                </span>
              ))}
              {blocks.length > 3 && <span className="month-more">+{blocks.length - 3} další</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
