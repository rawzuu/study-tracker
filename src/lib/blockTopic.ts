/** Názvy bloků bez konkrétního tématu (vygenerované ranním plánem). */
const NO_TOPIC = /^(Nová látka|Blok podle plánu|Nedokončený blok|Po přednášce:.*|Anki:.*)$/;
/** Předpony z ranního plánu a „Co teď?“ – téma je až za nimi. */
const PREFIX = /^(Opakování|Nové téma|Pokračovat|Příprava na zkoušku|Podle plánu):\s*/;

/**
 * Všechna témata z názvu bloku plánu.
 * „Opakování: Derivace, Limity +1“ → [„Derivace“, „Limity“], „Nové téma: Řady“ → [„Řady“],
 * „Opakování: Zápočet (−3 d)“ → [„Zápočet“]. Vlastní název bloku zůstane, jak je.
 * Bez toho by z vygenerovaného názvu vzniklo nové téma a skutečná témata by se jako zopakovaná nezapsala.
 */
export function blockTopics(title: string): string[] {
  let t = title.trim();
  for (let guard = 0; guard < 3; guard++) {
    if (NO_TOPIC.test(t)) return [];
    const m = t.match(PREFIX);
    if (!m) break;
    t = t.slice(m[0].length).replace(/\s*\(−\d+ d\)$/, '').trim();
    // „+2“ na konci = další témata, která se do názvu nevešla – ta z názvu nezjistíme
    if (m[1] === 'Opakování') {
      return t
        .replace(/\s\+\d+$/, '')
        .split(', ')
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }
  return t ? [t] : [];
}

/** Hlavní téma bloku (první z `blockTopics`) – předvyplní se do časovače nebo zápisu. */
export function blockTopic(title: string): string {
  return blockTopics(title)[0] ?? '';
}
