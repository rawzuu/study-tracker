import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useStore } from '../../data/store';
import { SUBJECT_COLORS, alive, uid } from '../../data/schema';

/** Výběr předmětu s možností rovnou přidat nový. */
export function SubjectSelect({
  value,
  onChange,
  disabled,
  allowAll,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  allowAll?: boolean;
}) {
  const { data, upsert } = useStore();
  const subjects = alive(data.subjects).filter((s) => !s.archived || s.id === value);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const add = () => {
    const n = name.trim();
    if (!n) return;
    const id = uid();
    const used = new Set(alive(data.subjects).map((s) => s.color));
    const color = SUBJECT_COLORS.find((c) => !used.has(c)) ?? SUBJECT_COLORS[data.subjects.length % SUBJECT_COLORS.length];
    upsert('subjects', { id, name: n, color, weeklyGoalMin: 0, archived: false });
    onChange(id);
    setName('');
    setAdding(false);
  };

  if (adding) {
    return (
      <div className="row">
        <input
          className="input"
          autoFocus
          placeholder="Název předmětu"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
            if (e.key === 'Escape') setAdding(false);
          }}
        />
        <button className="btn primary" onClick={add} type="button">
          Přidat
        </button>
        <button className="btn ghost" onClick={() => setAdding(false)} type="button">
          Zrušit
        </button>
      </div>
    );
  }

  return (
    <div className="row">
      <select className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {allowAll ? <option value="">Všechny předměty</option> : <option value="">— vyber předmět —</option>}
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {!allowAll && (
        <button className="btn icon" title="Nový předmět" onClick={() => setAdding(true)} disabled={disabled} type="button">
          <Plus size={17} />
        </button>
      )}
    </div>
  );
}

export function SubjectTag({ id }: { id: string }) {
  const { data } = useStore();
  const s = data.subjects.find((x) => x.id === id);
  return (
    <span className="row" style={{ gap: 7, minWidth: 0 }}>
      <span className="dot" style={{ background: s?.color ?? 'var(--text-faint)' }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s?.name ?? 'Smazaný předmět'}</span>
    </span>
  );
}
