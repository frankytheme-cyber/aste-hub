"""
Orchestratore degli scraper — esegue tutti i portali in parallelo
e salva i risultati in data/aste.json con deduplicazione.
"""

import asyncio
import json
import logging
import os
from datetime import date, datetime, timedelta
from typing import Callable, Optional

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

# Campi che il lotto tenuto eredita dai duplicati scartati quando non li ha:
# ogni portale espone dati diversi (lo stato di occupazione solo il PVP, le
# coordinate non tutti), e la deduplica non deve perderli.
_CAMPI_COMPLEMENTARI = (
    "stato_occupazione", "mq", "diritto", "lat", "lng", "id_pvp", "indirizzo",
    "immagine", "tipo_vendita", "modalita_partecipazione", "offerta_minima",
    "comune", "provincia", "regione",
)


def _score_lotto(item: dict) -> tuple:
    return (
        bool(item.get("immagine")),
        _FONTE_PRIORITY.get(item.get("fonte") or "", 0),
        bool(item.get("indirizzo")),
        bool(item.get("mq")),
    )


def _fondi_gruppo(group: list[dict]) -> dict:
    """Sceglie il miglior annuncio del gruppo e lo completa con gli altri."""
    best = dict(max(group, key=_score_lotto))
    altri = [i for i in group if i.get("id") != best.get("id")]
    for campo in _CAMPI_COMPLEMENTARI:
        if best.get(campo) in (None, ""):
            valore = next((a[campo] for a in altri if a.get(campo) not in (None, "")), None)
            if valore is not None:
                best[campo] = valore
    if best.get("tipo") == "Immobile":
        best["tipo"] = next(
            (a["tipo"] for a in altri if a.get("tipo") and a["tipo"] != "Immobile"),
            best["tipo"],
        )
    return best


def _deduplica_cross_portale(items: list[dict]) -> list[dict]:
    """
    Rimuove i duplicati cross-portale: stesso immobile pubblicato su più portali.

    Passo 1 (esatto): annunci con lo stesso ``id_pvp`` — astalegale dichiara
    l'annuncio PVP da cui ripubblica.
    Passo 2 (euristico): stesso comune, prezzo e data d'asta. Se nel gruppo ci
    sono fonti diverse resta solo il migliore (immagine > astegiudiziarie >
    astalegale > pvp); se la fonte e' una sola si tiene tutto (sono lotti
    diversi della stessa procedura). I lotti senza prezzo o data passano intatti.

    In entrambi i passi il lotto tenuto eredita i campi che non ha dai
    duplicati scartati (vedi ``_CAMPI_COMPLEMENTARI``).
    """
    from collections import defaultdict

    rimossi = 0

    per_id_pvp: dict[str, list[dict]] = defaultdict(list)
    passo1 = []
    for item in items:
        if item.get("id_pvp"):
            per_id_pvp[str(item["id_pvp"])].append(item)
        else:
            passo1.append(item)
    for group in per_id_pvp.values():
        passo1.append(_fondi_gruppo(group) if len(group) > 1 else group[0])
        rimossi += len(group) - 1

    buckets: dict[tuple, list[dict]] = defaultdict(list)
    result = []
    for item in passo1:
        key = _chiave_lotto(item)
        if key is None:
            result.append(item)
        else:
            buckets[key].append(item)

    for group in buckets.values():
        if len({i.get("fonte") for i in group}) <= 1:
            result.extend(group)
            continue
        result.append(_fondi_gruppo(group))
        rimossi += len(group) - 1

    if rimossi:
        logger.info(f"[orchestratore] Deduplicati {rimossi} annunci cross-portale")
    return result


# Sotto questa frazione dei lotti dell'ultimo scraping una fonte e' considerata
# fallita (API giu', rate limit, schema cambiato): si tengono i suoi lotti
# precedenti invece di farli sparire dal catalogo fino al prossimo giro.
SOGLIA_FONTE_FALLITA = 0.5


def _integra_fonte_fallita(nome: str, nuovi: list[dict], precedenti: list[dict]) -> list[dict]:
    """Se ``nuovi`` e' molto piu' piccolo del giro precedente, aggiunge i vecchi
    lotti ancora futuri di quella fonte (i nuovi vincono a parita' di id)."""
    vecchi = [i for i in precedenti if i.get("fonte") == nome]
    if not vecchi or len(nuovi) >= len(vecchi) * SOGLIA_FONTE_FALLITA:
        return nuovi
    oggi = date.today().isoformat()
    ids_nuovi = {i.get("id") for i in nuovi}
    recuperati = [
        i for i in vecchi
        if i.get("id") not in ids_nuovi and (i.get("data_asta") or "9999") >= oggi
    ]
    logger.warning(
        f"[{nome}] Solo {len(nuovi)} lotti contro {len(vecchi)} dell'ultimo scraping: "
        f"mantengo {len(recuperati)} lotti precedenti"
    )
    return nuovi + recuperati


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
    precedenti: Optional[list[dict]] = None,
    on_progress: Optional[Callable[[str, int], None]] = None,
) -> list[dict]:
    """
    Esegue tutti gli scraper in parallelo e deduplica.

    precedenti: lotti dell'ultimo scraping completo; se passati, una fonte che
        fallisce non svuota il catalogo (vedi ``_integra_fonte_fallita``).
        Va passato solo per scraping senza filtri, altrimenti il confronto dei
        conteggi non ha senso.
    on_progress: chiamata con (nome_fonte, n_lotti) al termine di ogni scraper.
    """
    if scrapers is None:
        scrapers = [PVPScraper, AsteGiudiziarieSpA, AstalegaleSpA]

    async def _uno(sc) -> list[dict]:
        items = await run_scraper(sc, regione, tipo, prezzo_min, prezzo_max, data_fine, max_pages)
        if precedenti:
            items = _integra_fonte_fallita(sc.SOURCE_NAME, items, precedenti)
        if on_progress:
            on_progress(sc.SOURCE_NAME, len(items))
        return items

    all_results_nested = await asyncio.gather(*[_uno(sc) for sc in scrapers], return_exceptions=True)

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

    # Zona OMI dalle coordinate, per valutare il lotto sulle quotazioni della
    # sua zona invece che sulla mediana del comune. Opzionale: non solleva.
    from analisi.zone_omi import assegna_zone
    n_zone = await assegna_zone(all_items)
    logger.info(f"[orchestratore] Zona OMI assegnata a {n_zone} lotti")

    # Ordina per data; i lotti con data non ancora fissata finiscono in coda
    all_items.sort(key=lambda x: x.get("data_asta") or "9999")

    logger.info(f"[orchestratore] Totale unico: {len(all_items)} immobili")
    return all_items


def save_to_disk(items: list[dict], path: str = DATA_FILE,
                 updated_at: Optional[str] = None) -> str:
    """
    Salva i risultati su disco con metadata. ``updated_at`` va passato solo
    quando si riscrivono dati esistenti senza un nuovo scraping (altrimenti
    l'API li crederebbe freschi e salterebbe l'aggiornamento).
    Scrittura atomica: scrive su file temporaneo poi fa rename,
    così una lettura concorrente non vede mai un file parziale.
    """
    import tempfile
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = {
        "updated_at": updated_at or (datetime.utcnow().isoformat() + "Z"),
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
    parser.add_argument("--max-pages", type=int, default=0, help="0 = tutto il catalogo")
    parser.add_argument("--output", default=None,
                        help="Default: data/aste.json per uno scraping completo, "
                             "data/aste_parziale.json se ci sono filtri o --max-pages")
    args = parser.parse_args()

    # aste.json e' il catalogo servito dall'API: uno scraping filtrato o troncato
    # non deve sostituirlo, se non chiedendolo esplicitamente con --output.
    parziale = any([args.regione, args.tipo, args.prezzo_min, args.prezzo_max,
                    args.data_fine, args.max_pages])
    output = args.output or (
        os.path.join(os.path.dirname(DATA_FILE), "aste_parziale.json") if parziale else DATA_FILE
    )

    async def main():
        items = await scrape_all(
            regione=args.regione,
            tipo=args.tipo,
            prezzo_min=args.prezzo_min,
            prezzo_max=args.prezzo_max,
            data_fine=args.data_fine,
            max_pages=args.max_pages,
            precedenti=None if parziale else load_from_disk(DATA_FILE).get("items"),
        )
        save_to_disk(items, output)
        print(f"\n✅ Scraping completato: {len(items)} immobili salvati in {output}")

    asyncio.run(main())
