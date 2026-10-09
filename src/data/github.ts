/**
 * Synchronizace dat do soukromého GitHub repa přes Contents API.
 * Každý zápis = jeden commit, takže máš úplnou historii dat a můžeš se vrátit k libovolné verzi.
 */

import { DAY, parseDayKey, startOfDay } from '../lib/time';

export interface GithubConfig {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  token: string;
  expires?: string; // YYYY-MM-DD – konec platnosti tokenu (nepovinné; GitHub ho prohlížeči neprozradí)
}

/** Kolik dní zbývá do konce platnosti tokenu (null = neznámo). */
export function tokenDaysLeft(c: GithubConfig | null, now = Date.now()): number | null {
  if (!c?.expires || !/^\d{4}-\d{2}-\d{2}$/.test(c.expires)) return null;
  return Math.round((parseDayKey(c.expires).getTime() - startOfDay(now)) / DAY);
}

const CONFIG_KEY = 'st.github';

export function loadGithubConfig(): GithubConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as GithubConfig;
    return c.owner && c.repo && c.token ? c : null;
  } catch {
    return null;
  }
}

export function saveGithubConfig(c: GithubConfig | null) {
  try {
    if (c) localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* ignore */
  }
}

export class GithubError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function headers(c: GithubConfig, accept = 'application/vnd.github+json'): HeadersInit {
  return {
    Accept: accept,
    Authorization: `Bearer ${c.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function contentsUrl(c: GithubConfig) {
  const path = c.path.split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path}`;
}

function describe(status: number): string {
  if (status === 401) return 'Neplatný token.';
  if (status === 403) return 'Token nemá oprávnění (potřebuje Contents: Read and write).';
  if (status === 404) return 'Repo nebo větev nenalezena (nebo k nim token nemá přístup).';
  if (status === 409) return 'Konflikt verzí.';
  return `GitHub vrátil chybu ${status}.`;
}

function b64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function utf8ToB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Stáhne soubor s daty. Vrací null, pokud ještě neexistuje. */
export async function fetchRemote(c: GithubConfig): Promise<{ text: string; sha: string } | null> {
  const url = `${contentsUrl(c)}?ref=${encodeURIComponent(c.branch)}`;
  const res = await fetch(url, { headers: headers(c), cache: 'no-store' });
  if (res.status === 404) {
    // Rozliš "soubor neexistuje" od "repo neexistuje / bez přístupu".
    const repoRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`,
      { headers: headers(c), cache: 'no-store' },
    );
    if (!repoRes.ok) throw new GithubError(describe(repoRes.status), repoRes.status);
    return null;
  }
  if (!res.ok) throw new GithubError(describe(res.status), res.status);
  const json = (await res.json()) as { sha: string; content?: string; encoding?: string };
  if (json.content && json.encoding === 'base64') {
    return { text: b64ToUtf8(json.content), sha: json.sha };
  }
  // Soubory nad 1 MB API nevrací v `content` – stáhneme je jako raw.
  const raw = await fetch(url, { headers: headers(c, 'application/vnd.github.raw+json'), cache: 'no-store' });
  if (!raw.ok) throw new GithubError(describe(raw.status), raw.status);
  return { text: await raw.text(), sha: json.sha };
}

/** Zapíše soubor. `sha` = verze, kterou přepisujeme (null pro nový soubor). */
export async function pushRemote(c: GithubConfig, text: string, sha: string | null, message: string): Promise<string> {
  const res = await fetch(contentsUrl(c), {
    method: 'PUT',
    headers: { ...headers(c), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: utf8ToB64(text),
      branch: c.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new GithubError(describe(res.status), res.status);
  const json = (await res.json()) as { content: { sha: string } };
  return json.content.sha;
}

// ---------- Gist pro odebíraný kalendář ----------

function gistHeaders(token: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

function gistError(status: number): string {
  if (status === 401) return 'Neplatný token.';
  if (status === 403 || status === 404) return 'Token nemá oprávnění „Gists: Read and write“.';
  return `GitHub vrátil chybu ${status}.`;
}

/** Vytvoří tajný (neveřejný) gist. */
export async function createGist(token: string, filename: string, content: string): Promise<{ id: string; owner: string }> {
  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: gistHeaders(token),
    body: JSON.stringify({ description: 'Study Tracker – studijní plán (kalendář)', public: false, files: { [filename]: { content } } }),
  });
  if (!res.ok) throw new GithubError(gistError(res.status), res.status);
  const json = (await res.json()) as { id: string; owner: { login: string } };
  return { id: json.id, owner: json.owner.login };
}

export async function updateGist(token: string, id: string, filename: string, content: string): Promise<void> {
  const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: gistHeaders(token),
    body: JSON.stringify({ files: { [filename]: { content } } }),
  });
  if (!res.ok) throw new GithubError(gistError(res.status), res.status);
}
