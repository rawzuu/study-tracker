import { useMemo, useState } from 'react';
import { BookOpen, Check, FileSpreadsheet, Pencil, Plus, Trash2 } from 'lucide-react';
import { sessionsToCsv } from '../../lib/csv';
import { downloadFile } from '../planner/ics';
import { applyStudy, ctxFrom, findTopic, newTopic } from '../topics/schedule';
import { matchPlanBlocks } from '../planner/match';
import { useStore } from '../../data/store';
import { PlanBlock, Session, alive, uid } from '../../data/schema';
import { Empty, Field, Modal } from '../../components/ui';
import { useRemoveWithUndo } from '../../components/undo';
import { capitalize, dayKey, fmtDayLabel, fmtDuration, fmtTime, fromLocalInput, toLocalInput } from '../../lib/time';
import { totalSec } from '../../lib/stats';
import { blockTopic, blockTopics } from '../../lib/blockTopic';
import { SubjectSelect, SubjectTag } from '../subjects/SubjectSelect';
import { modeName } from '../timer/modes';
import { FOCUS_LABELS } from '../timer/FocusRating';

/** Předvyplnění z naplánovaného bloku: kdy začal a kolik z něj mohlo do teď proběhnout. */
function fromBlock(b: PlanBlock, now = Date.now()): { start: number; minutes: number } {
  if (b.start >= now) return { start: now - b.durationMin * 60_000, minutes: b.durationMin }; // hotovo dřív, než blok začal
  return { start: b.start, minutes: Math.max(1, Math.min(b.durationMin, Math.round((now - b.start) / 60_000))) };
}

export function SessionModal({
  session,
  initialStart,
  planBlock,
  onClose,
}: {
  session?: Session;
  initialStart?: number;
  /** Zápis z bloku plánu („Hotovo“): předvyplní se z něj a po uložení se blok odškrtne. */
  planBlock?: PlanBlock;
  onClose: () => void;
}) {
  const { upsert, upsertMany } = useStore();
  const removeWithUndo = useRemoveWithUndo();
  const defEnd = session?.end ?? Date.now();
  const pre = planBlock && !session ? fromBlock(planBlock) : null;
  const [subjectId, setSubjectId] = useState(session?.subjectId ?? planBlock?.subjectId ?? '');
  const [topic, setTopic] = useState(session?.topic ?? (planBlock ? blockTopic(planBlock.title) : ''));
  const [start, setStart] = useState(toLocalInput(session?.start ?? pre?.start ?? initialStart ?? defEnd - 50 * 60_000));
  const [minutes, setMinutes] = useState(session ? Math.round(session.durationSec / 60) : (pre?.minutes ?? 50));
  const [focus, setFocus] = useState<number>(session?.focus ?? 0);
  // Vygenerovaný název bloku („Po přednášce: …“) se nehodí jako téma – zůstane aspoň v poznámce.
  const [note, setNote] = useState(session?.note ?? (planBlock && blockTopic(planBlock.title) !== planBlock.title.trim() ? planBlock.title : ''));

  const { data } = useStore();
  // Blok „Opakování: A, B, C“: ostatní existující témata se zapíšou jako zopakovaná (jde odškrtnout).
  const [dropped, setDropped] = useState<Set<string>>(() => new Set());
  const extras =
    planBlock && !session && data.settings.multiTopicReview !== false
      ? blockTopics(planBlock.title)
          .slice(1)
          .map((n) => findTopic(data.topics, subjectId, n))
          .filter((t, i, all): t is NonNullable<typeof t> => !!t && !t.mastered && t.name.toLocaleLowerCase('cs') !== topic.trim().toLocaleLowerCase('cs') && all.findIndex((x) => x?.id === t.id) === i)
      : [];
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
    for (const x of extras) if (!dropped.has(x.id)) upsert('topics', applyStudy(x, s + minutes * 60_000, 'ok', ctxFrom(data), { auto: true }));
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
    // Odpovídající naplánované bloky se automaticky odškrtnou (a blok, ze kterého se zapisuje, vždy).
    if (!session) {
      const matched = matchPlanBlocks(data.planBlocks, subjectId, s, end).filter((b) => b.id !== planBlock?.id);
      const own = planBlock ? data.planBlocks.filter((b) => b.id === planBlock.id && !b.done) : [];
      if (matched.length || own.length) upsertMany('planBlocks', [...own, ...matched].map((b) => ({ ...b, done: true })));
    }
    onClose();
  };

  return (
    <Modal
      title={session ? 'Upravit sezení' : planBlock ? 'Zapsat odučený blok' : 'Zapsat sezení ručně'}
      onClose={onClose}
      footer={
        <>
          {planBlock && !session && (
            <button
              className="btn left"
              onClick={() => {
                upsert('planBlocks', { ...planBlock, done: true });
                onClose();
              }}
            >
              <Check size={15} /> Jen odškrtnout
            </button>
          )}
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
        {planBlock && !session && <p className="muted small" style={{ margin: 0 }}>Čas se započítá do přehledu a statistik. Pokud učení trvalo jinak dlouho, uprav minuty.</p>}
        <Field label="Předmět">
          <SubjectSelect value={subjectId} onChange={setSubjectId} />
        </Field>
        <Field label="Téma">
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} />
        </Field>
        {extras.length > 0 && (
          <div className="stack tight">
            <span className="label">Další zopakovaná témata z bloku</span>
            {extras.map((x) => (
              <label key={x.id} className="row extra-topic">
                <input
                  type="checkbox"
                  checked={!dropped.has(x.id)}
                  onChange={(e) =>
                    setDropped((cur) => {
                      const next = new Set(cur);
                      if (e.target.checked) next.delete(x.id);
                      else next.add(x.id);
                      return next;
                    })
                  }
                />
                <span>{x.name}</span>
              </label>
            ))}
          </div>
        )}
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
