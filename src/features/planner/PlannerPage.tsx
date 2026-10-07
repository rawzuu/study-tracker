import { PointerEvent as RPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus, CalendarRange, Check, ChevronLeft, ChevronRight, Download, GraduationCap, PenLine, Plus } from 'lucide-react';
import { DayPlanModal } from '../dayplan/DayPlanModal';
import { useStore } from '../../data/store';
import { Exam, PlanBlock, Session, alive } from '../../data/schema';
import { Bar, Empty, Modal, Segmented } from '../../components/ui';
import { MonthView } from './MonthView';
import { DAY, HOUR, MIN, addDays, dayKey, fmtDate, fmtDuration, fmtTime, parseDayKey, plural, startOfDay, startOfMonth, startOfWeek, WEEKDAYS_SHORT } from '../../lib/time';
import { bySubject, inRange } from '../../lib/stats';
import { SubjectTag } from '../subjects/SubjectSelect';
import { SessionModal } from '../sessions/HistoryPage';
import { useTimer } from '../timer/TimerContext';
import { BlockModal, ExamModal, ExportModal } from './PlannerModals';
import './planner.css';

const DEFAULT_HOUR_FROM = 6; // mřížka začíná v 6:00, pokud nemáš nic dřív (např. učení po půlnoci)
const HOUR_TO = 24;
const HOUR_H = 48;
const SNAP_MIN = 15;

type Layer = 'all' | 'plan' | 'done';

type ModalState =
  | { kind: 'block'; block?: PlanBlock; start?: number }
  | { kind: 'session'; session?: Session; start?: number }
  | { kind: 'choose'; start: number }
  | { kind: 'exam'; exam?: Exam }
  | { kind: 'export' }
  | null;

/** Položka kalendáře: plán (obrys), odučené sezení (plná barva) nebo právě běžící blok. */
interface CalItem {
  kind: 'plan' | 'done' | 'live';
  id: string;
  subjectId: string;
  start: number;
  end: number;
  title: string;
  block?: PlanBlock;
  session?: Session;
}

function shiftMonth(t: number, n: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
}

/** Rozložení překrývajících se položek do sloupců. */
function layoutDay(items: CalItem[]): Map<string, { lane: number; lanes: number }> {
  const out = new Map<string, { lane: number; lanes: number }>();
  const sorted = [...items].sort((a, b) => a.start - b.start || (a.kind === 'plan' ? -1 : 1));
  let cluster: CalItem[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    for (const b of cluster) out.get(b.id)!.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const b of sorted) {
    const end = Math.max(b.end, b.start + 20 * MIN);
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
  const timer = useTimer();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(Date.now()));
  const [view, setView] = useState<'week' | 'month'>('week');
  const [layer, setLayer] = useState<Layer>('all');
  const [monthStart, setMonthStart] = useState(() => startOfMonth(Date.now()));
  const [modal, setModal] = useState<ModalState>(null);
  const [dayPlan, setDayPlan] = useState(false);
  const [drag, setDrag] = useState<{ id: string; dayDelta: number; minDelta: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollXRef = useRef<HTMLDivElement>(null);
  const subj = useMemo(() => new Map(data.subjects.map((s) => [s.id, s])), [data.subjects]);

  const liveRunning = timer.state.phase === 'work' && (timer.state.status === 'running' || timer.state.status === 'paused');
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), liveRunning ? 15_000 : 60_000);
    return () => window.clearInterval(id);
  }, [liveRunning]);

  // Posuň pohled na aktuální hodinu; na úzké obrazovce i vodorovně na dnešek
  useEffect(() => {
    const h = new Date().getHours();
    scrollRef.current?.scrollTo({ top: Math.max(0, (h - hourFrom - 3) * HOUR_H) });
    const x = scrollXRef.current;
    if (x && x.scrollWidth > x.clientWidth) {
      const idx = Math.round((startOfDay(Date.now()) - startOfWeek(Date.now())) / DAY);
      x.scrollLeft = Math.max(0, 52 + idx * ((x.scrollWidth - 52) / 7) - 60);
    }
  }, [view]);

  const weekEnd = addDays(weekStart, 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const blocks = useMemo(() => alive(data.planBlocks).filter((b) => b.start >= weekStart && b.start < weekEnd), [data.planBlocks, weekStart, weekEnd]);
  const weekSessions = useMemo(() => inRange(alive(data.sessions), weekStart, weekEnd), [data.sessions, weekStart, weekEnd]);
  const exams = alive(data.exams);

  const items = useMemo<CalItem[]>(() => {
    const out: CalItem[] = [];
    if (layer !== 'done')
      for (const b of blocks)
        out.push({ kind: 'plan', id: `p-${b.id}`, subjectId: b.subjectId, start: b.start, end: b.start + b.durationMin * MIN, title: b.title, block: b });
    if (layer !== 'plan') {
      for (const s of weekSessions) out.push({ kind: 'done', id: `s-${s.id}`, subjectId: s.subjectId, start: s.start, end: s.end, title: s.topic, session: s });
      const ws = timer.state.workStartedAt;
      if (liveRunning && ws && ws >= weekStart && ws < weekEnd) {
        out.push({ kind: 'live', id: 'live', subjectId: timer.state.subjectId, start: ws, end: Math.max(now, ws + 10 * MIN), title: timer.state.topic });
      }
    }
    return out;
  }, [blocks, weekSessions, layer, liveRunning, timer.state.workStartedAt, timer.state.subjectId, timer.state.topic, now, weekStart, weekEnd]);

  const hourFrom = Math.min(DEFAULT_HOUR_FROM, ...items.map((it) => new Date(it.start).getHours()));

  const studied = bySubject(weekSessions);
  const planned = new Map<string, number>();
  for (const b of blocks) planned.set(b.subjectId, (planned.get(b.subjectId) ?? 0) + b.durationMin * 60);
  const subjectsInWeek = alive(data.subjects).filter((s) => planned.has(s.id) || studied.has(s.id) || (s.weeklyGoalMin > 0 && !s.archived));
  const legend = [...studied.entries()].sort((a, b) => b[1] - a[1]);

  const colWidth = () => {
    const g = gridRef.current;
    return g ? (g.getBoundingClientRect().width - 52) / 7 : 100;
  };

  const onGridClick = (e: React.MouseEvent<HTMLDivElement>, day: number) => {
    if ((e.target as HTMLElement).closest('.cal-item')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mins = Math.floor((((e.clientY - rect.top) / HOUR_H) * 60) / 30) * 30 + hourFrom * 60;
    const start = day + mins * MIN;
    if (layer === 'plan') setModal({ kind: 'block', start });
    else if (layer === 'done') setModal({ kind: 'session', start });
    else setModal({ kind: 'choose', start });
  };

  const onPlanDown = (e: RPointerEvent<HTMLDivElement>, b: PlanBlock) => {
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
      last = { dayDelta: Math.round(dx / cw), minDelta: Math.round(((dy / HOUR_H) * 60) / SNAP_MIN) * SNAP_MIN };
      setDrag({ id: b.id, ...last });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag(null);
      if (!moved) return setModal({ kind: 'block', block: b });
      if (last.dayDelta || last.minDelta) upsert('planBlocks', { ...b, start: addDays(b.start, last.dayDelta) + last.minDelta * MIN });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const isThisWeek = weekStart === startOfWeek(now);
  const weekStudied = weekSessions.reduce((a, s) => a + s.durationSec, 0);
  const weekPlanned = blocks.reduce((a, b) => a + b.durationMin * 60, 0);
  const upcomingExams = exams.filter((e) => parseDayKey(e.date).getTime() >= startOfDay(now)).sort((a, b) => a.date.localeCompare(b.date));
  const today = startOfDay(now);

  return (
    <div className="stack loose">
      <div className="page-head">
        <div>
          <h1>Kalendář</h1>
          <p>Plná barva = odučeno (z časovače se zapisuje samo), obrys = plán. Klikni do prázdna pro nový záznam, plán přesouvej tažením.</p>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={() => setDayPlan(true)}>
            <CalendarRange size={14} /> Naplánovat den
          </button>
          <button className="btn" onClick={() => setModal({ kind: 'export' })}>
            <Download size={14} /> Do kalendáře
          </button>
          <button className="btn" onClick={() => setModal({ kind: 'exam' })}>
            <GraduationCap size={14} /> Zkouška
          </button>
          <button className="btn" onClick={() => setModal({ kind: 'session', start: now - HOUR })}>
            <PenLine size={14} /> Zapsat odučené
          </button>
          <button className="btn primary" onClick={() => setModal({ kind: 'block', start: Math.max(now, weekStart + 9 * HOUR) })}>
            <Plus size={15} /> Naplánovat
          </button>
        </div>
      </div>

      <div className="card planner-card">
        <div className="card-head cal-head">
          <div className="row">
            <button className="btn icon sm" onClick={() => (view === 'week' ? setWeekStart(addDays(weekStart, -7)) : setMonthStart(shiftMonth(monthStart, -1)))} aria-label="Předchozí">
              <ChevronLeft size={16} />
            </button>
            <button className="btn icon sm" onClick={() => (view === 'week' ? setWeekStart(addDays(weekStart, 7)) : setMonthStart(shiftMonth(monthStart, 1)))} aria-label="Další">
              <ChevronRight size={16} />
            </button>
            <h2 style={{ marginLeft: 4 }}>
              {view === 'week'
                ? `${fmtDate(weekStart, { day: 'numeric', month: 'long' })} – ${fmtDate(addDays(weekStart, 6), { day: 'numeric', month: 'long' })}`
                : new Date(monthStart).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })}
            </h2>
            {(view === 'week' ? !isThisWeek : monthStart !== startOfMonth(now)) && (
              <button
                className="btn ghost sm"
                onClick={() => {
                  setWeekStart(startOfWeek(Date.now()));
                  setMonthStart(startOfMonth(Date.now()));
                }}
              >
                Dnes
              </button>
            )}
          </div>
          <div className="row wrap">
            {view === 'week' && (
              <span className="sub num hide-sm">
                odučeno {fmtDuration(weekStudied, { short: true })} · plán {fmtDuration(weekPlanned, { short: true })}
              </span>
            )}
            <Segmented<Layer>
              value={layer}
              onChange={setLayer}
              options={[
                { value: 'all', label: 'Vše' },
                { value: 'done', label: 'Odučeno' },
                { value: 'plan', label: 'Plán' },
              ]}
            />
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'week', label: 'Týden' },
                { value: 'month', label: 'Měsíc' },
              ]}
            />
          </div>
        </div>

        {view === 'month' ? (
          <MonthView
            data={data}
            monthStart={monthStart}
            layer={layer}
            onOpenDay={(d) => {
              setWeekStart(startOfWeek(d));
              setView('week');
            }}
          />
        ) : (
          <>
            <div className="week-scroll-x" ref={scrollXRef}>
              <div className="week" ref={gridRef}>
                <div className="week-head">
                  <div />
                  {days.map((d, i) => {
                    const dayExams = exams.filter((e) => e.date === dayKey(d));
                    const daySessions = weekSessions.filter((s) => startOfDay(s.start) === d);
                    const daySec = daySessions.reduce((a, s) => a + s.durationSec, 0);
                    const perSubj = bySubject(daySessions);
                    return (
                      <div key={d} className={`week-day-head ${d === today ? 'today' : ''}`}>
                        <span className="wd">{WEEKDAYS_SHORT[i]}</span>
                        <span className="dn">{new Date(d).getDate()}</span>
                        <span className="day-sum num">{daySec ? fmtDuration(daySec, { short: true }) : ' '}</span>
                        <span className="day-mix">
                          {[...perSubj.entries()].map(([id, sec]) => (
                            <i key={id} style={{ flexGrow: sec, background: subj.get(id)?.color }} />
                          ))}
                        </span>
                        {dayExams.map((e) => (
                          <button key={e.id} className="exam-pill" style={{ borderColor: subj.get(e.subjectId)?.color }} onClick={() => setModal({ kind: 'exam', exam: e })} title={e.name}>
                            {e.name}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
                <div className="week-body" ref={scrollRef}>
                  <div className="week-inner" style={{ height: (HOUR_TO - hourFrom) * HOUR_H }}>
                    <div className="hours">
                      {Array.from({ length: HOUR_TO - hourFrom }, (_, i) => (
                        <div key={i} className="hour-label" style={{ top: i * HOUR_H }}>
                          {hourFrom + i}:00
                        </div>
                      ))}
                    </div>
                    {days.map((d) => {
                      const dayItems = items.filter((it) => startOfDay(it.start) === d);
                      const lay = layoutDay(dayItems);
                      return (
                        <div key={d} className={`day-col ${d === today ? 'today' : ''}`} onClick={(e) => onGridClick(e, d)}>
                          {Array.from({ length: HOUR_TO - hourFrom }, (_, i) => (
                            <div key={i} className="hour-line" style={{ top: i * HOUR_H }} />
                          ))}
                          {d === today && <div className="now-line" style={{ top: ((now - d) / HOUR - hourFrom) * HOUR_H }} />}
                          {dayItems.map((it) => {
                            const s = subj.get(it.subjectId);
                            const startMin = (it.start - d) / MIN - hourFrom * 60;
                            const durMin = Math.max(1, (it.end - it.start) / MIN);
                            const { lane, lanes } = lay.get(it.id)!;
                            const dragging = it.block && drag?.id === it.block.id;
                            const h = Math.max(20, (durMin / 60) * HOUR_H - 2);
                            const style = {
                              top: (startMin / 60) * HOUR_H,
                              height: h,
                              left: `calc(${(lane / lanes) * 100}% + 2px)`,
                              width: `calc(${100 / lanes}% - 4px)`,
                              ['--c' as string]: s?.color ?? '#888',
                              transform: dragging ? `translate(${drag!.dayDelta * colWidth()}px, ${(drag!.minDelta / 60) * HOUR_H}px)` : undefined,
                            };
                            const timeLabel = `${fmtTime(it.start)}–${fmtTime(it.end)}`;
                            if (it.kind === 'plan') {
                              const b = it.block!;
                              return (
                                <div
                                  key={it.id}
                                  className={`cal-item cal-plan ${b.done ? 'done' : ''} ${dragging ? 'dragging' : ''}`}
                                  style={style}
                                  onPointerDown={(e) => onPlanDown(e, b)}
                                  title={`Plán: ${s?.name ?? ''} ${it.title} ${timeLabel}`}
                                >
                                  <b>
                                    {b.done && <Check size={11} strokeWidth={3} />} {s?.name ?? '?'}
                                  </b>
                                  {h >= 34 && <span>{it.title || 'plán'}</span>}
                                  {h >= 50 && (
                                    <span className="t">
                                      {dragging ? fmtTime(addDays(b.start, drag!.dayDelta) + drag!.minDelta * MIN) : timeLabel}
                                    </span>
                                  )}
                                </div>
                              );
                            }
                            return (
                              <div
                                key={it.id}
                                className={`cal-item cal-done ${it.kind === 'live' ? 'live' : ''}`}
                                style={style}
                                onClick={() => it.session && setModal({ kind: 'session', session: it.session })}
                                title={`${it.kind === 'live' ? 'Právě probíhá' : 'Odučeno'}: ${s?.name ?? ''}${it.title ? ' – ' + it.title : ''} · ${timeLabel}${it.session ? ' · ' + fmtDuration(it.session.durationSec) : ''}`}
                              >
                                <b>{s?.name ?? '?'}</b>
                                {h >= 34 && <span>{it.kind === 'live' ? 'právě teď' : it.title || fmtDuration(it.session!.durationSec, { short: true })}</span>}
                                {h >= 50 && <span className="t">{timeLabel}</span>}
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
            <div className="cal-legend">
              <span className="legend-key">
                <i className="k-done" /> odučeno
              </span>
              <span className="legend-key">
                <i className="k-plan" /> plán
              </span>
              <span className="legend-sep" />
              {legend.length === 0 ? (
                <span className="faint small">Tento týden zatím nic odučeno.</span>
              ) : (
                legend.map(([id, sec]) => (
                  <span key={id} className="legend-subj">
                    <i style={{ background: subj.get(id)?.color }} />
                    {subj.get(id)?.name ?? '?'} <span className="num faint">{fmtDuration(sec, { short: true })}</span>
                  </span>
                ))
              )}
            </div>
          </>
        )}
      </div>

      <div className="g12">
        <div className="card c-6">
          <div className="card-head">
            <h2>Plán vs. realita</h2>
            <span className="sub">{isThisWeek ? 'tento týden' : 'vybraný týden'}</span>
          </div>
          {subjectsInWeek.length === 0 ? (
            <Empty icon={<CalendarPlus size={24} strokeWidth={1.5} />} title="Tento týden zatím nic">
              <span className="small">Naplánuj bloky nebo si nastav týdenní cíle u předmětů.</span>
            </Empty>
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              {subjectsInWeek.map((s) => {
                const p = planned.get(s.id) ?? 0;
                const st = studied.get(s.id) ?? 0;
                const goal = s.weeklyGoalMin * 60;
                const target = Math.max(p, goal);
                return (
                  <div key={s.id} className="stack tight">
                    <div className="row between small">
                      <SubjectTag id={s.id} />
                      <span className="num faint">
                        <span style={{ color: 'var(--text)' }}>{fmtDuration(st, { short: true })}</span> odučeno · plán {fmtDuration(p, { short: true })}
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

        <div className="card c-6">
          <div className="card-head">
            <h2>Zkoušky</h2>
            <button className="btn ghost sm" onClick={() => setModal({ kind: 'exam' })}>
              <Plus size={14} /> Přidat
            </button>
          </div>
          {upcomingExams.length === 0 ? (
            <Empty icon={<GraduationCap size={24} strokeWidth={1.5} />} title="Žádné nadcházející zkoušky">
              <span className="small">Přidej zkoušku a nech si naplánovat rozložené opakování.</span>
            </Empty>
          ) : (
            <div className="list">
              {upcomingExams.map((e) => {
                const dd = Math.round((parseDayKey(e.date).getTime() - today) / DAY);
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
                    <span className={`chip ${dd <= 3 ? 'bad' : dd <= 10 ? 'warn' : ''}`}>{dd === 0 ? 'dnes' : `za ${dd} ${plural(dd, 'den', 'dny', 'dní')}`}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {modal?.kind === 'choose' && (
        <Modal title={`${new Date(modal.start).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'numeric' })} · ${fmtTime(modal.start)}`} onClose={() => setModal(null)}>
          <div className="choose">
            <button className="choose-opt" onClick={() => setModal({ kind: 'block', start: modal.start })}>
              <span className="k-plan big" />
              <b>Naplánovat</b>
              <span className="small faint">Záměr – blok učení do plánu</span>
            </button>
            <button className="choose-opt" onClick={() => setModal({ kind: 'session', start: modal.start })}>
              <span className="k-done big" />
              <b>Zapsat odučené</b>
              <span className="small faint">Učení bez spuštěného časovače</span>
            </button>
          </div>
        </Modal>
      )}
      {modal?.kind === 'block' && <BlockModal block={modal.block} initialStart={modal.start} onClose={() => setModal(null)} />}
      {modal?.kind === 'session' && <SessionModal session={modal.session} initialStart={modal.start} onClose={() => setModal(null)} />}
      {modal?.kind === 'exam' && <ExamModal exam={modal.exam} onClose={() => setModal(null)} />}
      {modal?.kind === 'export' && <ExportModal onClose={() => setModal(null)} />}
      {dayPlan && <DayPlanModal onClose={() => setDayPlan(false)} />}
    </div>
  );
}
