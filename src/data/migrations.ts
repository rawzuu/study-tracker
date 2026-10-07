import { AppData, COLLECTIONS, SCHEMA_VERSION, defaultSettings } from './schema';

/**
 * Migrace dat mezi verzemi schématu.
 * Klíč = verze, ZE které se migruje. Funkce vrací data ve verzi o 1 vyšší.
 *
 * Příklad pro budoucí verzi 2:
 *   1: (d) => ({ ...d, schemaVersion: 2, sessions: d.sessions.map((s) => ({ ...s, tags: [] })) }),
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const migrations: Record<number, (d: any) => any> = {};

export class SchemaTooNewError extends Error {
  constructor(public version: number) {
    super(`Data mají verzi ${version}, ale aplikace zná jen verzi ${SCHEMA_VERSION}. Obnov stránku.`);
  }
}

/** Převede libovolná (i starší nebo neúplná) data na aktuální verzi. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrate(input: any): AppData {
  let d = input && typeof input === 'object' ? { ...input } : {};
  let v: number = typeof d.schemaVersion === 'number' ? d.schemaVersion : 1;
  if (v > SCHEMA_VERSION) throw new SchemaTooNewError(v);
  while (v < SCHEMA_VERSION) {
    const step = migrations[v];
    if (!step) throw new Error(`Chybí migrace z verze ${v}`);
    d = step(d);
    v = d.schemaVersion;
  }
  return normalize(d);
}

/** Doplní chybějící pole výchozími hodnotami. Nic nemaže. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(d: any): AppData {
  const out = { ...d, schemaVersion: SCHEMA_VERSION } as AppData;
  for (const key of COLLECTIONS) {
    if (!Array.isArray(out[key])) (out as unknown as Record<string, unknown[]>)[key] = [];
  }
  out.settings = { ...defaultSettings(), ...(d.settings ?? {}) };
  return out;
}

export function needsMigration(input: { schemaVersion?: number } | null | undefined): boolean {
  return !!input && (input.schemaVersion ?? 1) < SCHEMA_VERSION;
}
