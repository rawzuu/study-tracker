import { useMemo, useState } from 'react';
import { BookOpen, FileSpreadsheet, Pencil, Plus, Trash2 } from 'lucide-react';
import { sessionsToCsv } from '../../lib/csv';
import { downloadFile } from '../planner/ics';
import { applyStudy, ctxFrom, findTopic, newTopic } from '../topics/schedule';
import { matchPlanBlocks } from '../planner/match';
import { useStore } from '../../data/store';
import { Session, alive, uid } from '../../data/schema';
import { Empty, Field, Modal } from '../../components/ui';
import { useRemoveWithUndo } from '../../components/undo';
import { capitalize, dayKey, fmtDayLabel, fmtDuration, fmtTime, fromLocalInput, toLocalInput } from '../../lib/time';
import { totalSec } from '../../lib/stats';
import { SubjectSelect, SubjectTag } from '../subjects/SubjectSelect';
import { modeName } from '../timer/modes';
import { FOCUS_LABELS } from '../timer/FocusRating';

export function SessionModal({ session, initialStart, onClose }: { session?: Session; initialStart?: number; onClose: () => void }) {
  const { upsert, upsertMany } = useStore();
  const removeWithUndo = useRemoveWithUndo();
  const defEnd = session?.end ?? Date.now();
  const [subjectId, setSubjectId] = useState(session?.subjectId ?? '');
  const [topic, setTopic] = useState(session?.topic ?? '');
  const [start, setStart] = useState(toLocalInput(session?.start ?? initialStart ?? defEnd - 50 * 60_000));
  const [minutes, setMinutes] = useState(session ? Math.round(session.durationSec / 60) : 50);
  const [focus, setFocus] = useState<number>(session?.focus ?? 0);
  const [note, setNote] = useState(session?.note ?? '');

  const { data } = useStore();
  const save = () => {
    if (!subjectId || minutes <= 0) return;
    const s = fromLocalInput(start);
    // Nové ruční sezení s tématem posune i plán opakování tématu.
    let topicId = session?.topicId;
    const tName = topic.trim();
    if (!session && tName) {
      const base = findTopic(data.topics, subjectId, tName) ?? newTopic(subjectId, tName);
      const next = applyStudy(base, s + minutes * 60_000, 'ok', ctxFrom(data), { auto: true });
      upsert('topics', next);
      topicId = next.id;
    }
    const durationSec = minutes * 60;
    // U časovačových sezení zachováme skutečný konec (včetně pauz), pokud se nezměnil začátek.
    const end = session && session.start === s ? Math.max(session.end, s + durationSec * 1000) : s + durationSec * 1000;
    upsert('sessions', {
      ...(session ?? { id: uid(), mode: 'manual', interruptions: 0 }),
      subjectId,
      topic: topic.trim(),
      start: s,
      end,
      durationSec,
      focus: focus || undefined,
      note: note.trim(),
      topicId,
    } as Session);
    // Odpovídající naplánované bloky se automaticky odškrtnou.
    if (!session) {
      const matched = matchPlanBlocks(data.planBlocks, subjectId, s, end);
      if (matched.length) upsertMany('planBlocks', matched.map((b) => ({ ...b, done: true })));
    }
    onClose();
  };

  return (
    <Modal
      title={session ? 'Upravit sezení' : 'Zapsat sezení ručně'}
      onClose={onClose}
      footer={
        <>
          {session && (
            <button
              className="btn danger left"
              onClick={() => {
                if (confirm('Opravdu smazat toto sezení?')) {
                  removeWithUndo('sessions', session.id, 'Sezení smazáno');
                  onClose();
                }
              }}
            >
              <Trash2 size={15} /> Smazat
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={!subjectId || minutes <= 0}>
            Uložit
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Předmět">
          <SubjectSelect value={subjectId} onChange={setSubjectId} />
        </Field>
        <Field label="Téma">
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} />
        </Field>
        <div className="grid cols-2" style={{ gap: 10 }}>
          <Field label="Začátek">
            <input className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Čistý čas (min)">
            <input className="input" type="number" min={1} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Soustředění">
          <select className="input" value={focus} onChange={(e) => setFocus(Number(e.target.value))}>
            <option value={0}>Nehodnoceno</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} – {FOCUS_LABELS[n]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Poznámka">
          <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function HistoryPage() {
  const { data } = useStore();
  const [subjectId, setSubjectId] = useState('');
  const [editing, setEditing] = useState<Session | 'new' | null>(null);
  const [limit, setLimit] = useState(30);

  const groups = useMemo(() => {
    const list = alive(data.sessions)
      .filter((s) => !subjectId || s.subjectId === subjectId)
      .sort((a, b) => b.start - a.start);
    const map = new Map<string, Session[]>();
    for (const s of list) {
      const k = dayKey(s.start);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return [...map.entries()];
  }, [data.sessions, subjectId]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Historie</h1>
        </div>
        <div className="row wrap">
          <div style={{ width: 220 }}>
            <SubjectSelect value={subjectId} onChange={setSubjectId} allowAll />
          </div>
          <button
            className="btn"
            onClick={() => downloadFile(`study-tracker-sezeni-${dayKey(Date.now())}.csv`, sessionsToCsv(data.sessions, data.subjects, data.presets), 'text/csv;charset=utf-8')}
          >
            <FileSpreadsheet size={14} /> CSV
          </button>
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Plus size={15} /> Ruční zápis
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="card">
          <Empty icon={<BookOpen size={28} />} title="Žádná sezení" />
        </div>
      ) : (
        groups.slice(0, limit).map(([day, list]) => (
          <div className="card" key={day}>
            <div className="card-head">
              <h2>{capitalize(fmtDayLabel(list[0].start))}</h2>
              <span className="chip num">{fmtDuration(totalSec(list))}</span>
            </div>
            <div className="list">
              {list.map((s) => (
                <div className="list-item" key={s.id}>
                  <span className="num small muted" style={{ width: 92, flexShrink: 0 }}>
                    {fmtTime(s.start)}–{fmtTime(s.end)}
                  </span>
                  <div className="grow">
                    <SubjectTag id={s.subjectId} />
                    <div className="small faint">
                      {[s.topic, modeName(s.mode, data.presets), s.interruptions ? `${s.interruptions}× vyrušení` : '', s.note]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    {s.recall && <div className="recall small">{s.recall}</div>}
                  </div>
                  {s.focus && <span className="chip">{s.focus}/5</span>}
                  <span className="num" style={{ fontWeight: 600, minWidth: 64, textAlign: 'right' }}>
                    {fmtDuration(s.durationSec)}
                  </span>
                  <button className="btn ghost icon sm" onClick={() => setEditing(s)} aria-label="Upravit">
                    <Pencil size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      {groups.length > limit && (
        <button className="btn" onClick={() => setLimit(limit + 30)}>
          Načíst starší
        </button>
      )}

      {editing && <SessionModal session={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
