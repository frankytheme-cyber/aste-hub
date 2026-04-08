"""
Cache file-based per i risultati delle analisi perizie.
Evita di ri-analizzare (e ri-pagare) la stessa perizia.
"""

import json
import os
from typing import Optional

CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "analisi_cache.json")


def _load() -> dict:
    if not os.path.exists(CACHE_FILE):
        return {}
    with open(CACHE_FILE, encoding="utf-8") as f:
        return json.load(f)


def _save(cache: dict):
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def get_analisi(immobile_id: str) -> Optional[dict]:
    """Ritorna l'analisi cached o None."""
    return _load().get(immobile_id)


def set_analisi(immobile_id: str, analisi: dict):
    """Salva un'analisi in cache."""
    cache = _load()
    cache[immobile_id] = analisi
    _save(cache)
