"""
Scraper per astalegale.net
Portale autorizzato MdG — leader per aste telematiche certificate.
Usa l'API REST pubblica su api.astalegale.net (nessuna auth richiesta).
"""

import logging
import re
from typing import Optional

import httpx

from .base import RE_IMMOBILE, BaseAsteScraper, Immobile, with_retry
from .astegiudiziarie import PROVINCE_REGIONI, classifica_tipo, _norm_tipo_vendita, _norm_modalita

logger = logging.getLogger(__name__)

REGIONI_SLUG = {
    "Abruzzo": "abruzzo", "Basilicata": "basilicata", "Calabria": "calabria",
    "Campania": "campania", "Emilia-Romagna": "emilia-romagna",
    "Friuli-Venezia Giulia": "friuli-venezia-giulia", "Lazio": "lazio",
    "Liguria": "liguria", "Lombardia": "lombardia", "Marche": "marche",
    "Molise": "molise", "Piemonte": "piemonte", "Puglia": "puglia",
    "Sardegna": "sardegna", "Sicilia": "sicilia", "Toscana": "toscana",
    "Trentino-Alto Adige": "trentino-alto-adige", "Umbria": "umbria",
    "Valle d'Aosta": "valle-d-aosta", "Veneto": "veneto",
}

API_URL = "https://api.astalegale.net/Search"
SITE_BASE = "https://www.astalegale.net"

# L'API ignora il PageSize richiesto e restituisce sempre 12 risultati per pagina.
# Il valore serve solo come fallback: quello vero viene letto dalla prima risposta.
PAGE_SIZE_FALLBACK = 12

# Le pagine si scaricano in sequenza: con l'API a 12 risultati/pagina l'intero
# catalogo sono ~1500 richieste (~3 minuti). Provato a parallelizzare: l'API
# applica una quota ogni ~100 richieste e risponde 429, e il tempo risparmiato
# torna via tutto nel backoff.

# Tentativi per pagina. Piu' generosi del default perche' una pagina persa
# significa 12 annunci mancanti dal catalogo.
TENTATIVI_PAGINA = 5

MAX_TITOLO = 200


def _pulisci(valore) -> str:
    """Normalizza un campo testuale. L'API usa "-" come segnaposto di "assente"."""
    testo = (valore or "").strip()
    return "" if testo == "-" else testo


# Sotto Type=Immobili il portale pubblica anche mobili, veicoli, macchinari,
# aziende e crediti. Il campo `tipologia` e' un vocabolario chiuso, quindi
# scartiamo qui i beni non immobiliari finche' l'informazione e' disponibile
# (a valle resta solo il tipo normalizzato, che non basta a distinguerli).
_TIPOLOGIE_NON_IMMOBILI = re.compile(
    r"(azienda|quote di partecipazione|titoli|veicol|automezz|autovettur"
    r"|ciclomotor|rimorchi|natant|imbarcazion|navi e galleggianti|macchinari"
    r"|macchine|attrezzatur|utensili|arredi|arredo|mobili da casa|merce"
    r"|materie prime|prodotti finiti|preziosi|oggetti d'arte|antiquariat"
    r"|computer|informatic|apparecchi|elettrodomestic|abbigliament|calzatur"
    r"|licenz|marchi|brevett|animali|bestiame)",
    re.IGNORECASE,
)


class AstalegaleSpA(BaseAsteScraper):
    """
    Scraper per https://www.astalegale.net
    Usa l'API REST pubblica — nessun browser richiesto.
    """

    SOURCE_NAME = "astalegale"
    BASE_URL = SITE_BASE

    async def search(
        self,
        regione: Optional[str] = None,
        tipo: Optional[str] = None,
        prezzo_min: Optional[float] = None,
        prezzo_max: Optional[float] = None,
        data_fine: Optional[str] = None,
        max_pages: int = 0,
    ) -> list[Immobile]:
        """Cerca immobili via API REST astalegale. max_pages=0 scarica tutto."""
        results = []
        scartati_pro = 0

        payload = {
            "Type": "Immobili",
            "Page": 1,
            "PageSize": PAGE_SIZE_FALLBACK,
            "SortBy": "DataAstaAsc",
        }

        if regione:
            slug = REGIONI_SLUG.get(regione, regione.lower())
            payload["Luoghi"] = [slug]

        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Origin": "https://www.astalegale.net",
            "Referer": "https://www.astalegale.net/Immobili",
        }

        async with httpx.AsyncClient(timeout=60) as client:

            async def fetch_pagina(page_num: int) -> tuple[list, int]:
                """Restituisce (items, totale). Ritenta sugli errori transitori."""
                p = dict(payload)
                p["Page"] = page_num

                async def _fetch():
                    r = await client.post(API_URL, json=p, headers=headers)
                    r.raise_for_status()
                    try:
                        return r.json()
                    except ValueError as e:
                        # Sotto carico l'API risponde 200 con corpo vuoto: e' un
                        # errore transitorio, lo rendiamo ritentabile da with_retry.
                        raise httpx.TransportError(f"risposta non JSON: {e}") from e

                data = await with_retry(
                    _fetch,
                    tentativi=TENTATIVI_PAGINA,
                    descrizione=f"astalegale pagina {page_num}",
                )
                res = data.get("results") or {}
                return (res.get("currentPage") or []), int(res.get("totalResults") or 0)

            try:
                prima, total = await fetch_pagina(1)
                if not prima:
                    logger.warning("[astalegale] Nessun risultato dalla prima pagina")
                    return []

                # L'API impone il proprio page size ignorando PageSize: lo deduciamo
                # dalla risposta. Assumerne uno piu' grande significa fermare la
                # paginazione troppo presto e perdere la maggior parte del catalogo.
                page_size = len(prima) or PAGE_SIZE_FALLBACK
                totale_pagine = -(-total // page_size) if total > 0 else 0
                logger.info(
                    f"[astalegale] {total} annunci, {page_size}/pagina "
                    f"→ {totale_pagine or '?'} pagine"
                )

                # Il totale dichiarato dall'API guida la paginazione, ma il ciclo
                # si ferma comunque sulla prima pagina vuota: se un giorno il
                # totale sparisse o fosse sbagliato non tronchiamo la raccolta.
                pagine = [prima]
                page_num = 2
                while True:
                    if max_pages > 0 and page_num > max_pages:
                        break
                    if totale_pagine and page_num > totale_pagine:
                        break
                    items, _ = await fetch_pagina(page_num)
                    if not items:
                        break
                    pagine.append(items)
                    if page_num % 200 == 0:
                        logger.info(
                            f"[astalegale] Progresso: pagina {page_num}/{totale_pagine or '?'}"
                        )
                    page_num += 1

                for batch in pagine:
                    for item in batch:
                        # Gli annunci "isPro" hanno tutti i campi mascherati con X
                        # (paywall): non c'e' nulla di utilizzabile. Sono annunci
                        # provenienti dal PVP, dove li prendiamo con i dati completi.
                        if item.get("isPro"):
                            scartati_pro += 1
                            continue
                        immobile = self._parse_item(item, prezzo_min, prezzo_max, data_fine)
                        if immobile:
                            results.append(immobile)

            except Exception as e:
                logger.error(f"[astalegale] Errore API: {e}")

        if scartati_pro:
            logger.info(f"[astalegale] Saltati {scartati_pro} annunci mascherati (isPro)")
        logger.info(f"[astalegale] Trovati {len(results)} immobili")
        return results

    def _parse_item(self, item: dict, prezzo_min, prezzo_max, data_fine) -> Optional[Immobile]:
        if not isinstance(item, dict):
            return None

        lotto_id = item.get("id") or ""
        if not lotto_id:
            return None

        tipologia = item.get("tipologia") or ""
        if _TIPOLOGIE_NON_IMMOBILI.search(tipologia):
            return None

        # Su astalegale "titolo" e' l'indirizzo del bene ("Piazza Umberto I, 11")
        # e "descrizione" il testo del lotto: mappiamo ciascuno al campo giusto.
        indirizzo = _pulisci(item.get("titolo"))
        # Il troncamento va fatto prima del controllo qui sotto: il titolo salvato
        # e' quello troncato, ed e' su quello che l'API rifara' il match.
        titolo = (_pulisci(item.get("descrizione")) or indirizzo)[:MAX_TITOLO]

        # A volte la descrizione e' solo un toponimo ("Chiusi", "C/da Crocecchie")
        # o un riferimento catastale: anteponiamo la tipologia, che resta l'unica
        # informazione sul bene ed evita che il lotto venga scartato a valle.
        if tipologia and not RE_IMMOBILE.search(titolo):
            titolo = f"{tipologia} — {titolo}" if titolo else tipologia

        prezzo = item.get("prezzoNum") or 0.0
        if isinstance(prezzo, str):
            prezzo = self._safe_float(prezzo) or 0.0

        # Filtri prezzo (l'API non li supporta nativamente)
        if prezzo_min is not None and prezzo < prezzo_min:
            return None
        if prezzo_max is not None and prezzo > prezzo_max:
            return None

        comune = item.get("comune") or ""
        provincia = item.get("provincia") or ""
        # La regione dell'API arriva senza trattini ("Emilia Romagna"): usiamo
        # prima la mappa canonica sulla provincia, altrimenti il filtro per
        # regione si sdoppia in due voci per la stessa regione.
        regione = PROVINCE_REGIONI.get(provincia.upper(), "") or item.get("regione") or ""
        tribunale = item.get("tribunale") or ""

        # Data asta. Molti lotti sono pubblicati prima che la data di vendita sia
        # fissata (l'API restituisce "-"): li teniamo con data_asta=None invece di
        # scartarli, sono annunci a tutti gli effetti visibili sul portale.
        data_norm = self._normalize_date(item.get("dataAsta") or "")

        if data_fine and data_norm and data_norm > data_fine:
            return None

        # Tipo immobile — primato posizionale (vedi classifica_tipo)
        tipo = classifica_tipo(tipologia or titolo or "")

        friendly_id = item.get("friendlyId") or lotto_id
        url = f"{SITE_BASE}/Aste/Detail/{friendly_id}"

        # Tipo vendita e modalità partecipazione
        tipo_vendita = _norm_tipo_vendita(
            item.get("tipoAsta") or item.get("tipoVendita") or item.get("tipoGara") or ""
        )
        modalita = _norm_modalita(
            item.get("modalita") or item.get("modalitaPartecipazione") or ""
        )

        # Offerta minima: dal campo API o fallback 75% prezzo base. Il campo puo'
        # valere "-" (non ancora determinata): in quel caso _safe_float da' None.
        offerta_min_raw = item.get("offertaMinima")
        if isinstance(offerta_min_raw, str):
            offerta_min = self._safe_float(offerta_min_raw)
        elif offerta_min_raw is not None:
            offerta_min = float(offerta_min_raw)
        else:
            offerta_min = None
        if offerta_min is None and prezzo:
            offerta_min = round(float(prezzo) * 0.75, 2)

        # Immagine principale — prova più nomi di campo
        url_foto_raw = (
            item.get("urlImmaginePrincipale")
            or item.get("urlPhoto")
            or item.get("urlFoto")
            or item.get("urlImmagine")
        )
        foto_url = None
        if url_foto_raw:
            foto_url = url_foto_raw if url_foto_raw.startswith("http") else SITE_BASE + url_foto_raw

        return Immobile(
            id=f"astalegale:{lotto_id}",
            titolo=titolo or tipo,
            comune=comune.strip(),
            regione=regione,
            provincia=provincia,
            prezzo=float(prezzo),
            offerta_minima=offerta_min,
            data_asta=data_norm,
            tipo=tipo,
            immagine=foto_url,
            mq=None,
            tribunale=tribunale,
            lotto=item.get("codiceLotto") or lotto_id,
            stato_occupazione=None,
            indirizzo=indirizzo or None,
            url_annuncio=url,
            tipo_vendita=tipo_vendita,
            modalita_partecipazione=modalita,
            fonte=self.SOURCE_NAME,
        )

    def _normalize_date(self, raw) -> Optional[str]:
        if not raw:
            return None
        raw = str(raw).strip()

        # ISO 8601
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", raw)
        if m:
            return m.group(0)

        # DD/MM/YYYY (con eventuale ora " - HH:MM")
        m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", raw)
        if m:
            d, mo, y = m.group(1), m.group(2), m.group(3)
            return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"

        return None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass
