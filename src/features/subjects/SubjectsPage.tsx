import { useState } from 'react';
import { Archive, ArchiveRestore, BookMarked, Pencil, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../../data/store';
import { SUBJECT_COLORS, Subject, alive, uid } from '../../data/schema';
import { Empty, Field, Modal } from '../../components/ui';
import { useRemoveWithUndo } from '../../components/undo';
import { fmtDuration } from '../../lib/time';
import { bySubject } from '../../lib/stats';

function SubjectModal({ subject, onClose }: { subject?: Subject; onClose: () => void }) {
  const { data, upsert } = useStore();
  const removeWithUndo = useRemoveWithUndo();
  const used = new Set(alive(data.subjects).map((s) => s.color));
  const [name, setName] = useState(subject?.name ?? '');
  const [color, setColor] = useState(subject?.color ?? SUBJECT_COLORS.find((c) => !used.has(c)) ?? SUBJECT_COLORS[0]);
  const [goalH, setGoalH] = useState(subject ? subject.weeklyGoalMin / 60 : 0);
  const sessions = subject ? alive(data.sessions).filter((s) => s.subjectId === subject.id).length : 0;

  const save = () => {
    if (!name.trim()) return;
    upsert('subjects', {
      ...(subject ?? { id: uid(), archived: false }),
      name: name.trim(),
      color,
      weeklyGoalMin: Math.round(goalH * 60),
    } as Subject);
    onClose();
  };

  return (
    <Modal
      title={subject ? 'Upravit předmět' : 'Nový předmět'}
      onClose={onClose}
      footer={
        <>
          {subject && sessions === 0 && (
            <button
              className="btn danger left"
              onClick={() => {
                removeWithUndo('subjects', subject.id, 'Předmět smazán');
                onClose();
              }}
            >
              <Trash2 size={15} /> Smazat
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={!name.trim()}>
            Uložit
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Název">
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </Field>
        <Field label="Barva">
          <div className="row wrap" style={{ gap: 8 }}>
            {SUBJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  background: c,
                  border: color === c ? '2px solid var(--text)' : '2px solid transparent',
                  outline: color === c ? '2px solid var(--surface)' : 'none',
                  outlineOffset: -4,
                  cursor: 'pointer',
                }}
              />
            ))}
            <input className="input" type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Vlastní barva" />
          </div>
        </Field>
        <Field label="Týdenní cíl (hodiny)" hint="0 = bez cíle. Zobrazí se na přehledu a v kalendáři.">
          <input className="input" type="number" min={0} step={0.5} value={goalH} onChange={(e) => setGoalH(Math.max(0, Number(e.target.value)))} />
        </Field>
        {subject && sessions > 0 && (
          <p className="small faint">
            Předmět má {sessions} sezení, proto ho nejde smazat – můžeš ho ale archivovat. Data ve statistikách zůstanou.
          </p>
        )}
      </div>
    </Modal>
  );
}

export function SubjectsPage() {
  const { data, upsert } = useStore();
  const [editing, setEditing] = useState<Subject | 'new' | null>(null);
  const subjects = alive(data.subjects);
  const totals = bySubject(alive(data.sessions));
  const active = subjects.filter((s) => !s.archived);
  const archived = subjects.filter((s) => s.archived);

  const row = (s: Subject) => (
    <div className="list-item" key={s.id}>
      <span style={{ width: 14, height: 14, borderRadius: 5, background: s.color, flexShrink: 0 }} />
      <div className="grow">
        <b>{s.name}</b>
        <div className="small faint">
          Celkem {fmtDuration(totals.get(s.id) ?? 0)}
          {s.weeklyGoalMin > 0 && ` · cíl ${fmtDuration(s.weeklyGoalMin * 60)} týdně`}
        </div>
      </div>
      <button className="btn ghost icon sm" title={s.archived ? 'Obnovit' : 'Archivovat'} onClick={() => upsert('subjects', { ...s, archived: !s.archived })}>
        {s.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
      </button>
      <button className="btn ghost icon sm" onClick={() => setEditing(s)} aria-label="Upravit">
        <Pencil size={15} />
      </button>
    </div>
  );

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Předměty</h1>
          <p>Barvy, týdenní cíle a archiv.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Plus size={16} /> Nový předmět
        </button>
      </div>
      <div className="card">
        {active.length === 0 ? (
          <Empty icon={<BookMarked size={28} />} title="Zatím žádné předměty">
            <button className="btn primary sm" onClick={() => setEditing('new')}>
              Přidat první předmět
            </button>
          </Empty>
        ) : (
          <div className="list">{active.map(row)}</div>
        )}
      </div>
      {archived.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Archiv</h2>
          </div>
          <div className="list">{archived.map(row)}</div>
        </div>
      )}
      {editing && <SubjectModal subject={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
