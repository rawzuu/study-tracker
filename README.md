# 📚 Study Tracker

Osobní aplikace na sledování času učení: časovače podložené výzkumem, statistiky, plánovač a export do Apple Kalendáře.

**Aplikace:** https://rawzuu.github.io/study-tracker/

## Funkce

- **Časovače:** Pomodoro (25/5), Dlouhé Pomodoro (50/10), 52/17, Ultradiánní blok (90/20), Flowtime, stopky a vlastní režimy. U každého je uvedeno, z čeho vychází a jak silné jsou důkazy.
- **Záznam sezení:** předmět, téma, čistý čas, hodnocení soustředění (1–5), počet vyrušení a ruční zápis.
- **Statistiky:** heatmapa roku, trend s 7denním průměrem, předměty v čase, rozložení, den × hodina, soustředění podle denní doby a automatické postřehy.
- **Plánovač:** týdenní kalendář s přetahováním, opakované bloky, týdenní cíle, plán vs. realita.
- **Zkoušky:** automaticky naplánované rozložené opakování (spacing effect).
- **Export `.ics`:** pro Apple Kalendář, Google i Outlook.
- **Opakování témat (v2):** každé téma se vrací po 1, 3, 7, 14, 30, 60 a 120 dnech; těžké vybavení interval zkrátí.
- **Vybavení po bloku (v2):** po bloku krátce sepíšeš, co si pamatuješ (retrieval practice).
- **Týdenní reflexe (v2):** souhrn týdne, 3 otázky a jedna věc, kterou změníš – zobrazí se na přehledu.
- **Měsíční report (v2):** postřehy, nejsilnější dny a hodiny, chronotyp, srovnání předmětů s minulým měsícem, tisk do PDF.
- **Šum na soustředění (v2):** hnědý, růžový nebo bílý šum generovaný v prohlížeči.
- **Odebíraný kalendář (v2):** plán se publikuje do tajného gistu a Apple Kalendář se aktualizuje sám.
- **Měsíční pohled v plánovači a export CSV (v2).**
- **Průvodce pro nové uživatele (v2)** – kamarádi si nastaví vlastní zálohu na svůj GitHub.
- **Tmavý (výchozí) i světlý režim.** Funguje na mobilu a jde přidat na plochu (PWA, offline).

## Kde jsou data a proč se neztratí

| Vrstva | Co dělá |
|---|---|
| **IndexedDB** v prohlížeči | Okamžité ukládání, funguje offline. |
| **Soukromé repo `study-tracker-data`** | Každá změna = commit do `data.json`. Kompletní historie, víc zařízení. |
| **Export JSON** | Ruční záloha kdykoliv (Nastavení → Záloha). |

- Kód (toto repo) a data (soukromé repo) jsou **úplně oddělené**. Nasazení nové verze na data nesahá.
- Synchronizace slučuje data po jednotlivých záznamech (vyhrává novější `updatedAt`). Mazání je „měkké“ (`deletedAt`), takže se nic neztratí ani při práci na dvou zařízeních.
- Data mají `schemaVersion`. Při změně struktury se použije migrace v [`src/data/migrations.ts`](src/data/migrations.ts) a před migrací se lokálně uloží záloha.
- Nové funkce data jen **přidávají** (nová pole a kolekce), takže starší verze aplikace je umí načíst a nic z nich nesmažou.

## Návrat na starší verzi

Každá verze je uložená jako [release](https://github.com/rawzuu/study-tracker/releases).

1. Otevři **Actions → Deploy na GitHub Pages → Run workflow**.
2. Do pole *verze* napiš tag, např. `v1.0.0`, a spusť.
3. Za ~1 minutu běží na stránce zvolená verze. Zpět na nejnovější: spusť znovu s prázdným polem.

Data zůstávají v soukromém repu nedotčená (záloha stavu před v2: tag `zaloha-pred-v2` v `study-tracker-data`).

### Připojení synchronizace (jednou na zařízení)

1. [Vytvoř fine-grained token](https://github.com/settings/personal-access-tokens/new):
   - *Repository access* → *Only select repositories* → `study-tracker-data`
   - *Permissions* → *Contents* → **Read and write**
2. V aplikaci otevři **Nastavení → Synchronizace s GitHubem** a vlož token.

## Vývoj

```bash
npm install
npm run dev       # http://localhost:5173/study-tracker/
npm run build
```

Po pushnutí do `main` se aplikace automaticky nasadí přes GitHub Actions.

### Jak přidat novou funkci

1. Vytvoř složku v `src/features/<nazev>/` se stránkou.
2. Přidej jeden řádek do pole `PAGES` v [`src/App.tsx`](src/App.tsx).
3. Pokud potřebuješ nová data:
   - přidej pole do typů v [`src/data/schema.ts`](src/data/schema.ts),
   - zvyš `SCHEMA_VERSION`,
   - napiš migraci do [`src/data/migrations.ts`](src/data/migrations.ts).

   Nová kolekce entit patří i do `COLLECTIONS`, aby se synchronizovala.
4. Nové grafy patří do [`src/features/stats/charts.ts`](src/features/stats/charts.ts) jako funkce vracející ECharts option.

### Struktura

```
src/
  data/        schéma, migrace, slučování, GitHub sync, store (jediný přístup k datům)
  features/    dashboard, timer, stats, planner, sessions, subjects, settings
  components/  sdílené UI (Modal, Switch, Chart…)
  lib/         práce s časem, statistiky, téma, zvuky, router
```

## Zdroje k metodám

- Biwer, F. et al. (2023). *Understanding effort regulation: Comparing 'Pomodoro' breaks and self-regulated breaks.* British Journal of Educational Psychology.
- Cepeda, N. J. et al. (2006). *Distributed practice in verbal recall tasks.* Psychological Bulletin.
- Cepeda, N. J. et al. (2008). *Spacing effects in learning: A temporal ridgeline of optimal retention.* Psychological Science.
- Dunlosky, J. et al. (2013). *Improving students' learning with effective learning techniques.* Psychological Science in the Public Interest.
- Roediger, H. L. & Karpicke, J. D. (2006). *Test-enhanced learning.* Psychological Science.
- Kleitman, N. (1982). *Basic rest-activity cycle — 22 years later.* Sleep.
