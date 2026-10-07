import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudUpload, Download, Github, Info, Moon, Monitor, Plus, RefreshCw, Sun, Trash2, Upload, Volume2 } from 'lucide-react';
import { useStore } from '../../data/store';
import { SCHEMA_VERSION, ThemePref, alive, uid } from '../../data/schema';
import { GithubConfig, fetchRemote, loadGithubConfig, saveGithubConfig } from '../../data/github';
import { migrate } from '../../data/migrations';
import { serialize } from '../../data/merge';
import { Field, Segmented, Switch, useToast } from '../../components/ui';
import { chime, requestNotifications, unlockAudio } from '../../lib/alerts';
import { dayKey, fmtTime } from '../../lib/time';
import { allModes } from '../timer/modes';
import { downloadFile } from '../planner/ics';

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

export function SettingsPage() {
  const { data, setSettings } = useStore();
  const s = data.settings;
  const toast = useToast();

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h1>Nastavení</h1>
          <p>Vzhled, časovač, synchronizace a zálohy.</p>
        </div>
      </div>

      <SyncSection />

      <div className="card">
        <div className="card-head">
          <h2>Vzhled a cíle</h2>
        </div>
        <Row label="Motiv">
          <Segmented<ThemePref>
            value={s.theme}
            onChange={(v) => setSettings({ theme: v })}
            options={[
              { value: 'dark', label: <span className="row" style={{ gap: 6 }}><Moon size={14} /> Tmavý</span> },
              { value: 'light', label: <span className="row" style={{ gap: 6 }}><Sun size={14} /> Světlý</span> },
              { value: 'system', label: <span className="row" style={{ gap: 6 }}><Monitor size={14} /> Systém</span> },
            ]}
          />
        </Row>
        <Row label="Denní cíl" desc="Kolik minut denně se chceš učit. 0 = bez cíle.">
          <input
            className="input num"
            style={{ width: 110 }}
            type="number"
            min={0}
            step={15}
            value={s.dailyGoalMin}
            onChange={(e) => setSettings({ dailyGoalMin: Math.max(0, Number(e.target.value)) })}
          />
        </Row>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Časovač</h2>
        </div>
        <Row label="Výchozí režim">
          <select className="input" style={{ width: 200 }} value={s.defaultMode} onChange={(e) => setSettings({ defaultMode: e.target.value })}>
            {allModes(data.presets).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Automaticky spustit pauzu" desc="Po konci bloku práce rovnou běží pauza.">
          <Switch checked={s.autoStartBreaks} onChange={(v) => setSettings({ autoStartBreaks: v })} />
        </Row>
        <Row label="Automaticky spustit další blok" desc="Po pauze rovnou začne další blok práce.">
          <Switch checked={s.autoStartWork} onChange={(v) => setSettings({ autoStartWork: v })} />
        </Row>
        <Row label="Hodnotit soustředění" desc="Po každém bloku se zeptá na hodnocení 1–5. Díky tomu uvidíš, kdy se učíš nejlépe.">
          <Switch checked={s.askFocusRating} onChange={(v) => setSettings({ askFocusRating: v })} />
        </Row>
        <Row label="Zvuk">
          <div className="row">
            {s.sound && (
              <>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={s.volume}
                  onChange={(e) => setSettings({ volume: Number(e.target.value) })}
                  style={{ width: 110, accentColor: 'var(--accent)' }}
                />
                <button
                  className="btn ghost icon sm"
                  title="Přehrát ukázku"
                  onClick={() => {
                    unlockAudio();
                    chime(s.volume, 'work-end');
                  }}
                >
                  <Volume2 size={15} />
                </button>
              </>
            )}
            <Switch checked={s.sound} onChange={(v) => setSettings({ sound: v })} />
          </div>
        </Row>
        <Row label="Systémové notifikace" desc="Upozornění, když je záložka na pozadí. Na iPhonu fungují jen po přidání na plochu.">
          <Switch
            checked={s.notifications}
            onChange={async (v) => {
              if (v && !(await requestNotifications())) {
                toast('Prohlížeč notifikace nepovolil');
                return;
              }
              setSettings({ notifications: v });
            }}
          />
        </Row>
        <Row label="Flowtime – poměr pauzy" desc={`Pauza = práce ÷ ${s.flowtimeRatio} (50 min práce → ${Math.round(50 / s.flowtimeRatio)} min pauza)`}>
          <input
            className="input num"
            style={{ width: 90 }}
            type="number"
            min={2}
            max={10}
            value={s.flowtimeRatio}
            onChange={(e) => setSettings({ flowtimeRatio: Math.min(10, Math.max(2, Number(e.target.value))) })}
          />
        </Row>
        <Row label="Minimální délka sezení" desc="Kratší bloky (v sekundách) se neukládají.">
          <input
            className="input num"
            style={{ width: 90 }}
            type="number"
            min={0}
            step={30}
            value={s.minSessionSec}
            onChange={(e) => setSettings({ minSessionSec: Math.max(0, Number(e.target.value)) })}
          />
        </Row>
      </div>

      <PresetsSection />
      <BackupSection />

      <div className="card">
        <div className="card-head">
          <h2>O datech</h2>
        </div>
        <p className="small muted">
          Verze schématu: <b>{SCHEMA_VERSION}</b> · předmětů {alive(data.subjects).length} · sezení {alive(data.sessions).length} · bloků plánu{' '}
          {alive(data.planBlocks).length} · zkoušek {alive(data.exams).length}
        </p>
        <p className="small faint" style={{ marginTop: 6 }}>
          Data se ukládají v prohlížeči (IndexedDB) a synchronizují do tvého soukromého GitHub repa. Při aktualizaci aplikace se
          automaticky převedou na novou verzi a před převodem se uloží záloha.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// GitHub synchronizace
// ============================================================
function SyncSection() {
  const { sync, syncNow, refreshSyncConfig } = useStore();
  const toast = useToast();
  const existing = loadGithubConfig();
  const [editing, setEditing] = useState(!existing);
  const [cfg, setCfg] = useState<GithubConfig>(
    existing ?? { owner: 'rawzuu', repo: 'study-tracker-data', branch: 'main', path: 'data.json', token: '' },
  );
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setTesting(true);
    setError(null);
    try {
      await fetchRemote(cfg); // ověří token i přístup k repu
      saveGithubConfig(cfg);
      setEditing(false);
      refreshSyncConfig();
      toast('Synchronizace zapnuta');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const status = (() => {
    switch (sync.status) {
      case 'off':
        return <span className="chip warn">Vypnuto – data jsou jen v tomto prohlížeči</span>;
      case 'syncing':
        return <span className="chip accent">Synchronizuji…</span>;
      case 'ok':
        return (
          <span className="chip ok">
            <CheckCircle2 size={13} /> Synchronizováno {fmtTime(sync.at)}
          </span>
        );
      case 'error':
        return (
          <span className="chip bad">
            <AlertTriangle size={13} /> Chyba
          </span>
        );
      default:
        return <span className="chip">Připraveno</span>;
    }
  })();

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="row" style={{ gap: 8 }}>
          <Github size={17} /> Synchronizace s GitHubem
        </h2>
        {status}
      </div>

      {sync.status === 'error' && (
        <div className="callout bad" style={{ marginBottom: 12 }}>
          <AlertTriangle size={16} />
          <span>{sync.message}</span>
        </div>
      )}

      {!editing && existing ? (
        <div className="stack">
          <p className="small muted">
            Data se ukládají do <code>{existing.owner}/{existing.repo}</code> → <code>{existing.path}</code> (větev {existing.branch}).
            Každá změna = commit, takže máš celou historii.
          </p>
          <div className="row wrap">
            <button className="btn" onClick={() => void syncNow()} disabled={sync.status === 'syncing'}>
              <RefreshCw size={15} /> Synchronizovat teď
            </button>
            <a className="btn ghost" href={`https://github.com/${existing.owner}/${existing.repo}/commits/${existing.branch}`} target="_blank" rel="noreferrer">
              Historie změn
            </a>
            <button className="btn ghost" onClick={() => setEditing(true)}>
              Upravit
            </button>
            <button
              className="btn ghost danger-text"
              onClick={() => {
                if (confirm('Odpojit GitHub? Data v repu i v prohlížeči zůstanou, jen se přestanou synchronizovat.')) {
                  saveGithubConfig(null);
                  refreshSyncConfig();
                }
              }}
            >
              Odpojit
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <div className="callout">
            <Info size={16} />
            <div className="stack tight small">
              <b>Jak získat token (jednou na každém zařízení):</b>
              <span>
                1. Otevři{' '}
                <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
                  GitHub → Fine-grained tokens → Generate new token
                </a>
              </span>
              <span>
                2. <i>Repository access</i> → <i>Only select repositories</i> → vyber <code>{cfg.repo || 'study-tracker-data'}</code>
              </span>
              <span>
                3. <i>Permissions</i> → <i>Contents</i> → <b>Read and write</b>. Nic dalšího není potřeba.
              </span>
              <span>4. Expiraci nastav třeba na rok, token zkopíruj a vlož sem.</span>
              <span className="faint">Token zůstává jen v tomto prohlížeči a má přístup pouze k datovému repu.</span>
            </div>
          </div>
          <div className="grid cols-2" style={{ gap: 10 }}>
            <Field label="Vlastník (uživatel)">
              <input className="input" value={cfg.owner} onChange={(e) => setCfg({ ...cfg, owner: e.target.value.trim() })} />
            </Field>
            <Field label="Repo s daty">
              <input className="input" value={cfg.repo} onChange={(e) => setCfg({ ...cfg, repo: e.target.value.trim() })} />
            </Field>
            <Field label="Větev">
              <input className="input" value={cfg.branch} onChange={(e) => setCfg({ ...cfg, branch: e.target.value.trim() })} />
            </Field>
            <Field label="Soubor">
              <input className="input" value={cfg.path} onChange={(e) => setCfg({ ...cfg, path: e.target.value.trim() })} />
            </Field>
          </div>
          <Field label="Token">
            <input
              className="input"
              type="password"
              autoComplete="off"
              placeholder="github_pat_…"
              value={cfg.token}
              onChange={(e) => setCfg({ ...cfg, token: e.target.value.trim() })}
            />
          </Field>
          {error && (
            <div className="callout bad">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}
          <div className="row">
            <button className="btn primary" onClick={connect} disabled={testing || !cfg.owner || !cfg.repo || !cfg.token}>
              <CloudUpload size={15} /> {testing ? 'Ověřuji…' : 'Připojit a synchronizovat'}
            </button>
            {existing && (
              <button className="btn ghost" onClick={() => setEditing(false)}>
                Zrušit
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Vlastní režimy časovače
// ============================================================
function PresetsSection() {
  const { data, upsert, remove } = useStore();
  const presets = alive(data.presets);
  const [name, setName] = useState('');
  const [work, setWork] = useState(40);
  const [short, setShort] = useState(8);
  const [long, setLong] = useState(20);
  const [rounds, setRounds] = useState(3);

  const add = () => {
    upsert('presets', {
      id: uid(),
      name: name.trim() || `${work} / ${short}`,
      workMin: work,
      shortBreakMin: short,
      longBreakMin: long,
      roundsBeforeLong: rounds,
    });
    setName('');
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Vlastní režimy časovače</h2>
      </div>
      {presets.length > 0 && (
        <div className="list" style={{ marginBottom: 14 }}>
          {presets.map((p) => (
            <div className="list-item" key={p.id}>
              <div className="grow">
                <b>{p.name}</b>
                <div className="small faint">
                  {p.workMin} min práce · {p.shortBreakMin} min pauza · {p.longBreakMin} min dlouhá po {p.roundsBeforeLong} kolech
                </div>
              </div>
              <button className="btn ghost icon sm" onClick={() => remove('presets', p.id)} aria-label="Smazat">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="grid cols-4" style={{ gap: 10, alignItems: 'end' }}>
        <Field label="Název">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Můj režim" />
        </Field>
        <Field label="Práce (min)">
          <input className="input" type="number" min={1} value={work} onChange={(e) => setWork(Math.max(1, Number(e.target.value)))} />
        </Field>
        <Field label="Pauza (min)">
          <input className="input" type="number" min={1} value={short} onChange={(e) => setShort(Math.max(1, Number(e.target.value)))} />
        </Field>
        <Field label="Dlouhá pauza (min)">
          <input className="input" type="number" min={1} value={long} onChange={(e) => setLong(Math.max(1, Number(e.target.value)))} />
        </Field>
        <Field label="Kol do dlouhé pauzy">
          <input className="input" type="number" min={1} value={rounds} onChange={(e) => setRounds(Math.max(1, Number(e.target.value)))} />
        </Field>
        <button className="btn" onClick={add}>
          <Plus size={15} /> Přidat režim
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Záloha
// ============================================================
function BackupSection() {
  const { data, replaceAll } = useStore();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (file: File) => {
    try {
      const incoming = migrate(JSON.parse(await file.text()));
      replaceAll(incoming);
      toast('Záloha sloučena s aktuálními daty');
    } catch (e) {
      alert(`Import selhal: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Záloha</h2>
      </div>
      <p className="small muted" style={{ marginBottom: 12 }}>
        Export stáhne všechna data jako JSON. Import zálohu <b>sloučí</b> s aktuálními daty – nic nepřepíše ani nesmaže.
      </p>
      <div className="row wrap">
        <button className="btn" onClick={() => downloadFile(`study-tracker-zaloha-${dayKey(Date.now())}.json`, serialize(data), 'application/json')}>
          <Download size={15} /> Exportovat JSON
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> Importovat zálohu
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
