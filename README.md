# 📚 Study Tracker

Osobní aplikace na sledování času učení: časovače podložené výzkumem, statistiky, plánovač a export do Apple Kalendáře.

**Aplikace:** https://rawzuu.github.io/study-tracker/

## Funkce

- **Časovače:** Pomodoro (25/5), Dlouhé Pomodoro (50/10), 52/17, Ultradiánní blok (90/20), Flowtime, stopky a vlastní režimy. U každého je uvedeno, z čeho vychází a jak silné jsou důkazy.
- **Záznam sezení:** předmět, téma, čistý čas, hodnocení soustředění (1–5), počet vyrušení a ruční zápis.
- **Statistiky:** heatmapa roku, trend s 7denním průměrem, předměty v čase, rozložení, den × hodina, soustředění podle denní doby a automatické postřehy.
- **Kalendář (v2.1):** odučené bloky z časovače plnou barvou předmětu, plán jako obrys, živý blok běžícího časovače, automatické odškrtnutí splněného plánu, týden/měsíc, plán vs. realita.
- **Zkoušky:** automaticky naplánované rozložené opakování (spacing effect).
- **Export `.ics`:** pro Apple Kalendář, Google i Outlook.
- **Opakování témat – FSRS-6 (v2.1):** stejný algoritmus jako Anki (knihovna `ts-fsrs`). Každé téma má stabilitu, obtížnost a aktuální pravděpodobnost vybavení; hodnocení Znovu/Těžko/Dobře/Snadno; nastavitelná cílová spolehlivost; opakování se nikdy nenaplánuje až po zkoušce.
- **Anki (v2.1):** přes doplněk AnkiConnect panel „Anki dnes“ (nové / učené / k opakování po balíčcích) a čas z Anki automaticky ve statistikách a kalendáři.
- **Vybavení po bloku (v2):** po bloku krátce sepíšeš, co si pamatuješ (retrieval practice).
- **Týdenní reflexe (v2):** souhrn týdne, 3 otázky a jedna věc, kterou změníš – zobrazí se na přehledu.
- **Měsíční report (v2):** postřehy, nejsilnější dny a hodiny, chronotyp, srovnání předmětů s minulým měsícem, tisk do PDF.
- **Šum na soustředění (v2):** hnědý, růžový nebo bílý šum generovaný v prohlížeči.
- **Odebíraný kalendář (v2):** plán se publikuje do tajného gistu a Apple Kalendář se aktualizuje sám.
- **„Co teď?“ (v2.2):** doporučí, co se učit, podle 6 signálů – blízkost zkoušky, témata k opakování (FSRS), zaostávání za týdenním cílem, zanedbání, plán a prokládání předmětů. Typ činnosti a délka bloku podle tvých dat o soustředění. Rozpis „Proč“ ukazuje všechny signály. Viz [`src/lib/recommend.ts`](src/lib/recommend.ts).
- **Ranní plánování (v2.2):** jedním klikem navrhne prokládaný plán na zbytek dne (nedokončené ze včerejška, priority, volná místa v kalendáři) a uloží ho do kalendáře.
- **Úspěchy (v2.2):** 119 odznaků ve 24 kategoriích s úrovněmi (ocel → platina) + skryté. Počítají se z dat, i zpětně. Připraveno na budoucí online statistiku „kolik % uživatelů to má“ (vypnuto, viz `src/features/achievements/share.ts`).
- **Export CSV (v2).**
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

## Anki

1. V desktopové Anki: *Nástroje → Doplňky → Získat doplňky* → kód `2055492159` (AnkiConnect), restart Anki.
2. V aplikaci *Nastavení → Anki → Propojit s Anki*. Anki se zeptá na povolení stránky → Yes.
3. Funguje v prohlížeči na stejném počítači, kde běží Anki (Chromium/Firefox). Na mobilu se ukazuje poslední stav z počítače.

## Návrat na starší verzi

Každá verze je uložená jako [release](https://github.com/rawzuu/study-tracker/releases).

1. Otevři **Actions → Deploy na GitHub Pages → Run workflow**.
2. Do pole *verze* napiš tag, např. `v1.0.0`, a spusť.
3. Za ~1 minutu běží na stránce zvolená verze. Zpět na nejnovější: spusť znovu s prázdným polem.

Data zůstávají v soukromém repu nedotčená (zálohy stavu: tagy `zaloha-pred-v2` a `zaloha-pred-v2.1` v `study-tracker-data`).

### Připojení synchronizace (jednou na zařízení)

1. [Vytvoř fine-grained token](https://github.com/settings/personal-access-tokens/new):
   - *Repository access* → *Only select repositories* → `study-tracker-data`
   - *Permissions* → *Contents* → **Read and write**
2. V aplikaci otevři **Nastavení → Synchronizace s GitHubem** a vlož token.

## Bezpečnost

- **Content Security Policy:** stránka smí spouštět jen vlastní skripty a komunikovat jen s `api.github.com` a s Anki na `127.0.0.1:8765`. I kdyby se do stránky dostal cizí kód, token nemá kam odeslat.
- Token k GitHubu je jen v prohlížeči daného zařízení a má přístup jen k datovému repu (fine-grained, Contents: Read and write).
- Texty od uživatele se v grafech escapují (žádné vkládání HTML), CSV export je chráněný proti spouštění vzorců v Excelu.
- Odebíraný kalendář je v tajném (neveřejném) gistu.

## Vývoj

```bash
npm install
npm run dev       # http://localhost:5173/study-tracker/
npm test          # testy klíčové logiky (slučování dat, FSRS, doporučení, plánování, úspěchy, export)
npm run build
```

GitHub Actions před každým nasazením spustí testy – když něco selže, nová verze se nenasadí.

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
