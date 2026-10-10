import { useEffect, useState } from 'react';
import { ThemePref } from '../data/schema';

export type ResolvedTheme = 'dark' | 'light';

/** Aplikuje téma na <html> a vrací skutečně použité téma. */
export function useApplyTheme(pref: ThemePref): ResolvedTheme {
  const [systemLight, setSystemLight] = useState(() => window.matchMedia('(prefers-color-scheme: light)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const on = (e: MediaQueryListEvent) => setSystemLight(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const resolved: ResolvedTheme = pref === 'system' ? (systemLight ? 'light' : 'dark') : pref;
  // Nastavujeme hned při renderu (ne až v efektu), aby grafy v potomcích četly už nové barvy.
  if (document.documentElement.dataset.theme !== resolved) document.documentElement.dataset.theme = resolved;
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#12110f' : '#f6f3ee');
  }, [resolved]);
  return resolved;
}

/** Přečte hodnotu CSS proměnné z aktuálního tématu. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
