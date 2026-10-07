import { useEffect, useState } from 'react';

/** Jednoduchý hash router – funguje na GitHub Pages bez nastavování serveru. */
export function useRoute(): string {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'prehled';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(route: string) {
  window.location.hash = `/${route}`;
}
