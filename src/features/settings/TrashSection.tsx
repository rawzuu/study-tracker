import { useMemo, useState } from 'react';
import { ArchiveRestore } from 'lucide-react';
import { useStore } from '../../data/store';
import { useToast } from '../../components/ui';
import { TRASH_DAYS, TRASH_LABEL, trashItems } from '../../lib/trash';
import { fmtDayLabel, fmtTime } from '../../lib/time';

/** Koš – smazané položky za posledních 30 dní jde vrátit jedním klikem. */
export function TrashSection() {
  const { data, restore } = useStore();
  const toast = useToast();
  const [all, setAll] = useState(false);
  const items = useMemo(() => trashItems(data), [data]);
  const shown = all ? items : items.slice(0, 6);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Koš</h2>
        <span className="sub">{items.length ? `${items.length} za ${TRASH_DAYS} dní` : `posledních ${TRASH_DAYS} dní`}</span>
      </div>
      {items.length === 0 ? (
        <p className="small faint">Prázdný. Smazané sezení, téma, zkoušku nebo předmět tu najdeš ještě {TRASH_DAYS} dní.</p>
      ) : (
        <div className="list trash-list">
          {shown.map((it) => (
            <div className="list-item" key={`${it.key}-${it.id}`}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis">
                  <span className="label">{TRASH_LABEL[it.key]}</span> <b>{it.title}</b>
                </div>
                <div className="small faint ellipsis">
                  {it.detail ? `${it.detail} · ` : ''}smazáno {fmtDayLabel(it.deletedAt).toLowerCase()} {fmtTime(it.deletedAt)}
                </div>
              </div>
              <button
                className="btn sm"
                onClick={() => {
                  restore(it.key, it.id);
                  toast(`Obnoveno: ${it.title}`);
                }}
              >
                <ArchiveRestore size={14} /> Obnovit
              </button>
            </div>
          ))}
          {items.length > shown.length && (
            <button className="btn ghost sm" onClick={() => setAll(true)}>
              Zobrazit vše ({items.length})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
