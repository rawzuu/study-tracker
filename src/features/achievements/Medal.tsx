import { PointerEvent, useId, useRef } from 'react';
import {
  Anchor, Blocks, BookOpen, Brain, Calendar, Check, Clock, Coffee, Flame, FlaskConical, Gift, GraduationCap, Grid3x3, Hourglass, Layers,
  ListChecks, LucideIcon, Moon, Mountain, NotebookPen, Pi, Repeat, Shield, Shuffle, Sparkles, Star, Sun, Sunrise, Target, Trophy, Undo2,
} from 'lucide-react';
import { Group, IconName } from './achievements';

/**
 * Medaile úspěchu – inspirováno tím, jak úspěchy dělají Apple Fitness, Xbox nebo GitHub:
 *  - tvar podle kategorie (čte se dřív než text): Čas = mince, Pravidelnost = šestiúhelník, …
 *  - materiál podle úrovně: ocel → bronz → stříbro → zlato → platina (kovový lem, vypouklá plocha, odlesk)
 *  - smaltovaný pruh v barvě kategorie a vyražené číslo úrovně, takže každá úroveň vypadá jinak
 *  - zamčená medaile je „neražený“ grafitový polotovar s kroužkem postupu k odemčení
 */

const ICONS: Record<IconName, LucideIcon> = {
  clock: Clock, flame: Flame, blocks: Blocks, sun: Sun, calendar: Calendar, target: Target, mountain: Mountain, repeat: Repeat,
  anchor: Anchor, check: Check, notebook: NotebookPen, list: ListChecks, star: Star, trophy: Trophy, book: BookOpen, layers: Layers,
  shuffle: Shuffle, sunrise: Sunrise, moon: Moon, coffee: Coffee, shield: Shield, brain: Brain, flask: FlaskConical,
  graduation: GraduationCap, undo: Undo2, grid: Grid3x3, sparkles: Sparkles, gift: Gift, pi: Pi, hourglass: Hourglass,
};

export type Material = 'steel' | 'bronze' | 'silver' | 'gold' | 'platinum';
export const MATERIALS: Material[] = ['steel', 'bronze', 'silver', 'gold', 'platinum'];
export const MATERIAL_LABEL: Record<Material, string> = { steel: 'ocel', bronze: 'bronz', silver: 'stříbro', gold: 'zlato', platinum: 'platina' };

/** Barevné stopy kovu: světlo, střed, stín, „ryté“ písmo. */
const METAL: Record<Material, { hi: string; mid: string; lo: string; ink: string }> = {
  steel: { hi: '#eef1f5', mid: '#a3acb7', lo: '#58616c', ink: '#353c45' },
  bronze: { hi: '#f7d4b0', mid: '#c0824f', lo: '#6b3d21', ink: '#45260f' },
  silver: { hi: '#ffffff', mid: '#c8ced5', lo: '#7a838d', ink: '#474e56' },
  gold: { hi: '#fff3bf', mid: '#e2b247', lo: '#8a5f12', ink: '#553a06' },
  platinum: { hi: '#f5fcff', mid: '#b7dbee', lo: '#5a8ba5', ink: '#2c5265' },
};

/** Smalt podle kategorie – tlumené tóny, ať medaile nepůsobí jako hračka. */
const ENAMEL: Record<Group, string> = {
  Čas: '#9a6a1d',
  Pravidelnost: '#a2442b',
  Soustředění: '#2c5d8c',
  Paměť: '#22756b',
  Plánování: '#4d5b72',
  Pestrost: '#5d782d',
  Zvláštní: '#7a2f40',
};

type Shape = 'circle' | 'hex' | 'oct' | 'shield' | 'square' | 'rosette' | 'seal';
const SHAPE: Record<Group, Shape> = {
  Čas: 'circle',
  Pravidelnost: 'hex',
  Soustředění: 'oct',
  Paměť: 'shield',
  Plánování: 'square',
  Pestrost: 'rosette',
  Zvláštní: 'seal',
};

/** Materiál pro úroveň `tier` z `tiers` (1 = první). */
export function materialFor(tier: number, tiers: number): Material {
  if (tiers <= 1) return 'gold';
  return MATERIALS[Math.round(((tier - 1) / (tiers - 1)) * 4)];
}

const C = 50; // střed viewBoxu 100 × 100
const RAYS = Array.from({ length: 48 }, (_, i) => (i * Math.PI) / 24);
const pt = (r: number, a: number) => `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`;

function polygon(n: number, r: number, rot = -Math.PI / 2): string {
  return `M${Array.from({ length: n }, (_, i) => pt(r, rot + (i * 2 * Math.PI) / n)).join('L')}Z`;
}

/** Obrys tvaru o „poloměru“ r (stejný tvar v různých velikostech = lem, smalt, plocha). */
function shapePath(shape: Shape, r: number): string {
  switch (shape) {
    case 'circle':
      return `M${C - r} ${C}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    case 'hex':
      return polygon(6, r * 1.04);
    case 'oct':
      return polygon(8, r * 1.02, -Math.PI / 2 + Math.PI / 8);
    case 'square': {
      const h = r * 0.9;
      const k = r * 0.3;
      return `M${C - h + k} ${C - h}H${C + h - k}Q${C + h} ${C - h} ${C + h} ${C - h + k}V${C + h - k}Q${C + h} ${C + h} ${C + h - k} ${C + h}H${C - h + k}Q${C - h} ${C + h} ${C - h} ${C + h - k}V${C - h + k}Q${C - h} ${C - h} ${C - h + k} ${C - h}Z`;
    }
    case 'shield': {
      const w = r * 0.88;
      const t = C - r * 0.92;
      return `M${C} ${t - r * 0.04}Q${C + w * 0.55} ${t + r * 0.1} ${C + w} ${t + r * 0.06}V${C + r * 0.12}Q${C + w * 0.92} ${C + r * 0.72} ${C} ${C + r * 1.02}Q${C - w * 0.92} ${C + r * 0.72} ${C - w} ${C + r * 0.12}V${t + r * 0.06}Q${C - w * 0.55} ${t + r * 0.1} ${C} ${t - r * 0.04}Z`;
    }
    case 'rosette': {
      const n = 12;
      let d = '';
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const a1 = a0 + (2 * Math.PI) / n;
        if (i === 0) d += `M${pt(r * 0.93, a0)}`;
        d += `Q${pt(r * 1.07, (a0 + a1) / 2)} ${pt(r * 0.93, a1)}`;
      }
      return d + 'Z';
    }
    case 'seal': {
      const n = 16;
      return `M${Array.from({ length: n * 2 }, (_, i) => pt(i % 2 ? r * 0.86 : r * 1.02, -Math.PI / 2 + (i * Math.PI) / n)).join('L')}Z`;
    }
  }
}

export interface MedalProps {
  group: Group;
  icon: IconName;
  material: Material | null; // null = zamčeno
  label?: string; // vyražené číslo na stužce, např. „100 h“
  progress?: number; // 0–1, kroužek postupu u zamčené medaile
  secret?: boolean;
  size?: number;
  tilt?: boolean; // náklon a odlesk za myší
  fresh?: boolean; // právě získaná – jednou přeletí lesk
}

/** Náklon a odlesk podle polohy myši – jako když medailí otočíš ve světle. */
function useTilt(enabled: boolean) {
  const ref = useRef<HTMLSpanElement>(null);
  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    const el = ref.current;
    if (!enabled || !el || e.pointerType === 'touch') return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--ry', `${(x * 22).toFixed(1)}deg`);
    el.style.setProperty('--rx', `${(-y * 22).toFixed(1)}deg`);
    el.style.setProperty('--sx', `${(x * 110).toFixed(0)}px`);
  };
  const onPointerLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--sx', '-85px');
  };
  return { ref, onPointerMove, onPointerLeave };
}

export function Medal({ group, icon, material, label, progress = 0, secret, size = 84, tilt, fresh }: MedalProps) {
  const uid = useId().replace(/:/g, '');
  const shape = SHAPE[group];
  const Icon = ICONS[icon];
  const on = material != null;
  const m = on ? METAL[material] : null;
  const enamel = ENAMEL[group];
  const t = useTilt(!!tilt);
  const id = (k: string) => `${k}-${uid}`;
  const showRing = !on && progress > 0;
  const ringR = 49;
  const ringLen = 2 * Math.PI * ringR;

  return (
    <span
      ref={t.ref}
      className={`medal ${on ? 'on' : 'locked'} ${tilt ? 'tilt' : ''} ${fresh ? 'fresh' : ''}`}
      style={{ width: size, height: size }}
      onPointerMove={t.onPointerMove}
      onPointerLeave={t.onPointerLeave}
    >
      <span className="medal-body">
        <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
          <defs>
            <linearGradient id={id('rim')} x1="0.15" y1="0" x2="0.85" y2="1">
              {on ? (
                <>
                  <stop offset="0" stopColor={m!.hi} />
                  <stop offset="0.45" stopColor={m!.mid} />
                  <stop offset="1" stopColor={m!.lo} />
                </>
              ) : (
                <>
                  <stop offset="0" style={{ stopColor: 'var(--medal-lock-hi)' }} />
                  <stop offset="1" style={{ stopColor: 'var(--medal-lock-lo)' }} />
                </>
              )}
            </linearGradient>
            <radialGradient id={id('face')} cx="0.36" cy="0.3" r="0.85">
              {on ? (
                <>
                  <stop offset="0" stopColor={m!.hi} />
                  <stop offset="0.55" stopColor={m!.mid} />
                  <stop offset="1" stopColor={m!.lo} />
                </>
              ) : (
                <>
                  <stop offset="0" style={{ stopColor: 'var(--medal-lock-face-hi)' }} />
                  <stop offset="1" style={{ stopColor: 'var(--medal-lock-face-lo)' }} />
                </>
              )}
            </radialGradient>
            <linearGradient id={id('enamel')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={enamel} stopOpacity={1} />
              <stop offset="1" stopColor="#000" stopOpacity={0.55} />
            </linearGradient>
            <linearGradient id={id('sheen')} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <clipPath id={id('clip')}>
              <path d={shapePath(shape, 46)} />
            </clipPath>
            <clipPath id={id('faceclip')}>
              <path d={shapePath(shape, 34)} />
            </clipPath>
          </defs>

          {showRing && (
            <g className="medal-ring">
              <circle cx={C} cy={C} r={ringR} fill="none" strokeWidth="1.6" className="medal-ring-track" />
              <circle
                cx={C}
                cy={C}
                r={ringR}
                fill="none"
                strokeWidth="1.8"
                strokeLinecap="round"
                className="medal-ring-fill"
                strokeDasharray={`${(ringLen * Math.min(1, progress)).toFixed(1)} ${ringLen.toFixed(1)}`}
                transform={`rotate(-90 ${C} ${C})`}
              />
            </g>
          )}

          {/* lem */}
          <path d={shapePath(shape, 46)} fill={`url(#${id('rim')})`} className="medal-rim" />
          {/* smaltovaný pruh (u zamčené jen tmavá drážka) */}
          <path d={shapePath(shape, 40.5)} fill={on ? `url(#${id('enamel')})` : 'var(--medal-lock-groove)'} />
          <path d={shapePath(shape, 40.5)} fill="none" stroke="#000" strokeOpacity={on ? 0.35 : 0.2} strokeWidth="0.8" />
          {/* plocha */}
          <path d={shapePath(shape, 34)} fill={`url(#${id('face')})`} />
          {/* jemné paprskové gravírování plochy (jako ciferník) */}
          {on && (
            <g clipPath={`url(#${id('faceclip')})`} className="medal-guilloche">
              {RAYS.map((a, i) => (
                <line key={i} x1={C} y1={C} x2={C + 40 * Math.cos(a)} y2={C + 40 * Math.sin(a)} stroke={i % 2 ? m!.lo : m!.hi} strokeWidth="0.35" />
              ))}
            </g>
          )}
          <path d={shapePath(shape, 34)} fill="none" stroke={on ? m!.hi : 'var(--medal-lock-hi)'} strokeOpacity={on ? 0.7 : 0.35} strokeWidth="0.7" />

          {/* odlesk */}
          {on && (
            <g clipPath={`url(#${id('clip')})`}>
              <rect className="medal-sheen" x="33" y="-20" width="34" height="140" fill={`url(#${id('sheen')})`} transform="rotate(20 50 50)" />
            </g>
          )}

          {/* stužka s vyraženým číslem */}
          {label && (
            <g className="medal-ribbon">
              <path d="M28 76h44l-4 6 4 6H28l4-6Z" fill={on ? '#111' : 'var(--medal-lock-ribbon)'} stroke={on ? m!.mid : 'var(--medal-lock-hi)'} strokeWidth="0.8" />
              <text x="50" y="84.4" textAnchor="middle" fill={on ? m!.hi : 'var(--text-3)'}>
                {label}
              </text>
            </g>
          )}
        </svg>
        <span className="medal-icon" style={{ color: on ? m!.ink : undefined, marginTop: label ? -size * 0.08 : 0 }}>
          {secret && !on ? <span className="num medal-q">?</span> : <Icon size={Math.round(size * 0.3)} strokeWidth={2} />}
        </span>
      </span>
    </span>
  );
}

/** Malá kovová mince (souhrn sbírky podle materiálů). */
export function Coin({ material, size = 14 }: { material: Material; size?: number }) {
  const m = METAL[material];
  return (
    <span
      className="coin"
      style={{ width: size, height: size, background: `radial-gradient(circle at 35% 30%, ${m.hi}, ${m.mid} 55%, ${m.lo})` }}
      title={MATERIAL_LABEL[material]}
    />
  );
}
