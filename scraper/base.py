"""
Base class per gli scraper di aste immobiliari.
Definisce lo schema dati e le utility di parsing comuni.
"""

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class Immobile:
    """Schema normalizzato per un lotto immobiliare."""
    id: str                          # ID univoco (fonte:lotto)
    titolo: str
    comune: str
    regione: str
    provincia: str
    prezzo: float                    # Prezzo base d'asta in €
    data_asta: str                   # ISO date YYYY-MM-DD
    tipo: str                        # es. Appartamento, Villa, Terreno...
    offerta_minima: Optional[float] = None  # Offerta minima in €
    immagine: Optional[str] = None           # URL immagine principale
    mq: Optional[int] = None
    piano: Optional[str] = None
    tribunale: Optional[str] = None
    lotto: Optional[str] = None
    stato_occupazione: Optional[str] = None
    perito: Optional[str] = None
    indirizzo: Optional[str] = None
    url_annuncio: Optional[str] = None
    fonte: str = ""                  # pvp | astegiudiziarie | astalegale | ...
    documenti: list = field(default_factory=list)  # [{tipo, titolo, url}]
    scraped_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self):
        return asdict(self)


class BaseAsteScraper(ABC):
    """Classe base per tutti gli scraper di aste."""

    SOURCE_NAME: str = "base"
    BASE_URL: str = ""

    def __init__(self, headless: bool = True, timeout: int = 30000):
        self.headless = headless
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    @abstractmethod
    async def search(
        self,
        regione: Optional[str] = None,
        tipo: Optional[str] = None,
        prezzo_min: Optional[float] = None,
        prezzo_max: Optional[float] = None,
        data_fine: Optional[str] = None,
        max_pages: int = 3,
    ) -> list[Immobile]:
        """Restituisce una lista di Immobile dal portale."""
        ...

    def _safe_float(self, s: str) -> Optional[float]:
        """Converte una stringa prezzo in float."""
        if not s:
            return None
        cleaned = s.replace("€", "").replace(".", "").replace(",", ".").strip()
        try:
            return float(cleaned)
        except ValueError:
            return None

    def _safe_int(self, s: str) -> Optional[int]:
        if not s:
            return None
        # Prima prova a parsare come float (gestisce "1250.5", "1.250,5")
        f = self._safe_float(s)
        if f is not None:
            return int(round(f))
        # Fallback: estrai solo cifre
        cleaned = "".join(c for c in s if c.isdigit())
        return int(cleaned) if cleaned else None

    def _normalize_regione(self, text: str) -> str:
        """Mappa stringhe comuni al nome regione standard."""
        mapping = {
            "MI": "Lombardia", "MILANO": "Lombardia",
            "RM": "Lazio", "ROMA": "Lazio",
            "TO": "Piemonte", "TORINO": "Piemonte",
            "NA": "Campania", "NAPOLI": "Campania",
            "FI": "Toscana", "FIRENZE": "Toscana",
            "BO": "Emilia-Romagna", "BOLOGNA": "Emilia-Romagna",
            "GE": "Liguria", "GENOVA": "Liguria",
            "VE": "Veneto", "VENEZIA": "Veneto",
            "PA": "Sicilia", "PALERMO": "Sicilia",
            "BA": "Puglia", "BARI": "Puglia",
            "BS": "Lombardia", "BRESCIA": "Lombardia",
            "BG": "Lombardia", "BERGAMO": "Lombardia",
            "SI": "Toscana", "SIENA": "Toscana",
        }
        return mapping.get(text.upper(), text.title())
