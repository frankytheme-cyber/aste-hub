"""
Quotazioni OMI (Osservatorio del Mercato Immobiliare) — Agenzia delle Entrate.
Scarica i dati CSV open data, li cacha con TTL 180 giorni, restituisce
la quotazione media per comune e tipologia. Non solleva mai eccezioni al chiamante.

MANUTENZIONE: aggiornare _OMI_ZIP_URLS ogni semestre (gennaio e luglio)
aggiungendo il nuovo URL in cima alla lista.

NOTA (giugno 2026): i vecchi URL diretti con document-ID (documents/20143/...)
restituiscono 404 — il download massivo OMI ora passa dall'area riservata
autenticata (telematici.agenziaentrate.gov.it, "Forniture dati OMI"). In
alternativa esiste il mirror open-data `ondata/quotazioni-immobiliari-agenzia-entrate`
(file valori.7z/zone.7z su GitHub, aggiornato semestralmente): richiede pero' la
dipendenza `py7zr` e un join sul Comune_ISTAT (il file "valori" non contiene il nome
del comune). Vedi `_OMI_ZIP_URLS` e la funzione `_fetch_impl`. Finche' nessuna fonte
risponde, `fetch_quotazioni_omi` restituisce None e l'analisi prosegue senza dati OMI.
"""

import csv
import io
import json
import logging
import os
import tempfile
import unicodedata
import zipfile
from datetime import datetime, timedelta
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ─── Configurazione ───────────────────────────────────────────────────────────

OMI_CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "omi_cache.json")
# Il dataset OMI nazionale (~970k righe, ~145 MB) è troppo grande per la cache JSON:
# salviamo il CSV grezzo su disco e lo filtriamo in streaming per comune a query time.
OMI_CSV_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "omi_valori.csv")
OMI_CACHE_TTL_DAYS = 180

# Fonte primaria: mirror open-data `ondata` (GitHub), aggiornato semestralmente.
# valori.7z contiene valori.csv con schema completo (Comune_descrizione, Fascia, Zona,
# Compr_min/max, Loc_min/max) → nessun join necessario.
_ONDATA_VALORI_URLS = [
    "https://raw.githubusercontent.com/ondata/quotazioni-immobiliari-agenzia-entrate/master/data/valori.7z",
    "https://github.com/ondata/quotazioni-immobiliari-agenzia-entrate/raw/master/data/valori.7z",
]

# Fallback storico: ZIP diretti Agenzia Entrate (document-ID). NOTA: a giugno 2026
# questi URL rispondono 404 (download dismesso a favore dell'area riservata); restano
# come ultimo tentativo nel caso vengano ripristinati. Aggiungi nuovi semestri in cima.
_OMI_ZIP_URLS = [
    "https://www.agenziaentrate.gov.it/portale/documents/20143/233439/OMI_2025_2.zip",
    "https://www.agenziaentrate.gov.it/portale/documents/20143/233439/Quotazioni_OMI_2025_2.zip",
    "https://www.agenziaentrate.gov.it/portale/documents/20143/233439/OMI_2024_2.zip",
]

# Mappatura tipologie interne → keyword OMI nei CSV
_TIPO_TO_OMI: dict[str, list[str]] = {
    "Appartamento": [
        "abitazioni civili",
        "abitazioni di tipo economico",
        "abitazioni signorili",
        "residenziale",
        "abitazioni",
    ],
    "Villa / Casa indipendente": [
        "ville e villini",
        "abitazioni civili",
        "abitazioni signorili",
        "villette",
    ],
    "Locale commerciale": [
        "negozi",
        "laboratori artigianali",
        "locali commerciali",
        "commerciale",
    ],
    "Ufficio": ["uffici", "ufficio"],
    "Garage / Box": ["box auto", "posti auto coperti", "box", "autorimesse"],
    "Capannone industriale": ["capannoni tipici", "capannoni industriali", "industriale"],
    "Magazzino": ["magazzini", "depositi", "magazzino"],
    "Terreno": [],  # non mappato — OMI usa schema diverso per terreni
}

_STATO_PREFERITO = "normale"

# Mappatura zona testuale (dalla perizia / soggetto_immobile.zona) → fascia OMI.
# Le fasce OMI nei CSV sono codificate: B=centrale, C=semicentrale, D=periferica,
# E=suburbana, R=rurale (alcuni semestri usano la descrizione estesa).
_ZONA_KEYWORD_TO_FASCIA: list[tuple[tuple[str, ...], str]] = [
    (("semicentr",), "C"),                                  # va prima di "centr"
    (("centro", "centrale", "centro storico"), "B"),
    (("perifer",), "D"),
    (("suburb", "extraurb", "extra urb", "fuori citta"), "E"),
    (("rural", "agricol", "campagna"), "R"),
]

# Descrizioni estese di fascia che possono comparire nella colonna CSV, → codice.
_FASCIA_DESC_TO_COD: list[tuple[str, str]] = [
    ("semicentr", "C"),
    ("central", "B"),
    ("centro", "B"),
    ("perifer", "D"),
    ("suburb", "E"),
    ("rural", "R"),
]


def _zona_to_fascia(zona: Optional[str]) -> Optional[str]:
    """Mappa la zona testuale dell'immobile al codice fascia OMI, o None."""
    if not zona:
        return None
    z = _normalizza(zona)
    for keywords, cod in _ZONA_KEYWORD_TO_FASCIA:
        if any(k in z for k in keywords):
            return cod
    return None


def _fascia_riga_to_cod(valore: str) -> Optional[str]:
    """Normalizza il valore della colonna fascia di una riga CSV al codice B/C/D/E/R."""
    if not valore:
        return None
    v = _normalizza(valore)
    # Già un codice singolo (B, C, D, E, R)
    if len(v) == 1 and v.upper() in ("B", "C", "D", "E", "R"):
        return v.upper()
    for sub, cod in _FASCIA_DESC_TO_COD:
        if sub in v:
            return cod
    return None


# ─── Normalizzazione testo ────────────────────────────────────────────────────

def _normalizza(s: str) -> str:
    """Lowercase, rimuove accenti, strip spazi."""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower().strip()


def _match_tipologia(tipo: str, tipologia_csv: str) -> bool:
    keywords = _TIPO_TO_OMI.get(tipo, [])
    t = _normalizza(tipologia_csv)
    return any(_normalizza(k) in t or t in _normalizza(k) for k in keywords)


# ─── Cache su disco ───────────────────────────────────────────────────────────

def _cache_load() -> dict:
    try:
        with open(OMI_CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _cache_save(data: dict) -> None:
    os.makedirs(os.path.dirname(OMI_CACHE_FILE), exist_ok=True)
    with open(OMI_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _cache_is_valid(cache: dict) -> bool:
    ts = cache.get("_downloaded_at")
    if not ts:
        return False
    return datetime.utcnow() - datetime.fromisoformat(ts) < timedelta(days=OMI_CACHE_TTL_DAYS)


# ─── Download e parsing ───────────────────────────────────────────────────────

def _parse_csv_text(raw: bytes) -> list[dict]:
    """Parsa i byte di un CSV OMI. Gestisce encoding e separatori variabili."""
    rows: list[dict] = []
    text = None
    for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        logger.error("[OMI] Impossibile decodificare il CSV")
        return []

    first_line = text.split("\n")[0]
    sep = ";" if first_line.count(";") > first_line.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=sep)
    for row in reader:
        rows.append({k.strip().lower(): (v or "").strip() for k, v in row.items() if k})
    return rows


async def _download_ondata_csv() -> Optional[bytes]:
    """
    Scarica valori.7z dal mirror open-data `ondata`, estrae valori.csv e ne restituisce
    i byte grezzi. Fonte primaria delle quotazioni OMI. None se non disponibile.
    """
    try:
        import py7zr
    except ImportError:
        logger.warning("[OMI] py7zr non installato: salto il mirror ondata (pip install py7zr)")
        return None

    headers = {"User-Agent": "Mozilla/5.0 (compatible; AsteHub/1.0)"}
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        for url in _ONDATA_VALORI_URLS:
            try:
                logger.info("[OMI] Download mirror ondata: %s", url)
                resp = await client.get(url, headers=headers)
                if resp.status_code != 200 or len(resp.content) < 1000:
                    logger.warning("[OMI] %s → HTTP %d", url, resp.status_code)
                    continue
                logger.info("[OMI] Download OK: %d bytes — estrazione 7z...", len(resp.content))
                with tempfile.TemporaryDirectory() as tmp:
                    with py7zr.SevenZipFile(io.BytesIO(resp.content)) as z:
                        z.extractall(tmp)
                    csv_path = next(
                        (os.path.join(tmp, n) for n in os.listdir(tmp) if n.lower().endswith(".csv")),
                        None,
                    )
                    if not csv_path:
                        logger.error("[OMI] Nessun CSV nell'archivio ondata")
                        continue
                    with open(csv_path, "rb") as f:
                        return f.read()
            except Exception as e:
                logger.warning("[OMI] mirror ondata %s fallito: %s", url, e)
    return None


def _extract_csv_from_zip(zip_bytes: bytes) -> Optional[bytes]:
    """Estrae i byte del CSV OMI da un archivio ZIP (fallback Agenzia Entrate)."""
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            csv_names = [n for n in zf.namelist() if n.lower().endswith((".csv", ".txt"))]
            if not csv_names:
                return None
            target = next((n for n in csv_names if "omi" in n.lower()), csv_names[0])
            return zf.read(target)
    except Exception as e:
        logger.error("[OMI] Errore estrazione ZIP: %s", e)
        return None


async def _download_omi_zip() -> Optional[bytes]:
    """Fallback storico: tenta i candidati ZIP Agenzia Entrate; primo valido o None."""
    headers = {"User-Agent": "Mozilla/5.0 (compatible; AsteHub/1.0)"}
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        for url in _OMI_ZIP_URLS:
            try:
                logger.info("[OMI] Tentativo download ZIP: %s", url)
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200 and len(resp.content) > 1000:
                    logger.info("[OMI] Download OK: %d bytes", len(resp.content))
                    return resp.content
                logger.warning("[OMI] %s → HTTP %d", url, resp.status_code)
            except Exception as e:
                logger.warning("[OMI] %s fallito: %s", url, e)
    logger.error("[OMI] Tutti i candidati URL hanno fallito")
    return None


def _detect_sep(first_line: str) -> str:
    return ";" if first_line.count(";") > first_line.count(",") else ","


def _decode(raw: bytes) -> Optional[str]:
    for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return None


async def _ensure_omi_csv() -> Optional[tuple[str, dict, str]]:
    """
    Garantisce la presenza del CSV OMI su disco (scaricandolo se cache scaduta/assente)
    e restituisce (percorso_csv, col_map, separatore). None se nessuna fonte è disponibile.
    Il CSV non viene caricato in memoria: il filtro avviene in streaming a query time.
    """
    cache = _cache_load()
    csv_path = cache.get("_csv_path")
    if (
        _cache_is_valid(cache)
        and csv_path and os.path.exists(csv_path)
        and cache.get("_col_map") and cache.get("_sep")
    ):
        return csv_path, cache["_col_map"], cache["_sep"]

    logger.info("[OMI] Cache assente o scaduta, avvio download...")
    raw = await _download_ondata_csv()
    if not raw:
        zip_bytes = await _download_omi_zip()
        raw = _extract_csv_from_zip(zip_bytes) if zip_bytes else None
    if not raw:
        return None

    # Rileva colonne e separatore da un campione (header + prime righe)
    sample_text = _decode(raw[:300_000]) or ""
    if not sample_text:
        logger.error("[OMI] Impossibile decodificare il CSV")
        return None
    sep = _detect_sep(sample_text.split("\n", 1)[0])
    sample_rows = list(csv.DictReader(io.StringIO(sample_text), delimiter=sep))
    sample_rows = [{k.strip().lower(): (v or "").strip() for k, v in r.items() if k} for r in sample_rows]
    col_map = _identifica_colonne(sample_rows)
    if not col_map:
        return None

    os.makedirs(os.path.dirname(OMI_CSV_FILE), exist_ok=True)
    with open(OMI_CSV_FILE, "wb") as f:
        f.write(raw)
    _cache_save({
        "_downloaded_at": datetime.utcnow().isoformat(),
        "_csv_path": OMI_CSV_FILE,
        "_col_map": col_map,
        "_sep": sep,
    })
    logger.info("[OMI] CSV salvato su disco: %s (%d byte)", OMI_CSV_FILE, len(raw))
    return OMI_CSV_FILE, col_map, sep


def _identifica_colonne(rows: list[dict]) -> Optional[dict]:
    """Rileva nomi colonna del CSV OMI (variano tra semestri)."""
    if not rows:
        return None
    keys = list(rows[0].keys())

    def _find(candidates: list[str], exclude: tuple[str, ...] = ()) -> Optional[str]:
        for c in candidates:
            m = next((k for k in keys if c in k and not any(x in k for x in exclude)), None)
            if m:
                return m
        return None

    mapping = {
        # Preferisce il NOME del comune; esclude codici (ISTAT/catastale/amministrativo numerico)
        "comune":    _find(["comune_descrizione", "desccomune", "denominazione", "comune"],
                           exclude=("istat", "cod", "_cat")),
        "tipologia": _find(["descr_tipologia", "tipologia", "tipo", "destinazione"]),
        "stato":     _find(["statoconservazione", "stato_conservazione", "stato"]),
        # Compravendita (Compr_min/Compr_max nello schema QI corrente)
        "cot_min":   _find(["compr_min", "cotmin", "cot_min", "quotazione_min", "min"], exclude=("loc",)),
        "cot_max":   _find(["compr_max", "cotmax", "cot_max", "quotazione_max", "max"], exclude=("loc",)),
        # Locazione (Loc_min/Loc_max) — usata per il riferimento canone di mercato
        "loc_min":   _find(["loc_min"]),
        "loc_max":   _find(["loc_max"]),
        # Zona / fascia OMI
        "fascia":    _find(["fascia"]),
        "zona":      _find(["linkzona", "zona"]),
        "semestre":  _find(["semestre", "sem"]),
        "anno":      _find(["anno", "year"]),
    }
    missing = [r for r in ["comune", "tipologia", "cot_min", "cot_max"] if not mapping.get(r)]
    if missing:
        logger.error("[OMI] Colonne obbligatorie mancanti: %s. Trovate: %s", missing, keys[:15])
        return None
    return mapping


# ─── API pubblica ─────────────────────────────────────────────────────────────

async def fetch_quotazioni_omi(
    comune: str,
    tipo: str,
    mq: Optional[int] = None,
    zona: Optional[str] = None,
) -> Optional[dict]:
    """
    Restituisce le quotazioni OMI per comune e tipologia, filtrate per zona quando
    la zona dell'immobile è identificabile.

    Args:
        comune: Nome del comune (es. "Milano", "Roma")
        tipo:   Tipologia interna (es. "Appartamento", "Locale commerciale")
        mq:     Superficie in m² — se fornita, aggiunge valore_min/max/medio totale
        zona:   Zona testuale dell'immobile (es. "centro", "periferica"). Se mappabile
                a una fascia OMI, le quotazioni vengono filtrate su quella fascia;
                altrimenti si usa il range min-max dell'intero comune.

    Returns:
        {
            "tipologie_trovate": ["Abitazioni civili", ...],
            "cotazione_min_mq": 1200,
            "cotazione_max_mq": 1800,
            "canone_min_mq_mese": 8,     # locazione, se disponibile
            "canone_max_mq_mese": 12,    # locazione, se disponibile
            "valore_min": 96000,         # solo se mq fornito
            "valore_max": 144000,        # solo se mq fornito
            "valore_medio": 120000,      # solo se mq fornito
            "zona_identificata": true,   # false → range comunale, non zonale
            "fascia_usata": "B",         # None se zona non identificata
            "nota_zona": "...",
            "n_zone": 4,
            "semestre": "2025-S2",
            "fonte": "OMI — Agenzia delle Entrate",
        }
        o None se dati non disponibili. Non solleva mai eccezioni.
    """
    try:
        return await _fetch_impl(comune, tipo, mq, zona)
    except Exception as e:
        logger.error("[OMI] Errore inatteso: %s", e)
        return None


async def _fetch_impl(
    comune: str,
    tipo: str,
    mq: Optional[int],
    zona: Optional[str] = None,
) -> Optional[dict]:
    if not _TIPO_TO_OMI.get(tipo):
        return None  # Terreni o tipi non mappati

    ensured = await _ensure_omi_csv()
    if not ensured:
        return None
    csv_path, col_map, sep = ensured

    col_c   = col_map["comune"]
    col_t   = col_map["tipologia"]
    col_min = col_map["cot_min"]
    col_max = col_map["cot_max"]
    col_stato = col_map.get("stato")
    col_fascia = col_map.get("fascia")
    col_loc_min = col_map.get("loc_min")
    col_loc_max = col_map.get("loc_max")
    anno_col  = col_map.get("anno")
    sem_col   = col_map.get("semestre")

    # Stream-filter del CSV (~970k righe) per comune+tipologia, senza caricarlo in RAM.
    # Pre-filtro per riga: salta (senza parsare il CSV) le righe che non contengono
    # nemmeno il nome del comune → evita ~99% del lavoro di parsing.
    # Poi preferisce il match ESATTO del comune; usa il contains solo se nessun match
    # esatto (riduce i falsi positivi su scala nazionale).
    na = _normalizza(comune)
    na_ascii = na.isascii()  # comuni ASCII (maggioranza) → gate veloce senza unicodedata
    esatte: list[dict] = []
    contiene: list[dict] = []
    try:
        with open(csv_path, encoding="utf-8-sig", errors="replace", newline="") as f:
            header = f.readline()
            fieldnames = [h.strip() for h in next(csv.reader([header], delimiter=sep))]
            for line in f:
                if na:
                    if na_ascii:
                        if na not in line.lower():
                            continue
                    elif na not in _normalizza(line):
                        continue
                values = next(csv.reader([line], delimiter=sep))
                rl = {k.strip().lower(): (v or "").strip() for k, v in zip(fieldnames, values) if k}
                if not _match_tipologia(tipo, rl.get(col_t, "")):
                    continue
                nc = _normalizza(rl.get(col_c, ""))
                if nc and nc == na:
                    esatte.append(rl)
                elif na and (na in nc or nc in na):
                    contiene.append(rl)
    except Exception as e:
        logger.error("[OMI] Errore lettura CSV: %s", e)
        return None

    righe = esatte or contiene
    if not righe:
        logger.info("[OMI] Nessuna riga per comune='%s' tipo='%s'", comune, tipo)
        return None

    # Preferisce stato "normale"; se non trovato usa tutte le righe
    if col_stato:
        normale = [r for r in righe if _normalizza(r.get(col_stato, "")) == _normalizza(_STATO_PREFERITO)]
        righe = normale if normale else righe

    # ── Filtro per zona/fascia ────────────────────────────────────────────────
    # Se la zona dell'immobile è mappabile a una fascia OMI e quella fascia esiste
    # tra le righe del comune, restringe a quella fascia (valutazione "stessa zona").
    fascia_target = _zona_to_fascia(zona)
    zona_identificata = False
    fascia_usata: Optional[str] = None
    if fascia_target and col_fascia:
        righe_fascia = [r for r in righe if _fascia_riga_to_cod(r.get(col_fascia, "")) == fascia_target]
        if righe_fascia:
            righe = righe_fascia
            zona_identificata = True
            fascia_usata = fascia_target

    if zona_identificata:
        nota_zona = (
            f"Quotazioni filtrate sulla fascia OMI '{fascia_usata}' corrispondente alla "
            f"zona indicata in perizia ('{zona}')."
        )
    else:
        nota_zona = (
            "Zona non identificabile dalla perizia o assente nei dati OMI: viene mostrato "
            "il range min-max dell'intero comune (le quotazioni variano sensibilmente per zona)."
        )

    def _num(s: str) -> Optional[float]:
        # Gestisce sia il formato italiano ("1.000,50" → 1000.50) sia quello del
        # mirror ondata con punto decimale ("5.1" → 5.1, "1000" → 1000). Regola:
        # l'ULTIMO separatore presente è il separatore decimale.
        if not s:
            return None
        s = s.strip()
        last_dot, last_comma = s.rfind("."), s.rfind(",")
        try:
            if last_comma > last_dot:
                # decimale = virgola → punti sono migliaia
                return float(s.replace(".", "").replace(",", "."))
            if last_dot > last_comma:
                # decimale = punto → virgole sono migliaia
                return float(s.replace(",", ""))
            return float(s)  # nessun separatore
        except Exception:
            return None

    vals_min = [v for r in righe if (v := _num(r.get(col_min, ""))) and v > 0]
    vals_max = [v for r in righe if (v := _num(r.get(col_max, ""))) and v > 0]
    if not vals_min or not vals_max:
        return None

    # Range esplicito: minimo assoluto delle quotazioni minime, massimo assoluto
    # delle massime (sulla fascia se identificata, altrimenti sull'intero comune).
    cot_min = round(min(vals_min))
    cot_max = round(max(vals_max))
    tipologie = list({r.get(col_t, "") for r in righe if r.get(col_t)})

    # Canone di locazione di mercato (€/m²/mese) — usato per l'alert canone vile
    canone_min = canone_max = None
    if col_loc_min and col_loc_max:
        loc_min = [v for r in righe if (v := _num(r.get(col_loc_min, ""))) and v > 0]
        loc_max = [v for r in righe if (v := _num(r.get(col_loc_max, ""))) and v > 0]
        if loc_min:
            canone_min = round(min(loc_min), 2)
        if loc_max:
            canone_max = round(max(loc_max), 2)

    # Semestre più recente
    semestre = None
    if anno_col and sem_col:
        coppie = {(r.get(anno_col, ""), r.get(sem_col, "")) for r in righe}
        if coppie:
            anno, sem = max(coppie)
            semestre = f"{anno}-S{sem}" if anno and sem else None

    out: dict = {
        "tipologie_trovate": tipologie,
        "cotazione_min_mq":  cot_min,
        "cotazione_max_mq":  cot_max,
        "canone_min_mq_mese": canone_min,
        "canone_max_mq_mese": canone_max,
        "zona_identificata": zona_identificata,
        "fascia_usata":      fascia_usata,
        "nota_zona":         nota_zona,
        "n_zone":            len(righe),
        "semestre":          semestre,
        "fonte":             "OMI — Agenzia delle Entrate",
    }
    if mq and mq > 0:
        out["valore_min"]   = round(cot_min * mq)
        out["valore_max"]   = round(cot_max * mq)
        out["valore_medio"] = round(((cot_min + cot_max) / 2) * mq)
    return out
