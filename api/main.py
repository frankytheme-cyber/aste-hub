"""
Backend FastAPI — serve dati aste immobiliari al frontend React.
Gestisce: ricerca/filtro, trigger scraping manuale, cache su disco, aggiornamento automatico.
"""

import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Assicura che il package scraper sia nel path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.main import scrape_all, save_to_disk, load_from_disk, DATA_FILE

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s"
)
logger = logging.getLogger(__name__)

# ─── Stato globale ────────────────────────────────────────────────────────────

_scraping_in_progress = False
_last_scrape: Optional[datetime] = None
_scrape_progress = {"completati": 0, "totale": 3, "fonti_ok": [], "immobili_trovati": 0}
CACHE_TTL_HOURS = 6  # Aggiorna dati ogni 6 ore


# ─── Lifecycle ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """All'avvio: lancia uno scraping se i dati sono assenti o vecchi."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        logger.warning("ANTHROPIC_API_KEY non configurata — l'analisi perizie non funzionera'")

    data = load_from_disk()
    should_scrape = (
        data["count"] == 0 or
        (data["updated_at"] and
         datetime.fromisoformat(data["updated_at"].rstrip("Z")) <
         datetime.utcnow() - timedelta(hours=CACHE_TTL_HOURS))
    )
    if should_scrape:
        logger.info("Dati assenti o vecchi — lancio scraping iniziale in background")
        asyncio.create_task(_background_scrape())
    else:
        logger.info(f"Cache valida: {data['count']} immobili da {data['updated_at']}")
    yield


# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Case all'Asta API",
    description="API per aste immobiliari giudiziarie italiane — fonti ufficiali",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # React dev server su qualsiasi porta
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Helper ───────────────────────────────────────────────────────────────────

async def _background_scrape(
    regione=None, tipo=None,
    prezzo_min=None, prezzo_max=None,
    data_fine=None,
):
    global _scraping_in_progress, _last_scrape, _scrape_progress
    if _scraping_in_progress:
        logger.info("Scraping già in corso, skip")
        return

    _scraping_in_progress = True
    _scrape_progress = {"completati": 0, "totale": 3, "fonti_ok": [], "immobili_trovati": 0}
    logger.info("🔍 Avvio scraping completo...")

    from scraper.main import run_scraper, save_to_disk as _save
    from scraper.pvp import PVPScraper
    from scraper.astegiudiziarie import AsteGiudiziarieSpA
    from scraper.astalegale import AstalegaleSpA

    scrapers = [
        ("PVP", PVPScraper),
        ("Astegiudiziarie", AsteGiudiziarieSpA),
        ("Astalegale", AstalegaleSpA),
    ]

    async def _run_one(name, cls):
        global _scrape_progress
        items = await run_scraper(
            cls, regione, tipo, prezzo_min, prezzo_max, data_fine, max_pages=0
        )
        _scrape_progress["completati"] += 1
        _scrape_progress["immobili_trovati"] += len(items)
        _scrape_progress["fonti_ok"].append(f"{name} ({len(items)})")
        return items

    try:
        results = await asyncio.gather(
            *[_run_one(name, cls) for name, cls in scrapers],
            return_exceptions=True,
        )

        # Appiattisci e deduplica
        seen_ids = set()
        all_items = []
        for batch in results:
            if isinstance(batch, Exception):
                continue
            for item in batch:
                uid = item.get("id", "")
                if uid and uid not in seen_ids:
                    seen_ids.add(uid)
                    all_items.append(item)

        # Filtra beni non immobiliari
        before = len(all_items)
        all_items = [i for i in all_items if _is_immobile(i)]
        esclusi = before - len(all_items)
        if esclusi:
            logger.info(f"Esclusi {esclusi} beni non immobiliari")

        all_items.sort(key=lambda x: x.get("data_asta", "9999"))

        if all_items:
            _save(all_items)
            _last_scrape = datetime.utcnow()
            _scrape_progress["immobili_trovati"] = len(all_items)
            logger.info(f"✅ Scraping completato: {len(all_items)} immobili")
        else:
            logger.warning("⚠️ Nessun dato restituito dagli scraper")
    except Exception as e:
        logger.error(f"❌ Errore scraping: {e}")
    finally:
        _scraping_in_progress = False


import re as _re

_TIPI_IMMOBILE = {
    "appartamento", "villa / casa indipendente", "terreno",
    "locale commerciale", "capannone industriale",
    "garage / box", "magazzino", "ufficio",
}
_RE_IMMOBILE = _re.compile(
    r"(appartament|villa|casa|abitazion|terren[oi]|fabbricat|locale|negozio"
    r"|capannon|garage|autorimessa|box\b|magazzin|ufficio|deposito"
    r"|laboratorio|albergo|complesso|immobil|propriet[aà]"
    r"|piano\s+(primo|secondo|terzo|quarto|quinto|terra|seminterr|interr|rialz)"
    r"|foglio|particella|catast|sub\s*\d|mq\s*\d|superficie"
    r"|vani\s*\d|stanz|camera|cucina|bagno|cantina|soffitta|soffitte|mansarda"
    r"|posto\s*auto|parcheggio|rudere|ruderi|edificabil|seminativ"
    r"|agricol|lotto\s+n|vendita\s+terreni|fallimento|ambient[ei]"
    r"|\bvia\s+|\bpiazza\s+|\bviale\s+|\bcorso\s+|\bcontrada\s+|\blocalit[aà])",
    _re.IGNORECASE,
)


def _is_immobile(item: dict) -> bool:
    return (
        (item.get("tipo") or "").lower() in _TIPI_IMMOBILE
        or bool(_RE_IMMOBILE.search(item.get("titolo") or ""))
    )


def _apply_filters(items: list, regione, tipo, prezzo_min, prezzo_max, data_fine, q) -> list:
    """Filtra in memoria la lista di immobili."""
    filtered = [i for i in items if _is_immobile(i)]

    if regione and regione.lower() != "tutte le regioni":
        filtered = [i for i in filtered if
                    (i.get("regione") or "").lower() == regione.lower()]

    if tipo and tipo.lower() != "tutti":
        filtered = [i for i in filtered if
                    (i.get("tipo") or "").lower() == tipo.lower()]

    if prezzo_min is not None:
        filtered = [i for i in filtered if (i.get("prezzo") or 0) >= prezzo_min]

    if prezzo_max is not None:
        filtered = [i for i in filtered if (i.get("prezzo") or 0) <= prezzo_max]

    if data_fine:
        filtered = [i for i in filtered if (i.get("data_asta") or "") <= data_fine]

    if q:
        q_lower = q.lower()
        filtered = [i for i in filtered if
                    q_lower in ((i.get("titolo") or "") + " " +
                                (i.get("comune") or "") + " " +
                                (i.get("indirizzo") or "") + " " +
                                (i.get("tipo") or "")).lower()]

    return filtered


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"message": "Case all'Asta API", "docs": "/docs"}


@app.get("/api/status")
async def status():
    """Stato del sistema: dati disponibili, ultimo aggiornamento."""
    data = load_from_disk()
    resp = {
        "count": data["count"],
        "updated_at": data["updated_at"],
        "scraping_in_progress": _scraping_in_progress,
        "cache_ttl_hours": CACHE_TTL_HOURS,
        "data_file": DATA_FILE,
    }
    if _scraping_in_progress:
        resp["progress"] = _scrape_progress
    return resp


@app.get("/api/immobili")
async def get_immobili(
    regione: Optional[str] = Query(None, description="Regione italiana"),
    tipo: Optional[str] = Query(None, description="Tipo immobile"),
    prezzo_min: Optional[float] = Query(None, ge=0),
    prezzo_max: Optional[float] = Query(None, ge=0),
    data_fine: Optional[str] = Query(None, description="YYYY-MM-DD"),
    q: Optional[str] = Query(None, description="Ricerca testuale"),
    sort: Optional[str] = Query("data_asta", description="Campo ordinamento"),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
):
    """
    Restituisce la lista di immobili all'asta con filtri opzionali.
    I dati provengono dalla cache locale aggiornata periodicamente.
    """
    data = load_from_disk()
    items = data.get("items", [])

    # Filtra
    filtered = _apply_filters(items, regione, tipo, prezzo_min, prezzo_max, data_fine, q)

    # Ordina
    reverse = sort.startswith("-")
    sort_field = sort.lstrip("-")

    _numeric_sort = sort_field in ("prezzo", "offerta_minima", "mq")

    def _sort_key(x):
        val = x.get(sort_field)
        if val is None:
            return (1, 0 if _numeric_sort else "")
        if _numeric_sort:
            return (0, float(val) if isinstance(val, (int, float)) else 0)
        return (0, str(val).lower())

    try:
        filtered.sort(key=_sort_key, reverse=reverse)
    except Exception:
        pass

    total = len(filtered)
    page = filtered[offset: offset + limit]

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "updated_at": data["updated_at"],
        "items": page,
    }


@app.get("/api/immobili/{item_id}")
async def get_immobile(item_id: str):
    """Dettaglio di un singolo immobile."""
    data = load_from_disk()
    # L'id arriva URL-encoded, es. pvp%3A1234
    from urllib.parse import unquote
    decoded_id = unquote(item_id)

    for item in data.get("items", []):
        if item.get("id") == decoded_id:
            return item

    raise HTTPException(status_code=404, detail="Immobile non trovato")


@app.post("/api/scrape")
async def trigger_scrape(
    background_tasks: BackgroundTasks,
    regione: Optional[str] = Query(None),
    tipo: Optional[str] = Query(None),
    prezzo_min: Optional[float] = Query(None),
    prezzo_max: Optional[float] = Query(None),
    data_fine: Optional[str] = Query(None),
):
    """
    Lancia uno scraping manuale in background.
    Risponde immediatamente; i risultati saranno disponibili entro pochi minuti.
    """
    if _scraping_in_progress:
        return JSONResponse(
            status_code=202,
            content={"message": "Scraping già in corso", "in_progress": True}
        )

    background_tasks.add_task(
        _background_scrape, regione, tipo, prezzo_min, prezzo_max, data_fine
    )

    return {
        "message": "Scraping avviato in background",
        "in_progress": True,
        "tip": "Controlla /api/status per sapere quando è pronto",
    }


# ─── Stato arricchimento OMI ─────────────────────────────────────────────────

_omi_enrichment: dict = {"in_progress": False, "aggiornati": 0, "saltati": 0, "totale": 0, "errori": 0}


async def _background_arricchisci_omi():
    global _omi_enrichment
    from analisi.cache import _load as _cache_load_raw, _save as _cache_save_raw
    from analisi.omi import fetch_quotazioni_omi

    _omi_enrichment = {"in_progress": True, "aggiornati": 0, "saltati": 0, "totale": 0, "errori": 0}

    cache = _cache_load_raw()
    immobili_by_id = {i["id"]: i for i in (load_from_disk().get("items") or []) if i.get("id")}
    da_aggiornare = {k: v for k, v in cache.items() if "quotazioni_omi" not in v}

    _omi_enrichment["totale"] = len(da_aggiornare)
    logger.info("[OMI] Arricchimento: %d analisi da aggiornare", len(da_aggiornare))

    for immobile_id, analisi in da_aggiornare.items():
        immobile = immobili_by_id.get(immobile_id, {})
        # Preferisce i dati dall'analisi stessa (più stabili), poi dall'aste.json
        comune = analisi.get("comune") or immobile.get("comune") or ""
        tipo   = analisi.get("tipo") or immobile.get("tipo") or "Appartamento"
        mq = (
            (analisi.get("caratteristiche") or {}).get("superficie_mq")
            or immobile.get("mq")
        )

        if not comune:
            _omi_enrichment["saltati"] += 1
            continue

        try:
            omi_data = await fetch_quotazioni_omi(comune, tipo, mq)
        except Exception as e:
            logger.error("[OMI] Errore per %s: %s", immobile_id, e)
            _omi_enrichment["errori"] += 1
            continue

        roi_omi = None
        if omi_data and omi_data.get("valore_medio"):
            offerta = analisi.get("offerta_minima") or 0
            costi   = analisi.get("costi_sanatoria") or 0
            condo   = analisi.get("spese_condominiali") or 0
            roi_omi = omi_data["valore_medio"] - offerta - costi - condo

        cache[immobile_id]["quotazioni_omi"] = omi_data
        cache[immobile_id]["roi_omi"] = roi_omi
        _omi_enrichment["aggiornati"] += 1

    _cache_save_raw(cache)
    _omi_enrichment["in_progress"] = False
    logger.info("[OMI] Arricchimento completato: %d aggiornati, %d saltati, %d errori",
                _omi_enrichment["aggiornati"], _omi_enrichment["saltati"], _omi_enrichment["errori"])


# ─── Analisi Perizie ─────────────────────────────────────────────────────────

@app.get("/api/immobili/{item_id}/documenti")
async def get_documenti(item_id: str):
    """Recupera la lista dei documenti (PDF) allegati al lotto."""
    from urllib.parse import unquote
    from analisi.documenti import fetch_documenti_per_fonte

    decoded_id = unquote(item_id)
    data = load_from_disk()
    immobile = next(
        (i for i in data.get("items", []) if i.get("id") == decoded_id), None
    )
    if not immobile:
        raise HTTPException(status_code=404, detail="Immobile non trovato")

    # Se gia' presenti nell'oggetto, ritornali
    if immobile.get("documenti"):
        return {"documenti": immobile["documenti"]}

    documenti = await fetch_documenti_per_fonte(immobile)
    return {"documenti": documenti}


@app.get("/api/immobili/{item_id}/analisi")
async def get_analisi_cached(item_id: str):
    """Restituisce l'analisi cached se disponibile, altrimenti 404."""
    from urllib.parse import unquote
    from analisi.cache import get_analisi
    cached = get_analisi(unquote(item_id))
    if not cached:
        raise HTTPException(status_code=404, detail="Analisi non ancora disponibile")
    return cached


@app.delete("/api/immobili/{item_id}/analisi")
async def cancella_analisi(item_id: str):
    """Rimuove l'analisi dalla cache, permettendo di rianalizzare da zero."""
    from urllib.parse import unquote
    from analisi.cache import _load as _cache_load_raw, _save as _cache_save_raw

    decoded_id = unquote(item_id)
    cache = _cache_load_raw()
    if decoded_id not in cache:
        raise HTTPException(status_code=404, detail="Analisi non trovata in cache")
    del cache[decoded_id]
    _cache_save_raw(cache)
    return {"message": "Analisi rimossa dalla cache"}


@app.post("/api/immobili/{item_id}/analisi")
async def analizza_immobile(item_id: str):
    """
    Scarica la perizia, estrae il testo, e produce un'analisi strutturata.
    Restituisce il risultato cached se gia' disponibile.
    """
    from urllib.parse import unquote
    from analisi.cache import get_analisi, set_analisi
    from analisi.documenti import fetch_documenti_per_fonte
    from analisi.pdf_estrattore import scarica_pdf, estrai_testo, conta_pagine
    from analisi.analizzatore import analizza_perizia

    decoded_id = unquote(item_id)

    # Check cache
    cached = get_analisi(decoded_id)
    if cached:
        return cached

    # Trova immobile
    data = load_from_disk()
    immobile = next(
        (i for i in data.get("items", []) if i.get("id") == decoded_id), None
    )
    if not immobile:
        raise HTTPException(status_code=404, detail="Immobile non trovato")

    # Recupera documenti
    documenti = await fetch_documenti_per_fonte(immobile)
    perizia = next((d for d in documenti if d["tipo"] == "perizia"), None)
    if not perizia:
        raise HTTPException(
            status_code=404,
            detail="Perizia non trovata per questo lotto. "
                   "Il portale potrebbe non esporre i documenti via API."
        )

    # Download e estrazione testo
    try:
        pdf_bytes = await scarica_pdf(perizia["url"])
        testo = estrai_testo(pdf_bytes)
        pagine = conta_pagine(pdf_bytes)
    except Exception as e:
        logger.error(f"Errore download/estrazione PDF: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Errore download/estrazione PDF: {e}"
        )

    if not testo or len(testo) < 100:
        raise HTTPException(
            status_code=422,
            detail="Il PDF sembra essere un documento scannerizzato (solo immagini). "
                   "L'analisi automatica non e' ancora supportata per questo tipo."
        )

    # Analisi con Claude API
    try:
        risultato = await analizza_perizia(testo, immobile)
    except Exception as e:
        logger.error(f"Errore analisi AI: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Errore analisi AI: {e}"
        )

    # ── Arricchimento OMI ─────────────────────────────────────────────────────
    from analisi.omi import fetch_quotazioni_omi

    comune = immobile.get("comune") or ""
    tipo   = immobile.get("tipo") or "Appartamento"
    # Preferisce la superficie estratta dalla perizia (più accurata dello scraper)
    mq = (
        (risultato.get("caratteristiche") or {}).get("superficie_mq")
        or immobile.get("mq")
    )
    omi_data = await fetch_quotazioni_omi(comune, tipo, mq) if comune else None

    roi_omi = None
    if omi_data and omi_data.get("valore_medio"):
        offerta = risultato.get("offerta_minima") or 0
        costi   = risultato.get("costi_sanatoria") or 0
        condo   = risultato.get("spese_condominiali") or 0
        roi_omi = omi_data["valore_medio"] - offerta - costi - condo

    analisi = {
        "immobile_id": decoded_id,
        "analizzato_il": datetime.utcnow().isoformat() + "Z",
        "pagine_analizzate": pagine,
        "fonte_pdf_url": perizia["url"],
        **risultato,
        "comune": immobile.get("comune"),  # salvato per arricchimento futuro
        "tipo": immobile.get("tipo"),
        "quotazioni_omi": omi_data,  # None se non disponibili
        "roi_omi": roi_omi,           # None se mq assente o dati OMI assenti
    }

    # Salva in cache
    set_analisi(decoded_id, analisi)
    return analisi


@app.post("/api/analisi/arricchisci-omi")
async def arricchisci_omi(background_tasks: BackgroundTasks):
    """
    Aggiunge quotazioni_omi e roi_omi a tutte le analisi in cache che ne sono prive,
    senza re-invocare Claude. Risponde subito; l'aggiornamento avviene in background.
    """
    if _omi_enrichment.get("in_progress"):
        return JSONResponse(
            status_code=202,
            content={"message": "Arricchimento OMI già in corso", **_omi_enrichment},
        )
    background_tasks.add_task(_background_arricchisci_omi)
    return {"message": "Arricchimento OMI avviato in background", "tip": "Controlla GET /api/analisi/arricchisci-omi per lo stato"}


@app.get("/api/analisi/arricchisci-omi")
async def stato_arricchimento_omi():
    """Stato dell'ultimo arricchimento OMI."""
    return _omi_enrichment


@app.get("/api/prezzi-mercato")
async def get_prezzi_mercato(
    comune: str = Query(..., description="Nome del comune, es. 'Milano'"),
    tipo: str = Query("Appartamento", description="Tipo immobile"),
    mq: Optional[int] = Query(None, ge=1, description="Superficie in m²"),
):
    """
    Quotazioni OMI per comune e tipologia senza dover analizzare una perizia.
    La prima chiamata scarica i dati OMI (~30-60s); le successive sono immediate (cache 180gg).
    """
    from analisi.omi import fetch_quotazioni_omi

    dati = await fetch_quotazioni_omi(comune, tipo, mq)
    if dati is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Quotazioni OMI non disponibili per '{comune}' — '{tipo}'. "
                "I dati potrebbero non essere ancora scaricabili o il comune/tipo non è presente nel dataset."
            ),
        )
    return dati


@app.get("/api/stats")
async def stats():
    """Statistiche aggregate sui dati disponibili."""
    data = load_from_disk()
    items = data.get("items", [])

    if not items:
        return {"message": "Nessun dato disponibile. Avvia /api/scrape"}

    regioni = {}
    tipi = {}
    fonti = {}
    prezzi = [i["prezzo"] for i in items if i.get("prezzo")]

    for i in items:
        r = i.get("regione") or "N/D"
        t = i.get("tipo") or "N/D"
        f = i.get("fonte") or "N/D"
        regioni[r] = regioni.get(r, 0) + 1
        tipi[t] = tipi.get(t, 0) + 1
        fonti[f] = fonti.get(f, 0) + 1

    return {
        "totale": len(items),
        "updated_at": data["updated_at"],
        "prezzo_medio": round(sum(prezzi) / len(prezzi), 2) if prezzi else 0,
        "prezzo_min": min(prezzi) if prezzi else 0,
        "prezzo_max": max(prezzi) if prezzi else 0,
        "per_regione": dict(sorted(regioni.items(), key=lambda x: -x[1])[:10]),
        "per_tipo": dict(sorted(tipi.items(), key=lambda x: -x[1])),
        "per_fonte": fonti,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "api.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
