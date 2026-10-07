import { PointerEvent as RPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus, ChevronLeft, ChevronRight, Download, GraduationCap, Plus } from 'lucide-react';
import { useStore } from '../../data/store';
import { Exam, PlanBlock, alive } from '../../data/schema';
import { Bar, Empty } from '../../components/ui';
import { addDays, dayKey, fmtDate, fmtDuration, fmtTime, parseDayKey, plural, startOfDay, startOfWeek, WEEKDAYS_SHORT } from '../../lib/time';
import { bySubject, inRange } from '../../lib/stats';
import { SubjectTag } from '../subjects/SubjectSelect';
import { BlockModal, ExamModal, ExportModal } from './PlannerModals';
import './planner.css';

const HOUR_FROM = 6;
const HOUR_TO = 24;
const HOUR_H = 46;
const SNAP_MIN = 15;

type ModalState =
  | { kind: 'block'; block?: PlanBlock; start?: number }
  | { kind: 'exam'; exam?: Exam }
  | { kind: 'export' }
  | null;

/** Rozložení překrývajících se bloků do sloupců. */
function layoutDay(blocks: PlanBlock[]): Map<string, { lane: number; lanes: number }> {
  const out = new Map<string, { lane: number; lanes: number }>();
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  let cluster: PlanBlock[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    for (const b of cluster) out.get(b.id)!.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const b of sorted) {
    const end = b.start + b.durationMin * 60_000;
    if (b.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((e) => e <= b.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else laneEnds[lane] = end;
    out.set(b.id, { lane, lanes: 1 });
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return out;
}

export function PlannerPage() {
  const { data, upsert } = useStore();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(Date.now()));
  const [modal, setModal] = useState<ModalState>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; dayDelta: number; minDelta: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollXRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Posuň pohled na aktuální hodinu
  useEffect(() => {
    const h = new Date().getHours();
    scrollRef.current?.scrollTo({ top: Math.max(0, (h - HOUR_FROM - 2) * HOUR_H) });
    // Na úzké obrazovce posuň týden vodorovně na dnešek
    const x = scrollXRef.current;
    if (x && x.scrollWidth > x.clientWidth) {
      const idx = Math.round((startOfDay(Date.now()) - startOfWeek(Date.now())) / 86_400_000);
      x.scrollLeft = Math.max(0, 52 + idx * ((x.scrollWidth - 52) / 7) - 60);
    }
  }, []);

  const weekEnd = addDays(weekStart, 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const blocks = useMemo(
    () => alive(data.planBlocks).filter((b) => b.start >= weekStart && b.start < weekEnd),
    [data.planBlocks, weekStart, weekEnd],
  );
  const exams = alive(data.exams);
  const weekSessions = inRange(alive(data.sessions), weekStart, weekEnd);
  const studied = bySubject(weekSessions);

  // Plán vs realita podle předmětů
  const planned = new Map<string, number>();
  for (const b of blocks) planned.set(b.subjectId, (planned.get(b.subjectId) ?? 0) + b.durationMin * 60);
  const subjectsInWeek = alive(data.subjects).filter(
    (s) => planned.has(s.id) || studied.has(s.id) || (s.weeklyGoalMin > 0 && !s.archived),
  );

  const colWidth = () => {
    const g = gridRef.current;
    if (!g) return 100;
    return (g.getBoundingClientRect().width - 52) / 7;
  };

  const onGridClick = (e: React.MouseEvent<HTMLDivElement>, day: number) => {
    if ((e.target as HTMLElement).closest('.pblock')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const mins = Math.floor(((y / HOUR_H) * 60) / 30) * 30 + HOUR_FROM * 60;
    setModal({ kind: 'block', start: day + mins * 60_000 });
  };

  const onBlockDown = (e: RPointerEvent<HTMLDivElement>, b: PlanBlock) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const cw = colWidth();
    let moved = false;
    let last = { dayDelta: 0, minDelta: 0 };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      last = {
        dayDelta: Math.round(dx / cw),
        minDelta: Math.round(((dy / HOUR_H) * 60) / SNAP_MIN) * SNAP_MIN,
      };
      setDrag({ id: b.id, dx, dy, ...last });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag(null);
      if (!moved) {
        setModal({ kind: 'block', block: b });
        return;
      }
      if (last.dayDelta || last.minDelta) {
        upsert('planBlocks', { ...b, start: addDays(b.start, last.dayDelta) + last.minDelta * 60_000 });
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const isThisWeek = weekStart === startOfWeek(now);
  const totalPlanned = blocks.reduce((a, b) => a + b.durationMin * 60, 0);
  const totalDone = blocks.filter((b) => b.done).reduce((a, b) => a + b.durationMin * 60, 0);
  const upcomingExams = exams
    .filter((e) => parseDayKey(e.date).getTime() >= startOfDay(now))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Plánovač</h1>
          <p>Klikni do kalendáře pro nový blok, bloky přesouvej tažením.</p>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={() => setModal({ kind: 'export' })}>
            <Download size={15} /> Do kalendáře
          </button>
          <button className="btn" onClick={() => setModal({ kind: 'exam' })}>
            <GraduationCap size={15} /> Zkouška
          </button>
          <button className="btn primary" onClick={() => setModal({ kind: 'block', start: Math.max(now, weekStart + 9 * 3600_000) })}>
            <Plus size={16} /> Blok
          </button>
        </div>
      </div>

      <div className="card planner-card">
        <div className="row between" style={{ marginBottom: 12 }}>
          <div className="row">
            <button className="btn icon sm" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Předchozí týden">
              <ChevronLeft size={17} />
            </button>
            <button className="btn icon sm" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Další týden">
              <ChevronRight size={17} />
            </button>
            <h2 style={{ marginLeft: 6 }}>
              {fmtDate(weekStart, { day: 'numeric', month: 'long' })} – {fmtDate(addDays(weekStart, 6), { day: 'numeric', month: 'long' })}
            </h2>
            {!isThisWeek && (
              <button className="btn ghost sm" onClick={() => setWeekStart(startOfWeek(Date.now()))}>
                Dnes
              </button>
            )}
          </div>
          <span className="small muted num">
            Naplánováno {fmtDuration(totalPlanned, { short: true })} · hotovo {fmtDuration(totalDone, { short: true })}
          </span>
        </div>

        <div className="week-scroll-x" ref={scrollXRef}>
          <div className="week" ref={gridRef}>
            <div className="week-head">
              <div />
              {days.map((d, i) => {
                const dayExams = exams.filter((e) => e.date === dayKey(d));
                const isToday = d === startOfDay(now);
                return (
                  <div key={d} className={`week-day-head ${isToday ? 'today' : ''}`}>
                    <span className="wd">{WEEKDAYS_SHORT[i]}</span>
                    <span className="dn">{new Date(d).getDate()}</span>
                    {dayExams.map((e) => {
                      const s = data.subjects.find((x) => x.id === e.subjectId);
                      return (
                        <button key={e.id} className="exam-pill" style={{ borderColor: s?.color }} onClick={() => setModal({ kind: 'exam', exam: e })} title={e.name}>
                          🎓 {e.name}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="week-body" ref={scrollRef}>
              <div className="week-inner" style={{ height: (HOUR_TO - HOUR_FROM) * HOUR_H }}>
                <div className="hours">
                  {Array.from({ length: HOUR_TO - HOUR_FROM }, (_, i) => (
                    <div key={i} className="hour-label" style={{ top: i * HOUR_H }}>
                      {HOUR_FROM + i}:00
                    </div>
                  ))}
                </div>
                {days.map((d) => {
                  const dayBlocks = blocks.filter((b) => startOfDay(b.start) === d);
                  const lay = layoutDay(dayBlocks);
                  const isToday = d === startOfDay(now);
                  return (
                    <div key={d} className={`day-col ${isToday ? 'today' : ''}`} onClick={(e) => onGridClick(e, d)}>
                      {Array.from({ length: HOUR_TO - HOUR_FROM }, (_, i) => (
                        <div key={i} className="hour-line" style={{ top: i * HOUR_H }} />
                      ))}
                      {isToday && (
                        <div className="now-line" style={{ top: ((now - d) / 3600_000 - HOUR_FROM) * HOUR_H }} />
                      )}
                      {dayBlocks.map((b) => {
                        const s = data.subjects.find((x) => x.id === b.subjectId);
                        const startMin = (b.start - d) / 60_000 - HOUR_FROM * 60;
                        const { lane, lanes } = lay.get(b.id)!;
                        const dragging = drag?.id === b.id;
                        const color = s?.color ?? '#888';
                        return (
                          <div
                            key={b.id}
                            className={`pblock ${b.done ? 'done' : ''} ${dragging ? 'dragging' : ''}`}
                            style={{
                              top: (startMin / 60) * HOUR_H,
                              height: Math.max(20, (b.durationMin / 60) * HOUR_H - 2),
                              left: `calc(${(lane / lanes) * 100}% + 2px)`,
                              width: `calc(${100 / lanes}% - 4px)`,
                              ['--c' as string]: color,
                              transform: dragging ? `translate(${drag.dayDelta * colWidth()}px, ${(drag.minDelta / 60) * HOUR_H}px)` : undefined,
                            }}
                            onPointerDown={(e) => onBlockDown(e, b)}
                          >
                            <b>{s?.name ?? '?'}</b>
                            {b.durationMin >= 40 && <span>{b.title || `${b.durationMin} min`}</span>}
                            {b.durationMin >= 60 && (
                              <span className="t">
                                {dragging
                                  ? fmtTime(addDays(b.start, drag.dayDelta) + drag.minDelta * 60_000)
                                  : `${fmtTime(b.start)}–${fmtTime(b.start + b.durationMin * 60_000)}`}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <h2>Plán vs. realita</h2>
            <span className="sub">{isThisWeek ? 'tento týden' : 'vybraný týden'}</span>
          </div>
          {subjectsInWeek.length === 0 ? (
            <Empty icon={<CalendarPlus size={26} />} title="Tento týden zatím nic">
              <span className="small">Naplánuj bloky nebo si nastav týdenní cíle u předmětů.</span>
            </Empty>
          ) : (
            <div className="stack">
              {subjectsInWeek.map((s) => {
                const p = planned.get(s.id) ?? 0;
                const st = studied.get(s.id) ?? 0;
                const goal = s.weeklyGoalMin * 60;
                const target = Math.max(p, goal);
                return (
                  <div key={s.id} className="stack tight">
                    <div className="row between small">
                      <SubjectTag id={s.id} />
                      <span className="num muted">
                        {fmtDuration(st, { short: true })} odučeno · plán {fmtDuration(p, { short: true })}
                        {goal ? ` · cíl ${fmtDuration(goal, { short: true })}` : ''}
                      </span>
                    </div>
                    <Bar value={target ? st / target : st ? 1 : 0} color={s.color} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Zkoušky</h2>
            <button className="btn ghost sm" onClick={() => setModal({ kind: 'exam' })}>
              <Plus size={14} /> Přidat
            </button>
          </div>
          {upcomingExams.length === 0 ? (
            <Empty icon={<GraduationCap size={26} />} title="Žádné nadcházející zkoušky">
              <span className="small">Přidej zkoušku a nech si naplánovat rozložené opakování.</span>
            </Empty>
          ) : (
            <div className="list">
              {upcomingExams.map((e) => {
                const d = Math.round((parseDayKey(e.date).getTime() - startOfDay(now)) / 86_400_000);
                const reviews = alive(data.planBlocks).filter((b) => b.examId === e.id);
                const doneR = reviews.filter((b) => b.done).length;
                return (
                  <button key={e.id} className="list-item exam-row" onClick={() => setModal({ kind: 'exam', exam: e })}>
                    <div className="grow" style={{ textAlign: 'left' }}>
                      <b>{e.name}</b>
                      <div className="small muted row" style={{ gap: 8 }}>
                        <SubjectTag id={e.subjectId} />
                        <span>
                          · {parseDayKey(e.date).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long' })}
                          {e.time && ` ${e.time}`}
                        </span>
                      </div>
                      {reviews.length > 0 && <div className="small faint">Opakování {doneR}/{reviews.length}</div>}
                    </div>
                    <span className={`chip ${d <= 3 ? 'bad' : d <= 10 ? 'warn' : ''}`}>
                      {d === 0 ? 'dnes' : `za ${d} ${plural(d, 'den', 'dny', 'dní')}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {modal?.kind === 'block' && <BlockModal block={modal.block} initialStart={modal.start} onClose={() => setModal(null)} />}
      {modal?.kind === 'exam' && <ExamModal exam={modal.exam} onClose={() => setModal(null)} />}
      {modal?.kind === 'export' && <ExportModal onClose={() => setModal(null)} />}
    </div>
  );
}
