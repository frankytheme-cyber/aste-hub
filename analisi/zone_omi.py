"""
Zona OMI di un lotto a partire dalle sue coordinate.

Le quotazioni OMI variano molto tra le zone dello stesso comune (a Milano da
~1.000 a ~9.000 €/m²): senza la zona, la valutazione usa la mediana comunale.
I poligoni delle zone (semestre 2018-2, lo stesso delle quotazioni del mirror
ondata) sono pubblicati come KMZ per provincia: ogni zona ha il codice catastale
del comune (CODCOM, es. "A390") e il codice zona (CODZONA, es. "D66"), le stesse
chiavi delle colonne Comune_amm e Zona del CSV dei valori.

I KML di tutta Italia sono ~250 MB: non si tengono in memoria. L'assegnazione si
fa una provincia alla volta, una sola volta per coordinata (cache su disco), e
il risultato viene salvato sul lotto come ``zona_omi`` = "A390:D66".

Copertura: 100 province su 107 (il mirror non ha, ad es., Vicenza, Viterbo,
Monza, Forli'-Cesena, Fermo). Per quei lotti si resta sulla quotazione comunale.

Uso da CLI (assegna le zone ai lotti di data/aste.json):
    python3 -m analisi.zone_omi
"""

import asyncio
import io
import json
import logging
import os
import re
import tempfile
import zipfile
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
ZONE_DIR = os.path.join(_DATA_DIR, "omi_zone")
CACHE_FILE = os.path.join(ZONE_DIR, "assegnazioni.json")

_LISTA_URL = "https://api.github.com/repos/ondata/quotazioni-immobiliari-agenzia-entrate/contents/kmz"
# Nei nomi dei file sul repository "%20" e' letterale: va ricodificato come %2520.
_RAW_URL = "https://raw.githubusercontent.com/ondata/quotazioni-immobiliari-agenzia-entrate/master/kmz/"
_MAX_DOWNLOAD = 6

_RE_PLACEMARK = re.compile(r"<Placemark>(.*?)</Placemark>", re.S)
_RE_POLYGON = re.compile(r"<Polygon>(.*?)</Polygon>", re.S)
_RE_OUTER = re.compile(r"<outerBoundaryIs>.*?<coordinates>(.*?)</coordinates>", re.S)
_RE_INNER = re.compile(r"<innerBoundaryIs>.*?<coordinates>(.*?)</coordinates>", re.S)


def _campo(placemark: str, nome: str) -> str:
    m = re.search(rf'<Data name="{nome}">.*?<value>(.*?)</value>', placemark, re.S)
    return (m.group(1) if m else "").strip()


# ─── Geometria ────────────────────────────────────────────────────────────────

def _anello(testo: str) -> list:
    """'lng,lat,0 lng,lat,0 ...' -> [(lng, lat), ...]"""
    punti = []
    for tripla in testo.split():
        parti = tripla.split(",")
        if len(parti) >= 2:
            punti.append((float(parti[0]), float(parti[1])))
    return punti


def _bbox(punti: list) -> tuple:
    xs = [p[0] for p in punti]
    ys = [p[1] for p in punti]
    return min(xs), min(ys), max(xs), max(ys)


def _dentro_anello(x: float, y: float, anello: list) -> bool:
    """Ray casting: True se (x, y) e' dentro l'anello."""
    dentro = False
    j = len(anello) - 1
    for i in range(len(anello)):
        xi, yi = anello[i]
        xj, yj = anello[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            dentro = not dentro
        j = i
    return dentro


def zone_da_kml(testo: str) -> list:
    """Zone di un KML comunale: [{"codice", "bbox", "poligoni": [(esterno, [buchi])]}]."""
    zone = []
    for pm in _RE_PLACEMARK.findall(testo):
        codcom, codzona = _campo(pm, "CODCOM"), _campo(pm, "CODZONA")
        if not codcom or not codzona:
            continue
        poligoni = []
        for poly in _RE_POLYGON.findall(pm):
            esterno = _RE_OUTER.search(poly)
            if not esterno:
                continue
            anello = _anello(esterno.group(1))
            if len(anello) >= 3:
                buchi = [b for b in (_anello(t) for t in _RE_INNER.findall(poly)) if len(b) >= 3]
                poligoni.append((anello, buchi))
        if poligoni:
            tutti = [p for est, _ in poligoni for p in est]
            zone.append({"codice": f"{codcom}:{codzona}", "bbox": _bbox(tutti), "poligoni": poligoni})
    return zone


def zona_del_punto(lat: float, lng: float, zone: list) -> Optional[str]:
    for z in zone:
        x0, y0, x1, y1 = z["bbox"]
        if not (x0 <= lng <= x1 and y0 <= lat <= y1):
            continue
        for esterno, buchi in z["poligoni"]:
            if _dentro_anello(lng, lat, esterno) and not any(_dentro_anello(lng, lat, b) for b in buchi):
                return z["codice"]
    return None


def zone_da_kmz(dati: bytes) -> list:
    """Tutte le zone di una provincia (KMZ = zip con un KML per comune)."""
    zone = []
    with zipfile.ZipFile(io.BytesIO(dati)) as z:
        for nome in z.namelist():
            if nome.startswith("Comuni/") and nome.endswith(".kml"):
                zone.extend(zone_da_kml(z.read(nome).decode("utf-8", "replace")))
    return zone


# ─── Download e cache ─────────────────────────────────────────────────────────

def _carica_cache() -> dict:
    try:
        with open(CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"province": {}, "punti": {}}


def _salva_cache(cache: dict) -> None:
    os.makedirs(ZONE_DIR, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=ZONE_DIR,
                                     suffix=".tmp", delete=False) as tmp:
        json.dump(cache, tmp)
    os.replace(tmp.name, CACHE_FILE)


def _chiave(lat: float, lng: float) -> str:
    return f"{lat:.5f},{lng:.5f}"


async def _scarica_kmz(client: httpx.AsyncClient) -> list:
    """Percorsi locali di tutti i KMZ provinciali (scaricati solo la prima volta)."""
    os.makedirs(ZONE_DIR, exist_ok=True)
    r = await client.get(_LISTA_URL)
    r.raise_for_status()
    nomi = [f["name"] for f in r.json() if f["name"].endswith(".kmz")]
    sem = asyncio.Semaphore(_MAX_DOWNLOAD)

    async def _uno(nome: str) -> Optional[str]:
        locale = os.path.join(ZONE_DIR, nome.replace("%20", " "))
        if os.path.exists(locale):
            return locale
        async with sem:
            try:
                resp = await client.get(_RAW_URL + nome.replace("%", "%25").replace(" ", "%20"))
                resp.raise_for_status()
            except httpx.HTTPError as e:
                logger.warning("[zone OMI] %s non scaricato: %s", nome, e)
                return None
        with open(locale, "wb") as f:
            f.write(resp.content)
        return locale

    return [p for p in await asyncio.gather(*[_uno(n) for n in nomi]) if p]


def _elabora_province(percorsi: list, da_fare: dict, cache: dict) -> None:
    """Assegna le zone ai punti in ``da_fare`` ({chiave: (lat, lng)}), una provincia
    alla volta. CPU-bound: va eseguita in un thread."""
    for percorso in percorsi:
        if not da_fare:
            break
        nome = os.path.basename(percorso)
        bbox = cache["province"].get(nome)
        if bbox:
            x0, y0, x1, y1 = bbox
            if not any(x0 <= lng <= x1 and y0 <= lat <= y1 for lat, lng in da_fare.values()):
                continue
        with open(percorso, "rb") as f:
            zone = zone_da_kmz(f.read())
        if not zone:
            continue
        x0 = min(z["bbox"][0] for z in zone); y0 = min(z["bbox"][1] for z in zone)
        x1 = max(z["bbox"][2] for z in zone); y1 = max(z["bbox"][3] for z in zone)
        cache["province"][nome] = [x0, y0, x1, y1]
        for k, (lat, lng) in list(da_fare.items()):
            if x0 <= lng <= x1 and y0 <= lat <= y1:
                codice = zona_del_punto(lat, lng, zone)
                if codice:
                    cache["punti"][k] = codice
                    del da_fare[k]


async def assegna_zone(items: list) -> int:
    """Imposta ``zona_omi`` sui lotti con coordinate. Restituisce quanti ne hanno una.

    Non solleva mai: se i poligoni non sono scaricabili i lotti restano senza
    zona e la valutazione usa la quotazione comunale.
    """
    try:
        cache = _carica_cache()
        punti = cache["punti"]
        da_fare = {}
        for i in items:
            lat, lng = i.get("lat"), i.get("lng")
            if lat is None or lng is None:
                continue
            k = _chiave(lat, lng)
            if k not in punti:
                da_fare[k] = (lat, lng)
        if da_fare:
            logger.info("[zone OMI] %d coordinate nuove da assegnare", len(da_fare))
            async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
                percorsi = await _scarica_kmz(client)
            n_prima = len(da_fare)
            await asyncio.to_thread(_elabora_province, percorsi, da_fare, cache)
            # Le coordinate fuori da ogni zona (mare, province non coperte) si
            # ricordano come assenti, per non rielaborarle a ogni scraping.
            for k in da_fare:
                punti[k] = None
            _salva_cache(cache)
            logger.info("[zone OMI] Assegnate %d coordinate su %d", n_prima - len(da_fare), n_prima)
    except Exception as e:
        logger.error("[zone OMI] Assegnazione non riuscita: %s", e)
        return 0

    assegnati = 0
    for i in items:
        lat, lng = i.get("lat"), i.get("lng")
        codice = punti.get(_chiave(lat, lng)) if lat is not None and lng is not None else None
        i["zona_omi"] = codice
        assegnati += bool(codice)
    return assegnati


if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from scraper.main import DATA_FILE, load_from_disk, save_to_disk

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    dati = load_from_disk(DATA_FILE)
    n = asyncio.run(assegna_zone(dati["items"]))
    save_to_disk(dati["items"], DATA_FILE, updated_at=dati.get("updated_at"))
    print(f"Zona OMI assegnata a {n} lotti su {len(dati['items'])}")
