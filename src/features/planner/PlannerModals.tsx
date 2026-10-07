import { useMemo, useState } from 'react';
import { CalendarCheck, Check, Download, Play, Sparkles, Trash2 } from 'lucide-react';
import { useStore } from '../../data/store';
import { Exam, PlanBlock, alive, uid } from '../../data/schema';
import { Field, Modal, Switch, useToast } from '../../components/ui';
import { addDays, dayKey, fmtDayLabel, parseDayKey, startOfDay, toTimeInput } from '../../lib/time';
import { navigate } from '../../lib/router';
import { SubjectSelect } from '../subjects/SubjectSelect';
import { useTimer } from '../timer/TimerContext';
import { buildIcs, downloadFile } from './ics';
import { reviewDays } from './spaced';

function combine(date: string, time: string): number {
  const d = parseDayKey(date);
  const [h, m] = time.split(':').map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}

// ============================================================
// Blok plánu
// ============================================================
export function BlockModal({ block, initialStart, onClose }: { block?: PlanBlock; initialStart?: number; onClose: () => void }) {
  const { upsert, upsertMany, remove } = useStore();
  const timer = useTimer();
  const toast = useToast();
  const start0 = block?.start ?? initialStart ?? Date.now();
  const [subjectId, setSubjectId] = useState(block?.subjectId ?? '');
  const [title, setTitle] = useState(block?.title ?? '');
  const [date, setDate] = useState(dayKey(start0));
  const [time, setTime] = useState(toTimeInput(start0));
  const [duration, setDuration] = useState(block?.durationMin ?? 50);
  const [note, setNote] = useState(block?.note ?? '');
  const [repeat, setRepeat] = useState(1);

  const save = () => {
    if (!subjectId) return;
    const start = combine(date, time);
    if (block) {
      upsert('planBlocks', { ...block, subjectId, title: title.trim(), start, durationMin: duration, note: note.trim() });
    } else {
      upsertMany(
        'planBlocks',
        Array.from({ length: repeat }, (_, i) => ({
          id: uid(),
          subjectId,
          title: title.trim(),
          start: addDays(start, i * 7),
          durationMin: duration,
          done: false,
          note: note.trim(),
        })),
      );
      if (repeat > 1) toast(`Přidáno ${repeat} bloků`);
    }
    onClose();
  };

  return (
    <Modal
      title={block ? 'Upravit blok' : 'Nový blok učení'}
      onClose={onClose}
      footer={
        <>
          {block && (
            <button
              className="btn danger left"
              onClick={() => {
                remove('planBlocks', block.id);
                onClose();
              }}
            >
              <Trash2 size={15} /> Smazat
            </button>
          )}
          {block && !block.done && timer.state.status === 'idle' && (
            <button
              className="btn"
              onClick={() => {
                timer.configure({ subjectId: block.subjectId, topic: block.title, planBlockId: block.id });
                navigate('casovac');
                onClose();
              }}
            >
              <Play size={14} fill="currentColor" /> Spustit
            </button>
          )}
          {block && (
            <button
              className="btn"
              onClick={() => {
                upsert('planBlocks', { ...block, done: !block.done });
                onClose();
              }}
            >
              <Check size={15} /> {block.done ? 'Nehotovo' : 'Hotovo'}
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={!subjectId}>
            Uložit
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Předmět">
          <SubjectSelect value={subjectId} onChange={setSubjectId} />
        </Field>
        <Field label="Co budeš dělat">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="např. Procvičit integrály, kap. 5" />
        </Field>
        <div className="grid cols-3" style={{ gap: 10 }}>
          <Field label="Datum">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Začátek">
            <input className="input" type="time" value={time} step={300} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Délka (min)">
            <input className="input" type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(Math.max(5, Number(e.target.value)))} />
          </Field>
        </div>
        {!block && (
          <Field label="Opakovat každý týden" hint="Vytvoří stejný blok i v dalších týdnech.">
            <select className="input" value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
              <option value={1}>Neopakovat</option>
              {[2, 4, 8, 12, 16].map((n) => (
                <option key={n} value={n}>
                  {n} týdnů
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Poznámka">
          <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ============================================================
// Zkouška + rozložené opakování
// ============================================================
export function ExamModal({ exam, onClose }: { exam?: Exam; onClose: () => void }) {
  const { data, upsert, upsertMany, remove, update } = useStore();
  const toast = useToast();
  const [subjectId, setSubjectId] = useState(exam?.subjectId ?? '');
  const [name, setName] = useState(exam?.name ?? '');
  const [date, setDate] = useState(exam?.date ?? dayKey(addDays(Date.now(), 14)));
  const [time, setTime] = useState(exam?.time ?? '');
  const [note, setNote] = useState(exam?.note ?? '');
  const [generate, setGenerate] = useState(!exam);
  const [revTime, setRevTime] = useState('17:00');
  const [revDuration, setRevDuration] = useState(45);
  const [skipWeekends, setSkipWeekends] = useState(false);

  const slots = useMemo(() => (date ? reviewDays(date, { skipWeekends }) : []), [date, skipWeekends]);
  const existing = exam ? alive(data.planBlocks).filter((b) => b.examId === exam.id && !b.done && b.start >= Date.now()) : [];

  const save = () => {
    if (!subjectId || !name.trim() || !date) return;
    const id = exam?.id ?? uid();
    upsert('exams', { ...(exam ?? {}), id, subjectId, name: name.trim(), date, time, note: note.trim() });
    if (generate && slots.length) {
      // Smaž dříve vygenerované budoucí nedokončené bloky, aby nevznikly duplicity.
      const now = Date.now();
      update((d) => ({
        ...d,
        planBlocks: d.planBlocks.map((b) =>
          b.examId === id && !b.done && !b.deletedAt && b.start >= now ? { ...b, deletedAt: now, updatedAt: now } : b,
        ),
      }));
      upsertMany(
        'planBlocks',
        slots.map((s) => ({
          id: uid(),
          subjectId,
          title: `Opakování: ${name.trim()} (−${s.daysBefore} d)`,
          start: combine(dayKey(s.day), revTime),
          durationMin: revDuration,
          done: false,
          examId: id,
          note: 'Zkus si nejdřív vybavit z hlavy (retrieval practice), až pak se podívej do materiálů.',
        })),
      );
      toast(`Naplánováno ${slots.length} opakování`);
    }
    onClose();
  };

  return (
    <Modal
      wide
      title={exam ? 'Upravit zkoušku' : 'Nová zkouška'}
      onClose={onClose}
      footer={
        <>
          {exam && (
            <button
              className="btn danger left"
              onClick={() => {
                remove('exams', exam.id);
                const now = Date.now();
                update((d) => ({
                  ...d,
                  planBlocks: d.planBlocks.map((b) =>
                    b.examId === exam.id && !b.done && !b.deletedAt && b.start >= now ? { ...b, deletedAt: now, updatedAt: now } : b,
                  ),
                }));
                onClose();
              }}
            >
              <Trash2 size={15} /> Smazat
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={!subjectId || !name.trim() || !date}>
            Uložit
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="grid cols-2" style={{ gap: 10 }}>
          <Field label="Předmět">
            <SubjectSelect value={subjectId} onChange={setSubjectId} />
          </Field>
          <Field label="Název">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Zápočtový test, zkouška…" />
          </Field>
          <Field label="Datum">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Čas (volitelné)">
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Poznámka">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Místnost, rozsah látky…" />
        </Field>

        <div className="card" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
          <div className="row between">
            <div>
              <b className="row" style={{ gap: 6 }}>
                <Sparkles size={15} color="var(--accent)" /> Rozložené opakování
              </b>
              <p className="small muted">
                Naplánuje opakování s rozšiřujícími se rozestupy (spacing effect, Cepeda et al. 2008). Hustěji těsně před
                zkouškou, řidčeji dál od ní.
              </p>
            </div>
            <Switch checked={generate} onChange={setGenerate} label="Generovat opakování" />
          </div>
          {generate && (
            <div className="stack" style={{ marginTop: 14 }}>
              <div className="grid cols-3" style={{ gap: 10 }}>
                <Field label="Čas opakování">
                  <input className="input" type="time" value={revTime} onChange={(e) => setRevTime(e.target.value)} />
                </Field>
                <Field label="Délka (min)">
                  <input className="input" type="number" min={10} step={5} value={revDuration} onChange={(e) => setRevDuration(Math.max(10, Number(e.target.value)))} />
                </Field>
                <label className="field">
                  <span>Bez víkendů</span>
                  <div style={{ height: 38, display: 'flex', alignItems: 'center' }}>
                    <Switch checked={skipWeekends} onChange={setSkipWeekends} />
                  </div>
                </label>
              </div>
              {slots.length === 0 ? (
                <p className="small faint">Zkouška je moc blízko nebo v minulosti – není kam opakování naplánovat.</p>
              ) : (
                <div className="row wrap" style={{ gap: 6 }}>
                  {slots.map((s) => (
                    <span key={s.day} className="chip accent">
                      {new Date(s.day).toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' })} · −{s.daysBefore} d
                    </span>
                  ))}
                </div>
              )}
              {existing.length > 0 && (
                <p className="small faint">{existing.length} dříve vygenerovaných budoucích opakování se nahradí novými.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// Export do kalendáře
// ============================================================
export function ExportModal({ onClose }: { onClose: () => void }) {
  const { data } = useStore();
  const [range, setRange] = useState<'4' | '12' | 'all'>('4');
  const [exams, setExams] = useState(true);
  const [done, setDone] = useState(false);
  const [alarm, setAlarm] = useState<string>('10');

  const from = startOfDay(Date.now());
  const to = range === 'all' ? Infinity : addDays(from, Number(range) * 7);
  const blocks = alive(data.planBlocks).filter((b) => b.start >= from && b.start < to && (done || !b.done));
  const examList = exams ? alive(data.exams).filter((e) => parseDayKey(e.date).getTime() >= from) : [];

  const doExport = () => {
    const ics = buildIcs({
      blocks,
      exams: examList,
      subjects: data.subjects,
      alarmMin: alarm === 'none' ? null : Number(alarm),
    });
    downloadFile(`studijni-plan-${dayKey(Date.now())}.ics`, ics, 'text/calendar;charset=utf-8');
    onClose();
  };

  return (
    <Modal
      title="Export do Apple Kalendáře"
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={doExport} disabled={!blocks.length && !examList.length}>
          <Download size={15} /> Stáhnout .ics ({blocks.length + examList.length})
        </button>
      }
    >
      <div className="stack">
        <div className="callout">
          <CalendarCheck size={16} />
          <span>
            Stáhne se soubor <code>.ics</code>. Na Macu ho otevři dvojklikem, na iPhonu klepni na stažený soubor a zvol{' '}
            <i>Přidat vše</i>. Doporučuju vytvořit v Kalendáři samostatný kalendář „Učení“. Opakovaný import aktualizuje stejné
            události (mají stálé ID).
          </span>
        </div>
        <Field label="Období">
          <select className="input" value={range} onChange={(e) => setRange(e.target.value as '4' | '12' | 'all')}>
            <option value="4">Příští 4 týdny</option>
            <option value="12">Příštích 12 týdnů</option>
            <option value="all">Vše od dneška</option>
          </select>
        </Field>
        <Field label="Připomenutí před blokem">
          <select className="input" value={alarm} onChange={(e) => setAlarm(e.target.value)}>
            <option value="none">Bez připomenutí</option>
            <option value="5">5 minut</option>
            <option value="10">10 minut</option>
            <option value="15">15 minut</option>
            <option value="30">30 minut</option>
          </select>
        </Field>
        <div className="setting-row">
          <span className="label">Zahrnout zkoušky</span>
          <Switch checked={exams} onChange={setExams} />
        </div>
        <div className="setting-row">
          <span className="label">Zahrnout hotové bloky</span>
          <Switch checked={done} onChange={setDone} />
        </div>
        <p className="small faint">
          {blocks.length} bloků{examList.length ? ` a ${examList.length} zkoušek` : ''}
          {blocks.length ? `, první ${fmtDayLabel(Math.min(...blocks.map((b) => b.start))).toLowerCase()}` : ''}.
        </p>
      </div>
    </Modal>
  );
}
