import { ReactNode, useState } from 'react';
import { Eye, EyeOff, FileUp, RefreshCw, Trash2 } from 'lucide-react';
import { useStore } from '../../data/store';
import { Timetable, alive, uid } from '../../data/schema';
import { Field, Modal, useToast } from '../../components/ui';
import { useRemoveWithUndo } from '../../components/undo';
import { IcsResult, parseIcs } from '../../lib/ical';
import { Lecture, diffTimetable, lectureSubject, replaceEvents, seriesOf } from '../../lib/timetable';
import { fmtDate, fmtDayLabel, fmtTime, plural } from '../../lib/time';

interface Pending {
  fileName: string;
  result: IcsResult;
  replaceId: string | null; // null = nový rozvrh
  name: string;
}

const seriesCount = (r: IcsResult) => new Set(r.events.map((e) => e.series)).size;

/** Tlačítko s vlastním výběrem souboru – každé ví, do kterého rozvrhu soubor patří. */
function FileButton({ onFile, className, title, children }: { onFile: (f: File) => void; className: string; title?: string; children: ReactNode }) {
  return (
    <label className={className} title={title} style={{ cursor: 'pointer' }}>
      {children}
      <input
        type="file"
        accept=".ics,text/calendar"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </label>
  );
}

/** Správa rozvrhu: import .ics, nahrání nové verze (s náhledem změn), skrytí předmětů. */
export function TimetableModal({ onClose }: { onClose: () => void }) {
  const { data, upsert } = useStore();
  const toast = useToast();
  const removeWithUndo = useRemoveWithUndo();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timetables = alive(data.timetables ?? []);

  const onFile = async (file: File, replaceId: string | null) => {
    setError(null);
    try {
      const result = parseIcs(await file.text());
      if (!result.events.length) throw new Error('V souboru nejsou žádné hodiny s časem začátku a konce.');
      setPending({ fileName: file.name, result, replaceId, name: result.name || file.name.replace(/\.ics$/i, '') || 'Rozvrh' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const confirmImport = () => {
    if (!pending) return;
    const now = Date.now();
    if (pending.replaceId) {
      const tt = timetables.find((t) => t.id === pending.replaceId);
      if (tt) upsert('timetables', replaceEvents(tt, pending.result.events, now));
      toast('Rozvrh aktualizován');
    } else {
      upsert('timetables', { id: uid(), name: pending.name.trim() || 'Rozvrh', importedAt: now, events: pending.result.events, hiddenSeries: [], skipped: [] });
      toast('Rozvrh importován');
    }
    setPending(null);
  };

  const subjects = alive(data.subjects).filter((x) => !x.archived && x.id !== 'anki');
  const recapOn = data.settings.lectureRecap !== false;
  /** Přiřazení řady k předmětu ('' = automaticky podle názvu, '-' = žádný). */
  const setSubject = (tt: Timetable, series: string, value: string) => {
    const map = { ...(tt.seriesSubjects ?? {}) };
    if (value) map[series] = value;
    else delete map[series];
    upsert('timetables', { ...tt, seriesSubjects: map });
  };

  const toggleSeries = (tt: Timetable, series: string) => {
    const hidden = tt.hiddenSeries.includes(series) ? tt.hiddenSeries.filter((s) => s !== series) : [...tt.hiddenSeries, series];
    upsert('timetables', { ...tt, hiddenSeries: hidden });
  };

  const replacing = pending?.replaceId ? timetables.find((t) => t.id === pending.replaceId) : undefined;
  const diff = replacing && pending ? diffTimetable(replacing.events, pending.result.events) : null;
  const range = pending && pending.result.events.length ? `${fmtDate(pending.result.events[0].start)} – ${fmtDate(pending.result.events[pending.result.events.length - 1].start)}` : '';

  return (
    <Modal
      wide
      title="Rozvrh"
      onClose={onClose}
      footer={
        pending ? (
          <>
            <button className="btn ghost" onClick={() => setPending(null)}>
              Zrušit
            </button>
            <button className="btn primary" onClick={confirmImport}>
              {pending.replaceId ? 'Nahradit' : 'Importovat'}
            </button>
          </>
        ) : (
          <FileButton className="btn" onFile={(f) => void onFile(f, null)}>
            <FileUp size={14} /> {timetables.length ? 'Přidat další rozvrh' : 'Vybrat soubor .ics'}
          </FileButton>
        )
      }
    >
      <div className="stack">
        {error && <div className="callout bad">{error}</div>}

        {pending ? (
          <div className="stack">
            {!pending.replaceId && (
              <Field label="Název">
                <input className="input" value={pending.name} onChange={(e) => setPending({ ...pending, name: e.target.value })} />
              </Field>
            )}
            <div className="tt-summary">
              <span className="num">{pending.result.events.length}</span> {plural(pending.result.events.length, 'termín', 'termíny', 'termínů')} ·{' '}
              <span className="num">{seriesCount(pending.result)}</span> {plural(seriesCount(pending.result), 'předmět', 'předměty', 'předmětů')} · {range}
              {pending.result.skippedAllDay > 0 && (
                <span className="faint">
                  {' '}
                  · vynecháno celodenních akcí: {pending.result.skippedAllDay}
                </span>
              )}
            </div>
            {diff && (
              <div className="stack tight">
                <span className="label">Změny v budoucích termínech</span>
                <div className="tt-diff">
                  <span>
                    <b className="num">+{diff.added}</b> nových
                  </span>
                  <span>
                    <b className="num">−{diff.removed}</b> zrušených
                  </span>
                  <span className="faint">
                    <b className="num">{diff.unchanged}</b> beze změny
                  </span>
                </div>
                {diff.addedSeries.length > 0 && <p className="small muted">Nově: {diff.addedSeries.join(', ')}</p>}
                {diff.removedSeries.length > 0 && <p className="small muted">Už není: {diff.removedSeries.join(', ')}</p>}
                <p className="small faint">Proběhlé hodiny zůstanou beze změny. Skryté předměty a odpadlé termíny zůstanou skryté.</p>
              </div>
            )}
          </div>
        ) : timetables.length === 0 ? (
          <div className="stack tight">
            <p className="small muted">
              Nahraj rozvrh ve formátu .ics. Výuka se zobrazí v kalendáři jako obsazený čas a ranní plán do ní nebude nic plánovat.
            </p>
            <p className="small faint">
              Soubor stáhneš ve školním informačním systému u rozvrhu (export do kalendáře / iCal). Když se rozvrh změní, nahraješ novou verzi a
              změny se promítnou najednou.
            </p>
          </div>
        ) : (
          timetables.map((tt) => (
            <div key={tt.id} className="stack tight">
              <div className="row between wrap">
                <div>
                  <b>{tt.name}</b>
                  <div className="small faint">aktualizováno {fmtDayLabel(tt.importedAt).toLowerCase()} {fmtTime(tt.importedAt)}</div>
                </div>
                <div className="row">
                  <FileButton className="btn sm" onFile={(f) => void onFile(f, tt.id)} title="Nahraj nový export – změny se ukážou před uložením">
                    <RefreshCw size={13} /> Nahrát novou verzi
                  </FileButton>
                  <button className="btn ghost icon sm" onClick={() => removeWithUndo('timetables', tt.id, 'Rozvrh odstraněn')} aria-label="Odstranit rozvrh">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="list">
                {seriesOf(tt).map((s) => (
                  <div key={s.series} className={`list-item tt-series ${s.hidden ? 'hidden' : ''}`}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="ellipsis">{s.series}</div>
                      <div className="small faint num">
                        {s.when} · zbývá {s.upcoming} z {s.count}
                      </div>
                    </div>
                    {recapOn && !s.hidden && (
                      <select
                        className="input tt-subject"
                        value={tt.seriesSubjects?.[s.series] ?? ''}
                        onChange={(e) => setSubject(tt, s.series, e.target.value)}
                        title="Předmět pro opakování po přednášce"
                      >
                        <option value="">
                          {(() => {
                            const auto = lectureSubject({ ...data, timetables: [{ ...tt, seriesSubjects: {} }] }, tt.id, s.series);
                            return auto ? `${subjects.find((x) => x.id === auto)?.name} (auto)` : 'bez předmětu (auto)';
                          })()}
                        </option>
                        {subjects.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                        <option value="-">žádný</option>
                      </select>
                    )}
                    <button className="btn ghost icon sm" onClick={() => toggleSeries(tt, s.series)} aria-label={s.hidden ? 'Zobrazit' : 'Skrýt'} title={s.hidden ? 'Zobrazit v kalendáři' : 'Skrýt (např. nepovinný předmět)'}>
                      {s.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

/** Detail jedné hodiny z rozvrhu: odpadá / skrýt celý předmět. */
export function LectureModal({ lecture, onClose, onManage }: { lecture: Lecture; onClose: () => void; onManage: () => void }) {
  const { data, upsert } = useStore();
  const toast = useToast();
  const tt = (data.timetables ?? []).find((t) => t.id === lecture.timetableId);
  if (!tt) return null;

  const change = (patch: Partial<Timetable>, message: string) => {
    const before = { hiddenSeries: tt.hiddenSeries, skipped: tt.skipped };
    upsert('timetables', { ...tt, ...patch });
    toast(message, { label: 'Vrátit', onClick: () => upsert('timetables', { ...tt, ...before }) });
    onClose();
  };

  return (
    <Modal
      title={lecture.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost left" onClick={onManage}>
            Spravovat rozvrh
          </button>
          <button className="btn" onClick={() => change({ hiddenSeries: [...tt.hiddenSeries, lecture.series] }, 'Předmět skrytý v kalendáři')}>
            Skrýt všechny
          </button>
          <button className="btn primary" onClick={() => change({ skipped: [...tt.skipped, lecture.key] }, 'Termín označen jako odpadlý')}>
            Tento termín odpadá
          </button>
        </>
      }
    >
      <div className="stack tight small">
        <span className="num">
          {fmtDayLabel(lecture.start)} · {fmtTime(lecture.start)}–{fmtTime(lecture.end)}
        </span>
        {lecture.location && <span className="muted">{lecture.location}</span>}
        <span className="faint">{tt.name} · z rozvrhu, dá se upravit novým importem</span>
      </div>
    </Modal>
  );
}
