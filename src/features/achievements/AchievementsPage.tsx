import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../data/store';
import { fmtDate, fmtDuration } from '../../lib/time';
import { Modal } from '../../components/ui';
import { Coin, MATERIALS, MATERIAL_LABEL, Material, Medal, materialFor } from './Medal';
import { Family, FamilyResult, GROUPS, ROMAN, SingleResult, evaluate } from './achievements';
import { FEATURES } from './share';
import './achievements.css';

const VIEWED_KEY = 'st.ach.viewed';
const fmtDay = (t: number) => fmtDate(t, { day: 'numeric', month: 'numeric', year: 'numeric' });

/** Číslo vyražené na stužce medaile. */
function ribbon(threshold: number, unit: Family['unit']): string {
  const n = threshold >= 1000 ? `${threshold / 1000}k` : String(threshold);
  return unit === 'h' ? `${n} h` : unit === 'd' ? `${n} d` : unit === 'min' ? `${n} min` : unit === 'x' ? `${n}×` : n;
}

const cz = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

/** Kolik zbývá do další úrovně – lidsky. */
function remaining(r: FamilyResult): string {
  if (r.next == null) return '';
  const left = r.next - r.value;
  switch (r.family.unit) {
    case 'h':
      return `zbývá ${fmtDuration(Math.max(60, left * 3600))}`;
    case 'min':
      return `blok o ${Math.ceil(left)} min delší`;
    case 'd': {
      const d = Math.ceil(left);
      return `zbývá ${d} ${cz(d, 'den', 'dny', 'dní')}`;
    }
    default: {
      const x = Math.ceil(left);
      return `ještě ${x}×`;
    }
  }
}

/** Podíl uživatelů s úspěchem – připraveno, zobrazí se až po zapnutí online statistik. */
function Rarity({ value }: { value?: number | null }) {
  if (!FEATURES.achievementRarity || value == null) return null;
  return <span className="rarity num">má {Math.round(value * 100)} % uživatelů</span>;
}

type Selected = { kind: 'family'; r: FamilyResult } | { kind: 'single'; r: SingleResult } | null;

function FamilyTile({ r, fresh, onOpen }: { r: FamilyResult; fresh: boolean; onOpen: () => void }) {
  const f = r.family;
  const n = f.thresholds.length;
  const on = r.tier > 0;
  const shownTh = on ? f.thresholds[r.tier - 1] : f.thresholds[0];
  return (
    <button className={`ach-tile ${on ? 'on' : ''}`} onClick={onOpen}>
      <Medal group={f.group} icon={f.icon} material={on ? materialFor(r.tier, n) : null} label={ribbon(shownTh, f.unit)} progress={on ? 0 : r.progress} tilt fresh={fresh} />
      <span className="ach-tile-name">
        {f.name}
        {on && n > 1 && <span className="num ach-tile-roman"> {ROMAN[r.tier - 1]}</span>}
      </span>
      <span className="ach-pips" aria-label={`${r.tier} z ${n} úrovní`}>
        {f.thresholds.map((_, i) => (
          <i key={i} className={i < r.tier ? `on m-${materialFor(i + 1, n)}` : i === r.tier ? 'next' : ''} />
        ))}
      </span>
      <span className="ach-tile-foot num">{r.next == null ? 'vše získáno' : on ? remaining(r) : f.desc(f.thresholds[0])}</span>
      {fresh && <span className="ach-new">nové</span>}
    </button>
  );
}

function SingleTile({ r, fresh, onOpen }: { r: SingleResult; fresh: boolean; onOpen: () => void }) {
  const s = r.single;
  const hidden = s.secret && !r.unlocked;
  return (
    <button className={`ach-tile ${r.unlocked ? 'on' : ''}`} onClick={onOpen}>
      <Medal group={s.group} icon={s.icon} material={r.unlocked ? 'gold' : null} secret={s.secret} tilt fresh={fresh} />
      <span className="ach-tile-name">{hidden ? 'Skrytý úspěch' : s.name}</span>
      <span className="ach-tile-foot">{r.unlocked ? (r.at ? fmtDay(r.at) : 'získáno') : hidden ? 'odhalí se sám' : s.desc}</span>
      {fresh && <span className="ach-new">nové</span>}
    </button>
  );
}

function FamilyDetail({ r }: { r: FamilyResult }) {
  const f = r.family;
  const n = f.thresholds.length;
  const on = r.tier > 0;
  const cur = on ? r.tiers[r.tier - 1] : null;
  return (
    <div className="ach-detail">
      <div className="ach-hero-medal">
        <Medal
          group={f.group}
          icon={f.icon}
          material={on ? materialFor(r.tier, n) : null}
          label={ribbon(on ? f.thresholds[r.tier - 1] : f.thresholds[0], f.unit)}
          progress={on ? 0 : r.progress}
          size={196}
          tilt
        />
      </div>
      <div className="ach-detail-text">
        <span className="label">
          {f.group} · {on ? `${MATERIAL_LABEL[materialFor(r.tier, n)]} · úroveň ${r.tier} z ${n}` : `0 z ${n} úrovní`}
        </span>
        <p className="ach-detail-desc">{on ? f.desc(f.thresholds[r.tier - 1]) : `První úroveň: ${f.desc(f.thresholds[0])}`}</p>
        {cur?.at && <span className="small faint num">získáno {fmtDay(cur.at)}</span>}
        <Rarity />
        {r.next != null && (
          <div className="ach-next">
            <div className="row between small">
              <span>
                Další: <b>{f.desc(r.next)}</b>
              </span>
              <span className="num faint">{Math.round(r.progress * 100)} %</span>
            </div>
            <div className="ach-bar">
              <i style={{ width: `${Math.round(r.progress * 100)}%` }} />
            </div>
            <span className="small muted">{remaining(r)}</span>
          </div>
        )}
      </div>
      <div className="ach-tiers">
        {r.tiers.map((t, i) => (
          <div key={i} className={`ach-tier ${t.unlocked ? 'on' : ''}`} title={f.desc(t.threshold)}>
            <Medal
              group={f.group}
              icon={f.icon}
              material={t.unlocked ? materialFor(i + 1, n) : null}
              label={ribbon(t.threshold, f.unit)}
              progress={i === r.tier ? r.progress : 0}
              size={60}
            />
            <span className="num">{ROMAN[i]}</span>
            <span className="small faint num">{t.unlocked ? (t.at ? fmtDate(t.at, { day: 'numeric', month: 'numeric', year: '2-digit' }) : '✓') : i === r.tier ? `${Math.round(r.progress * 100)} %` : ' '}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SingleDetail({ r }: { r: SingleResult }) {
  const s = r.single;
  const hidden = s.secret && !r.unlocked;
  return (
    <div className="ach-detail">
      <div className="ach-hero-medal">
        <Medal group={s.group} icon={s.icon} material={r.unlocked ? 'gold' : null} secret={s.secret} size={196} tilt />
      </div>
      <div className="ach-detail-text">
        <span className="label">
          {s.group}
          {s.secret ? ' · skrytý' : ''}
        </span>
        <p className="ach-detail-desc">{hidden ? 'Podmínku prozradí až samotné získání.' : s.desc}</p>
        {r.unlocked && <span className="small faint num">{r.at ? `získáno ${fmtDay(r.at)}` : 'získáno'}</span>}
        <Rarity />
      </div>
    </div>
  );
}

export function AchievementsPage() {
  const { data } = useStore();
  const res = useMemo(() => evaluate(data), [data]);
  const [selected, setSelected] = useState<Selected>(null);

  // „Nové“ = získané od poslední návštěvy této stránky (první návštěva nic neoznačí)
  const [fresh] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(VIEWED_KEY);
      if (!raw) return new Set();
      const seen = new Set<string>(JSON.parse(raw));
      return new Set(res.unlockedIds.filter((id) => !seen.has(id)));
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEWED_KEY, JSON.stringify(res.unlockedIds));
    } catch {
      /* ignore */
    }
  }, [res.unlockedIds]);

  const famFresh = (r: FamilyResult) => r.tiers.some((t, i) => t.unlocked && fresh.has(`${r.family.id}.${i + 1}`));

  // sbírka podle kovů
  const byMaterial = new Map<Material, number>(MATERIALS.map((m) => [m, 0]));
  for (const r of res.families) for (let i = 0; i < r.tier; i++) {
    const m = materialFor(i + 1, r.family.thresholds.length);
    byMaterial.set(m, byMaterial.get(m)! + 1);
  }
  for (const s of res.singles) if (s.unlocked) byMaterial.set('gold', byMaterial.get('gold')! + 1);

  const close = res.families.filter((r) => r.next != null && r.value > 0).sort((a, b) => b.progress - a.progress).slice(0, 4);
  const recent = [
    ...res.families.flatMap((r) => r.tiers.map((t, i) => ({ key: `${r.family.id}.${i + 1}`, r, i, at: t.at, unlocked: t.unlocked }))),
  ]
    .filter((x) => x.unlocked && x.at)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  const recentSingles = res.singles.filter((s) => s.unlocked && s.at);
  const latest = [
    ...recent.map((x) => ({ key: x.key, at: x.at!, node: <Medal group={x.r.family.group} icon={x.r.family.icon} material={materialFor(x.i + 1, x.r.family.thresholds.length)} label={ribbon(x.r.family.thresholds[x.i], x.r.family.unit)} size={64} />, name: `${x.r.family.name}${x.r.family.thresholds.length > 1 ? ' ' + ROMAN[x.i] : ''}`, open: () => setSelected({ kind: 'family', r: x.r }) })),
    ...recentSingles.map((s) => ({ key: s.single.id, at: s.at!, node: <Medal group={s.single.group} icon={s.single.icon} material="gold" size={64} />, name: s.single.name, open: () => setSelected({ kind: 'single', r: s }) })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 6);

  const pct = res.total ? res.unlocked / res.total : 0;

  return (
    <div className="stack loose">
      <div className="page-head">
        <div>
          <h1>Úspěchy</h1>
          <p>Počítají se z tvých dat, i zpětně. Kliknutím na medaili uvidíš všechny její úrovně.</p>
        </div>
      </div>

      <div className="card ach-summary">
        <div className="ach-count">
          <span className="label">sbírka</span>
          <span className="ach-count-num num">
            {res.unlocked}
            <small>/{res.total}</small>
          </span>
          <div className="ach-bar big">
            <i style={{ width: `${Math.round(pct * 100)}%` }} />
          </div>
          <span className="small faint">{Math.round(pct * 100)} % všech medailí</span>
        </div>
        <div className="ach-metals">
          {MATERIALS.map((m) => (
            <div key={m} className={`ach-metal ${byMaterial.get(m) ? '' : 'none'}`}>
              <Coin material={m} size={22} />
              <span className="num">{byMaterial.get(m)}</span>
              <span className="label">{MATERIAL_LABEL[m]}</span>
            </div>
          ))}
        </div>
      </div>

      {(close.length > 0 || latest.length > 0) && (
        <div className="g12">
          {close.length > 0 && (
            <div className={`card ${latest.length ? 'c-7 xl-8' : 'c-12'}`}>
              <div className="card-head">
                <h2>Na dosah</h2>
                <span className="sub">nejblíž další úrovni</span>
              </div>
              <div className="ach-close">
                {close.map((r) => (
                  <button key={r.family.id} className="ach-close-item" onClick={() => setSelected({ kind: 'family', r })}>
                    <Medal group={r.family.group} icon={r.family.icon} material={null} label={ribbon(r.next!, r.family.unit)} progress={r.progress} size={76} tilt />
                    <span className="ach-tile-name">
                      {r.family.name}
                      {r.family.thresholds.length > 1 && <span className="num ach-tile-roman"> {ROMAN[r.tier]}</span>}
                    </span>
                    <span className="ach-tile-foot num">
                      {Math.round(r.progress * 100)} % · {remaining(r)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {latest.length > 0 && (
            <div className={`card ${close.length ? 'c-5 xl-4' : 'c-12'}`}>
              <div className="card-head">
                <h2>Nedávno získané</h2>
              </div>
              <div className="ach-latest">
                {latest.map((x) => (
                  <button key={x.key} className="ach-latest-item" onClick={x.open} title={x.name}>
                    {x.node}
                    <span className="small ellipsis">{x.name}</span>
                    <span className="small faint num">{fmtDate(x.at, { day: 'numeric', month: 'numeric' })}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {GROUPS.map((g) => {
        const fams = res.families.filter((r) => r.family.group === g);
        const singles = res.singles.filter((s) => s.single.group === g);
        if (!fams.length && !singles.length) return null;
        const unlocked = fams.reduce((a, r) => a + r.tier, 0) + singles.filter((s) => s.unlocked).length;
        const total = fams.reduce((a, r) => a + r.family.thresholds.length, 0) + singles.length;
        return (
          <section key={g} className="ach-group">
            <div className="ach-group-head">
              <h2>{g}</h2>
              <span className="num faint">
                {unlocked}/{total}
              </span>
            </div>
            <div className="ach-grid">
              {fams.map((r) => (
                <FamilyTile key={r.family.id} r={r} fresh={famFresh(r)} onOpen={() => setSelected({ kind: 'family', r })} />
              ))}
              {singles.map((s) => (
                <SingleTile key={s.single.id} r={s} fresh={fresh.has(s.single.id)} onOpen={() => setSelected({ kind: 'single', r: s })} />
              ))}
            </div>
          </section>
        );
      })}

      {selected && (
        <Modal
          wide
          title={
            selected.kind === 'family'
              ? `${selected.r.family.name}${selected.r.tier > 0 && selected.r.family.thresholds.length > 1 ? ' ' + ROMAN[selected.r.tier - 1] : ''}`
              : selected.r.single.secret && !selected.r.unlocked
                ? 'Skrytý úspěch'
                : selected.r.single.name
          }
          onClose={() => setSelected(null)}
        >
          {selected.kind === 'family' ? <FamilyDetail r={selected.r} /> : <SingleDetail r={selected.r} />}
        </Modal>
      )}
    </div>
  );
}
