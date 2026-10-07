import { useState } from 'react';
import { ArrowRight, Cloud, HardDrive, Plus, X } from 'lucide-react';
import { useStore } from '../../data/store';
import { SUBJECT_COLORS, uid } from '../../data/schema';
import { loadGithubConfig } from '../../data/github';
import { navigate } from '../../lib/router';
import './onboarding.css';

const KEY = 'st.onboarded';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Průvodce pro nové uživatele (např. kamarády). Zobrazí se jen při úplně prázdných datech. */
export function Onboarding() {
  const { upsertMany } = useStore();
  const [open, setOpen] = useState(() => !wasDismissed() && !loadGithubConfig());
  const [step, setStep] = useState(0);
  const [names, setNames] = useState<string[]>(['', '', '']);

  if (!open) return null;

  const finish = (goSettings = false) => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
    setOpen(false);
    if (goSettings) navigate('nastaveni');
  };

  const saveSubjects = () => {
    const clean = names.map((n) => n.trim()).filter(Boolean);
    if (clean.length) {
      upsertMany(
        'subjects',
        clean.map((name, i) => ({ id: uid(), name, color: SUBJECT_COLORS[i % SUBJECT_COLORS.length], weeklyGoalMin: 0, archived: false })),
      );
    }
    setStep(2);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal onboarding" role="dialog" aria-modal="true">
        <button className="btn ghost icon sm ob-close" onClick={() => finish()} aria-label="Zavřít">
          <X size={16} />
        </button>
        <div className="ob-steps">
          {[0, 1, 2].map((i) => (
            <i key={i} className={i <= step ? 'on' : ''} />
          ))}
        </div>

        {step === 0 && (
          <div className="stack" style={{ gap: 16 }}>
            <div className="label">vítej</div>
            <h1>Study Tracker</h1>
            <p className="muted">
              Měř, kolik se čemu učíš, plánuj týden a nech si připomínat opakování ve správný čas. Časovače i metody vycházejí
              z výzkumu o učení.
            </p>
            <ul className="ob-list">
              <li>
                <b>Časovač</b> – Pomodoro, 50/10, 90 min, Flowtime…
              </li>
              <li>
                <b>Opakování</b> – témata se vrací po 1, 3, 7, 14… dnech
              </li>
              <li>
                <b>Statistiky a měsíční report</b> – kdy a jak se učíš nejlépe
              </li>
              <li>
                <b>Kalendář</b> – plán i odučené bloky, export do Apple Kalendáře
              </li>
            </ul>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" onClick={() => setStep(1)}>
                Začít <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="stack" style={{ gap: 16 }}>
            <div className="label">krok 1 ze 2</div>
            <h1>Co se učíš?</h1>
            <p className="muted">Přidej předměty. Další můžeš kdykoliv doplnit.</p>
            <div className="stack tight">
              {names.map((n, i) => (
                <input
                  key={i}
                  className="input"
                  autoFocus={i === 0}
                  placeholder={['Matematika', 'Angličtina', 'Programování'][i] ?? 'Předmět'}
                  value={n}
                  onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))}
                  onKeyDown={(e) => e.key === 'Enter' && saveSubjects()}
                />
              ))}
              <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setNames([...names, ''])}>
                <Plus size={14} /> Další předmět
              </button>
            </div>
            <div className="row between">
              <button className="btn ghost" onClick={() => setStep(2)}>
                Přeskočit
              </button>
              <button className="btn primary" onClick={saveSubjects}>
                Pokračovat <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="stack" style={{ gap: 16 }}>
            <div className="label">krok 2 ze 2</div>
            <h1>Kde budou tvoje data</h1>
            <div className="ob-choice">
              <div className="ob-option">
                <HardDrive size={18} />
                <div>
                  <b>Jen v tomhle prohlížeči</b>
                  <p className="small muted">
                    Funguje hned. Pozor: když vymažeš data prohlížeče, záznamy zmizí. Občas si udělej zálohu v Nastavení → Export.
                  </p>
                </div>
              </div>
              <div className="ob-option">
                <Cloud size={18} />
                <div>
                  <b>Záloha na tvůj GitHub (doporučeno)</b>
                  <p className="small muted">
                    Založíš si soukromé repo a data se do něj budou automaticky ukládat. Funguje to i mezi počítačem a mobilem.
                    Trvá to asi 3 minuty a návod je v Nastavení.
                  </p>
                </div>
              </div>
            </div>
            <div className="row between">
              <button className="btn" onClick={() => finish()}>
                Zatím jen v prohlížeči
              </button>
              <button className="btn primary" onClick={() => finish(true)}>
                Nastavit zálohu <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
