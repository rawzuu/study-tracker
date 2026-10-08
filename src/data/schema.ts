/**
 * Datové schéma aplikace.
 *
 * PRAVIDLA PRO ZMĚNY (aby se nikdy neztratila data):
 *  1. Přidání NOVÉHO volitelného pole nebo nové kolekce verzi nemění – starší verze aplikace
 *     neznámá pole jen ignorují (a nesmažou). Tak zůstává možný návrat na starší release.
 *  2. Když měníš tvar EXISTUJÍCÍCH dat (přejmenování, jiný typ), zvyš SCHEMA_VERSION o 1
 *     a do `migrations.ts` přidej převodní funkci.
 *  3. Nikdy nemaž ani nepřejmenovávej pole bez migrace.
 *  4. Každá entita má `id`, `createdAt`, `updatedAt` a volitelně `deletedAt`.
 *     Mazání je "měkké" (nastaví se deletedAt), díky tomu funguje synchronizace mezi zařízeními.
 */

export const SCHEMA_VERSION = 1;

export interface Entity {
  id: string;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms – podle něj se řeší konflikty při synchronizaci
  deletedAt?: number;
}

export interface Subject extends Entity {
  name: string;
  color: string;
  weeklyGoalMin: number; // 0 = bez cíle
  archived: boolean;
}

export interface Session extends Entity {
  subjectId: string;
  topic: string;
  start: number; // epoch ms
  end: number; // epoch ms
  durationSec: number; // čistý čas učení (bez pauz)
  mode: string; // id režimu časovače nebo 'manual'
  focus?: number; // 1–5
  interruptions: number;
  note: string;
  topicId?: string; // v1.1+: odkaz na téma
  recall?: string; // v1.1+: co si pamatuješ po bloku (retrieval practice)
}

/** Téma/kapitola předmětu s plánem rozloženého opakování. (v1.1+) */
export interface Topic extends Entity {
  subjectId: string;
  name: string;
  stage: number; // -1 = ještě neučeno, 0.. = index intervalu opakování
  lastStudiedAt?: number;
  nextReviewAt?: number;
  reviews: number;
  mastered: boolean; // zvládnuto – už se neopakuje
  note: string;
  fsrs?: TopicFsrs; // v2.1+: stav algoritmu FSRS-6 (stage/nextReviewAt se dál vyplňují kvůli starším verzím)
}

/** Stav tématu podle FSRS (paměťový model Stabilita–Obtížnost–Vybavitelnost). */
export interface TopicFsrs {
  s: number; // stabilita ve dnech
  d: number; // obtížnost 1–10
  state: number; // 0 nové, 1 učení, 2 opakování, 3 znovu učení
  reps: number;
  lapses: number; // kolikrát zapomenuto
  scheduledDays: number;
  lastReview?: number;
  due: number;
}

/** Poslední stav z Anki (přes AnkiConnect). (v2.1+) */
export interface AnkiSnapshot extends Entity {
  at: number;
  decks: { name: string; newCount: number; learnCount: number; reviewCount: number; total: number }[];
  reviewedToday: number;
  msToday: number;
}

export interface AnkiSettings {
  enabled: boolean;
  countTime: boolean; // započítávat čas z Anki jako sezení
  deckSubjects: Record<string, string>; // balíček → id předmětu
  importDays: number;
}

/** Týdenní reflexe. (v1.1+) */
export interface Reflection extends Entity {
  weekStart: string; // YYYY-MM-DD (pondělí)
  rating: number; // 1–5
  wentWell: string;
  blocked: string;
  focusNext: string;
}

export interface PlanBlock extends Entity {
  subjectId: string;
  title: string;
  start: number; // epoch ms
  durationMin: number;
  done: boolean;
  examId?: string; // vygenerováno z plánovače zkoušky
  note: string;
}

export interface Exam extends Entity {
  subjectId: string;
  name: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM nebo ''
  note: string;
}

/**
 * Importovaný rozvrh (např. školní z .ics). Slouží jen jako obsazený čas v kalendáři a v ranním plánu. (v2.3+)
 * Celý rozvrh je jedna entita – nový import ho nahradí najednou a synchronizace řeší jen jeden záznam.
 */
export interface Timetable extends Entity {
  name: string;
  importedAt: number;
  events: TimetableEvent[]; // jednotlivé termíny (opakování už rozbalená)
  hiddenSeries: string[]; // skryté řady (předměty) – platí i po novém importu
  skipped: string[]; // klíče jednotlivých termínů, které odpadají
}

export interface TimetableEvent {
  key: string; // řada + začátek – stabilní mezi importy
  series: string; // název akce – podle něj se skrývá celá řada
  title: string;
  location: string;
  start: number;
  end: number;
}

/** Záznam o návrhu z měsíčního reportu (použitý nebo ponechaný). (v2.3+) */
export interface CalibrationEntry {
  month: string; // YYYY-MM – měsíc reportu
  key: 'dailyGoal' | 'weeklyGoals' | 'dayWindow';
  action: 'applied' | 'kept';
  at: number;
  before?: unknown; // původní hodnota (kvůli vrácení)
  after?: unknown; // nová hodnota (pro zobrazení v reportu)
}

export interface TimerPreset extends Entity {
  name: string;
  workMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  roundsBeforeLong: number;
}

export type ThemePref = 'dark' | 'light' | 'system';
export type NoiseType = 'off' | 'brown' | 'pink' | 'white';

export interface CalendarFeed {
  gistId: string;
  owner: string;
  includeExams: boolean;
  alarmMin: number | null;
}

export interface Settings {
  updatedAt: number;
  theme: ThemePref;
  dailyGoalMin: number;
  defaultMode: string;
  autoStartBreaks: boolean;
  autoStartWork: boolean;
  sound: boolean;
  volume: number; // 0–1
  notifications: boolean;
  askFocusRating: boolean;
  flowtimeRatio: number; // pauza = práce / ratio
  minSessionSec: number; // kratší sezení se neukládají
  // v1.1+
  askRecall: boolean;
  noiseType: NoiseType;
  noiseVolume: number;
  weeklyReflection: boolean;
  calendarFeed: CalendarFeed | null;
  // v2.1+
  desiredRetention: number; // cílová pravděpodobnost vybavení (FSRS)
  maxIntervalDays: number;
  anki: AnkiSettings;
  // v2.2+
  planDayStart: string; // HH:MM – od kdy plánovat den
  planDayEnd: string; // HH:MM
  // v2.3+
  calibration: CalibrationEntry[];
}

export interface AppData {
  schemaVersion: number;
  subjects: Subject[];
  sessions: Session[];
  planBlocks: PlanBlock[];
  exams: Exam[];
  presets: TimerPreset[];
  topics: Topic[];
  reflections: Reflection[];
  anki: AnkiSnapshot[];
  timetables: Timetable[]; // v2.3+
  settings: Settings;
}

/** Kolekce entit, které se slučují po jednotlivých záznamech. */
export const COLLECTIONS = ['subjects', 'sessions', 'planBlocks', 'exams', 'presets', 'topics', 'reflections', 'anki', 'timetables'] as const;
export type CollectionKey = (typeof COLLECTIONS)[number];

export const SUBJECT_COLORS = [
  '#7c8cff', // indigo
  '#3dd68c', // green
  '#f472b6', // pink
  '#5eb1ef', // blue
  '#ffb224', // amber
  '#a78bfa', // violet
  '#ff7a59', // coral
  '#2ec8b6', // teal
  '#e5e5e5', // light
  '#c2a878', // sand
];

export function defaultSettings(): Settings {
  return {
    updatedAt: 0,
    theme: 'dark',
    dailyGoalMin: 120,
    defaultMode: 'pomodoro',
    autoStartBreaks: true,
    autoStartWork: false,
    sound: true,
    volume: 0.6,
    notifications: false,
    askFocusRating: true,
    flowtimeRatio: 5,
    minSessionSec: 60,
    askRecall: true,
    noiseType: 'off',
    noiseVolume: 0.35,
    weeklyReflection: true,
    calendarFeed: null,
    desiredRetention: 0.9,
    maxIntervalDays: 365,
    anki: { enabled: false, countTime: true, deckSubjects: {}, importDays: 60 },
    planDayStart: '08:00',
    planDayEnd: '22:00',
    calibration: [],
  };
}

export function emptyData(): AppData {
  return {
    schemaVersion: SCHEMA_VERSION,
    subjects: [],
    sessions: [],
    planBlocks: [],
    exams: [],
    presets: [],
    topics: [],
    reflections: [],
    anki: [],
    timetables: [],
    settings: defaultSettings(),
  };
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function alive<T extends Entity>(list: T[]): T[] {
  return list.filter((e) => !e.deletedAt);
}
