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


# ─── Estrazione di dati dal testo libero del lotto ───────────────────────────
# Nessun portale espone la superficie in un campo strutturato, e la quota di
# proprieta' in vendita compare solo nella descrizione. Sono pero' i due dati che
# decidono il valore di un lotto: senza mq non c'e' €/m², e 1/3 di un appartamento
# non vale un terzo del prezzo (non si puo' abitare ne' rivendere liberamente).

def parse_numero(s: str) -> Optional[float]:
    """'1.234,56' / '1250.5' / '1.250' / '85' -> float. None se non numerico.

    Con la virgola il formato e' italiano (punti = migliaia); senza virgola un
    punto seguito da gruppi di 3 cifre e' separatore di migliaia, altrimenti e'
    il separatore decimale.
    """
    s = (s or "").strip().replace(" ", "")
    if not s:
        return None
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(?:\.\d{3})+", s):
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


_NUM = r"(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)"
_RE_MQ = re.compile(
    # "superficie commerciale di (circa) (mq) 85,50" ...
    r"superficie(?:\s+(?:commerciale|lorda|netta|catastale|complessiva|utile|"
    r"convenzionale|calpestabile))?[^\d\n]{0,25}?" + _NUM +
    # ... oppure "85,50 mq" / "mq 85" / "85 m²"
    r"|" + _NUM + r"\s*(?:mq|m²|m2|m\.\s?q\.|metri\s*quadr)"
    # "mq. 85" / "mq. lordi 149,00" / "mq catastali 353"
    r"|\bmq\.?\s*(?:(?:lordi|netti|utili|catastali|commerciali|complessivi|circa)\s+){0,2}" + _NUM,
    re.IGNORECASE,
)


def descrizione_estesa(testo, titolo: str) -> Optional[str]:
    """Il testo completo del lotto se aggiunge qualcosa al titolo, altrimenti None
    (inutile salvare due volte la stessa frase per migliaia di lotti)."""
    testo = re.sub(r"\s+", " ", str(testo or "")).strip()
    if not testo or len(testo) <= len((titolo or "").strip()):
        return None
    return testo[:MAX_DESCRIZIONE]


# Oltre questa lunghezza sono avvisi di vendita incollati per intero.
MAX_DESCRIZIONE = 4000


def estrai_mq(testo: str) -> Optional[int]:
    """Superficie in m² citata nel testo del lotto, o None.

    Prende la prima occorrenza: nelle descrizioni la superficie principale viene
    citata prima di quella delle pertinenze.
    """
    for m in _RE_MQ.finditer(testo or ""):
        valore = parse_numero(next(g for g in m.groups() if g))
        # Sotto i 5 m² e' quasi sempre un numero di subalterno o di piano.
        if valore and 5 <= valore <= 10_000_000:
            return int(round(valore))
    return None


_RE_FRAZIONE = re.compile(
    r"(?:quot[ae]|diritt[oi]|propriet[aà]|pari\s+a(?:d|l)?|per\s+(?:la\s+)?quota\s+di)"
    r"[^\d\n]{0,30}?\b(\d{1,4})\s*/\s*(\d{1,4})\b"
    r"|\b(\d{1,4})\s*/\s*(\d{1,4})\s+(?:(?:di|della|del|dell'|in)\s+)?(?:piena\s+|nuda\s+)?propriet",
    re.IGNORECASE,
)
_RE_NUDA = re.compile(r"nuda\s+propriet", re.IGNORECASE)
_RE_USUFRUTTO = re.compile(r"\busufrutto\b", re.IGNORECASE)
_RE_SUPERFICIE_DIRITTO = re.compile(r"diritto\s+di\s+superficie", re.IGNORECASE)


def analizza_diritti(testo: str) -> Optional[str]:
    """Descrive il diritto in vendita quando NON e' la piena proprieta' dell'intero.

    Restituisce ad es. "Quota 1/3", "Nuda proprieta'", "Usufrutto",
    "Diritto di superficie", oppure None (piena proprieta' o non indicato).
    Le quote intere (1/1, 1000/1000) non sono segnalate.
    """
    t = testo or ""
    for m in _RE_FRAZIONE.finditer(t):
        num, den = (int(g) for g in (m.group(1) or m.group(3), m.group(2) or m.group(4)))
        if 0 < num < den:
            return f"Quota {num}/{den}"
    if _RE_NUDA.search(t):
        return "Nuda proprietà"
    if _RE_SUPERFICIE_DIRITTO.search(t):
        return "Diritto di superficie"
    # "usufrutto" da solo e' spesso citato come diritto *gravante* sul bene
    # ("libero da usufrutto"): lo segnaliamo solo se e' l'oggetto della vendita.
    if re.search(r"(?:diritt[oi]|quota)\s+(?:di|dell')\s*usufrutto", t, re.IGNORECASE):
        return "Usufrutto"
    return None


# ─── Modalita' di vendita ────────────────────────────────────────────────────
# Dalla riforma del 2015 le vendite giudiziarie sono quasi tutte "senza incanto"
# e si distinguono per come si partecipa: asincrona telematica (offerte online in
# una finestra di giorni), sincrona telematica (gara online in diretta), sincrona
# mista (online o in aula) e tradizionale (solo in presenza). Ogni portale usa un
# vocabolario diverso ("SincronaMista", idModalitaVendita=3, ...): qui diventa
# uno solo. Prima "sincrona mista" finiva sotto "Con incanto", che e' un'altra cosa.

_VENDITE = (
    # (regex sul testo normalizzato, tipo_vendita, modalita_partecipazione)
    (r"asincron", "Asincrona telematica", "Telematica"),
    (r"sincron\w*\s*mist|\bmista\b", "Sincrona mista", "Mista"),
    (r"sincron", "Sincrona telematica", "Telematica"),
    (r"tradizional|analogic|in presenza|presso il venditore", "Tradizionale", "In presenza"),
    (r"vendita\s*online|\bonline\b|telematic", "Telematica", "Telematica"),
    (r"senza incanto", "Senza incanto", None),
    (r"con incanto", "Con incanto", None),
    (r"trattativa", "Trattativa privata", None),
)


def normalizza_vendita(raw) -> tuple:
    """Testo/codice di modalita' di vendita del portale -> (tipo_vendita, modalita).

    "SincronaMista" -> ("Sincrona mista", "Mista"); valori non informativi
    ("AltraModalita", "") -> (None, None): meglio nessun dato di un'etichetta vuota.
    """
    # CamelCase -> parole: "SincronaMista" -> "sincrona mista"
    t = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", str(raw or "")).replace("_", " ").lower().strip()
    if not t:
        return None, None
    for pattern, tipo, modalita in _VENDITE:
        if re.search(pattern, t):
            return tipo, modalita
    return None, None


# ─── Stato di occupazione dal testo ──────────────────────────────────────────
# Solo il PVP ha un campo strutturato, ma molte descrizioni lo dicono in chiaro
# ("Libero da persone e cose", "Occupato dal debitore"). Le regole sono strette:
# "libero su tre lati" o "area libera" non parlano di occupazione. Se il testo
# cita entrambi gli stati (lotti misti) vince il peggiore.

_RE_OCC_SENZA_TITOLO = re.compile(r"occupat[oaie]\s+(?:\w+\s+){0,3}senza\s+(?:alcun\s+)?titolo", re.IGNORECASE)
_RE_OCC_LIBERAZIONE = re.compile(r"(?:in\s+corso\s+di|procedura\s+di|ordine\s+di)\s+liberazione", re.IGNORECASE)
_RE_OCCUPATO = re.compile(
    # "occupato da detriti / colture / beni mobili" non riguarda chi ci abita
    r"\b(?:occupat|locat|affittat|condott)[oaie]\s+(?:dal|dalla|dai|dagli|da|con|in\s+forza|in\s+virt[uù])\b"
    r"(?!\s+(?:detriti|colture|coltivazioni|vegetazione|beni\s+mobili|materiale|materiali|rifiuti|masserizie|arredi|cose))"
    r"|stato\s+di\s+occupazione\s*:?\s*(?:\w+\s+){0,4}?occupat"
    r"|stato\s+d[il]\s+possesso\s*:?\s*(?:occupat|locat)"
    r"|\b(?:abitat|utilizzat|detenut)[oaie]\s+(?:dal|dalla|dall'|dai|dagli)\s*(?:debitor|esecutat|propriet|conduttor|locatar)"
    r"|\bin\s+affitto\s+con\b|contratto\s+di\s+locazione\s+(?:opponibile|avente|registrat|in\s+corso|con\s+scadenza)"
    r"|\b(?:immobile|bene|unit[aà]|appartamento|abitazione|lotto|fabbricato)\s+(?:risulta\s+|[eè]\s+|attualmente\s+){0,2}(?:occupat|locat)[oa]\b"
    r"|(?:^|[.;]\s*)occupat[oa]\s*(?:[.;]|$)",
    re.IGNORECASE,
)
_RE_LIBERO = re.compile(
    r"\bliber[oaie]\s+da\s+persone"
    r"|stato\s+di\s+occupazione\s*:?\s*(?:[\w']+\s+){0,6}?liber[oa]\b"
    r"|stato\s+d[il]\s+possesso\s*:?\s*liber[oa]\b"
    r"|\bliber[oa]\s+ai\s+fini\s+della\s+procedura"
    r"|\b(?:immobile|bene|unit[aà]|appartamento|abitazione|lotto|fabbricato|villa|locale)\s+(?:risulta\s+|[eè]\s+|attualmente\s+){0,2}liber[oa]\b(?!\s+(?:su|a|da\s+\w+\s+lati)\b)"
    r"|(?:^|[.;]\s*)liber[oa]\s*(?:[.;]|$)",
    re.IGNORECASE,
)
_RE_NON_LOCATO = re.compile(r"non\s+(?:risulta\s+)?(?:occupat|locat)", re.IGNORECASE)


def estrai_stato_occupazione(testo: str) -> Optional[str]:
    """Stato di occupazione citato nella descrizione del lotto, o None.

    Stessi valori del campo PVP: "Occupato senza titolo", "Occupato",
    "In corso di liberazione", "Libero".
    """
    t = testo or ""
    if not t:
        return None
    if _RE_OCC_SENZA_TITOLO.search(t):
        return "Occupato senza titolo"
    occupato = bool(_RE_OCCUPATO.search(t)) and not _RE_NON_LOCATO.search(t)
    if occupato:
        return "Occupato"
    if _RE_OCC_LIBERAZIONE.search(t):
        return "In corso di liberazione"
    if _RE_LIBERO.search(t) or _RE_NON_LOCATO.search(t):
        return "Libero"
    return None


def normalizza_data(raw) -> Optional[str]:
    """ISO, "DD/MM/YYYY[ - HH:MM]" o timestamp in ms -> "YYYY-MM-DD"; None se assente."""
    if not raw:
        return None
    raw = str(raw).strip()
    if raw.isdigit() and len(raw) > 8:
        return datetime.utcfromtimestamp(int(raw) / 1000).strftime("%Y-%m-%d")
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", raw)
    if m:
        return m.group(0)
    m = re.search(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})", raw)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"
    return None


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
    diritto: Optional[str] = None    # es. "Quota 1/3", "Nuda proprietà"; None = piena proprietà
    lat: Optional[float] = None
    lng: Optional[float] = None
    # Id dell'annuncio sul PVP. astalegale ripubblica i lotti PVP dichiarandone
    # l'origine: con questo id la deduplica cross-portale e' esatta.
    id_pvp: Optional[str] = None
    zona_omi: Optional[str] = None   # "A390:D66" (codice catastale:zona), da analisi.zone_omi
    # Data di pubblicazione dell'annuncio sul portale (YYYY-MM-DD): serve a
    # mostrare le novita' dall'ultima visita.
    data_pubblicazione: Optional[str] = None
    # Testo completo del lotto, solo quando dice piu' del titolo (che e' troncato):
    # serve alla ricerca testuale e alla scheda di dettaglio. L'API non lo
    # include nella lista, dove peserebbe su ogni pagina.
    descrizione: Optional[str] = None
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

    def _normalize_date(self, raw) -> Optional[str]:
        return normalizza_data(raw)

    def _safe_float(self, s: str) -> Optional[float]:
        """Converte una stringa prezzo in float (formato italiano o con punto decimale)."""
        if not s:
            return None
        return parse_numero(s.replace("€", ""))

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
