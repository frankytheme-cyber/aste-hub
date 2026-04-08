"""
Orchestratore degli scraper — esegue tutti i portali in parallelo
e salva i risultati in data/aste.json con deduplicazione.
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Optional

from .pvp import PVPScraper
from .astegiudiziarie import AsteGiudiziarieSpA
from .astalegale import AstalegaleSpA
from .base import Immobile

logger = logging.getLogger(__name__)

DATA_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "aste.json")


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

    all_results_nested = await asyncio.gather(*tasks, return_exceptions=False)

    # Appiattisci e deduplica
    seen_ids = set()
    all_items = []
    for batch in all_results_nested:
        for item in batch:
            uid = item.get("id", "")
            if uid and uid not in seen_ids:
                seen_ids.add(uid)
                all_items.append(item)

    # Filtra beni non immobiliari.
    # 1) Whitelist tipi specifici (passano sempre)
    # 2) Tipo generico "Immobile" → controlla che il titolo menzioni un bene immobiliare
    import re

    _TIPI_SPECIFICI = {
        "appartamento", "villa / casa indipendente", "terreno",
        "locale commerciale", "capannone industriale",
        "garage / box", "magazzino", "ufficio",
    }
    _IMMOBILE_RE = re.compile(
        r"(appartament|villa|casa|abitazion|terren[oi]|fabbricat|locale|negozio"
        r"|capannon|garage|autorimessa|box\b|magazzin|ufficio|deposito"
        r"|laboratorio|albergo|complesso|immobil|propriet[aà]"
        r"|piano\s+(primo|secondo|terzo|quarto|quinto|terra|seminterr|interr|rialz)"
        r"|foglio|particella|catast|sub\s*\d|mq\s*\d|superficie"
        r"|vani\s*\d|stanz|camera|cucina|bagno|cantina|soffitta|soffitte|mansarda"
        r"|posto\s*auto|parcheggio|rudere|ruderi|edificabil|seminativ"
        r"|agricol|lotto\s+n|vendita\s+terreni|fallimento|ambient[ei]"
        r"|\bvia\s+|\bpiazza\s+|\bviale\s+|\bcorso\s+|\bcontrada\s+|\blocalit[aà])",
        re.IGNORECASE,
    )

    before = len(all_items)
    def _is_immobile(item):
        tipo = (item.get("tipo") or "").lower()
        if tipo in _TIPI_SPECIFICI:
            return True
        # Tipo generico "Immobile" → verifica dal titolo
        return bool(_IMMOBILE_RE.search(item.get("titolo") or ""))

    all_items = [i for i in all_items if _is_immobile(i)]
    esclusi = before - len(all_items)
    if esclusi:
        logger.info(f"[orchestratore] Esclusi {esclusi} beni non immobiliari")

    # Ordina per data
    all_items.sort(key=lambda x: x.get("data_asta", "9999"))

    logger.info(f"[orchestratore] Totale unico: {len(all_items)} immobili")
    return all_items


def save_to_disk(items: list[dict], path: str = DATA_FILE) -> str:
    """Salva i risultati su disco con metadata."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = {
        "updated_at": datetime.utcnow().isoformat() + "Z",
        "count": len(items),
        "items": items,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    logger.info(f"[orchestratore] Salvati {len(items)} immobili in {path}")
    return path


def load_from_disk(path: str = DATA_FILE) -> dict:
    """Carica dati dal disco."""
    if not os.path.exists(path):
        return {"updated_at": None, "count": 0, "items": []}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


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
