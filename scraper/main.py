"""
Orchestratore degli scraper — esegue tutti i portali in parallelo
e salva i risultati in data/aste.json con deduplicazione.
"""

import asyncio
import json
import logging
import os
from datetime import date, datetime, timedelta
from typing import Optional

from .pvp import PVPScraper
from .astegiudiziarie import AsteGiudiziarieSpA
from .astalegale import AstalegaleSpA
# _is_immobile e' definito in base.py e ri-esportato qui: l'API lo importa da
# scraper.main insieme al resto della pipeline.
from .base import Immobile, _is_immobile  # noqa: F401

logger = logging.getLogger(__name__)

DATA_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "aste.json")


# Gli archivi dei portali contengono errori di data entry: esistono annunci con
# data di vendita nel 2202 o nel 3019. Oltre questo orizzonte la data non e'
# credibile e l'annuncio inquinerebbe l'ordinamento "prossime aste".
ORIZZONTE_ANNI = 3


def _scarta_date_implausibili(items: list[dict]) -> list[dict]:
    """Rimuove gli annunci con data d'asta oltre l'orizzonte credibile."""
    limite = (date.today() + timedelta(days=365 * ORIZZONTE_ANNI)).isoformat()
    tenuti = [i for i in items if (i.get("data_asta") or "") <= limite]
    scartati = len(items) - len(tenuti)
    if scartati:
        logger.info(
            f"[orchestratore] Scartati {scartati} annunci con data d'asta "
            f"implausibile (oltre {limite})"
        )
    return tenuti


def _chiave_lotto(item: dict) -> Optional[tuple]:
    """Chiave di identita' presunta di un lotto: (comune, prezzo, data d'asta).

    Restituisce None se prezzo o data mancano: senza quei due campi la chiave
    degrada a "un qualunque lotto in questo comune" e accomunerebbe immobili
    diversi. Meglio nessun match che un match sbagliato.
    """
    comune = (item.get("comune") or "").lower().strip()
    prezzo = item.get("prezzo")
    data = item.get("data_asta")
    if not comune or not prezzo or not data:
        return None
    return (comune, prezzo, data)


def _enrich_images(items: list[dict]) -> None:
    """
    Arricchisce gli annunci senza immagine copiandola da un annuncio
    corrispondente su un altro portale.

    Usa SOLO come donatori gli item che avevano l'immagine prima dell'enrichment
    (immagini originali dello scraper) per evitare propagazione a cascata.

    Pass 1: match esatto (comune + prezzo + data asta) — stesso lotto cross-portale.
    Pass 2: match per indirizzo (comune + indirizzo) — stesso edificio, lotti diversi.
    """
    # Snapshot degli item con immagine originale (prima di qualsiasi modifica)
    originali = [item for item in items if item.get("immagine")]

    # Pass 1: match esatto (comune, prezzo, data_asta)
    exact_index: dict[tuple, str] = {}
    for item in originali:
        key = _chiave_lotto(item)
        if key and key not in exact_index:
            exact_index[key] = item["immagine"]

    enriched = 0
    for item in items:
        if item.get("immagine"):
            continue
        key = _chiave_lotto(item)
        img = exact_index.get(key) if key else None
        if img:
            item["immagine"] = img
            enriched += 1

    # Pass 2: match per indirizzo (stesso edificio, lotti diversi)
    addr_index: dict[tuple, str] = {}
    for item in originali:
        addr = (item.get("indirizzo") or "").lower().strip()
        if len(addr) >= 10:
            key = ((item.get("comune") or "").lower().strip(), addr)
            if key not in addr_index:
                addr_index[key] = item["immagine"]

    enriched_addr = 0
    for item in items:
        if item.get("immagine"):
            continue
        addr = (item.get("indirizzo") or "").lower().strip()
        if len(addr) >= 10:
            key = ((item.get("comune") or "").lower().strip(), addr)
            img = addr_index.get(key)
            if img:
                item["immagine"] = img
                enriched_addr += 1

    total = enriched + enriched_addr
    if total:
        logger.info(
            f"[orchestratore] Immagini arricchite cross-portale: {total} "
            f"({enriched} match esatto, {enriched_addr} per indirizzo)"
        )


_FONTE_PRIORITY = {"astegiudiziarie": 3, "astalegale": 2, "pvp": 1}


def _deduplica_cross_portale(items: list[dict]) -> list[dict]:
    """
    Rimuove i duplicati cross-portale: stesso immobile pubblicato su più portali
    con lo stesso comune, prezzo e data d'asta.

    Regola: se in un gruppo (comune, prezzo, data) ci sono fonti diverse,
    tieni solo il migliore (prefer immagine > astegiudiziarie > astalegale > pvp).
    Se tutte le fonti sono uguali, tieni tutto (sono lotti diversi della stessa procedura).
    I lotti senza prezzo o senza data non sono confrontabili e passano intatti.
    """
    from collections import defaultdict

    buckets: dict[tuple, list[dict]] = defaultdict(list)
    non_confrontabili = []
    for item in items:
        key = _chiave_lotto(item)
        if key is None:
            non_confrontabili.append(item)
            continue
        buckets[key].append(item)

    result = list(non_confrontabili)
    rimossi = 0
    for key, group in buckets.items():
        fonti = {i.get("fonte") for i in group}
        if len(fonti) <= 1:
            result.extend(group)
            continue

        # Gruppo cross-portale: scegli il migliore e scarta gli altri
        def _score(item):
            return (
                bool(item.get("immagine")),
                _FONTE_PRIORITY.get(item.get("fonte") or "", 0),
                bool(item.get("indirizzo")),
                bool(item.get("mq")),
            )

        best = max(group, key=_score)
        result.append(best)
        rimossi += len(group) - 1

    if rimossi:
        logger.info(f"[orchestratore] Deduplicati {rimossi} annunci cross-portale")
    return result


async def run_scraper(
    scraper_cls,
    regione=None,
    tipo=None,
    prezzo_min=None,
    prezzo_max=None,
    data_fine=None,
    max_pages=0,
) -> list[dict]:
    """Esegue un singolo scraper e restituisce lista di dict."""
    name = scraper_cls.SOURCE_NAME
    logger.info(f"[{name}] Avvio scraping...")
    try:
        async with scraper_cls(headless=True) as sc:
            results = await sc.search(
                regione=regione,
                tipo=tipo,
                prezzo_min=prezzo_min,
                prezzo_max=prezzo_max,
                data_fine=data_fine,
                max_pages=max_pages,
            )
        logger.info(f"[{name}] Completato: {len(results)} immobili")
        return [r.to_dict() for r in results]
    except Exception as e:
        logger.error(f"[{name}] Errore fatale: {e}")
        return []


async def scrape_all(
    regione: Optional[str] = None,
    tipo: Optional[str] = None,
    prezzo_min: Optional[float] = None,
    prezzo_max: Optional[float] = None,
    data_fine: Optional[str] = None,
    max_pages: int = 0,
    scrapers=None,
) -> list[dict]:
    """
    Esegue tutti gli scraper in parallelo e deduplicato.
    """
    if scrapers is None:
        scrapers = [PVPScraper, AsteGiudiziarieSpA, AstalegaleSpA]

    tasks = [
        run_scraper(sc, regione, tipo, prezzo_min, prezzo_max, data_fine, max_pages)
        for sc in scrapers
    ]

    all_results_nested = await asyncio.gather(*tasks, return_exceptions=True)

    # Appiattisci e deduplica
    seen_ids = set()
    all_items = []
    for batch in all_results_nested:
        if isinstance(batch, Exception):
            logger.error(f"[orchestratore] Scraper fallito: {batch}")
            continue
        for item in batch:
            uid = item.get("id", "")
            if uid and uid not in seen_ids:
                seen_ids.add(uid)
                all_items.append(item)

    before = len(all_items)
    all_items = [i for i in all_items if _is_immobile(i)]
    esclusi = before - len(all_items)
    if esclusi:
        logger.info(f"[orchestratore] Esclusi {esclusi} beni non immobiliari")

    all_items = _scarta_date_implausibili(all_items)

    # Deduplicazione cross-portale: stesso lotto pubblicato su più portali
    all_items = _deduplica_cross_portale(all_items)

    # Arricchimento immagini cross-portale: se un annuncio non ha immagine,
    # prova a copiarla da un annuncio corrispondente su un altro portale.
    _enrich_images(all_items)

    # Ordina per data; i lotti con data non ancora fissata finiscono in coda
    all_items.sort(key=lambda x: x.get("data_asta") or "9999")

    logger.info(f"[orchestratore] Totale unico: {len(all_items)} immobili")
    return all_items


def save_to_disk(items: list[dict], path: str = DATA_FILE) -> str:
    """
    Salva i risultati su disco con metadata.
    Scrittura atomica: scrive su file temporaneo poi fa rename,
    così una lettura concorrente non vede mai un file parziale.
    """
    import tempfile
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = {
        "updated_at": datetime.utcnow().isoformat() + "Z",
        "count": len(items),
        "items": items,
    }
    dir_ = os.path.dirname(path) or "."
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=dir_, suffix=".tmp", delete=False
    ) as tmp:
        json.dump(payload, tmp, ensure_ascii=False, indent=2)
        tmp_path = tmp.name
    os.replace(tmp_path, path)  # atomico su POSIX
    logger.info(f"[orchestratore] Salvati {len(items)} immobili in {path}")
    return path


def load_from_disk(path: str = DATA_FILE) -> dict:
    """Carica dati dal disco. Gestisce file assente o corrotto."""
    if not os.path.exists(path):
        return {"updated_at": None, "count": 0, "items": []}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"[orchestratore] Errore lettura {path}: {e} — restituisco vuoto")
        return {"updated_at": None, "count": 0, "items": []}


async def full_scrape_and_save(**kwargs) -> dict:
    """Esegue scraping completo e salva. Usato dalla FastAPI."""
    items = await scrape_all(**kwargs)
    if items:
        save_to_disk(items)
    return {"scraped": len(items), "saved": bool(items)}


# Punto di ingresso CLI
if __name__ == "__main__":
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s"
    )

    parser = argparse.ArgumentParser(description="Scraper aste immobiliari")
    parser.add_argument("--regione", default=None)
    parser.add_argument("--tipo", default=None)
    parser.add_argument("--prezzo-min", type=float, default=None)
    parser.add_argument("--prezzo-max", type=float, default=None)
    parser.add_argument("--data-fine", default=None)
    parser.add_argument("--max-pages", type=int, default=25)
    parser.add_argument("--output", default=DATA_FILE)
    args = parser.parse_args()

    async def main():
        items = await scrape_all(
            regione=args.regione,
            tipo=args.tipo,
            prezzo_min=args.prezzo_min,
            prezzo_max=args.prezzo_max,
            data_fine=args.data_fine,
            max_pages=args.max_pages,
        )
        save_to_disk(items, args.output)
        print(f"\n✅ Scraping completato: {len(items)} immobili salvati in {args.output}")

    asyncio.run(main())
