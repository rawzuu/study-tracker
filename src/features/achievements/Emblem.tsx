import {
  Anchor, Blocks, BookOpen, Brain, Calendar, Check, Clock, Coffee, Flame, FlaskConical, Gift, GraduationCap, Grid3x3, Hourglass, Layers,
  ListChecks, LucideIcon, Moon, Mountain, NotebookPen, Pi, Repeat, Shield, Shuffle, Sparkles, Star, Sun, Sunrise, Target, Trophy, Undo2,
} from 'lucide-react';
import { IconName, ROMAN } from './achievements';

const ICONS: Record<IconName, LucideIcon> = {
  clock: Clock, flame: Flame, blocks: Blocks, sun: Sun, calendar: Calendar, target: Target, mountain: Mountain, repeat: Repeat,
  anchor: Anchor, check: Check, notebook: NotebookPen, list: ListChecks, star: Star, trophy: Trophy, book: BookOpen, layers: Layers,
  shuffle: Shuffle, sunrise: Sunrise, moon: Moon, coffee: Coffee, shield: Shield, brain: Brain, flask: FlaskConical,
  graduation: GraduationCap, undo: Undo2, grid: Grid3x3, sparkles: Sparkles, gift: Gift, pi: Pi, hourglass: Hourglass,
};

/** Kovové odstíny úrovní: ocel → bronz → stříbro → zlato → platina. */
const METALS = ['#8b95a5', '#b98a5a', '#c3cad4', '#e2b54d', '#9fd8f5'];

export function metalFor(tier: number, tiers: number): string {
  if (tier <= 0) return 'var(--line-strong)';
  if (tiers <= 1) return METALS[3];
  return METALS[Math.round(((tier - 1) / (tiers - 1)) * 4)];
}

/** Šestiúhelníkový „štítek“ s ikonou a římským číslem úrovně. */
export function Emblem({ icon, tier, tiers, size = 46, secret }: { icon: IconName; tier: number; tiers: number; size?: number; secret?: boolean }) {
  const Icon = ICONS[icon];
  const on = tier > 0;
  const c = metalFor(tier, tiers);
  const id = `g-${icon}-${tier}-${tiers}`;
  return (
    <span className={`emblem ${on ? 'on' : ''}`} style={{ width: size, height: size * 1.1, ['--m' as string]: c }}>
      <svg viewBox="0 0 40 44" width={size} height={size * 1.1} aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={c} stopOpacity={on ? 0.22 : 0} />
            <stop offset="1" stopColor={c} stopOpacity={on ? 0.04 : 0} />
          </linearGradient>
        </defs>
        <path d="M20 1.5 37.5 11.5v21L20 42.5 2.5 32.5v-21Z" fill={`url(#${id})`} stroke={c} strokeWidth={on ? 1.4 : 1} strokeDasharray={on ? undefined : '2.5 2.5'} />
        {on && <path d="M20 5.5 34 13.5v17L20 38.5 6 30.5v-17Z" fill="none" stroke={c} strokeOpacity={0.35} strokeWidth={0.6} />}
      </svg>
      <span className="emblem-icon">{secret && !on ? <span className="num">?</span> : <Icon size={size * 0.36} strokeWidth={1.6} />}</span>
      {on && tiers > 1 && <span className="emblem-tier num">{ROMAN[tier - 1]}</span>}
    </span>
  );
}
