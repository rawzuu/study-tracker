import { useState } from 'react';
import { useStore } from '../../data/store';
import { Modal } from '../../components/ui';
import { fmtDuration } from '../../lib/time';
import { SubjectTag } from '../subjects/SubjectSelect';
import { useTimer } from './TimerContext';

export const FOCUS_LABELS = ['', 'Rozptýlený', 'Spíš slabé', 'V pohodě', 'Soustředěný', 'Hluboký flow'];
const FOCUS_EMOJI = ['', '😵‍💫', '😕', '🙂', '🎯', '🔥'];

/** Po bloku práce se zeptá na hodnocení soustředění (1–5). */
export function FocusRatingModal() {
  const { pendingRating, clearRating } = useTimer();
  const { data, upsert } = useStore();
  const session = data.sessions.find((s) => s.id === pendingRating);
  const [focus, setFocus] = useState<number | null>(null);
  const [note, setNote] = useState('');

  if (!session) return null;

  const close = () => {
    setFocus(null);
    setNote('');
    clearRating();
  };
  const save = () => {
    upsert('sessions', { ...session, focus: focus ?? undefined, note: note.trim() || session.note });
    close();
  };

  return (
    <Modal
      title="Jak ses soustředil?"
      onClose={close}
      footer={
        <>
          <button className="btn ghost" onClick={close}>
            Přeskočit
          </button>
          <button className="btn primary" onClick={save} disabled={!focus && !note.trim()}>
            Uložit
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="row between muted small">
          <SubjectTag id={session.subjectId} />
          <span className="num">{fmtDuration(session.durationSec)}</span>
        </div>
        <div className="rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={focus === n ? 'on' : ''} onClick={() => setFocus(n)} type="button">
              <span className="emoji">{FOCUS_EMOJI[n]}</span>
              <span className="n">{n}</span>
              <span className="l">{FOCUS_LABELS[n]}</span>
            </button>
          ))}
        </div>
        <textarea
          className="input"
          placeholder="Poznámka (volitelné) – co šlo dobře, co ne…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}
