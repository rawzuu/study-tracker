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

/**
 * Kolikrát se karta dnes průměrně ukáže: nová projde výukovými kroky (výchozí 1 min a 10 min → 2–3 odpovědi,
 * s „Znovu“ víc), karta ve výuce ještě 1–2, opakovaná občas spadne do „Znovu“ a vrátí se.
 */
export const ANSWERS_PER_CARD = { new: 2.5, learn: 1.5, review: 1.1 };

/** Výchozí tempo, dokud není z čeho počítat (sekund na odpověď). */
const DEFAULT_SEC_PER_ANSWER = 10;

/**
 * Tvoje tempo v sekundách na jednu odpověď: z Anki sezení za posledních 30 dní (čas odpovědí z Anki / počet odpovědí),
 * jinak z dneška, jinak 10 s.
 */
export function ankiSecPerAnswer(
  sessions: { mode: string; start: number; durationSec: number; note: string; deletedAt?: number }[],
  today: { reviewedToday: number; msToday: number } | undefined,
  now = Date.now(),
): number {
  let sec = 0;
  let answers = 0;
  for (const s of sessions) {
    if (s.mode !== 'anki' || s.deletedAt || s.start < now - 30 * 86_400_000) continue;
    const n = Number(/(\d+) karet/.exec(s.note)?.[1] ?? 0);
    if (n > 0) {
      sec += s.durationSec;
      answers += n;
    }
  }
  if (answers >= 50) return sec / answers;
  if (today && today.reviewedToday >= 10 && today.msToday > 0) return today.msToday / 1000 / today.reviewedToday;
  return DEFAULT_SEC_PER_ANSWER;
}

/** Odhad času na dnešní karty v minutách (zaokrouhleno na 5 min, 5–180). */
export function ankiEstimateMin(decks: { newCount: number; learnCount: number; reviewCount: number }[], secPerAnswer: number): number {
  const answers = decks.reduce((a, d) => a + d.newCount * ANSWERS_PER_CARD.new + d.learnCount * ANSWERS_PER_CARD.learn + d.reviewCount * ANSWERS_PER_CARD.review, 0);
  return Math.max(5, Math.min(180, Math.round((answers * secPerAnswer) / 60 / 5) * 5));
}
