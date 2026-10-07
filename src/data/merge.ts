import { AppData, COLLECTIONS, Entity } from './schema';

/** Sloučí dvě kolekce: pro každé id vyhraje novější `updatedAt`. Nic se neztratí. */
export function mergeEntities<T extends Entity>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const e of a) map.set(e.id, e);
  for (const e of b) {
    const ex = map.get(e.id);
    if (!ex || e.updatedAt > ex.updatedAt) map.set(e.id, e);
  }
  return [...map.values()];
}

/** Sloučí lokální a vzdálená data (obě musí být už zmigrovaná na aktuální verzi). */
export function mergeData(local: AppData, remote: AppData): AppData {
  // Neznámá pole z budoucích verzí zachováme z obou stran.
  const out: AppData = { ...remote, ...local };
  for (const key of COLLECTIONS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any)[key] = mergeEntities(local[key] as Entity[], remote[key] as Entity[]);
  }
  out.settings = remote.settings.updatedAt > local.settings.updatedAt ? remote.settings : local.settings;
  return out;
}

/** Stabilní serializace pro porovnání a čitelné diffy v gitu. */
export function serialize(data: AppData): string {
  const sorted: AppData = { ...data };
  for (const key of COLLECTIONS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sorted as any)[key] = [...(data[key] as Entity[])].sort((x, y) =>
      x.createdAt - y.createdAt || x.id.localeCompare(y.id),
    );
  }
  return JSON.stringify(sorted, null, 1) + '\n';
}
