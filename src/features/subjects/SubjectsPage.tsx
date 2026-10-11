import { useState } from 'react';
import { Archive, ArchiveRestore, BookMarked, Pencil, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../../data/store';
import { SUBJECT_COLORS, Subject, alive, uid } from '../../data/schema';
import { Empty, Field, Modal, useToast } from '../../components/ui';
import { useRemoveWithUndo } from '../../components/undo';
import { fmtDuration, plural } from '../../lib/time';
import { removeSubjectWithPlans } from '../../lib/trash';
import { bySubject } from '../../lib/stats';

function SubjectModal({ subject, onClose }: { subject?: Subject; onClose: () => void }) {
  const { data, upsert, update, restore } = useStore();
  const removeWithUndo = useRemoveWithUndo();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const used = new Set(alive(data.subjects).map((s) => s.color));
  const [name, setName] = useState(subject?.name ?? '');
  const [color, setColor] = useState(subject?.color ?? SUBJECT_COLORS.find((c) => !used.has(c)) ?? SUBJECT_COLORS[0]);
  const [goalH, setGoalH] = useState(subject ? subject.weeklyGoalMin / 60 : 0);
  const sessions = subject ? alive(data.sessions).filter((s) => s.subjectId === subject.id).length : 0;
  // Co k předmětu patří v plánu – při smazání se nabídne smazat i to, jinak by v kalendáři zůstalo viset.
  const owned = subject
    ? {
        blocks: alive(data.planBlocks).filter((b) => b.subjectId === subject.id).length,
        exams: alive(data.exams).filter((e) => e.subjectId === subject.id).length,
        topics: alive(data.topics).filter((t) => t.subjectId === subject.id).length,
      }
    : { blocks: 0, exams: 0, topics: 0 };
  const ownedParts = [
    owned.blocks && `${owned.blocks} ${plural(owned.blocks, 'blok', 'bloky', 'bloků')} v plánu`,
    owned.exams && `${owned.exams} ${plural(owned.exams, 'zkouška', 'zkoušky', 'zkoušek')}`,
    owned.topics && `${owned.topics} ${plural(owned.topics, 'téma', 'témata', 'témat')}`,
  ].filter(Boolean) as string[];
  const ownedText = ownedParts.length > 1 ? `${ownedParts.slice(0, -1).join(', ')} a ${ownedParts[ownedParts.length - 1]}` : (ownedParts[0] ?? '');
  const deleteAll = () => {
    if (!subject) return;
    update((d) => removeSubjectWithPlans(d, subject.id));
    toast(`Předmět smazán i s plánem`, { label: 'Vrátit', onClick: () => restore('subjects', subject.id) });
    onClose();
  };
  // Předmět se stejným názvem už existuje – druhý by rozdělil statistiky na dvě půlky.
  const duplicate = alive(data.subjects).find((s) => s.id !== subject?.id && s.name.trim().toLocaleLowerCase('cs') === name.trim().toLocaleLowerCase('cs'));

  const save = () => {
    if (!name.trim() || duplicate) return;
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
          {subject && sessions === 0 && !confirmDelete && (
            <button
              className="btn danger left"
              onClick={() => {
                if (ownedText) return setConfirmDelete(true);
                removeWithUndo('subjects', subject.id, 'Předmět smazán');
                onClose();
              }}
            >
              <Trash2 size={15} /> Smazat
            </button>
          )}
          {subject && confirmDelete && (
            <>
              <button className="btn danger left" onClick={deleteAll}>
                <Trash2 size={15} /> Smazat i plán
              </button>
              <button
                className="btn"
                onClick={() => {
                  removeWithUndo('subjects', subject.id, 'Předmět smazán');
                  onClose();
                }}
              >
                Jen předmět
              </button>
            </>
          )}
          {!confirmDelete && (
            <button className="btn primary" onClick={save} disabled={!name.trim() || !!duplicate}>
              Uložit
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        {confirmDelete && (
          <div className="callout">
            <span>
              K předmětu patří {ownedText}. Smazat i je, nebo jen předmět? Obojí jde vrátit tlačítkem Vrátit nebo z Koše v Nastavení.
            </span>
          </div>
        )}
        <Field label="Název" hint={duplicate ? `Předmět „${duplicate.name}“ už existuje${duplicate.archived ? ' (v archivu)' : ''}.` : undefined}>
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
