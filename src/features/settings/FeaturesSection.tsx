import { useState } from 'react';
import { Copy } from 'lucide-react';
import { useStore } from '../../data/store';
import { alive } from '../../data/schema';
import { Segmented, Switch, useToast } from '../../components/ui';

/** Stejný řádek jako ve zbytku Nastavení. */
function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <div className="label">{label}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/** Volitelné funkce – každou jde vypnout nebo upravit podle sebe. */
export function FeaturesSection() {
  const { data, setSettings } = useStore();
  const toast = useToast();
  const s = data.settings;
  const first = alive(data.subjects).find((x) => !x.archived && x.id !== 'anki');
  const [link] = useState(
    () => `${window.location.origin}${window.location.pathname}#/casovac?start=1${first ? `&predmet=${encodeURIComponent(first.name)}` : ''}`,
  );

  return (
    <div className="card">
      <div className="card-head">
        <h2>Funkce</h2>
        <span className="sub">co má aplikace dělat sama</span>
      </div>
      <div>
        <Row label="Ranní výzva k plánování" desc="Dopoledne na přehledu nabídne naplánovat den.">
          <Switch checked={s.morningPrompt !== false} onChange={(v) => setSettings({ morningPrompt: v })} label="Ranní výzva k plánování" />
        </Row>
        <Row label="Opakování po přednášce" desc="Po hodině z rozvrhu nabídne „Co teď?“ a ranní plán krátké shrnutí ještě ten den. Jen s nahraným rozvrhem.">
          <Switch checked={s.lectureRecap !== false} onChange={(v) => setSettings({ lectureRecap: v })} label="Opakování po přednášce" />
        </Row>
        <Row label="Dny volna v sérii" desc="Kolik dní bez učení za týden sérii nepřeruší.">
          <Segmented<string>
            value={String(s.streakRestDays ?? 0)}
            onChange={(v) => setSettings({ streakRestDays: Number(v) })}
            options={[
              { value: '0', label: 'žádné' },
              { value: '1', label: '1 týdně' },
              { value: '2', label: '2 týdně' },
            ]}
          />
        </Row>
        <Row label="Den se počítá do série" desc="Minimum učení, aby den sérii prodloužil.">
          <Segmented<string>
            value={String(s.streakMinMin ?? 0)}
            onChange={(v) => setSettings({ streakMinMin: Number(v) })}
            options={[
              { value: '0', label: 'jakékoli' },
              { value: '10', label: 'od 10 min' },
              { value: '25', label: 'od 25 min' },
            ]}
          />
        </Row>
        <Row label="Hlídat zálohu na GitHub" desc="Upozorní, když záloha selhává nebo se blíží konec platnosti tokenu.">
          <Switch checked={s.tokenWarning !== false} onChange={(v) => setSettings({ tokenWarning: v })} label="Hlídat zálohu na GitHub" />
        </Row>
        <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div>
            <div className="label">Zkratky</div>
            <div className="desc">
              Na Macu najdeš po pravém kliknutí na ikonu aplikace Začít učení, Kalendář a Opakování. Tento odkaz spustí časovač – hodí se do Zkratek
              nebo pro Siri (předmět v odkazu si přepiš).
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <input className="input grow" readOnly value={link} style={{ height: 30, fontSize: 12, minWidth: 0 }} onFocus={(e) => e.target.select()} />
            <button
              className="btn icon sm"
              aria-label="Zkopírovat odkaz"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(
                  () => toast('Odkaz zkopírován'),
                  () => toast('Kopírování se nepovedlo – označ odkaz ručně'),
                );
              }}
            >
              <Copy size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
