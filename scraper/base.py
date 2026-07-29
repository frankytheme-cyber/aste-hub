"""
Base class per gli scraper di aste immobiliari.
Definisce lo schema dati e le utility di parsing comuni.
"""

import asyncio
import logging
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Awaitable, Callable, Optional, TypeVar

import httpx

logger = logging.getLogger(__name__)

T = TypeVar("T")


# ─── Filtro beni non immobiliari ──────────────────────────────────────────────
# I portali mettono all'asta anche mobili, veicoli e aziende. Vive qui perche' lo
# usano sia gli scraper sia l'API: due copie divergenti significherebbero annunci
# salvati dallo scraper e poi nascosti dall'API (o viceversa).
#
# 1) Whitelist tipi specifici (passano sempre)
# 2) Tipo generico "Immobile" → il titolo deve menzionare un bene immobiliare

TIPI_IMMOBILE = {
    "appartamento", "villa / casa indipendente", "terreno",
    "locale commerciale", "capannone industriale",
    "garage / box", "magazzino", "ufficio",
}

RE_IMMOBILE = re.compile(
    r"(appartament|villa|casa|abitazion|terren[oi]|fabbricat|locale|negozio"
    r"|capannon|garage|autorimessa|box\b|magazzin|ufficio|deposito"
    r"|laboratorio|albergo|alberghier|complesso|immobil|propriet[aà]"
    r"|piano\s+(primo|secondo|terzo|quarto|quinto|terra|seminterr|interr|rialz)"
    r"|foglio|particella|catast|sub\s*\d|mq\s*\d|superficie"
    r"|vani\s*\d|stanz|camera|cucina|bagno|cantina|soffitta|soffitte|mansarda"
    r"|posto\s*auto|parcheggio|rudere|ruderi|edificabil|seminativ"
    r"|agricol|lotto\s+n|vendita\s+terreni|fallimento|ambient[ei]"
    r"|rurale|fattoria|podere|casale|cascina|lastrico|tettoi|opific"
    r"|palestra|convento|teatr|cinematograf|edific|compendio"
    r"|\bvia\s+|\bpiazza\s+|\bviale\s+|\bcorso\s+|\bcontrada\s+|\blocalit[aà]"
    r"|\bloc\.\s*[A-Z])",
    re.IGNORECASE,
)


def _is_immobile(item: dict) -> bool:
    if (item.get("tipo") or "").lower() in TIPI_IMMOBILE:
        return True
    return bool(RE_IMMOBILE.search(item.get("titolo") or ""))


async def with_retry(
    coro_factory: "Callable[[], Awaitable[T]]",
    *,
    tentativi: int = 3,
    attesa_base: float = 2.0,
    descrizione: str = "richiesta",
) -> T:
    """
    Esegue una coroutine con retry e backoff esponenziale su errori transitori
    (timeout, errori di trasporto, HTTP 5xx / 429). Solleva l'ultima eccezione
    se tutti i tentativi falliscono.

    coro_factory: callable che crea una NUOVA coroutine ad ogni tentativo
                  (una coroutine non puo' essere ri-awaitata).
    """
    ultima_ecc: Optional[Exception] = None
    for tentativo in range(1, tentativi + 1):
        try:
            return await coro_factory()
        except (httpx.TimeoutException, httpx.TransportError) as e:
            ultima_ecc = e
        except httpx.HTTPStatusError as e:
            # Ritenta solo su errori server / rate limit transitori
            if e.response.status_code not in (429, 500, 502, 503, 504):
                raise
            ultima_ecc = e
        if tentativo < tentativi:
            attesa = attesa_base * (2 ** (tentativo - 1))
            logger.warning(
                "[retry] %s fallita (tentativo %d/%d): %s — riprovo tra %.0fs",
                descrizione, tentativo, tentativi, ultima_ecc, attesa,
            )
            await asyncio.sleep(attesa)
    assert ultima_ecc is not None
    logger.error("[retry] %s fallita dopo %d tentativi: %s", descrizione, tentativi, ultima_ecc)
    raise ultima_ecc


@dataclass
class Immobile:
    """Schema normalizzato per un lotto immobiliare."""
    id: str                          # ID univoco (fonte:lotto)
    titolo: str
    comune: str
    regione: str
    provincia: str
    prezzo: float                    # Prezzo base d'asta in €
    data_asta: Optional[str]         # ISO date YYYY-MM-DD; None se non ancora fissata
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
    tipo_vendita: Optional[str] = None           # es. "Senza incanto", "Con incanto", "Telematica"
    modalita_partecipazione: Optional[str] = None  # es. "Telematica", "In presenza", "Mista"
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
