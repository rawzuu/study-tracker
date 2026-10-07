# Study Tracker

Webová aplikace pro plánování a sledování studia. Běží v prohlížeči jako PWA, data ukládá lokálně a volitelně je synchronizuje do soukromého GitHub repozitáře.

https://rawzuu.github.io/study-tracker/

## Funkce

- Časovač s režimy Pomodoro, 50/10, 52/17, 90/20, Flowtime, stopky a vlastními intervaly. U každého bloku se zaznamenává čistý čas, soustředění a počet vyrušení.
- Kalendář s týdenním a měsíčním pohledem: plánované i odučené bloky, zkoušky, export do formátu iCalendar a odebíraný kalendář.
- Opakování témat podle algoritmu FSRS-6.
- Doporučení dalšího bloku a návrh plánu na zbytek dne podle zkoušek, týdenních cílů a témat k opakování.
- Statistiky, týdenní reflexe a měsíční report.
- Integrace s Anki přes AnkiConnect.
- Export do JSON a CSV, tmavý a světlý režim, offline provoz.

## Technologie

React 19, TypeScript, Vite, ECharts, [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), IndexedDB (idb-keyval) a Vitest. Nasazení na GitHub Pages přes GitHub Actions.

## Data a synchronizace

Data jsou uložena v IndexedDB prohlížeče. Synchronizace je volitelná: aplikace zapisuje `data.json` do soukromého repozitáře přes GitHub Contents API. Stačí fine-grained token s oprávněním *Contents: Read and write* k jedinému repozitáři. Token zůstává jen v prohlížeči daného zařízení.

Záznamy se slučují po jednotlivých entitách podle `updatedAt` a mazání je měkké (`deletedAt`). Stejně se slučují i změny z více otevřených záložek. Formát dat je verzovaný (`schemaVersion`) a změny struktury procházejí migracemi v [`src/data/migrations.ts`](src/data/migrations.ts).

## Vývoj

```bash
npm ci
npm run dev    # http://localhost:5173/study-tracker/
npm test
npm run build
```

Každý push do `main` spustí testy, build a nasazení. Starší verzi lze nasadit ručně: *Actions → Deploy na GitHub Pages → Run workflow* a do pole verze zadat tag, například `v2.1.1`.

```
src/
  data/        datový model, migrace, slučování a synchronizace
  features/    jednotlivé stránky aplikace
  lib/         výpočty (statistiky, doporučení, plán dne) a práce s časem
  components/  sdílené komponenty
  test/        testy
```

## Bezpečnost

Produkční build nastavuje Content Security Policy: skripty smí pocházet jen z vlastního původu a síťová komunikace je omezená na `api.github.com` a lokální AnkiConnect.

## Anki

Vyžaduje desktopovou Anki s doplňkem [AnkiConnect](https://ankiweb.net/shared/info/2055492159). Propojení se zapíná v *Nastavení → Anki*.
