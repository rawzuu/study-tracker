import { useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, CloudUpload, Copy, Download, FileSpreadsheet, Github, Info, Moon, Monitor, Plus, RefreshCw, Sun, Trash2, Upload, Volume2 } from 'lucide-react';
import { sessionsToCsv } from '../../lib/csv';
import { AnkiSettings } from '../anki/AnkiSettings';
import { FEED_FILE, buildFeed, feedHttpsUrl, feedWebcalUrl, publishFeed, readFeedStatus } from '../planner/calendarFeed';
import { createGist } from '../../data/github';
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
    <div>
      <div className="page-head">
        <div>
          <h1>Nastavení</h1>
          <p>Vzhled, časovač, synchronizace a zálohy.</p>
        </div>
      </div>
      <div className="masonry">

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
        <Row label="Vybavení po bloku" desc="Po bloku vyzve k sepsání hlavních bodů z hlavy (retrieval practice). Jde vždy přeskočit.">
          <Switch checked={s.askRecall} onChange={(v) => setSettings({ askRecall: v })} />
        </Row>
        <Row label="Připomínat týdenní reflexi" desc="Na začátku týdne se na přehledu objeví výzva k reflexi minulého týdne.">
          <Switch checked={s.weeklyReflection} onChange={(v) => setSettings({ weeklyReflection: v })} />
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

      <ReviewSection />
      <AnkiSettings />
      <CalendarFeedSection />
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
    existing ?? { owner: '', repo: 'study-tracker-data', branch: 'main', path: 'data.json', token: '' },
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
              <b>Jak zapnout zálohu (asi 3 minuty):</b>
              <span>
                0. Pokud ještě nemáš soukromé repo na data,{' '}
                <a href="https://github.com/new?name=study-tracker-data&visibility=private&description=Data+pro+Study+Tracker" target="_blank" rel="noreferrer">
                  založ ho tady
                </a>{' '}
                (Private, zaškrtni „Add a README“).
              </span>
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
                3. <i>Permissions</i> → <i>Contents</i> → <b>Read and write</b>. (Pro odebíraný kalendář navíc v <i>Account permissions</i> → <i>Gists</i> → <b>Read and write</b>.)
              </span>
              <span>4. Expiraci nastav třeba na rok, token zkopíruj a vlož sem. Na každém zařízení (počítač, mobil) se token vkládá zvlášť.</span>
              <span className="faint">Token zůstává jen v tomto prohlížeči a má přístup pouze k datovému repu.</span>
            </div>
          </div>
          <div className="grid cols-2" style={{ gap: 10 }}>
            <Field label="Vlastník (uživatel)">
              <input className="input" placeholder="tvoje GitHub jméno" value={cfg.owner} onChange={(e) => setCfg({ ...cfg, owner: e.target.value.trim() })} />
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
        Export JSON stáhne všechna data. CSV otevřeš v Excelu nebo Numbers. Import zálohu <b>sloučí</b> s aktuálními daty – nic nepřepíše ani nesmaže.
      </p>
      <div className="row wrap">
        <button className="btn" onClick={() => downloadFile(`study-tracker-zaloha-${dayKey(Date.now())}.json`, serialize(data), 'application/json')}>
          <Download size={15} /> Exportovat JSON
        </button>
        <button className="btn" onClick={() => downloadFile(`study-tracker-sezeni-${dayKey(Date.now())}.csv`, sessionsToCsv(data.sessions, data.subjects, data.presets), 'text/csv;charset=utf-8')}>
          <FileSpreadsheet size={15} /> Sezení do CSV
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

// ============================================================
// Odebíraný kalendář
// ============================================================
function CalendarFeedSection() {
  const { data, setSettings } = useStore();
  const toast = useToast();
  const feed = data.settings.calendarFeed;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeExams, setIncludeExams] = useState(feed?.includeExams ?? true);
  const [alarm, setAlarm] = useState<string>(feed?.alarmMin == null ? (feed ? 'none' : '10') : String(feed.alarmMin));
  const status = readFeedStatus();
  const hasSync = !!loadGithubConfig();

  const enable = async () => {
    const cfg = loadGithubConfig();
    if (!cfg) return;
    setBusy(true);
    setError(null);
    try {
      const opts = { includeExams, alarmMin: alarm === 'none' ? null : Number(alarm) };
      const { id, owner } = await createGist(cfg.token, FEED_FILE, buildFeed(data, opts));
      setSettings({ calendarFeed: { gistId: id, owner, ...opts } });
      toast('Kalendář publikován');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const updateOpts = (patch: { includeExams?: boolean; alarmMin?: number | null }) => {
    if (feed) setSettings({ calendarFeed: { ...feed, ...patch } });
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Odkaz zkopírován');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="row" style={{ gap: 8 }}>
          <CalendarClock size={16} /> Odebíraný kalendář
        </h2>
        {feed ? <span className="chip ok">zapnuto</span> : <span className="chip">vypnuto</span>}
      </div>
      <div className="stack">
        <p className="small muted">
          Plán a zkoušky se publikují do tajného gistu na tvém GitHubu. Apple Kalendář si je pak sám pravidelně stahuje, takže nic
          neimportuješ ručně. Kdo zná odkaz, plán uvidí – nikde ale není vypsaný ani vyhledatelný.
        </p>
        {!hasSync ? (
          <div className="callout">
            <Info size={15} />
            <span>Nejdřív zapni synchronizaci s GitHubem výše.</span>
          </div>
        ) : feed ? (
          <>
            <div className="feed-url">
              <code className="ellipsis">{feedWebcalUrl(feed)}</code>
              <button className="btn sm" onClick={() => void copy(feedWebcalUrl(feed))}>
                <Copy size={13} /> Kopírovat
              </button>
            </div>
            <div className="row wrap">
              <a className="btn primary" href={feedWebcalUrl(feed)}>
                <CalendarClock size={14} /> Přidat do Apple Kalendáře
              </a>
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await publishFeed(data, feed, true);
                    toast('Kalendář aktualizován');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw size={14} /> Aktualizovat teď
              </button>
              <a className="btn ghost" href={feedHttpsUrl(feed)} target="_blank" rel="noreferrer">
                Zobrazit soubor
              </a>
            </div>
            <p className="small faint">
              Na iPhonu: Nastavení → Kalendář → Účty → Přidat účet → Jiné → Přidat odebíraný kalendář a vlož odkaz. Na Macu stačí
              kliknout na tlačítko výše. Změny se v kalendáři objeví do ~1 hodiny (podle intervalu obnovy v Kalendáři).
              {status && ` Naposledy publikováno ${fmtTime(status.at)}${status.error ? ` – chyba: ${status.error}` : ''}.`}
            </p>
            <Row label="Zahrnout zkoušky">
              <Switch
                checked={feed.includeExams}
                onChange={(v) => updateOpts({ includeExams: v })}
              />
            </Row>
            <Row label="Připomenutí před blokem">
              <select
                className="input"
                style={{ width: 160 }}
                value={feed.alarmMin == null ? 'none' : String(feed.alarmMin)}
                onChange={(e) => updateOpts({ alarmMin: e.target.value === 'none' ? null : Number(e.target.value) })}
              >
                <option value="none">Bez připomenutí</option>
                <option value="5">5 minut</option>
                <option value="10">10 minut</option>
                <option value="15">15 minut</option>
                <option value="30">30 minut</option>
              </select>
            </Row>
            <button
              className="btn ghost danger-text"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                if (confirm('Vypnout odebíraný kalendář? Gist zůstane na GitHubu, jen se přestane aktualizovat.')) setSettings({ calendarFeed: null });
              }}
            >
              Vypnout
            </button>
          </>
        ) : (
          <>
            <div className="grid cols-2" style={{ gap: 10 }}>
              <label className="field">
                <span>Připomenutí před blokem</span>
                <select className="input" value={alarm} onChange={(e) => setAlarm(e.target.value)}>
                  <option value="none">Bez připomenutí</option>
                  <option value="5">5 minut</option>
                  <option value="10">10 minut</option>
                  <option value="15">15 minut</option>
                  <option value="30">30 minut</option>
                </select>
              </label>
              <label className="field">
                <span>Zahrnout zkoušky</span>
                <div style={{ height: 34, display: 'flex', alignItems: 'center' }}>
                  <Switch checked={includeExams} onChange={setIncludeExams} />
                </div>
              </label>
            </div>
            <p className="small faint">
              Token musí mít navíc oprávnění <b>Account permissions → Gists → Read and write</b>. Existující token jde upravit na
              GitHubu v Settings → Developer settings → Fine-grained tokens.
            </p>
            <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={enable} disabled={busy}>
              <CalendarClock size={14} /> {busy ? 'Publikuji…' : 'Zapnout odebíraný kalendář'}
            </button>
          </>
        )}
        {error && (
          <div className="callout bad">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Opakování – FSRS
// ============================================================
function ReviewSection() {
  const { data, setSettings } = useStore();
  const s = data.settings;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Opakování (FSRS-6)</h2>
        <span className="sub">stejný algoritmus jako Anki</span>
      </div>
      <Row label="Cílová spolehlivost" desc="Opakování se naplánuje, když pravděpodobnost vybavení klesne na tuto hodnotu. Vyšší = častější opakování.">
        <select className="input" style={{ width: 120 }} value={s.desiredRetention} onChange={(e) => setSettings({ desiredRetention: Number(e.target.value) })}>
          {[0.85, 0.88, 0.9, 0.92, 0.95, 0.97].map((r) => (
            <option key={r} value={r}>
              {Math.round(r * 100)} %
            </option>
          ))}
        </select>
      </Row>
      <Row label="Maximální interval" desc="Nejdelší možná pauza mezi opakováními.">
        <select className="input" style={{ width: 120 }} value={s.maxIntervalDays} onChange={(e) => setSettings({ maxIntervalDays: Number(e.target.value) })}>
          {[30, 60, 90, 180, 365, 730].map((d) => (
            <option key={d} value={d}>
              {d} dní
            </option>
          ))}
        </select>
      </Row>
      <p className="small faint" style={{ marginTop: 10 }}>
        90 % je doporučený kompromis mezi zapamatováním a počtem opakování. Před zkouškou se vyplatí zvýšit na 95 %. Opakování se navíc
        nikdy nenaplánuje až po zkoušce daného předmětu.
      </p>
    </div>
  );
}
