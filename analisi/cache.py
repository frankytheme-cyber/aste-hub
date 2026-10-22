"""
Cache file-based per i risultati delle analisi perizie.
Evita di ri-analizzare (e ri-pagare) la stessa perizia.
"""

import json
import logging
import os
import tempfile
from typing import Optional

logger = logging.getLogger(__name__)

CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "analisi_cache.json")


def _load() -> dict:
    if not os.path.exists(CACHE_FILE):
        return {}
    try:
        with open(CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        # Un file illeggibile non deve far rispondere 500 a ogni endpoint di
        # analisi: si lavora a cache vuota e lo si segnala. Il file resta sul
        # disco (non viene riscritto finche' non si salva una nuova analisi).
        logger.error("Cache analisi illeggibile (%s): %s", CACHE_FILE, e)
        return {}


def _save(cache: dict):
    """Scrittura atomica: file temporaneo + rename, così un crash a meta'
    scrittura non lascia un JSON troncato (e con esso tutte le analisi pagate)."""
    dir_ = os.path.dirname(CACHE_FILE)
    os.makedirs(dir_, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=dir_, suffix=".tmp", delete=False
    ) as tmp:
        json.dump(cache, tmp, ensure_ascii=False, indent=2)
        tmp_path = tmp.name
    os.replace(tmp_path, CACHE_FILE)


def get_analisi(immobile_id: str) -> Optional[dict]:
    """Ritorna l'analisi cached o None."""
    return _load().get(immobile_id)


def set_analisi(immobile_id: str, analisi: dict):
    """Salva un'analisi in cache."""
    cache = _load()
    cache[immobile_id] = analisi
    _save(cache)


def aggiorna_analisi(immobile_id: str, campi: dict) -> bool:
    """Aggiunge/sovrascrive alcuni campi di un'analisi gia' in cache.

    Rilegge il file al momento della scrittura: chi lavora a lungo su una copia
    (es. l'arricchimento OMI) non cancella le analisi salvate nel frattempo.
    False se l'analisi non e' (piu') in cache.
    """
    cache = _load()
    if immobile_id not in cache:
        return False
    cache[immobile_id].update(campi)
    _save(cache)
    return True
