/**
 * Klient pro AnkiConnect (doplněk do desktopové Anki, kód 2055492159).
 * Anki musí běžet na stejném počítači – API poslouchá na 127.0.0.1:8765.
 * Dokumentace: https://git.sr.ht/~foosoft/anki-connect
 */

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8765';

/** Adresa AnkiConnect – výchozí 127.0.0.1:8765, pro testy jde přepsat v localStorage `st.ankiEndpoint`. */
function endpoint(): string {
  try {
    return localStorage.getItem('st.ankiEndpoint') || DEFAULT_ENDPOINT;
  } catch {
    return DEFAULT_ENDPOINT;
  }
}

export type AnkiErrorKind = 'offline' | 'denied' | 'error';

export class AnkiError extends Error {
  constructor(
    public kind: AnkiErrorKind,
    message: string,
  ) {
    super(message);
  }
}

async function invoke<T>(action: string, params: Record<string, unknown> = {}, timeoutMs = 5000): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    // Tělo jako prostý text = „simple request“ bez CORS preflightu.
    res = await fetch(endpoint(), { method: 'POST', body: JSON.stringify({ action, version: 6, params }), signal: ctrl.signal });
  } catch {
    throw new AnkiError('offline', 'Anki neběží nebo prohlížeč nepovolil přístup k místní síti.');
  } finally {
    window.clearTimeout(timer);
  }
  if (res.status === 403) throw new AnkiError('denied', 'AnkiConnect tuto stránku nepovolil.');
  const json = (await res.json()) as { result: T; error: string | null };
  if (json.error) throw new AnkiError('error', json.error);
  return json.result;
}

export async function requestPermission(): Promise<void> {
  const r = await invoke<{ permission: 'granted' | 'denied' }>('requestPermission', {}, 60_000);
  if (r.permission !== 'granted') throw new AnkiError('denied', 'V Anki bylo připojení zamítnuto. Povol ho v nastavení doplňku AnkiConnect.');
}

export interface DeckStat {
  name: string;
  newCount: number;
  learnCount: number;
  reviewCount: number;
  total: number;
}

export interface AnkiReview {
  deck: string; // nejvyšší úroveň balíčku
  time: number; // kdy byla karta zodpovězena (ms)
  durationMs: number;
}

export interface AnkiFetch {
  decks: DeckStat[];
  reviewedToday: number;
  reviews: AnkiReview[];
}

const topLevel = (name: string) => name.split('::')[0];

/** Stáhne počty k opakování a historii opakování od `sinceMs`. */
export async function fetchAnki(sinceMs: number, opts: { reviews?: boolean; knownReviewedToday?: number } = {}): Promise<AnkiFetch & { reviewsFetched: boolean }> {
  await requestPermission();
  const names = await invoke<string[]>('deckNames');
  const tops = [...new Set(names.map(topLevel))];
  const stats = await invoke<Record<string, { name: string; new_count: number; learn_count: number; review_count: number; total_in_deck: number }>>('getDeckStats', { decks: tops });
  const decks: DeckStat[] = Object.values(stats)
    .map((d) => ({ name: d.name, newCount: d.new_count, learnCount: d.learn_count, reviewCount: d.review_count, total: d.total_in_deck }))
    .filter((d) => d.total > 0)
    .sort((a, b) => b.reviewCount + b.learnCount + b.newCount - (a.reviewCount + a.learnCount + a.newCount));
  const reviewedToday = await invoke<number>('getNumCardsReviewedToday');

  // Úspora: když od minula nepřibylo žádné opakování, historii znovu nestahujeme.
  if (opts.reviews === false || (opts.knownReviewedToday != null && opts.knownReviewedToday === reviewedToday)) {
    return { decks, reviewedToday, reviews: [], reviewsFetched: false };
  }

  // cardReviews vrací jen karty přímo v daném balíčku (ne v podbalíčcích) → ptáme se na všechny.
  const reviews: AnkiReview[] = [];
  for (const name of names) {
    const rows = await invoke<[number, number, number, number, number, number, number, number, number][]>('cardReviews', { deck: name, startID: Math.floor(sinceMs) });
    for (const r of rows) reviews.push({ deck: topLevel(name), time: r[0], durationMs: r[7] });
  }
  reviews.sort((a, b) => a.time - b.time);
  return { decks, reviewedToday, reviews, reviewsFetched: true };
}

/** Seskupí opakování do bloků (pauza > 10 min = nový blok) zvlášť pro každý balíček. */
export function clusterReviews(reviews: AnkiReview[], gapMs = 10 * 60_000): { deck: string; start: number; end: number; durationMs: number; count: number }[] {
  const byDeck = new Map<string, AnkiReview[]>();
  for (const r of reviews) {
    if (!byDeck.has(r.deck)) byDeck.set(r.deck, []);
    byDeck.get(r.deck)!.push(r);
  }
  const out: { deck: string; start: number; end: number; durationMs: number; count: number }[] = [];
  for (const [deck, list] of byDeck) {
    let cur: (typeof out)[number] | null = null;
    for (const r of list) {
      if (cur && r.time - cur.end <= gapMs) {
        cur.end = r.time;
        cur.durationMs += r.durationMs;
        cur.count++;
      } else {
        if (cur) out.push(cur);
        cur = { deck, start: r.time - r.durationMs, end: r.time, durationMs: r.durationMs, count: 1 };
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}
