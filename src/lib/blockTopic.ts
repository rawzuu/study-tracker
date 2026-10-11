/** Názvy bloků bez konkrétního tématu (vygenerované ranním plánem). */
const NO_TOPIC = /^(Nová látka|Blok podle plánu|Nedokončený blok|Po přednášce:.*|Anki:.*)$/;
/** Předpony z ranního plánu a „Co teď?“ – téma je až za nimi. */
const PREFIX = /^(Opakování|Nové téma|Pokračovat|Příprava na zkoušku|Podle plánu):\s*/;

/**
 * Téma pro časovač nebo zápis z názvu bloku plánu.
 * „Opakování: Derivace, Limity +1“ → „Derivace“, „Nové téma: Řady“ → „Řady“,
 * „Opakování: Zápočet (−3 d)“ → „Zápočet“. Vlastní název bloku zůstane, jak je.
 * Bez toho by z vygenerovaného názvu vzniklo nové téma a skutečné téma by se jako zopakované nezapsalo.
 */
export function blockTopic(title: string): string {
  let t = title.trim();
  for (let guard = 0; guard < 3; guard++) {
    if (NO_TOPIC.test(t)) return '';
    const m = t.match(PREFIX);
    if (!m) return t;
    t = t.slice(m[0].length).replace(/\s*\(−\d+ d\)$/, '');
    if (m[1] === 'Opakování') t = t.replace(/\s\+\d+$/, '').split(', ')[0];
    t = t.trim();
  }
  return t;
}
