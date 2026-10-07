import { ComponentType } from 'react';
import {
  BarChart3,
  BookMarked,
  CalendarDays,
  CloudOff,
  Cloud,
  AlertTriangle,
  GraduationCap,
  History,
  LayoutDashboard,
  Menu,
  RefreshCw,
  Settings,
  Timer,
} from 'lucide-react';
import { useStore } from './data/store';
import { useRoute } from './lib/router';
import { useApplyTheme } from './lib/theme';
import { fmtClock, fmtTime } from './lib/time';
import { ThemeContext } from './components/Chart';
import { useTimer } from './features/timer/TimerContext';
import { FocusRatingModal } from './features/timer/FocusRating';
import { Dashboard } from './features/dashboard/Dashboard';
import { TimerPage } from './features/timer/TimerPage';
import { StatsPage } from './features/stats/StatsPage';
import { PlannerPage } from './features/planner/PlannerPage';
import { HistoryPage } from './features/sessions/HistoryPage';
import { SubjectsPage } from './features/subjects/SubjectsPage';
import { SettingsPage } from './features/settings/SettingsPage';

/**
 * Registr stránek. Novou funkci přidáš tak, že vytvoříš složku ve `features/`
 * a přidáš sem jeden řádek.
 */
interface PageDef {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  component: ComponentType;
  mobile?: boolean; // zobrazit ve spodní liště na mobilu
}

const PAGES: PageDef[] = [
  { id: 'prehled', label: 'Přehled', icon: LayoutDashboard, component: Dashboard, mobile: true },
  { id: 'casovac', label: 'Časovač', icon: Timer, component: TimerPage, mobile: true },
  { id: 'planovac', label: 'Plánovač', icon: CalendarDays, component: PlannerPage, mobile: true },
  { id: 'statistiky', label: 'Statistiky', icon: BarChart3, component: StatsPage, mobile: true },
  { id: 'historie', label: 'Historie', icon: History, component: HistoryPage },
  { id: 'predmety', label: 'Předměty', icon: BookMarked, component: SubjectsPage },
  { id: 'nastaveni', label: 'Nastavení', icon: Settings, component: SettingsPage },
  { id: 'vice', label: 'Více', icon: Menu, component: MorePage },
];

function MorePage() {
  return (
    <div className="stack">
      <h1>Více</h1>
      <div className="card nav">
        {PAGES.filter((p) => !p.mobile && p.id !== 'vice').map((p) => (
          <a key={p.id} href={`#/${p.id}`}>
            <p.icon size={18} /> {p.label}
          </a>
        ))}
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
        <CloudOff size={15} /> Záloha na GitHub vypnutá
      </a>
    );
  }
  if (sync.status === 'error') {
    return (
      <a href="#/nastaveni" className="sync-badge bad" title={sync.message}>
        <AlertTriangle size={15} /> Chyba synchronizace
      </a>
    );
  }
  return (
    <button className="sync-badge" onClick={() => void syncNow()} title="Synchronizovat teď">
      {sync.status === 'syncing' ? <RefreshCw size={15} className="spin" /> : <Cloud size={15} />}
      {sync.status === 'syncing' ? 'Synchronizuji…' : sync.status === 'ok' ? `Uloženo ${fmtTime(sync.at)}` : 'GitHub připojen'}
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
      <div className="grow">
        <div className="small" style={{ fontWeight: 600 }}>
          {isBreak ? 'Pauza' : (subj?.name ?? 'Učení')}
          {state.status === 'paused' && ' · pozastaveno'}
        </div>
      </div>
      <span className="num" style={{ fontWeight: 650 }}>
        {fmtClock(remainingMs ?? elapsedMs)}
      </span>
    </a>
  );
}

export function App() {
  const { data } = useStore();
  const theme = useApplyTheme(data.settings.theme);
  const route = useRoute();
  const page = PAGES.find((p) => p.id === route) ?? PAGES[0];
  const Page = page.component;

  return (
    <ThemeContext.Provider value={theme}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-logo">
              <GraduationCap size={18} />
            </div>
            Study Tracker
          </div>
          <nav className="nav">
            {PAGES.filter((p) => p.id !== 'vice').map((p) => (
              <a key={p.id} href={`#/${p.id}`} className={p.id === page.id ? 'active' : ''}>
                <p.icon size={18} /> {p.label}
              </a>
            ))}
          </nav>
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
              <p.icon size={21} />
              {p.label}
            </a>
          ))}
        </nav>
      </div>
      <FocusRatingModal />
    </ThemeContext.Provider>
  );
}
