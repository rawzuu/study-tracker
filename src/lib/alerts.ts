let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Zavolej při kliknutí uživatele, aby prohlížeč povolil pozdější přehrání zvuku. */
export function unlockAudio() {
  audio();
}

/** Jemná zvonkohra vygenerovaná přes Web Audio (žádné soubory). */
export function chime(volume: number, kind: 'work-end' | 'break-end') {
  const ac = audio();
  if (!ac || volume <= 0) return;
  const notes = kind === 'work-end' ? [659.25, 783.99, 1046.5] : [523.25, 659.25, 523.25];
  const t0 = ac.currentTime + 0.02;
  notes.forEach((f, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    const t = t0 + i * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25 * volume, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 1.3);
  });
}

export async function requestNotifications(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

export function notify(title: string, body: string) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    new Notification(title, { body, icon: `${import.meta.env.BASE_URL}icon.svg`, tag: 'study-timer' });
  } catch {
    /* některé prohlížeče (iOS) notifikace mimo PWA nepodporují */
  }
}
