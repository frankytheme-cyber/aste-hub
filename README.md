# Aste Hub

Aggregatore di aste immobiliari giudiziarie italiane. Raccoglie annunci da tre portali ufficiali (PVP/Ministero della Giustizia, astegiudiziarie.it, astalegale.net), normalizza i dati e li espone tramite un'API FastAPI consumata da un frontend React.

## Requisiti

- Python 3.10+
- Node.js 18+
- `pip` e `npm`

## Setup (prima volta)

```bash
# 1. Dipendenze Python + browser Chromium per Playwright
./setup.sh

# 2. Dipendenze frontend
npm install
```

### Variabili d'ambiente

Crea un file `.env` nella root del progetto:

```env
ANTHROPIC_API_KEY=sk-ant-...   # Necessario per l'analisi PDF delle perizie
```

## Avvio

Apri **due terminali**:

```bash
# Terminale 1 — Backend API (http://localhost:8000)
./start.sh

# Terminale 2 — Frontend React (http://localhost:5173)
npm run dev
```

Il backend avvia automaticamente uno scraping in background al primo avvio se non ci sono dati in cache.

## Struttura

```
aste-hub/
├── api/
│   └── main.py           # FastAPI: filtri, paginazione, proxy immagini, analisi perizie
├── scraper/
│   ├── base.py           # BaseAsteScraper + dataclass Immobile
│   ├── pvp.py            # Scraper pvp.giustizia.it
│   ├── astegiudiziarie.py# Scraper astegiudiziarie.it
│   ├── astalegale.py     # Scraper astalegale.net
│   └── main.py           # Orchestratore + CLI
├── analisi/
│   ├── documenti.py      # Recupero URL documenti (PDF) per lotto
│   ├── pdf_estrattore.py # Download e estrazione testo PDF
│   ├── analizzatore.py   # Analisi perizia con Claude API
│   └── cache.py          # Cache file-based analisi
├── data/
│   ├── aste.json         # Cache dati scraped (aggiornata ogni 6h)
│   └── analisi_cache.json# Cache analisi perizie
├── case-asta.jsx         # Frontend React (Vite)
├── setup.sh              # Setup iniziale
└── start.sh              # Avvio backend
```

## API

| Endpoint | Descrizione |
|---|---|
| `GET /api/immobili` | Lista immobili con filtri e paginazione |
| `GET /api/immobili/{id}` | Dettaglio singolo immobile |
| `POST /api/scrape` | Avvia scraping manuale |
| `GET /api/stats` | Statistiche aggregate |
| `GET /api/status` | Stato scraping in corso |
| `GET /api/immobili/{id}/documenti` | URL documenti allegati (PDF) |
| `POST /api/immobili/{id}/analisi` | Analisi perizia con Claude AI |
| `GET /api/image-proxy?url=` | Proxy immagini portali esterni |
| `GET /docs` | Documentazione interattiva Swagger |

### Parametri filtro `/api/immobili`

| Parametro | Tipo | Esempio |
|---|---|---|
| `regione` | string | `Lombardia` |
| `tipo` | string | `Appartamento` |
| `prezzo_min` | float | `50000` |
| `prezzo_max` | float | `200000` |
| `pagina` | int | `1` |
| `per_pagina` | int | `20` |

## Scraping da CLI

```bash
python -m scraper.main --regione Lombardia --prezzo-max 200000
python -m scraper.main --tipo Appartamento --regione Toscana
```
