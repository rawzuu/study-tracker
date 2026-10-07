import { useMemo, useState } from 'react';
import { CalendarCheck, Plus, RotateCcw, X } from 'lucide-react';
import { useStore } from '../../data/store';
import { alive, uid } from '../../data/schema';
import { Modal, useToast } from '../../components/ui';
import { DayPlanItem, busyIntervals, dayBounds, dayRange, place, proposeDay } from '../../lib/dayplan';
import { HOUR, MIN, fmtDuration, startOfDay, toTimeInput } from '../../lib/time';
import './dayplan.css';

/** Ranní plánování: návrh bloků na zbytek dne, úpravy a uložení do kalendáře. */
export function DayPlanModal({ onClose }: { onClose: () => void }) {
  const { data, upsertMany, setSettings } = useStore();
  const toast = useToast();
  const [extra, setExtra] = useState(0);
  const [items, setItems] = useState<DayPlanItem[]>(() => proposeDay(data));
  const now = Date.now();
  const { day, to } = dayBounds(data, now);
  const subj = useMemo(() => new Map(data.subjects.map((s) => [s.id, s])), [data.subjects]);
  const busy = busyIntervals(data, day, new Set(items.filter((i) => i.carry).map((i) => i.carry!.id)));

  const studied = alive(data.sessions).filter((s) => s.start >= day).reduce((a, s) => a + s.durationSec / 60, 0);
  const planned = alive(data.planBlocks).filter((b) => !b.done && startOfDay(b.start) === day && b.start + b.durationMin * MIN > now).reduce((a, b) => a + b.durationMin, 0);
  const proposed = items.filter((i) => i.include && i.start).reduce((a, i) => a + i.minutes, 0);

  const update = (key: string, patch: Partial<DayPlanItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const reflow = (list: DayPlanItem[]) => setItems(place(data, list.map((i) => ({ ...i, start: 0 })), now));

  const save = () => {
    const chosen = items.filter((i) => i.include && i.start);
    upsertMany(
      'planBlocks',
      chosen.map((i) =>
        i.carry
          ? { ...i.carry, start: i.start, durationMin: i.minutes }
          : { id: uid(), subjectId: i.subjectId, title: i.title, start: i.start, durationMin: i.minutes, done: false, note: i.reasons.join(' · ') },
      ),
    );
    toast(`Do kalendáře přidáno ${chosen.length} bloků`);
    onClose();
  };

  // časová osa dne: od začátku plánovaného dne (nebo dřívějšího bloku) do konce
  const range = dayRange(data, day);
  const axisStart = Math.floor(Math.min(range.start, ...busy.map((b) => b[0])) / HOUR) * HOUR;
  const axisEnd = Math.ceil(Math.max(range.end, to, ...items.map((i) => (i.start ? i.start + i.minutes * MIN : 0))) / HOUR) * HOUR;
  const pct = (t: number) => `${((t - axisStart) / (axisEnd - axisStart)) * 100}%`;

  return (
    <Modal
      wide
      title={`Plán na dnešek · ${new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' })}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost left" onClick={() => setItems(proposeDay(data, Date.now(), extra))}>
            <RotateCcw size={14} /> Navrhnout znovu
          </button>
          <button
            className="btn"
            onClick={() => {
              const n = extra + 1;
              setExtra(n);
              setItems(proposeDay(data, Date.now(), n));
            }}
          >
            <Plus size={14} /> Další blok
          </button>
          <button className="btn primary" onClick={save} disabled={!items.some((i) => i.include && i.start)}>
            <CalendarCheck size={14} /> Uložit do kalendáře
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <div className="dp-sum num small">
          <span>
            cíl <b>{fmtDuration(data.settings.dailyGoalMin * 60, { short: true })}</b>
          </span>
          <span>
            odučeno <b>{fmtDuration(studied * 60, { short: true })}</b>
          </span>
          <span>
            už v plánu <b>{fmtDuration(planned * 60, { short: true })}</b>
          </span>
          <span className="accent-text">
            navrhuji <b>{fmtDuration(proposed * 60, { short: true })}</b>
          </span>
        </div>

        <div className="dp-axis">
          {busy.map(([a, b], i) => (
            <i key={i} className="dp-busy" style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }} />
          ))}
          {items
            .filter((i) => i.include && i.start)
            .map((i) => (
              <i key={i.key} className="dp-item" style={{ left: pct(i.start), width: `calc(${pct(i.start + i.minutes * MIN)} - ${pct(i.start)})`, background: subj.get(i.subjectId)?.color }} />
            ))}
          {now > axisStart && now < axisEnd && <i className="dp-now" style={{ left: pct(now) }} />}
          {Array.from({ length: Math.floor((axisEnd - axisStart) / HOUR) + 1 }, (_, k) => axisStart + k * HOUR)
            .filter((_, k) => k % 2 === 0)
            .map((t) => (
              <span key={t} className="dp-tick num" style={{ left: pct(t) }}>
                {new Date(t).getHours()}
              </span>
            ))}
        </div>

        {items.length === 0 ? (
          <p className="small muted">Na dnešek nic dalšího nenavrhuji – cíl je splněný nebo naplánovaný. Přidat můžeš tlačítkem „Další blok“.</p>
        ) : (
          <div className="list">
            {items.map((i) => {
              const s = subj.get(i.subjectId);
              return (
                <div key={i.key} className={`dp-row ${i.include ? '' : 'off'}`}>
                  <label className="dp-check">
                    <input type="checkbox" checked={i.include} onChange={(e) => update(i.key, { include: e.target.checked })} />
                  </label>
                  <input
                    className="input num dp-time"
                    type="time"
                    step={300}
                    value={i.start ? toTimeInput(i.start) : ''}
                    onChange={(e) => {
                      const [h, m] = e.target.value.split(':').map(Number);
                      if (!Number.isNaN(h)) update(i.key, { start: day + h * HOUR + (m || 0) * MIN, include: true });
                    }}
                  />
                  <span className="dp-color" style={{ background: s?.color }} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis">
                      <b>{s?.name}</b> <span className="muted">{i.title}</span>
                    </div>
                    <div className="small faint ellipsis">{i.start ? i.reasons.join(' · ') : 'nevejde se do dnešního dne'}</div>
                  </div>
                  <select className="input dp-dur" value={i.minutes} onChange={(e) => reflow(items.map((x) => (x.key === i.key ? { ...x, minutes: Number(e.target.value) } : x)))}>
                    {[15, 25, 30, 45, 50, 60, 75, 90, 120].map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </select>
                  <button className="btn ghost icon sm" onClick={() => reflow(items.filter((x) => x.key !== i.key))} aria-label="Odebrat">
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="row small faint" style={{ gap: 8 }}>
          <span>Plánuji mezi</span>
          <input className="input num" style={{ width: 96, height: 28 }} type="time" value={data.settings.planDayStart} onChange={(e) => setSettings({ planDayStart: e.target.value })} />
          <span>a</span>
          <input className="input num" style={{ width: 96, height: 28 }} type="time" value={data.settings.planDayEnd} onChange={(e) => setSettings({ planDayEnd: e.target.value })} />
          <span>· mezi bloky 10 min pauza · náročná látka přednostně do tvé nejsilnější denní doby</span>
        </div>
      </div>
    </Modal>
  );
}
