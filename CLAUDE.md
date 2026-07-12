# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Italian real-estate judicial auction aggregator. Scrapes listings from three official portals (PVP/Ministero della Giustizia, astegiudiziarie.it, astalegale.net), normalizes data into a common `Immobile` schema, and serves them via a FastAPI backend. A Vite + React frontend consumes the API.

## Setup & Run

```bash
# Initial setup (installs Python deps + Playwright Chromium)
./setup.sh

# Start the FastAPI backend (http://localhost:8000, auto-reload)
./start.sh
# or: python -m uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

# Start the frontend dev server (http://localhost:5173, proxies /api -> :8000)
npm run dev

# Frontend tests (Vitest) / production build
npm test
npm run build

# Backend tests (pytest)
python -m pytest api/test_filters.py

# Run scraper manually from CLI
python -m scraper.main --regione Lombardia --prezzo-max 200000

# API docs
# http://localhost:8000/docs
```

Note: the frontend shows "Errore API: 500" on every request when the backend on port 8000 is down — the Vite proxy answers 500 for an unreachable target. Start the backend first.

## Architecture

**Backend (Python 3.10+)**

- `scraper/base.py` — `BaseAsteScraper` ABC and `Immobile` dataclass. All scrapers extend `BaseAsteScraper`, use Playwright for browser automation, and return `list[Immobile]`. The base class provides `_safe_float`, `_safe_int`, `_normalize_regione` helpers.
- `scraper/astegiudiziarie.py` — Scraper for astegiudiziarie.it (Angular SPA). Also exports `PROVINCE_REGIONI` and `TIPO_MAP` dicts used by the other scrapers.
- `scraper/pvp.py` — Scraper for pvp.giustizia.it (Entando CMS). Intercepts API responses from the JS frontend.
- `scraper/astalegale.py` — Scraper for astalegale.net.
- `scraper/main.py` — Orchestrator: runs all scrapers in parallel via `asyncio.gather`, deduplicates by `id`, persists to `data/aste.json`. Also serves as CLI entry point.
- `api/main.py` — FastAPI app. Serves cached data from `data/aste.json` with in-memory filtering/sorting/pagination. Triggers background scraping on startup if cache is stale (>6h). Key routes: `GET /api/immobili`, `GET /api/immobili/{id}`, `GET /api/facets`, `POST /api/scrape`, `GET /api/stats`, `GET /api/status`. Filters on `/api/immobili`: `regione`/`tipo`/`fonte` (comma-separated multi-value), `provincia`, `comune`, `tribunale`, `prezzo_min/max`, `data_inizio/fine`, `q` (multi-token AND, accent-insensitive). `sort` is whitelisted (`_SORT_FIELDS`); invalid fields return 400. `/api/facets` returns distinct values with counts for the filter dropdowns (province/comuni/tribunali scoped via `?regione=`/`?provincia=`).
- `api/test_filters.py` — pytest suite for filters, search, and facets.

**Frontend (Vite + React 19)**

- `index.html` -> `src/main.jsx` -> `case-asta.jsx` — the whole UI lives in `case-asta.jsx` (single large component file). Dev server on port 5173 (`strictPort`) proxies `/api` to `http://127.0.0.1:8000` (`vite.config.js`), so the app uses relative `API_BASE = "/api"`.
- `businessPlan.js` (+ `businessPlan.test.js`, Vitest) — Business Plan calculation engine imported by the BusinessPlan panels.
- Filter/search/sort state is synced to the URL query string (shareable links, restored on load); the detail overlay is deep-linkable via `?id=` and integrates with browser history (Back closes it). Filter dropdown options come from `GET /api/facets` with hardcoded `REGIONI`/`TIPOLOGIE` constants as fallback.
- `dist/` is stale build output, not the source of truth.

**Analisi Perizie (Python 3.10+)**

- `analisi/documenti.py` — Recupero on-demand degli URL dei documenti (PDF) allegati a ciascun lotto. Dispatcha alla funzione specifica in base alla `fonte` (portale). Usa `httpx.AsyncClient`.
- `analisi/pdf_estrattore.py` — Download PDF via `httpx` e estrazione testo con `pdfplumber`.
- `analisi/analizzatore.py` — Analisi strutturata del testo della perizia tramite Claude API (Sonnet). Produce un report con: stato di possesso, conformita edilizia, abusi, ROI stimato.
- `analisi/cache.py` — Cache file-based su `data/analisi_cache.json`. Evita ri-analisi della stessa perizia.

**Data flow:** Scrapers (Playwright) -> `Immobile` dataclass -> `data/aste.json` (disk cache) -> FastAPI (read from disk, filter in memory) -> React frontend.

**Analisi flow:** User clicks "Analizza perizia" -> `POST /api/immobili/{id}/analisi` -> fetch document URLs on-demand -> download PDF -> pdfplumber -> Claude API -> cache -> response.

## Key Patterns

- All scrapers use a dual extraction strategy: first intercept JSON API responses from the SPA frontend, then fall back to DOM scraping if no API data is found.
- Scraper classes are used as async context managers (`async with ScraperCls(headless=True) as sc:`).
- `PROVINCE_REGIONI` (province code -> region name) and `TIPO_MAP` (keyword -> property type) are canonical mappings defined in `astegiudiziarie.py` and imported by the other scrapers.
- Deduplication key is the `id` field, formatted as `{fonte}:{lotto_id}`.
- In `data/aste.json` the `provincia` field holds full names ("Milano", not "MI"); filter values should come from `GET /api/facets`.
- The language of the codebase (comments, variable names, user-facing strings) is Italian.
- PDF analysis requires `ANTHROPIC_API_KEY` environment variable. The API warns at startup if not configured.
- Analysis results are cached in `data/analisi_cache.json` to avoid re-processing the same perizia.
- Additional API routes: `GET /api/immobili/{id}/documenti`, `POST /api/immobili/{id}/analisi`.
