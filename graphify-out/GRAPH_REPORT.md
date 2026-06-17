# Graph Report - .  (2026-06-15)

## Corpus Check
- Large corpus: 26 files · ~1,452,458 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 336 nodes · 559 edges · 34 communities (23 shown, 11 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 1% AMBIGUOUS · INFERRED: 49 edges (avg confidence: 0.74)
- Token cost: 170,477 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Portal Scrapers (astalegaleastegiudiziarie)|Portal Scrapers (astalegale/astegiudiziarie)]]
- [[_COMMUNITY_React Frontend Components|React Frontend Components]]
- [[_COMMUNITY_OMI Quotations Pipeline|OMI Quotations Pipeline]]
- [[_COMMUNITY_API Routes & Legal Alerts|API Routes & Legal Alerts]]
- [[_COMMUNITY_PDF Text Extraction|PDF Text Extraction]]
- [[_COMMUNITY_Scraper Normalization & Dedup|Scraper Normalization & Dedup]]
- [[_COMMUNITY_Scraper Orchestrator|Scraper Orchestrator]]
- [[_COMMUNITY_Perizia Analysis & OMI Alerts|Perizia Analysis & OMI Alerts]]
- [[_COMMUNITY_Frontend Build Dependencies|Frontend Build Dependencies]]
- [[_COMMUNITY_Claude Perizia Analyzer|Claude Perizia Analyzer]]
- [[_COMMUNITY_Document Fetch & User Overrides|Document Fetch & User Overrides]]
- [[_COMMUNITY_FastAPI App Lifecycle|FastAPI App Lifecycle]]
- [[_COMMUNITY_Analysis Cache|Analysis Cache]]
- [[_COMMUNITY_Per-Portal Document Fetch|Per-Portal Document Fetch]]
- [[_COMMUNITY_Immobili Filtering & Stats|Immobili Filtering & Stats]]
- [[_COMMUNITY_Document Classification|Document Classification]]
- [[_COMMUNITY_OMI Enrichment Background Tasks|OMI Enrichment Background Tasks]]
- [[_COMMUNITY_Market Price Lookup|Market Price Lookup]]
- [[_COMMUNITY_Frontend-Backend Proxy|Frontend-Backend Proxy]]
- [[_COMMUNITY_PDF Engine Fallbacks|PDF Engine Fallbacks]]
- [[_COMMUNITY_PDF Page Rendering|PDF Page Rendering]]
- [[_COMMUNITY_Setup & Dependencies|Setup & Dependencies]]
- [[_COMMUNITY_Setup Script|Setup Script]]
- [[_COMMUNITY_Start Script|Start Script]]
- [[_COMMUNITY_Delete Analysis Route|Delete Analysis Route]]
- [[_COMMUNITY_Get Analysis Route|Get Analysis Route]]
- [[_COMMUNITY_Market Price Route|Market Price Route]]
- [[_COMMUNITY_Frontend Manifest|Frontend Manifest]]
- [[_COMMUNITY_Fragmented Text Detection|Fragmented Text Detection]]
- [[_COMMUNITY_Data Flow Architecture|Data Flow Architecture]]
- [[_COMMUNITY_Project Documentation|Project Documentation]]

## God Nodes (most connected - your core abstractions)
1. `BaseAsteScraper` - 20 edges
2. `analizza_immobile()` - 18 edges
3. `Immobile` - 15 edges
4. `AstalegaleSpA` - 14 edges
5. `AsteGiudiziarieSpA` - 14 edges
6. `PVPScraper` - 14 edges
7. `_ensure_omi_csv()` - 12 edges
8. `load_from_disk()` - 12 edges
9. `load_from_disk` - 11 edges
10. `CaseAstaApp()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `_calcola_alert_canone_omi` --semantically_similar_to--> `AnalisiPanel()`  [INFERRED] [semantically similar]
  api/main.py → case-asta.jsx
- `CaseAstaApp()` --references--> `POST /api/scrape`  [INFERRED]
  case-asta.jsx → api/main.py
- `FastAPI` --uses--> `AstalegaleSpA`  [INFERRED]
  api/main.py → scraper/astalegale.py
- `FastAPI` --uses--> `AsteGiudiziarieSpA`  [INFERRED]
  api/main.py → scraper/astegiudiziarie.py
- `FastAPI` --uses--> `PVPScraper`  [INFERRED]
  api/main.py → scraper/pvp.py

## Import Cycles
- 1-file cycle: `api/main.py -> api/main.py`

## Hyperedges (group relationships)
- **Scrapers implementing BaseAsteScraper** — astegiudiziarie_astegiudiziariespa, astalegale_astalegalespa, pvp_pvpscraper, base_baseastescraper [EXTRACTED 1.00]
- **Flusso analisi perizia (documenti -> PDF -> Claude -> cache)** — documenti_fetch_documenti_per_fonte, pdf_estrattore_estrai_testo, analizzatore_analizza_perizia, cache_set_analisi, omi_fetch_quotazioni_omi [INFERRED 0.75]
- **Mappature di normalizzazione condivise tra scraper** — astegiudiziarie_province_regioni, astegiudiziarie_tipo_map, astegiudiziarie__norm_tipo_vendita, astegiudiziarie__norm_modalita [EXTRACTED 1.00]
- **AnalisiPanel dossier rendering components** — case_asta_analisipanel, case_asta_datatable, case_asta_callout, case_asta_icon [INFERRED 0.85]
- **Analisi perizia API flow (download->extract->Claude->OMI->cache)** — main_analizza_immobile, main_calcola_alert_canone_omi, main_calcola_alert_biennio_condominio, main_load_from_disk [INFERRED 0.85]
- **Frontend bootstrap chain (HTML->entry->root component->proxy)** — index_index_html, main_jsx_root, case_asta_caseastaapp, vite_config_api_proxy [INFERRED 0.85]

## Communities (34 total, 11 thin omitted)

### Community 0 - "Portal Scrapers (astalegale/astegiudiziarie)"
Cohesion: 0.07
Nodes (29): ABC, AstalegaleSpA, Immobile, Scraper per astalegale.net Portale autorizzato MdG — leader per aste telematiche, Scraper per https://www.astalegale.net     Usa l'API REST pubblica — nessun brow, Cerca immobili via API REST astalegale. max_pages=0 scarica tutto., AsteGiudiziarieSpA, _norm_modalita() (+21 more)

### Community 1 - "React Frontend Components"
Cohesion: 0.12
Nodes (25): AnalisiPanel(), Callout(), CardImmobile(), CaseAstaApp(), DataTable(), daysUntil(), DetailPage(), euro() (+17 more)

### Community 2 - "OMI Quotations Pipeline"
Cohesion: 0.12
Nodes (26): _cache_is_valid(), _cache_load(), _cache_save(), _decode(), _detect_sep(), _download_omi_zip(), _download_ondata_csv(), _ensure_omi_csv() (+18 more)

### Community 3 - "API Routes & Legal Alerts"
Cohesion: 0.11
Nodes (24): POST /api/immobili/{id}/analisi, _apply_filters, _apply_overrides, POST /api/analisi/arricchisci-omi, _background_arricchisci_omi, _background_scrape, Responsabilita biennale condominiale (art. 63 disp. att. c.c.), _calcola_alert_biennio_condominio (+16 more)

### Community 4 - "PDF Text Extraction"
Cohesion: 0.11
Nodes (22): conta_pagine(), _estrai_con_pdfium(), _estrai_con_pdfplumber(), estrai_testo(), Download e estrazione testo da PDF di perizie. Usa pypdfium2 (motore PDFium di C, Rileva OCR frammentato causato da timbri/watermark sovrapposti al layer testo., Renderizza solo le pagine agli indici specificati (0-based) come immagini PNG., Scarica il PDF dal portale sorgente. (+14 more)

### Community 5 - "Scraper Normalization & Dedup"
Cohesion: 0.19
Nodes (21): AstalegaleSpA._parse_item, AstalegaleSpA.search, _norm_modalita, _norm_tipo_vendita, AsteGiudiziarieSpA._parse_item, AsteGiudiziarieSpA.search, PROVINCE_REGIONI map, TIPO_MAP map (+13 more)

### Community 6 - "Scraper Orchestrator"
Cohesion: 0.18
Nodes (18): _background_scrape(), _is_immobile(), _deduplica_cross_portale(), _enrich_images(), full_scrape_and_save(), load_from_disk(), main(), Orchestratore degli scraper — esegue tutti i portali in parallelo e salva i risu (+10 more)

### Community 7 - "Perizia Analysis & OMI Alerts"
Cohesion: 0.15
Nodes (14): _calcola_risultati_finanziari, _chiama_claude, analizza_perizia, genera_descrizione, Prompt caching strategy (system prompt riutilizzato), PROMPT_SYSTEM_ANALISI, get_analisi, set_analisi (+6 more)

### Community 8 - "Frontend Build Dependencies"
Cohesion: 0.14
Nodes (13): dependencies, react, react-dom, devDependencies, vite, @vitejs/plugin-react, name, private (+5 more)

### Community 9 - "Claude Perizia Analyzer"
Cohesion: 0.26
Nodes (11): analizza_perizia(), _calcola_risultati_finanziari(), _chiama_claude(), genera_descrizione(), Analisi strutturata della perizia di stima tramite Claude API. Estrae: stato di, Chiama client.messages.create con retry esponenziale su errore 529 (overloaded)., Ricalcola risultati_finanziari e piano_finanziario in Python.     Il modello puo, Analizza la perizia tramite Claude API.      Args:         testo: Testo estratto (+3 more)

### Community 10 - "Document Fetch & User Overrides"
Cohesion: 0.20
Nodes (12): fetch_documenti_per_fonte(), Recupera i documenti (PDF) allegati a un lotto d'asta.     Dispatcha alla funzio, _apply_overrides(), get_documenti(), get_immobile(), _load_overrides(), _merge_overrides(), patch_immobile() (+4 more)

### Community 11 - "FastAPI App Lifecycle"
Cohesion: 0.18
Nodes (10): cancella_analisi(), image_proxy(), lifespan(), Backend FastAPI — serve dati aste immobiliari al frontend React. Gestisce: ricer, All'avvio: lancia uno scraping se i dati sono assenti o vecchi., Rimuove l'analisi dalla cache, permettendo di rianalizzare da zero., Stato dell'ultimo arricchimento OMI., Proxy trasparente per immagini dei portali — aggira hotlink protection. (+2 more)

### Community 12 - "Analysis Cache"
Cohesion: 0.25
Nodes (10): get_analisi(), _load(), Cache file-based per i risultati delle analisi perizie. Evita di ri-analizzare (, Ritorna l'analisi cached o None., Salva un'analisi in cache., _save(), set_analisi(), _background_arricchisci_omi() (+2 more)

### Community 13 - "Per-Portal Document Fetch"
Cohesion: 0.24
Nodes (9): _classify_documento(), _fetch_doc_astalegale(), _fetch_doc_astegiudiziarie(), _fetch_doc_pvp(), Recupero on-demand degli URL dei documenti (PDF) allegati a un lotto d'asta. Scr, PVP: i documenti sono protetti da autenticazione (401).     Non accessibili via, Recupera documenti da astalegale.net.     I PDF sono su documents.astalegale.net, Classifica un documento in base al titolo/descrizione o URL. (+1 more)

### Community 14 - "Immobili Filtering & Stats"
Cohesion: 0.20
Nodes (10): _apply_filters(), get_immobili(), load_from_disk(), Filtra in memoria la lista di immobili., Stato del sistema: dati disponibili, ultimo aggiornamento., Restituisce la lista di immobili all'asta con filtri opzionali.     I dati prove, Wrapper con cache in-memory di load_from_disk, invalidata sul mtime del file., Statistiche aggregate sui dati disponibili. (+2 more)

### Community 15 - "Document Classification"
Cohesion: 0.33
Nodes (7): _classify_documento, _fetch_doc_astalegale, _fetch_doc_astegiudiziarie, _fetch_doc_pvp, fetch_documenti_per_fonte (dispatcher), overrides.json (override indirizzo/perizia per lotto), scarica_pdf

### Community 16 - "OMI Enrichment Background Tasks"
Cohesion: 0.40
Nodes (5): arricchisci_omi(), Lancia uno scraping manuale in background.     Risponde immediatamente; i risult, Aggiunge quotazioni_omi e roi_omi a tutte le analisi in cache che ne sono prive,, trigger_scrape(), BackgroundTasks

### Community 17 - "Market Price Lookup"
Cohesion: 0.50
Nodes (4): fetch_quotazioni_omi(), Restituisce le quotazioni OMI per comune e tipologia, filtrate per zona quando, get_prezzi_mercato(), Quotazioni OMI per comune e tipologia senza dover analizzare una perizia.     La

### Community 18 - "Frontend-Backend Proxy"
Cohesion: 0.67
Nodes (3): API_BASE (/api proxy endpoint), Vite /api proxy to localhost:8000, vite.config.js (dev server + /api proxy)

### Community 19 - "PDF Engine Fallbacks"
Cohesion: 1.00
Nodes (3): _estrai_con_pdfium, _estrai_con_pdfplumber, estrai_testo

## Ambiguous Edges - Review These
- `load_from_disk` → `load_from_disk`  [AMBIGUOUS]
  api/main.py · relation: references
- `GET /api/immobili/{id}/analisi` → `GET /api/immobili/{id}/analisi`  [AMBIGUOUS]
  api/main.py · relation: references
- `src/main.jsx React entrypoint` → `start.sh (launch uvicorn)`  [AMBIGUOUS]
  start.sh · relation: references

## Knowledge Gaps
- **49 isolated node(s):** `Message`, `REGIONI`, `TIPOLOGIE`, `FONTI_INFO`, `TIPO_ICON` (+44 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `load_from_disk` and `load_from_disk`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `GET /api/immobili/{id}/analisi` and `GET /api/immobili/{id}/analisi`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `src/main.jsx React entrypoint` and `start.sh (launch uvicorn)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `fetch_quotazioni_omi()` connect `Market Price Lookup` to `OMI Quotations Pipeline`, `FastAPI App Lifecycle`, `PDF Text Extraction`, `Analysis Cache`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **Why does `AsteGiudiziarieSpA` connect `Portal Scrapers (astalegale/astegiudiziarie)` to `OMI Enrichment Background Tasks`, `FastAPI App Lifecycle`, `Scraper Orchestrator`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `PVPScraper` connect `Portal Scrapers (astalegale/astegiudiziarie)` to `OMI Enrichment Background Tasks`, `FastAPI App Lifecycle`, `Scraper Orchestrator`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `BaseAsteScraper` (e.g. with `AstalegaleSpA` and `AsteGiudiziarieSpA`) actually correct?**
  _`BaseAsteScraper` has 6 INFERRED edges - model-reasoned connections that need verification._