import { ComponentType, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookMarked,
  CalendarDays,
  FileText,
  History,
  LayoutDashboard,
  Menu,
  NotebookPen,
  Repeat,
  Settings,
  Timer,
} from 'lucide-react';
import { useStore } from './data/store';
import { alive } from './data/schema';
import { useRoute } from './lib/router';
import { useApplyTheme } from './lib/theme';
import { fmtClock, fmtTime, startOfDay } from './lib/time';
import { setNoiseVolume, startNoise, stopNoise } from './lib/noise';
import { ThemeContext } from './components/Chart';
import { useTimer } from './features/timer/TimerContext';
import { AfterBlockModal } from './features/timer/FocusRating';
import { Dashboard } from './features/dashboard/Dashboard';
import { TimerPage } from './features/timer/TimerPage';
import { StatsPage } from './features/stats/StatsPage';
import { ReportPage } from './features/stats/ReportPage';
import { PlannerPage } from './features/planner/PlannerPage';
import { useCalendarFeedSync } from './features/planner/calendarFeed';
import { TopicsPage } from './features/topics/TopicsPage';
import { isDue } from './features/topics/schedule';
import { ReflectionPage } from './features/reflection/ReflectionPage';
import { HistoryPage } from './features/sessions/HistoryPage';
import { SubjectsPage } from './features/subjects/SubjectsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { Onboarding } from './features/onboarding/Onboarding';
import { useAnkiSync } from './features/anki/useAnkiSync';

/**
 * Registr stránek. Novou funkci přidáš tak, že vytvoříš složku ve `features/`
 * a přidáš sem jeden řádek.
 */
interface PageDef {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  component: ComponentType;
  group: 'Učení' | 'Přehledy' | 'Nastavení' | null;
  mobile?: boolean; // zobrazit ve spodní liště na mobilu
}

const PAGES: PageDef[] = [
  { id: 'prehled', label: 'Přehled', icon: LayoutDashboard, component: Dashboard, group: 'Učení', mobile: true },
  { id: 'casovac', label: 'Časovač', icon: Timer, component: TimerPage, group: 'Učení', mobile: true },
  { id: 'planovac', label: 'Kalendář', icon: CalendarDays, component: PlannerPage, group: 'Učení', mobile: true },
  { id: 'opakovani', label: 'Opakování', icon: Repeat, component: TopicsPage, group: 'Učení' },
  { id: 'statistiky', label: 'Statistiky', icon: BarChart3, component: StatsPage, group: 'Přehledy', mobile: true },
  { id: 'report', label: 'Měsíční report', icon: FileText, component: ReportPage, group: 'Přehledy' },
  { id: 'reflexe', label: 'Reflexe', icon: NotebookPen, component: ReflectionPage, group: 'Přehledy' },
  { id: 'historie', label: 'Historie', icon: History, component: HistoryPage, group: 'Přehledy' },
  { id: 'predmety', label: 'Předměty', icon: BookMarked, component: SubjectsPage, group: 'Nastavení' },
  { id: 'nastaveni', label: 'Nastavení', icon: Settings, component: SettingsPage, group: 'Nastavení' },
  { id: 'vice', label: 'Více', icon: Menu, component: MorePage, group: null },
];

const GROUPS = ['Učení', 'Přehledy', 'Nastavení'] as const;

function useDueCount(): number {
  const { data } = useStore();
  return useMemo(() => {
    const end = startOfDay(Date.now()) + 86_400_000;
    return data.topics.filter((t) => isDue(t, end)).length;
  }, [data.topics]);
}

function NavLinks({ current }: { current: string }) {
  const due = useDueCount();
  return (
    <nav className="nav">
      {GROUPS.map((g) => (
        <div key={g}>
          <div className="nav-group label">{g}</div>
          {PAGES.filter((p) => p.group === g).map((p) => (
            <a key={p.id} href={`#/${p.id}`} className={p.id === current ? 'active' : ''}>
              <p.icon size={16} strokeWidth={1.75} /> {p.label}
              {p.id === 'opakovani' && due > 0 && <span className="badge">{due}</span>}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}

function MorePage() {
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Více</h1>
      </div>
      <div className="card">
        <NavLinks current="vice" />
      </div>
      <div className="stack tight">
        <MiniTimer />
        <SyncBadge />
      </div>
    </div>
  );
}

function SyncBadge() {
  const { sync, syncNow } = useStore();
  if (sync.status === 'off') {
    return (
      <a href="#/nastaveni" className="sync-badge warn">
        <span className="led" /> záloha vypnutá
      </a>
    );
  }
  if (sync.status === 'error') {
    return (
      <a href="#/nastaveni" className="sync-badge bad" title={sync.message}>
        <span className="led" /> chyba synchronizace
      </a>
    );
  }
  return (
    <button className={`sync-badge ${sync.status === 'syncing' ? 'busy' : ''}`} onClick={() => void syncNow()} title="Synchronizovat teď">
      <span className="led" />
      {sync.status === 'syncing' ? 'synchronizuji…' : sync.status === 'ok' ? `uloženo ${fmtTime(sync.at)}` : 'GitHub připojen'}
    </button>
  );
}

function MiniTimer() {
  const { state, remainingMs, elapsedMs } = useTimer();
  const { data } = useStore();
  if (state.status === 'idle') return null;
  const subj = data.subjects.find((s) => s.id === state.subjectId);
  const isBreak = state.phase !== 'work';
  return (
    <a href="#/casovac" className={`mini-timer ${isBreak ? 'is-break' : ''}`}>
      <span className="mini-dot" />
      <div className="grow ellipsis" style={{ fontWeight: 500 }}>
        {isBreak ? 'Pauza' : (subj?.name ?? 'Učení')}
        {state.status === 'paused' && <span className="faint"> · pozastaveno</span>}
      </div>
      <span className="num">{fmtClock(remainingMs ?? elapsedMs)}</span>
    </a>
  );
}

/** Šum hraje jen během běžícího bloku práce. */
function NoisePlayer() {
  const { data } = useStore();
  const { state } = useTimer();
  const { noiseType, noiseVolume } = data.settings;
  const active = noiseType !== 'off' && state.status === 'running' && state.phase === 'work';
  useEffect(() => {
    if (active) startNoise(noiseType, noiseVolume);
    else stopNoise();
    // hlasitost řeší samostatný efekt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, noiseType]);
  useEffect(() => {
    if (active) setNoiseVolume(noiseVolume);
  }, [active, noiseVolume]);
  useEffect(() => () => stopNoise(0.2), []);
  return null;
}

export function App() {
  const { data } = useStore();
  const theme = useApplyTheme(data.settings.theme);
  const route = useRoute();
  const page = PAGES.find((p) => p.id === (route === 'kalendar' ? 'planovac' : route)) ?? PAGES[0];
  const Page = page.component;
  useCalendarFeedSync(data);
  useAnkiSync();
  // O průvodci se rozhoduje jen jednou při startu – jinak by zmizel hned po přidání prvního předmětu.
  const [showOnboarding] = useState(() => alive(data.subjects).length === 0 && alive(data.sessions).length === 0);

  return (
    <ThemeContext.Provider value={theme}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark" />
            <span>
              study<span className="slash">/</span>tracker
            </span>
          </div>
          <NavLinks current={page.id} />
          <div className="sidebar-footer">
            <MiniTimer />
            <SyncBadge />
          </div>
        </aside>

        <main className="main">
          <Page />
        </main>

        {page.id !== 'casovac' && (
          <div className="mobile-mini">
            <MiniTimer />
          </div>
        )}

        <nav className="mobile-nav">
          {PAGES.filter((p) => p.mobile || p.id === 'vice').map((p) => (
            <a
              key={p.id}
              href={`#/${p.id}`}
              className={p.id === page.id || (p.id === 'vice' && !page.mobile && page.id !== 'vice') ? 'active' : ''}
            >
              <p.icon size={20} strokeWidth={1.75} />
              {p.label}
            </a>
          ))}
        </nav>
      </div>
      <AfterBlockModal />
      <NoisePlayer />
      {showOnboarding && <Onboarding />}
    </ThemeContext.Provider>
  );
}
