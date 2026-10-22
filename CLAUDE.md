# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Italian real-estate judicial auction aggregator. Scrapes listings from three official portals (PVP/Ministero della Giustizia, astegiudiziarie.it, astalegale.net), normalizes data into a common `Immobile` schema, and serves them via a FastAPI backend. A Vite + React frontend consumes the API.

## Setup & Run

```bash
# Initial setup (installs Python deps)
./setup.sh

# Start the FastAPI backend (http://localhost:8000, auto-reload)
./start.sh
# or: python -m uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

# Start the frontend dev server (http://localhost:5173, proxies /api -> :8000)
npm run dev

# Frontend tests (Vitest) / production build
npm test
npm run build

# Backend tests (pytest) — all suites
python3 -m pytest

# Run scraper manually from CLI (full catalog -> data/aste.json).
# Filtered/limited runs write to data/aste_parziale.json unless --output is given.
python3 -m scraper.main
python3 -m scraper.main --regione Lombardia --prezzo-max 200000

# API docs
# http://localhost:8000/docs
```

Note: the frontend shows "Errore API: 500" on every request when the backend on port 8000 is down — the Vite proxy answers 500 for an unreachable target. Start the backend first.

Note: `./start.sh` runs uvicorn with `--reload`. When the data is older than 6h, every reload (= every saved `.py` file) restarts a full scrape — ~1.600 requests to astalegale each time, which can get the IP rate-limited. While editing backend code with stale data, run without `--reload` or refresh the data first.

## Architecture

**Backend (Python 3.9+; on this machine it runs on the system `python3` 3.9 — there is no `python` binary)**

- `scraper/base.py` — `BaseAsteScraper` ABC and `Immobile` dataclass. All scrapers extend `BaseAsteScraper`, call the portals' JSON APIs with `httpx` (no browser), and return `list[Immobile]`. Also holds the shared text extractors `estrai_mq` (surface from the lot description — no portal has a structured field) and `analizza_diritti` (partial rights: "Quota 1/3", nuda proprietà, usufrutto, diritto di superficie), plus `parse_numero`.
- `scraper/astegiudiziarie.py` — Scraper for astegiudiziarie.it (Angular SPA). Also exports `PROVINCE_REGIONI` and `TIPO_MAP` dicts used by the other scrapers.
- `scraper/pvp.py` — Scraper for pvp.giustizia.it (Entando CMS). Intercepts API responses from the JS frontend.
- `scraper/astalegale.py` — Scraper for astalegale.net.
- `scraper/main.py` — Orchestrator (`scrape_all`): runs all scrapers in parallel, deduplicates, persists to `data/aste.json`. Used by both the API and the CLI. With `precedenti=` a source returning < 50% of its previous count keeps its previous future lots (`_integra_fonte_fallita`) instead of vanishing from the catalog.
- `api/main.py` — FastAPI app. Serves cached data from `data/aste.json` with in-memory filtering/sorting/pagination. Triggers background scraping on startup if cache is stale (>6h); `POST /api/scrape` always scrapes the whole catalog (a filtered scrape would replace `aste.json` with a subset). Every item returned by `/api/immobili` and `/api/immobili/{id}` carries a computed `valutazione` (see `analisi/valutazione.py`). Key routes: `GET /api/immobili`, `GET /api/immobili/{id}`, `GET /api/facets`, `POST /api/scrape`, `GET /api/stats`, `GET /api/status`. Filters on `/api/immobili`: `regione`/`tipo`/`fonte` (comma-separated multi-value), `provincia`, `comune`, `tribunale`, `prezzo_min/max`, `data_inizio/fine`, `q` (multi-token AND, accent-insensitive), `solo_piena_proprieta`, `solo_liberi`. `sort=-sconto_omi` orders by discount vs OMI. `GET /api/immobili/mappa` takes the same filters (shared `_filtri_richiesta` dependency) and returns every matching lot with coordinates as compact `[id, lat, lng, prezzo, giudizio]` points for the map. It must stay declared before `/api/immobili/{item_id}`. `sort` is whitelisted (`_SORT_FIELDS`); invalid fields return 400. `/api/facets` returns distinct values with counts for the filter dropdowns (province/comuni/tribunali scoped via `?regione=`/`?provincia=`).
- `api/test_filters.py` — pytest suite for filters, search, and facets.

**Frontend (Vite + React 19)**

- `index.html` -> `src/main.jsx` -> `case-asta.jsx` — the whole UI lives in `case-asta.jsx` (single large component file). Dev server on port 5173 (`strictPort`) proxies `/api` to `http://127.0.0.1:8000` (`vite.config.js`), so the app uses relative `API_BASE = "/api"`.
- `businessPlan.js` (+ `businessPlan.test.js`, Vitest) — Business Plan calculation engine imported by the BusinessPlan panels.
- `MappaAste.jsx` — Map view (Leaflet + OSM tiles, canvas renderer for ~18k markers), lazy-loaded so Leaflet stays out of the main bundle. List and map share the same filter query string (`filterQuery`); the view is in the URL as `?vista=mappa`.
- Filter/search/sort state is synced to the URL query string (shareable links, restored on load); the detail overlay is deep-linkable via `?id=` and integrates with browser history (Back closes it). Filter dropdown options come from `GET /api/facets` with hardcoded `REGIONI`/`TIPOLOGIE` constants as fallback.
- `dist/` is stale build output, not the source of truth.

**Analisi Perizie**

- `analisi/documenti.py` — Recupero on-demand degli URL dei documenti (PDF) allegati a ciascun lotto. Dispatcha alla funzione specifica in base alla `fonte` (portale). Usa `httpx.AsyncClient`.
- `analisi/pdf_estrattore.py` — Download PDF via `httpx` e estrazione testo con `pdfplumber`.
- `analisi/analizzatore.py` — Analisi strutturata del testo della perizia tramite Claude API (Sonnet). Produce un report con: stato di possesso, conformita edilizia, abusi, ROI stimato.
- `analisi/cache.py` — Cache file-based su `data/analisi_cache.json` (scrittura atomica). Per modificare un'analisi esistente usare `aggiorna_analisi` (rilegge il file): salvare una copia letta minuti prima cancella le analisi fatte nel frattempo.
- `analisi/omi.py` — Quotazioni OMI. Indice in memoria del solo semestre più recente (`prepara_indice`, caricato all'avvio); `quotazione_comunale` è sincrona per la valutazione della lista. Il mirror `ondata` arriva solo al **2018-S2**: per dati attuali scaricare il CSV ufficiale dall'area riservata AdE ("Forniture dati OMI") e sostituire `data/omi_valori.csv`.
- `analisi/zone_omi.py` — Zona OMI esatta dalle coordinate: poligoni delle zone (KMZ per provincia, mirror ondata, 2018-2, 100 province su 107) scaricati in `data/omi_zone/`, assegnazione punto-in-poligono una provincia alla volta, cache per coordinata in `data/omi_zone/assegnazioni.json`. `assegna_zone` gira in `scrape_all` e imposta `zona_omi` = "CODCOM:ZONA" (es. "A390:D66"), la stessa chiave di `Comune_amm`/`Zona` del CSV dei valori (`omi.quotazione_zona`). CLI: `python3 -m analisi.zone_omi`.
- `analisi/valutazione.py` — Valutazione rapida deterministica di un lotto (prezzo base €/m² vs OMI tipico del comune, diritti parziali, occupazione, tempi) → `giudizio` interessante/da_valutare/rischioso. Primo filtro prima di spendere un'analisi Claude.
- `analisi/schema_perizia.py` — Schema JSON per gli output strutturati dell'analisi (`output_config.format`). Gli output strutturati ammettono al massimo 16 unioni di tipi e 24 campi opzionali, quindi lo schema non ha null: testo assente = `""`, numero assente = `-1`, sì/no ignoto = `"non_indicato"`; `normalizza` li riconverte in None. Schema e conversione derivano dalla stessa `SPEC`: un campo nuovo si aggiunge lì (e nell'esempio del prompt). `piano_finanziario`/`risultati_finanziari` non sono chiesti al modello: li calcola `_calcola_risultati_finanziari`.
- Modello: `claude-sonnet-5-5` (analisi effort `medium`, descrizione `low`, chat `medium`), in streaming con fallback lato server (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Il pensiero adattivo è attivo di default: leggere la risposta per tipo di blocco (`testo_risposta`), mai `content[0]`, e lasciare spazio in `max_tokens`. L'SDK installato è 0.x (Python 3.9: la serie 1.x richiede 3.10+).
- Le chiamate a Claude usano `anthropic.AsyncAnthropic`: il client sincrono dentro gli handler async bloccava l'intero backend per tutta la durata dell'analisi.

**Data flow:** Scrapers (httpx) -> `Immobile` dataclass -> `data/aste.json` (disk cache) -> FastAPI (read from disk, filter in memory) -> React frontend.

**Analisi flow:** User clicks "Analizza perizia" -> `POST /api/immobili/{id}/analisi` -> fetch document URLs on-demand -> download PDF -> pdfplumber -> Claude API -> cache -> response.

## Key Patterns

- All scrapers use a dual extraction strategy: first intercept JSON API responses from the SPA frontend, then fall back to DOM scraping if no API data is found.
- Scraper classes are used as async context managers (`async with ScraperCls(headless=True) as sc:`).
- `PROVINCE_REGIONI` (province code -> region name) and `TIPO_MAP` (keyword -> property type) are canonical mappings defined in `astegiudiziarie.py` and imported by the other scrapers.
- Deduplication key is the `id` field, formatted as `{fonte}:{lotto_id}`.
- In `data/aste.json` the `provincia` field holds full names ("Milano", not "MI") for every source — astegiudiziarie returns codes and the scraper normalizes them via `PROVINCE_NOMI`. Filter values should come from `GET /api/facets`; `?provincia=` also accepts a code so older shared links keep working.
- `regione` is always the hyphenated canonical spelling ("Emilia-Romagna"). astalegale returns it unhyphenated, so the region is derived from the province via `PROVINCE_REGIONI` instead of trusting the field.
- The language of the codebase (comments, variable names, user-facing strings) is Italian.
- PDF analysis requires `ANTHROPIC_API_KEY` environment variable. The API warns at startup if not configured.
- Analysis results are cached in `data/analisi_cache.json` to avoid re-processing the same perizia.
- Additional API routes: `GET /api/immobili/{id}/documenti`, `POST /api/immobili/{id}/analisi`.
- `data_asta` may be `None`: many lots are published before the sale date is set. The API keeps them visible (`_asta_attiva`) and sorts them last; the card and detail panel show "Data da definire". Do not drop them in the scrapers.

## Portal API quirks

Hard-won details — getting any of these wrong silently drops thousands of listings.

**astalegale.net** (`POST api.astalegale.net/Search`)
- The API ignores the requested `PageSize` and always returns **12** results per page. The real page size is read from the first response; assuming a larger one stops pagination early (this bug cost ~14.000 of 18.500 listings).
- Rate limit: ~100 requests per window, then `429`. Pagination is sequential on purpose — parallelising just trades speed for backoff.
- `isPro: true` items have every field masked with `X` (paywall). They are PVP listings, so they are skipped and taken from the PVP scraper instead.
- Field mapping is counter-intuitive: `titolo` is the **address**, `descrizione` is the lot text. `dataAsta`/`prezzo` can be `"-"` (not yet set).
- Republished PVP lots have `source: "PVP"` and `externalDetailUrl` with `idAnnuncio=` → `id_pvp`. `modalitaVendita` ("Asincrona") is the sale type; `posizione` has lat/lng.

**pvp.giustizia.it** (`POST .../ric-ms/ricerca/vendite`)
- Do **not** use `filtroAnnunci: 0`: it returns only recently *published* annunci (~8.200), not all upcoming sales (~16.500). An auction in September published in April is missing.
- Instead the full archive (~279.000 rows, historical) is paged with `sort=dataVendita,asc&sort=id,asc`, starting from the first page with `dataVendita >= today`, found by binary search. The secondary sort on `id` keeps deep pagination deterministic.
- `regione` in the request body is silently ignored; the region filter is applied client-side.
- `disponibilita` (LIBER/OCCUP/OCCST/INCOR/NON_SPECIFICATA) is the occupancy status → `stato_occupazione`; `categoriaBene` is the cadastral category (far more precise than `categoriaLotto`); `indirizzo.coordinate` has lat/lng.
- `esito` in `SOSPE`/`ASDES`/`AGGIU` means suspended/unsold/awarded — excluded.

**astegiudiziarie.it** (`POST webapi.astegiudiziarie.it/api/search/map`)
- `search/Data` batches are fetched in parallel (`MAX_CONCORRENZA = 6`; measured: no errors up to 8 concurrent, ~4x faster overall).
- Two steps: `search/map` returns every lot id (~13.850, upcoming only with `storica: False`), then `search/Data` fetches details in batches of 20 (API limit).
- Even with `storica: False` about a third of the lots are `semaforo.descrizione == "NON PIU PARTECIPABILE"` (deserted/awarded/suspended): skipped by `_partecipabile`. Use `categoria` (cadastral) before `tipologia` for the type; coordinates only come from `search/map`; no surface field.
- `tipoRicerca: 1` is real estate; `2` is movable goods (vehicles, jewellery) and `3` credits/patents/trademarks — both correctly out of scope.

**Cross-portal**
- All the portals' archives contain data-entry errors (sale dates in 2202, 3019). `_scarta_date_implausibili` in `scraper/main.py` drops anything beyond `ORIZZONTE_ANNI`, for every source at once.
- astalegale and astegiudiziarie both republish PVP listings, so roughly half of the raw ~41.000 rows are cross-portal duplicates, collapsed by `_deduplica_cross_portale`: first exactly on `id_pvp`, then heuristically on `(comune, prezzo, data_asta)`. Lots missing a price or a date are left alone: that key would otherwise mean "any lot in this town" and merge unrelated properties. The kept lot inherits fields it lacks from the dropped duplicates (`_CAMPI_COMPLEMENTARI`), e.g. PVP's occupancy status.
- Classification: structured type fields are often generic ("IMMOBILI", "IMMOBILI-ALTRA CATEGORIA"). Use `classifica_tipo_da(specific, ..., generic)`, which falls through to the next text when a field yields only "Immobile".
