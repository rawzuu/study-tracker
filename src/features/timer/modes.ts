import { TimerPreset } from '../../data/schema';

export type Evidence = 'silné' | 'střední' | 'slabé' | 'nástroj';

export interface TimerMode {
  id: string;
  name: string;
  /** null = počítá nahoru (Flowtime, stopky) */
  workMin: number | null;
  shortBreakMin: number;
  longBreakMin: number;
  roundsBeforeLong: number;
  kind: 'interval' | 'flowtime' | 'stopwatch';
  tagline: string;
  description: string;
  evidence: Evidence;
  custom?: boolean;
}

export const BUILTIN_MODES: TimerMode[] = [
  {
    id: 'pomodoro',
    name: 'Pomodoro',
    workMin: 25,
    shortBreakMin: 5,
    longBreakMin: 20,
    roundsBeforeLong: 4,
    kind: 'interval',
    tagline: '25 / 5 · dlouhá pauza po 4 kolech',
    description:
      'Klasika (Cirillo). Krátké bloky snižují práh pro začátek a pravidelné pauzy brání únavě. Studie Biwer et al. (2023) ukázala, že systematické pauzy vedou k menší únavě a lepší náladě než pauzy „podle pocitu“ při stejném výkonu.',
    evidence: 'střední',
  },
  {
    id: 'pomodoro-long',
    name: 'Dlouhé Pomodoro',
    workMin: 50,
    shortBreakMin: 10,
    longBreakMin: 30,
    roundsBeforeLong: 3,
    kind: 'interval',
    tagline: '50 / 10 · pro hlubokou práci',
    description:
      'Delší bloky pro úlohy, kde trvá „rozjet se“ – matematika, programování, psaní. Zachovává poměr práce a pauzy ~5:1 jako klasické Pomodoro.',
    evidence: 'střední',
  },
  {
    id: '52-17',
    name: '52 / 17',
    workMin: 52,
    shortBreakMin: 17,
    longBreakMin: 17,
    roundsBeforeLong: 99,
    kind: 'interval',
    tagline: '52 / 17 · podle dat DeskTime',
    description:
      'Populární rytmus odvozený z dat aplikace DeskTime o nejproduktivnějších uživatelích. Nejde o kontrolovanou studii – ber to jako jednu z možností, ne jako vědecký fakt.',
    evidence: 'slabé',
  },
  {
    id: 'ultradian',
    name: 'Ultradiánní blok',
    workMin: 90,
    shortBreakMin: 20,
    longBreakMin: 30,
    roundsBeforeLong: 3,
    kind: 'interval',
    tagline: '90 / 20 · přirozený cyklus pozornosti',
    description:
      'Vychází z Kleitmanova „basic rest-activity cycle“ (~90 min). Hodí se na dlouhé soustředění u náročné látky. Důkazy pro bdělý stav jsou smíšené.',
    evidence: 'střední',
  },
  {
    id: 'flowtime',
    name: 'Flowtime',
    workMin: null,
    shortBreakMin: 0,
    longBreakMin: 0,
    roundsBeforeLong: 99,
    kind: 'flowtime',
    tagline: 'Učíš se, dokud jsi ve flow · pauza ≈ 1/5',
    description:
      'Nepřerušuje tě uprostřed soustředění. Až skončíš, aplikace navrhne pauzu úměrnou délce práce (výchozí 1/5, nastavitelné). Dobré, když tě pevný časovač vytrhává z flow.',
    evidence: 'nástroj',
  },
  {
    id: 'stopwatch',
    name: 'Stopky',
    workMin: null,
    shortBreakMin: 0,
    longBreakMin: 0,
    roundsBeforeLong: 99,
    kind: 'stopwatch',
    tagline: 'Jen měří čas, žádné pauzy',
    description: 'Prosté měření času – třeba na přednášku, cvičení nebo když chceš pauzy řídit sám.',
    evidence: 'nástroj',
  },
];

export function presetToMode(p: TimerPreset): TimerMode {
  return {
    id: p.id,
    name: p.name,
    workMin: p.workMin,
    shortBreakMin: p.shortBreakMin,
    longBreakMin: p.longBreakMin,
    roundsBeforeLong: p.roundsBeforeLong,
    kind: 'interval',
    tagline: `${p.workMin} / ${p.shortBreakMin} · dlouhá ${p.longBreakMin} min po ${p.roundsBeforeLong} kolech`,
    description: 'Tvůj vlastní režim.',
    evidence: 'nástroj',
    custom: true,
  };
}

export function allModes(presets: TimerPreset[]): TimerMode[] {
  return [...BUILTIN_MODES, ...presets.filter((p) => !p.deletedAt).map(presetToMode)];
}

export function modeName(id: string, presets: TimerPreset[]): string {
  if (id === 'manual') return 'Ruční zápis';
  if (id === 'plan') return 'Z plánu';
  return allModes(presets).find((m) => m.id === id)?.name ?? 'Neznámý režim';
}

export const BREAK_TIPS = [
  'Vstaň a projdi se – pohyb zlepšuje prokrvení mozku.',
  'Napij se vody. I mírná dehydratace zhoršuje pozornost.',
  'Podívej se 20 sekund do dálky (pravidlo 20-20-20) – odpočinou si oči.',
  'Nech mobil ležet. Scrollování mozek neodpočine, jen přepne.',
  'Pár hlubokých nádechů nebo protažení zad a krku.',
  'Zkus si bez poznámek říct, co ses právě naučil – retrieval practice patří k nejúčinnějším metodám.',
  'Vyvětrej. Čerstvý vzduch a nižší CO₂ pomáhají soustředění.',
  'Zavři oči a minutu nic nedělej. Klidný odpočinek pomáhá ukládat nové informace.',
];
