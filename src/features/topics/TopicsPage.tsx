import { useMemo, useState } from 'react';
import { Archive, Check, Play, Plus, Repeat, RotateCcw, Trash2 } from 'lucide-react';
import { useStore } from '../../data/store';
import { Topic, alive } from '../../data/schema';
import { Empty, Modal, useToast } from '../../components/ui';
import { DAY, addDays, fmtDate, plural, startOfDay } from '../../lib/time';
import { navigate } from '../../lib/router';
import { SubjectSelect, SubjectTag } from '../subjects/SubjectSelect';
import { useTimer } from '../timer/TimerContext';
import {
  RATINGS,
  RATING_HINT,
  RATING_LABEL,
  RecallRating,
  applyStudy,
  ctxFrom,
  difficulty,
  findTopic,
  isDue,
  newTopic,
  overdueDays,
  retrievability,
  stability,
} from './schedule';
import './topics.css';

function dueLabel(t: Topic): { text: string; cls: string } {
  if (t.mastered) return { text: 'zvládnuto', cls: 'ok' };
  if (t.nextReviewAt == null) return { text: 'nové', cls: '' };
  const d = overdueDays(t);
  if (d > 0) return { text: `${d} ${plural(d, 'den', 'dny', 'dní')} po termínu`, cls: 'bad' };
  if (d === 0) return { text: 'dnes', cls: 'accent' };
  if (d === -1) return { text: 'zítra', cls: '' };
  return { text: `za ${-d} ${plural(-d, 'den', 'dny', 'dní')}`, cls: '' };
}

/** Aktuální pravděpodobnost vybavení (FSRS) jako ukazatel. */
export function MemoryMeter({ t }: { t: Topic }) {
  const { data } = useStore();
  const ctx = ctxFrom(data);
  const r = retrievability(t, ctx);
  if (r == null) return <span className="mem mem-new label">nové</span>;
  const cls = r >= ctx.retention - 0.005 ? 'ok' : r >= 0.75 ? 'mid' : 'low';
  const s = stability(t);
  return (
    <span className={`mem mem-${cls}`} title={`Pravděpodobnost, že si to teď vybavíš: ${Math.round(r * 100)} %. Stabilita ${s?.toFixed(1)} dne.`}>
      <span className="mem-bar">
        <i style={{ width: `${Math.round(r * 100)}%` }} />
      </span>
      <span className="num">{Math.round(r * 100)}%</span>
    </span>
  );
}

/** Zpětná kompatibilita názvu. */
export const StageMeter = MemoryMeter;

function TopicRow({ t, onEdit }: { t: Topic; onEdit: () => void }) {
  const { upsert } = useStore();
  const timer = useTimer();
  const toast = useToast();
  const { data } = useStore();
  const due = dueLabel(t);
  const s = stability(t);
  const d = difficulty(t);
  const review = (r: RecallRating) => {
    const now = Date.now();
    const next = applyStudy(t, now, r, ctxFrom(data));
    upsert('topics', next);
    const days = Math.max(1, Math.round(((next.nextReviewAt ?? now) - now) / DAY));
    toast(`${RATING_LABEL[r]} · další opakování za ${days} ${plural(days, 'den', 'dny', 'dní')}`);
  };
  return (
    <div className="topic-row">
      <div className="grow" style={{ minWidth: 0 }}>
        <button className="topic-name" onClick={onEdit}>
          {t.name}
        </button>
        <div className="small faint topic-meta">
          <SubjectTag id={t.subjectId} />
          {t.lastStudiedAt && <span className="num">· naposled {fmtDate(t.lastStudiedAt)}</span>}
          {s != null && <span className="num" title="Stabilita: za kolik dní klesne vybavitelnost na 90 %">· S {s < 10 ? s.toFixed(1) : Math.round(s)} d</span>}
          {d != null && <span className="num" title="Obtížnost 1–10">· D {d.toFixed(1)}</span>}
          <span className="num">· {t.reviews}×</span>
        </div>
      </div>
      <MemoryMeter t={t} />
      <span className={`chip ${due.cls}`}>{due.text}</span>
      {!t.mastered && (
        <div className="row topic-actions" style={{ gap: 4 }}>
          {timer.state.status === 'idle' && (
            <button
              className="btn icon sm"
              title="Opakovat s časovačem"
              onClick={() => {
                timer.configure({ subjectId: t.subjectId, topic: t.name });
                navigate('casovac');
              }}
            >
              <Play size={12} fill="currentColor" />
            </button>
          )}
          <div className="segmented grade-seg" title="Zopakováno bez časovače – jak šlo vybavení?">
            {RATINGS.map((r) => (
              <button key={r} className={`g-${r}`} onClick={() => review(r)} title={RATING_HINT[r]}>
                {RATING_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TopicModal({ topic, onClose }: { topic?: Topic; onClose: () => void }) {
  const { data, upsert, remove } = useStore();
  const [subjectId, setSubjectId] = useState(topic?.subjectId ?? '');
  const [names, setNames] = useState(topic?.name ?? '');
  const [note, setNote] = useState(topic?.note ?? '');

  const save = () => {
    if (!subjectId) return;
    if (topic) {
      upsert('topics', { ...topic, subjectId, name: names.trim() || topic.name, note: note.trim() });
    } else {
      // Více témat najednou – jedno na řádek
      for (const line of names.split('\n').map((l) => l.trim()).filter(Boolean)) {
        if (!findTopic(data.topics, subjectId, line)) upsert('topics', { ...newTopic(subjectId, line), note: note.trim() });
      }
    }
    onClose();
  };

  return (
    <Modal
      title={topic ? 'Upravit téma' : 'Nová témata'}
      onClose={onClose}
      footer={
        <>
          {topic && (
            <>
              <button
                className="btn danger left"
                onClick={() => {
                  if (!confirm(`Smazat téma „${topic.name}“ i s historií opakování?`)) return;
                  remove('topics', topic.id);
                  onClose();
                }}
              >
                <Trash2 size={14} /> Smazat
              </button>
              <button
                className="btn"
                onClick={() => {
                  upsert('topics', { ...topic, mastered: !topic.mastered });
                  onClose();
                }}
              >
                {topic.mastered ? <RotateCcw size={14} /> : <Archive size={14} />}
                {topic.mastered ? 'Znovu opakovat' : 'Zvládnuto'}
              </button>
            </>
          )}
          <button className="btn primary" onClick={save} disabled={!subjectId || !names.trim()}>
            Uložit
          </button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          <span>Předmět</span>
          <SubjectSelect value={subjectId} onChange={setSubjectId} />
        </label>
        {topic ? (
          <label className="field">
            <span>Název</span>
            <input className="input" value={names} onChange={(e) => setNames(e.target.value)} />
          </label>
        ) : (
          <label className="field">
            <span>Témata – každé na nový řádek</span>
            <textarea className="input" style={{ minHeight: 130 }} value={names} onChange={(e) => setNames(e.target.value)} placeholder={'Limity\nDerivace\nIntegrály – substituce'} />
          </label>
        )}
        <label className="field">
          <span>Poznámka</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

export function TopicsPage() {
  const { data, upsertMany } = useStore();
  const toast = useToast();
  const [subjectId, setSubjectId] = useState('');
  const [editing, setEditing] = useState<Topic | 'new' | null>(null);
  const [showMastered, setShowMastered] = useState(false);

  const topics = useMemo(() => alive(data.topics).filter((t) => !subjectId || t.subjectId === subjectId), [data.topics, subjectId]);
  const endToday = addDays(startOfDay(Date.now()), 1);
  const ctx = ctxFrom(data);
  const due = topics
    .filter((t) => isDue(t, endToday))
    .sort((a, b) => (retrievability(a, ctx) ?? 1) - (retrievability(b, ctx) ?? 1));
  const upcoming = topics.filter((t) => !t.mastered && !isDue(t, endToday) && t.nextReviewAt != null).sort((a, b) => (a.nextReviewAt ?? 0) - (b.nextReviewAt ?? 0));
  const fresh = topics.filter((t) => !t.mastered && t.nextReviewAt == null);
  const mastered = topics.filter((t) => t.mastered);

  // Témata z historie sezení, která ještě nemají záznam
  const fromHistory = useMemo(() => {
    const out = new Map<string, { subjectId: string; name: string; last: number; count: number }>();
    for (const s of alive(data.sessions)) {
      if (s.mode === 'anki') continue; // bloky z Anki mají jako „téma“ název balíčku
      const name = s.topic.trim();
      if (!name || findTopic(data.topics, s.subjectId, name)) continue;
      const key = `${s.subjectId}|${name.toLocaleLowerCase('cs')}`;
      const ex = out.get(key);
      if (!ex) out.set(key, { subjectId: s.subjectId, name, last: s.end, count: 1 });
      else {
        ex.count++;
        ex.last = Math.max(ex.last, s.end);
      }
    }
    return [...out.values()];
  }, [data.sessions, data.topics]);

  const importHistory = () => {
    upsertMany(
      'topics',
      fromHistory.map((h) => {
        let t = newTopic(h.subjectId, h.name);
        t = applyStudy(t, h.last, 'ok', ctxFrom(data));
        return { ...t, reviews: h.count };
      }),
    );
    toast(`Přidáno ${fromHistory.length} témat`);
  };

  // Přehled zátěže na 14 dní dopředu
  const load = Array.from({ length: 14 }, (_, i) => {
    const from = addDays(startOfDay(Date.now()), i);
    const to = addDays(from, 1);
    const n = alive(data.topics).filter((t) => !t.mastered && t.nextReviewAt != null && (i === 0 ? t.nextReviewAt < to : t.nextReviewAt >= from && t.nextReviewAt < to)).length;
    return { from, n };
  });
  const maxLoad = Math.max(1, ...load.map((l) => l.n));

  return (
    <div className="stack loose">
      <div className="page-head">
        <div>
          <h1>Opakování</h1>
          <p>
            Algoritmus <b>FSRS-6</b> (stejný jako v Anki) hlídá u každého tématu, jak pravděpodobně si ho teď vybavíš, a naplánuje
            opakování, když klesne na <b className="num">{Math.round((data.settings.desiredRetention ?? 0.9) * 100)} %</b>.
          </p>
        </div>
        <div className="row wrap">
          <div style={{ width: 220 }}>
            <SubjectSelect value={subjectId} onChange={setSubjectId} allowAll />
          </div>
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Plus size={15} /> Témata
          </button>
        </div>
      </div>

      {fromHistory.length > 0 && (
        <div className="banner">
          <Repeat size={16} />
          <span className="grow">
            V historii {plural(fromHistory.length, 'je', 'jsou', 'je')} {fromHistory.length} {plural(fromHistory.length, 'téma', 'témata', 'témat')} bez plánu opakování.
          </span>
          <button className="btn sm" onClick={importHistory}>
            Přidat do opakování
          </button>
        </div>
      )}

      <div className="g12">
        <div className="card c-8 xl-9">
          <div className="card-head">
            <h2>K zopakování dnes</h2>
            <span className="sub num">{due.length}</span>
          </div>
          {due.length === 0 ? (
            <Empty icon={<Check size={24} />} title="Na dnešek máš hotovo">
              <span className="small">Nová témata se sem dostanou samy, když je budeš učit s časovačem.</span>
            </Empty>
          ) : (
            <div className="list">
              {due.map((t) => (
                <TopicRow key={t.id} t={t} onEdit={() => setEditing(t)} />
              ))}
            </div>
          )}
        </div>

        <div className="card c-4 xl-3">
          <div className="card-head">
            <h2>Příštích 14 dní</h2>
          </div>
          <div className="load">
            {load.map((l, i) => (
              <div key={l.from} className="load-col" title={`${fmtDate(l.from)}: ${l.n}`}>
                <span className="num small">{l.n || ''}</span>
                <i style={{ height: `${(l.n / maxLoad) * 100}%` }} className={i === 0 ? 'today' : ''} />
                <span className="label">{new Date(l.from).getDate()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card c-12">
          <div className="card-head">
            <h2>Naplánovaná</h2>
            <span className="sub num">{upcoming.length}</span>
          </div>
          {upcoming.length === 0 ? (
            <p className="small faint">Zatím nic.</p>
          ) : (
            <div className="list">
              {upcoming.map((t) => (
                <TopicRow key={t.id} t={t} onEdit={() => setEditing(t)} />
              ))}
            </div>
          )}
        </div>

        {fresh.length > 0 && (
          <div className="card c-12">
            <div className="card-head">
              <h2>Nová – ještě neučená</h2>
              <span className="sub num">{fresh.length}</span>
            </div>
            <div className="list">
              {fresh.map((t) => (
                <TopicRow key={t.id} t={t} onEdit={() => setEditing(t)} />
              ))}
            </div>
          </div>
        )}

        {mastered.length > 0 && (
          <div className="card c-12">
            <div className="card-head">
              <h2>Zvládnutá</h2>
              <button className="btn ghost sm" onClick={() => setShowMastered(!showMastered)}>
                {showMastered ? 'Skrýt' : `Zobrazit (${mastered.length})`}
              </button>
            </div>
            {showMastered && (
              <div className="list">
                {mastered.map((t) => (
                  <TopicRow key={t.id} t={t} onEdit={() => setEditing(t)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {editing && <TopicModal topic={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
