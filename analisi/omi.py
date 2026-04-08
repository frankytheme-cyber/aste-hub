"""
Quotazioni OMI (Osservatorio del Mercato Immobiliare) — Agenzia delle Entrate.
Scarica i dati CSV open data, li cacha con TTL 180 giorni, restituisce
la quotazione media per comune e tipologia. Non solleva mai eccezioni al chiamante.

MANUTENZIONE: aggiornare _OMI_ZIP_URLS ogni semestre (gennaio e luglio)
aggiungendo il nuovo URL in cima alla lista.
"""

import csv
import io
import json
import logging
import os
import unicodedata
import zipfile
from datetime import datetime, timedelta
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ─── Configurazione ───────────────────────────────────────────────────────────

OMI_CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "omi_cache.json")
OMI_CACHE_TTL_DAYS = 180

# Candidati URL in ordine (più recente prima). Aggiungi nuovi semestri in cima.
_OMI_ZIP_URLS = [
    "https://www.agenziaentrate.gov.it/portale/documents/20143/233439/OMI_2024_2.zip",
    "https://www.agenziaentrate.gov.it/portale/documents/20143/233439/OMI_2024_1.zip",
    "https://www.agenziaentrate.gov.it/portale/documents/20143/233439/OMI_2023_2.zip",
    "https://www.agenziaentrate.gov.it/portale/documents/20143/233439/Quotazioni_OMI_2024_2.zip",
    "https://www.agenziaentrate.gov.it/portale/documents/20143/233439/Quotazioni_OMI_2024_1.zip",
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


# ─── Normalizzazione testo ────────────────────────────────────────────────────

def _normalizza(s: str) -> str:
    """Lowercase, rimuove accenti, strip spazi."""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower().strip()


def _match_comune(a: str, b: str) -> bool:
    na, nb = _normalizza(a), _normalizza(b)
    return na == nb or na in nb or nb in na


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

async def _download_omi_zip() -> Optional[bytes]:
    """Tenta i candidati URL in ordine; restituisce il primo ZIP valido o None."""
    headers = {"User-Agent": "Mozilla/5.0 (compatible; AsteHub/1.0)"}
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        for url in _OMI_ZIP_URLS:
            try:
                logger.info("[OMI] Tentativo download: %s", url)
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200 and len(resp.content) > 1000:
                    logger.info("[OMI] Download OK: %d bytes", len(resp.content))
                    return resp.content
                logger.warning("[OMI] %s → HTTP %d", url, resp.status_code)
            except Exception as e:
                logger.warning("[OMI] %s fallito: %s", url, e)
    logger.error("[OMI] Tutti i candidati URL hanno fallito")
    return None


def _parse_csv_from_zip(zip_bytes: bytes) -> list[dict]:
    """Estrae e parsa il CSV OMI dal ZIP. Gestisce encoding e separatori variabili."""
    rows: list[dict] = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            csv_names = [n for n in zf.namelist() if n.lower().endswith((".csv", ".txt"))]
            if not csv_names:
                logger.error("[OMI] Nessun CSV trovato nel ZIP")
                return []
            target = next((n for n in csv_names if "omi" in n.lower()), csv_names[0])
            logger.info("[OMI] Parsing: %s", target)
            raw = zf.read(target)

            text = None
            for enc in ("utf-8-sig", "latin-1", "cp1252"):
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
                rows.append({k.strip().lower(): v.strip() for k, v in row.items() if k})
    except Exception as e:
        logger.error("[OMI] Errore parsing ZIP: %s", e)
    return rows


def _identifica_colonne(rows: list[dict]) -> Optional[dict]:
    """Rileva nomi colonna del CSV OMI (variano tra semestri)."""
    if not rows:
        return None
    keys = list(rows[0].keys())

    def _find(candidates: list[str]) -> Optional[str]:
        for c in candidates:
            m = next((k for k in keys if c in k), None)
            if m:
                return m
        return None

    mapping = {
        "comune":    _find(["desccomune", "comune", "desc_comune", "denominazione"]),
        "tipologia": _find(["tipologia", "tipo", "destinazione"]),
        "stato":     _find(["statoconservazione", "stato_conservazione", "stato"]),
        "cot_min":   _find(["cotmin", "cot_min", "quotazione_min", "min"]),
        "cot_max":   _find(["cotmax", "cot_max", "quotazione_max", "max"]),
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
) -> Optional[dict]:
    """
    Restituisce le quotazioni OMI per comune e tipologia.

    Args:
        comune: Nome del comune (es. "Milano", "Roma")
        tipo:   Tipologia interna (es. "Appartamento", "Locale commerciale")
        mq:     Superficie in m² — se fornita, aggiunge valore_min/max/medio totale

    Returns:
        {
            "tipologie_trovate": ["Abitazioni civili", ...],
            "cotazione_min_mq": 1200,
            "cotazione_max_mq": 1800,
            "valore_min": 96000,      # solo se mq fornito
            "valore_max": 144000,     # solo se mq fornito
            "valore_medio": 120000,   # solo se mq fornito
            "n_zone": 4,
            "semestre": "2024-S2",
            "fonte": "OMI — Agenzia delle Entrate",
        }
        o None se dati non disponibili. Non solleva mai eccezioni.
    """
    try:
        return await _fetch_impl(comune, tipo, mq)
    except Exception as e:
        logger.error("[OMI] Errore inatteso: %s", e)
        return None


async def _fetch_impl(
    comune: str,
    tipo: str,
    mq: Optional[int],
) -> Optional[dict]:
    if not _TIPO_TO_OMI.get(tipo):
        return None  # Terreni o tipi non mappati

    cache = _cache_load()
    if not _cache_is_valid(cache):
        logger.info("[OMI] Cache assente o scaduta, avvio download...")
        zip_bytes = await _download_omi_zip()
        if not zip_bytes:
            return None
        rows = _parse_csv_from_zip(zip_bytes)
        col_map = _identifica_colonne(rows)
        if not col_map:
            return None
        cache = {
            "_downloaded_at": datetime.utcnow().isoformat(),
            "_rows": rows,
            "_col_map": col_map,
        }
        _cache_save(cache)
        logger.info("[OMI] Cache aggiornata: %d righe", len(rows))

    rows = cache.get("_rows", [])
    col_map = cache.get("_col_map", {})
    if not rows or not col_map:
        return None

    col_c   = col_map["comune"]
    col_t   = col_map["tipologia"]
    col_min = col_map["cot_min"]
    col_max = col_map["cot_max"]
    col_stato = col_map.get("stato")
    anno_col  = col_map.get("anno")
    sem_col   = col_map.get("semestre")

    # Filtra per comune e tipologia
    righe = [
        r for r in rows
        if _match_comune(comune, r.get(col_c, ""))
        and _match_tipologia(tipo, r.get(col_t, ""))
    ]
    if not righe:
        logger.info("[OMI] Nessuna riga per comune='%s' tipo='%s'", comune, tipo)
        return None

    # Preferisce stato "normale"; se non trovato usa tutte le righe
    if col_stato:
        normale = [r for r in righe if _normalizza(r.get(col_stato, "")) == _normalizza(_STATO_PREFERITO)]
        righe = normale if normale else righe

    def _num(s: str) -> Optional[float]:
        try:
            return float(s.replace(".", "").replace(",", ".").strip())
        except Exception:
            return None

    vals_min = [v for r in righe if (v := _num(r.get(col_min, ""))) and v > 0]
    vals_max = [v for r in righe if (v := _num(r.get(col_max, ""))) and v > 0]
    if not vals_min or not vals_max:
        return None

    cot_min = round(sum(vals_min) / len(vals_min))
    cot_max = round(sum(vals_max) / len(vals_max))
    tipologie = list({r.get(col_t, "") for r in righe if r.get(col_t)})

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
        "n_zone":            len(righe),
        "semestre":          semestre,
        "fonte":             "OMI — Agenzia delle Entrate",
    }
    if mq and mq > 0:
        out["valore_min"]   = round(cot_min * mq)
        out["valore_max"]   = round(cot_max * mq)
        out["valore_medio"] = round(((cot_min + cot_max) / 2) * mq)
    return out
