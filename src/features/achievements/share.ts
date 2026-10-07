/**
 * PŘÍPRAVA na budoucí online sdílení úspěchů – zatím VYPNUTO a v UI se nic nezobrazuje.
 *
 * Myšlenka: aplikace jednou za čas odešle anonymní seznam odemčených úspěchů (jen ID a úroveň,
 * žádná jména předmětů ani časy) na jednoduchý server, který vrátí, kolik % uživatelů má
 * který úspěch. Stránka Úspěchy pak u odznaku ukáže např. „má 20 % uživatelů“.
 *
 * Co je potřeba k zapnutí:
 *  1. backend (např. Cloudflare Worker + KV): POST /report {payload} a GET /rarity → { "hours.5": 0.2, … }
 *  2. implementovat `RarityProvider` a nastavit `rarityProvider`
 *  3. FEATURES.achievementRarity = true a souhlas uživatele v Nastavení (opt-in)
 */
import { ACHIEVEMENTS_VERSION, Results } from './achievements';

export const FEATURES = {
  achievementRarity: false,
};

/** Anonymní obsah pro odeslání – žádné osobní údaje, jen ID úspěchů. */
export interface AchievementSharePayload {
  v: typeof ACHIEVEMENTS_VERSION;
  installId: string; // náhodné ID instalace (ne GitHub účet), aby se uživatel nepočítal dvakrát
  unlocked: string[]; // např. ["hours.1", "hours.2", "streak.1", "first-plan"]
  generatedAt: number;
}

export function buildSharePayload(results: Results, installId: string): AchievementSharePayload {
  return { v: ACHIEVEMENTS_VERSION, installId, unlocked: [...results.unlockedIds].sort(), generatedAt: Date.now() };
}

/** Podíl uživatelů (0–1), kteří daný úspěch mají; klíč = ID úspěchu. */
export type RarityMap = Record<string, number>;

export interface RarityProvider {
  report(payload: AchievementSharePayload): Promise<void>;
  fetchRarity(): Promise<RarityMap>;
}

/** Zatím žádný server → null. UI s tím počítá (rarity se nezobrazí). */
export const rarityProvider: RarityProvider | null = null;
