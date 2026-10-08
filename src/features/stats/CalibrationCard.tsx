import { useMemo } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useStore } from '../../data/store';
import { CalibrationEntry, Settings } from '../../data/schema';
import { CalibrationKey, Suggestion, calibrate, enoughData, monthKey } from '../../lib/calibrate';
import { fmtDuration } from '../../lib/time';

const ORDER: CalibrationKey[] = ['dailyGoal', 'weeklyGoals', 'dayWindow'];
const TITLE: Record<CalibrationKey, string> = { dailyGoal: 'Denní cíl', weeklyGoals: 'Týdenní cíle předmětů', dayWindow: 'Časové okno ranního plánu' };

/** Hodnota z historie návrhů v čitelné podobě. */
function describe(key: CalibrationKey, v: unknown): string {
  if (key === 'dailyGoal' && typeof v === 'number') return fmtDuration(v * 60);
  if (key === 'weeklyGoals' && v && typeof v === 'object') return `${fmtDuration(Object.values(v as Record<string, number>).reduce((a, b) => a + b, 0) * 60)} týdně`;
  if (key === 'dayWindow' && v && typeof v === 'object') {
    const w = v as { start: string; end: string };
    return `${w.start.replace(/^0/, '')}–${w.end.replace(/^0/, '')}`;
  }
  return '';
}

/** Návrhy na úpravu cílů a plánu podle skutečnosti (v reportu za uzavřený měsíc). */
export function CalibrationCard({ y, m }: { y: number; m: number }) {
  const { data, setSettings, upsertMany } = useStore();
  const month = monthKey(y, m);
  const end = Math.min(new Date(y, m + 1, 1).getTime(), Date.now());
  const log = data.settings.calibration ?? [];
  const decided = log.filter((c) => c.month === month);
  const suggestions = useMemo(() => calibrate(data, end), [data, end]);
  const enough = useMemo(() => enoughData(data, end), [data, end]);

  const apply = (s: Suggestion) => {
    if (s.subjects) {
      const byId = new Map(data.subjects.map((x) => [x.id, x]));
      upsertMany('subjects', s.subjects.filter((n) => byId.has(n.id)).map((n) => ({ ...byId.get(n.id)!, weeklyGoalMin: n.weeklyGoalMin })));
    }
    setSettings({ ...(s.settings ?? {}), calibration: [...log, { month, key: s.key, action: 'applied', at: Date.now(), before: s.before, after: s.after }] });
  };
  const keep = (s: Suggestion) => setSettings({ calibration: [...log, { month, key: s.key, action: 'kept', at: Date.now() }] });
  const undo = (e: CalibrationEntry) => {
    const patch: Partial<Settings> = { calibration: log.filter((x) => x !== e) };
    if (e.action === 'applied') {
      if (e.key === 'dailyGoal' && typeof e.before === 'number') patch.dailyGoalMin = e.before;
      if (e.key === 'dayWindow' && e.before) Object.assign(patch, { planDayStart: (e.before as { start: string }).start, planDayEnd: (e.before as { end: string }).end });
      if (e.key === 'weeklyGoals' && e.before) {
        const before = e.before as Record<string, number>;
        upsertMany('subjects', data.subjects.filter((x) => !x.deletedAt && x.id in before).map((x) => ({ ...x, weeklyGoalMin: before[x.id] })));
      }
    }
    setSettings(patch);
  };

  const rows = ORDER.map((key) => ({ key, entry: decided.find((c) => c.key === key), sug: suggestions.find((s) => s.key === key) })).filter((r) => r.entry || r.sug);

  return (
    <div className="card no-print calib">
      <div className="card-head">
        <h2 className="row" style={{ gap: 7 }}>
          <SlidersHorizontal size={14} /> Návrhy na další měsíc
        </h2>
        <span className="sub">podle posledních 8 týdnů</span>
      </div>
      {rows.length === 0 ? (
        <p className="small faint">
          {enough
            ? 'Cíle i plán odpovídají tomu, jak se opravdu učíš. Není co měnit.'
            : 'Na návrhy je zatím málo dat. Objeví se tady, až bude za posledních 8 týdnů aspoň 10 studijních dní.'}
        </p>
      ) : (
        <div className="calib-rows">
          {rows.map(({ key, entry, sug }) =>
            entry ? (
              <div key={key} className="calib-row decided">
                <div className="grow">
                  <span className="label">{TITLE[key]}</span>
                  <div className="calib-values">
                    {entry.action === 'applied' ? (
                      <>
                        <span className="faint num">{describe(key, entry.before)}</span> → <b className="num">{describe(key, entry.after)}</b>
                        <span className="chip ok">použito</span>
                      </>
                    ) : (
                      <span className="faint">ponecháno beze změny</span>
                    )}
                  </div>
                </div>
                <button className="btn ghost sm" onClick={() => undo(entry)}>
                  Vrátit
                </button>
              </div>
            ) : sug ? (
              <div key={key} className="calib-row">
                <div className="grow">
                  <span className="label">{sug.title}</span>
                  <div className="calib-values">
                    <span className="faint num">{sug.current}</span> → <b className="num">{sug.proposed}</b>
                  </div>
                  <ul className="calib-reasons">
                    {sug.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div className="calib-actions">
                  <button className="btn primary sm" onClick={() => apply(sug)}>
                    Použít
                  </button>
                  <button className="btn ghost sm" onClick={() => keep(sug)}>
                    Ponechat
                  </button>
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
