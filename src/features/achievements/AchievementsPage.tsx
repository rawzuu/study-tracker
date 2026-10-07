import { useMemo } from 'react';
import { useStore } from '../../data/store';
import { fmtDate } from '../../lib/time';
import { Bar } from '../../components/ui';
import { Emblem, metalFor } from './Emblem';
import { FamilyResult, GROUPS, ROMAN, SingleResult, evaluate } from './achievements';
import { FEATURES } from './share';
import './achievements.css';

const fmtVal = (v: number, unit: string) => {
  const n = unit === 'h' ? (v < 10 ? Math.round(v * 10) / 10 : Math.floor(v)) : Math.floor(v);
  return `${n.toLocaleString('cs-CZ')}${unit === 'h' ? ' h' : unit === 'd' ? ' d' : unit === 'min' ? ' min' : ''}`;
};

/** Podíl uživatelů s úspěchem – připraveno, zobrazí se až po zapnutí online statistik. */
function Rarity({ value }: { value?: number | null }) {
  if (!FEATURES.achievementRarity || value == null) return null;
  return <span className="rarity num">má {Math.round(value * 100)} % uživatelů</span>;
}

function FamilyRow({ r }: { r: FamilyResult }) {
  const f = r.family;
  const n = f.thresholds.length;
  const done = r.next == null;
  return (
    <div className="ach-row">
      <Emblem icon={f.icon} tier={r.tier} tiers={n} />
      <div className="ach-main">
        <div className="row between" style={{ gap: 8 }}>
          <span className="ach-name">
            {f.name}
            {r.tier > 0 && <span className="ach-roman num" style={{ color: metalFor(r.tier, n) }}> {ROMAN[r.tier - 1]}</span>}
          </span>
          <span className="num small faint">{done ? 'vše splněno' : `${fmtVal(r.value, f.unit)} / ${fmtVal(r.next!, f.unit)}`}</span>
        </div>
        <div className="small muted ellipsis">{done ? f.desc(f.thresholds[n - 1]) : `Další: ${f.desc(r.next!)}`}</div>
        {!done && <Bar value={r.progress} color={r.tier ? metalFor(r.tier, n) : 'var(--text-3)'} />}
        <div className="ach-track">
          {r.tiers.map((t, i) => (
            <span
              key={i}
              className={`ach-node ${t.unlocked ? 'on' : ''}`}
              style={{ ['--m' as string]: metalFor(i + 1, n) }}
              title={`${f.name} ${ROMAN[i]} – ${f.desc(t.threshold)}${t.at ? ` · ${fmtDate(t.at, { day: 'numeric', month: 'numeric', year: 'numeric' })}` : ''}`}
            >
              <i />
              <span className="num">{t.threshold >= 1000 ? `${t.threshold / 1000}k` : t.threshold}</span>
            </span>
          ))}
        </div>
        <Rarity />
      </div>
    </div>
  );
}

function SingleCard({ r }: { r: SingleResult }) {
  const s = r.single;
  const hidden = s.secret && !r.unlocked;
  return (
    <div className={`ach-single ${r.unlocked ? 'on' : ''}`}>
      <Emblem icon={s.icon} tier={r.unlocked ? 1 : 0} tiers={1} size={38} secret={s.secret} />
      <div style={{ minWidth: 0 }}>
        <div className="ach-name">{hidden ? 'Skrytý úspěch' : s.name}</div>
        <div className="small muted">{hidden ? 'Odhalí se, až ho získáš.' : s.desc}</div>
        {r.unlocked && r.at && <div className="small faint num">{fmtDate(r.at, { day: 'numeric', month: 'numeric', year: 'numeric' })}</div>}
        <Rarity />
      </div>
    </div>
  );
}

export function AchievementsPage() {
  const { data } = useStore();
  const res = useMemo(() => evaluate(data), [data]);

  // poslední odemčený (podle data) a nejbližší další
  const dated = [
    ...res.families.flatMap((r) => r.tiers.map((t, i) => ({ name: `${r.family.name} ${ROMAN[i]}`, at: t.at, unlocked: t.unlocked }))),
    ...res.singles.map((s) => ({ name: s.single.name, at: s.at, unlocked: s.unlocked })),
  ].filter((x) => x.unlocked && x.at);
  const latest = dated.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0];
  const closest = res.families.filter((r) => r.next != null && r.value > 0).sort((a, b) => b.progress - a.progress)[0];
  const secrets = res.singles.filter((s) => s.single.secret);

  return (
    <div className="stack loose">
      <div className="page-head">
        <div>
          <h1>Úspěchy</h1>
          <p>Počítají se z tvých dat – i zpětně. Každá kategorie má několik úrovní: ocel, bronz, stříbro, zlato, platina.</p>
        </div>
      </div>

      <div className="strip" style={{ ['--n' as string]: 4 }}>
        <div className="cell">
          <span className="label">odemčeno</span>
          <span className="value">
            {res.unlocked}
            <small>/{res.total}</small>
          </span>
          <span className="foot">{Math.round((res.unlocked / res.total) * 100)} % ze všech</span>
        </div>
        <div className="cell">
          <span className="label">poslední</span>
          <span className="value" style={{ fontSize: 18, fontFamily: 'var(--font)', letterSpacing: '-0.01em' }}>
            {latest?.name ?? '—'}
          </span>
          <span className="foot">{latest?.at ? fmtDate(latest.at, { day: 'numeric', month: 'long' }) : 'zatím nic'}</span>
        </div>
        <div className="cell">
          <span className="label">nejblíž</span>
          <span className="value" style={{ fontSize: 18, fontFamily: 'var(--font)', letterSpacing: '-0.01em' }}>
            {closest ? `${closest.family.name} ${ROMAN[closest.tier]}` : '—'}
          </span>
          <span className="foot">{closest ? `${Math.round(closest.progress * 100)} % · ${closest.family.desc(closest.next!)}` : ''}</span>
        </div>
        <div className="cell">
          <span className="label">skryté</span>
          <span className="value">
            {secrets.filter((s) => s.unlocked).length}
            <small>/{secrets.length}</small>
          </span>
          <span className="foot">odhalí se samy</span>
        </div>
      </div>

      <div className="g12">
        {GROUPS.map((g) => {
          const fams = res.families.filter((r) => r.family.group === g);
          const singles = res.singles.filter((s) => s.single.group === g);
          if (!fams.length && !singles.length) return null;
          const unlocked = fams.reduce((a, r) => a + r.tier, 0) + singles.filter((s) => s.unlocked).length;
          const total = fams.reduce((a, r) => a + r.family.thresholds.length, 0) + singles.length;
          return (
            <div key={g} className="card c-12 xl-6">
              <div className="card-head">
                <h2>{g}</h2>
                <span className="sub num">
                  {unlocked}/{total}
                </span>
              </div>
              <div className="stack" style={{ gap: 0 }}>
                {fams.map((r) => (
                  <FamilyRow key={r.family.id} r={r} />
                ))}
              </div>
              {singles.length > 0 && (
                <div className="ach-singles">
                  {singles.map((s) => (
                    <SingleCard key={s.single.id} r={s} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
