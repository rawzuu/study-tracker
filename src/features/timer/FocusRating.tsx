import { useState } from 'react';
import { useStore } from '../../data/store';
import { Modal } from '../../components/ui';
import { fmtDuration } from '../../lib/time';
import { SubjectTag } from '../subjects/SubjectSelect';
import { RATINGS, RATING_HINT, RATING_LABEL, RecallRating, applyStudy, ctxFrom, extraTopicSnapshots, topicSnapshots } from '../topics/schedule';
import { useTimer } from './TimerContext';

export const FOCUS_LABELS = ['', 'Rozptýlený', 'Spíš slabé', 'V pohodě', 'Soustředěný', 'Hluboký flow'];

/**
 * Po bloku práce: hodnocení soustředění, vybavení z hlavy (retrieval practice)
 * a u tématu i to, jak šlo vybavování – podle toho se upraví plán opakování.
 */
export function AfterBlockModal() {
  const { pendingRating, clearRating } = useTimer();
  const { data, upsert } = useStore();
  const session = data.sessions.find((s) => s.id === pendingRating);
  const [focus, setFocus] = useState<number | null>(null);
  const [recall, setRecall] = useState('');
  const [note, setNote] = useState('');
  const [difficulty, setDifficulty] = useState<RecallRating | null>(null);
  // Další témata z bloku „Opakování: A, B, C“ – zapsala se jako zopakovaná, odškrtnutím se vrátí.
  const [dropped, setDropped] = useState<Set<string>>(() => new Set());
  const extras = (pendingRating && extraTopicSnapshots.get(pendingRating)) || [];

  if (!session) return null;
  const { askFocusRating, askRecall } = data.settings;
  const topic = session.topicId ? data.topics.find((t) => t.id === session.topicId) : undefined;

  const close = () => {
    setFocus(null);
    setRecall('');
    setNote('');
    setDifficulty(null);
    setDropped(new Set());
    if (pendingRating) {
      topicSnapshots.delete(pendingRating);
      extraTopicSnapshots.delete(pendingRating);
    }
    clearRating();
  };

  const save = () => {
    upsert('sessions', {
      ...session,
      focus: focus ?? session.focus,
      recall: recall.trim() || session.recall,
      note: note.trim() || session.note,
    });
    // Plán opakování: při uložení sezení se počítalo s „Dobře“, tady ho případně opravíme.
    const snap = topicSnapshots.get(session.id);
    // i výslovné „Dobře“ se přepočítá – v historii se pak hodnocení nebere jako automatické
    if (topic && snap && difficulty) {
      upsert('topics', { ...applyStudy(snap, session.end, difficulty, ctxFrom(data)), id: topic.id, createdAt: topic.createdAt });
    }
    for (const x of extras) {
      if (!data.topics.some((t) => t.id === x.id && !t.deletedAt)) continue;
      if (dropped.has(x.id)) upsert('topics', { ...x }); // nestihlo se → stav před blokem, téma zůstane k opakování
      else if (difficulty) upsert('topics', { ...applyStudy(x, session.end, difficulty, ctxFrom(data)), id: x.id, createdAt: x.createdAt });
    }
    close();
  };

  const dirty = focus != null || recall.trim() || note.trim() || difficulty || dropped.size > 0;

  return (
    <Modal
      title="Blok dokončen"
      // Esc nebo klik vedle okna nesmí zahodit rozepsaný text – uloží se. Zahodit jde jen tlačítkem Přeskočit.
      onClose={dirty ? save : close}
      footer={
        <>
          <button className="btn ghost" onClick={close}>
            Přeskočit
          </button>
          <button className="btn primary" onClick={save} disabled={!dirty}>
            Uložit
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 18 }}>
        <div className="row between small">
          <span className="row" style={{ gap: 8 }}>
            <SubjectTag id={session.subjectId} />
            {session.topic && <span className="faint">· {session.topic}</span>}
          </span>
          <span className="num muted">{fmtDuration(session.durationSec)}</span>
        </div>

        {askRecall && (
          <div className="stack tight">
            <b style={{ fontWeight: 550 }}>Co si pamatuješ? Bez koukání do materiálů.</b>
            <textarea
              className="input"
              autoFocus
              placeholder="Napiš 2–3 hlavní myšlenky vlastními slovy…"
              value={recall}
              onChange={(e) => setRecall(e.target.value)}
              style={{ minHeight: 92 }}
            />
          </div>
        )}

        {topic && (
          <div className="stack tight">
            <span className="label">Jak šlo vybavení tématu „{topic.name}“?</span>
            <div className="grades">
              {RATINGS.map((r) => (
                <button key={r} className={`grade grade-${r} ${difficulty === r ? 'on' : ''}`} onClick={() => setDifficulty(r)} type="button">
                  <b>{RATING_LABEL[r]}</b>
                  <span>{RATING_HINT[r]}</span>
                </button>
              ))}
            </div>
            <span className="small faint">
              Algoritmus FSRS podle toho spočítá, kdy ti téma připomenout. Bez výběru se počítá s „Dobře“{extras.length > 0 ? ', stejné hodnocení dostanou i zaškrtnutá témata níž' : ''}.
            </span>
          </div>
        )}

        {extras.length > 0 && (
          <div className="stack tight">
            <span className="label">Další témata z bloku</span>
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
            <span className="small faint">Zapsala se jako zopakovaná. Odškrtni, co se v bloku nestihlo – zůstane k opakování.</span>
          </div>
        )}

        {askFocusRating && (
          <div className="stack tight">
            <span className="label">Soustředění</span>
            <div className="rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={focus === n ? 'on' : ''} onClick={() => setFocus(n)} type="button">
                  <span className="n num">{n}</span>
                  <span className="l">{FOCUS_LABELS[n]}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <input className="input" placeholder="Poznámka (volitelné)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}
