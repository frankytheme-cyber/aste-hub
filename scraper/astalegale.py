"""
Scraper per astalegale.net
Portale autorizzato MdG — leader per aste telematiche certificate.
Usa l'API REST pubblica su api.astalegale.net (nessuna auth richiesta).
"""

import logging
import re
from typing import Optional

import httpx

from .base import BaseAsteScraper, Immobile
from .astegiudiziarie import PROVINCE_REGIONI, TIPO_MAP

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
        page_size = 50

        payload = {
            "Type": "Immobili",
            "Page": 1,
            "PageSize": page_size,
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
            try:
                page_num = 1
                while True:
                    if max_pages > 0 and page_num > max_pages:
                        break

                    payload["Page"] = page_num
                    logger.info(f"[astalegale] API pagina {page_num}...")

                    resp = await client.post(
                        API_URL,
                        json=payload,
                        headers=headers,
                    )
                    resp.raise_for_status()
                    data = resp.json()

                    items = (data.get("results") or {}).get("currentPage") or []
                    if not items:
                        break

                    for item in items:
                        immobile = self._parse_item(item, prezzo_min, prezzo_max, data_fine)
                        if immobile:
                            results.append(immobile)

                    total = (data.get("results") or {}).get("totalResults", 0)
                    if page_num * page_size >= total:
                        break

                    page_num += 1

                    if page_num % 50 == 0:
                        logger.info(
                            f"[astalegale] Progresso: {len(results)}/{total}"
                        )

            except Exception as e:
                logger.error(f"[astalegale] Errore API: {e}")

        logger.info(f"[astalegale] Trovati {len(results)} immobili")
        return results

    def _parse_item(self, item: dict, prezzo_min, prezzo_max, data_fine) -> Optional[Immobile]:
        if not isinstance(item, dict):
            return None

        lotto_id = item.get("id") or ""
        if not lotto_id:
            return None

        titolo = item.get("titolo") or item.get("descrizione") or ""
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
        regione = item.get("regione") or PROVINCE_REGIONI.get(provincia.upper(), "")
        tribunale = item.get("tribunale") or ""

        # Data asta
        data_raw = item.get("dataAsta") or ""
        data_norm = self._normalize_date(data_raw)
        if not data_norm:
            return None

        if data_fine and data_norm > data_fine:
            return None

        # Tipo immobile
        tipo_raw = (item.get("tipologia") or titolo).lower()
        tipo = "Immobile"
        for k, v in TIPO_MAP.items():
            if k in tipo_raw:
                tipo = v
                break

        friendly_id = item.get("friendlyId") or lotto_id
        url = f"{SITE_BASE}/Aste/Detail/{friendly_id}"

        # Offerta minima: dal campo API o fallback 75% prezzo base
        offerta_min_raw = item.get("offertaMinima")
        if offerta_min_raw is not None:
            if isinstance(offerta_min_raw, str):
                offerta_min = self._safe_float(offerta_min_raw)
            else:
                offerta_min = float(offerta_min_raw)
        elif prezzo:
            offerta_min = round(float(prezzo) * 0.75, 2)
        else:
            offerta_min = None

        # Immagine principale — prova più nomi di campo
        foto_url = (
            item.get("urlImmaginePrincipale")
            or item.get("urlPhoto")
            or item.get("urlFoto")
            or item.get("urlImmagine")
            or None
        )

        return Immobile(
            id=f"astalegale:{lotto_id}",
            titolo=titolo.strip()[:200] or tipo,
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
            url_annuncio=url,
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
