"""
Scraper per pvp.giustizia.it — Portale delle Vendite Pubbliche
Fonte ufficiale del Ministero della Giustizia.
Usa l'API REST pubblica dei microservizi Entando (nessuna auth richiesta).
"""

import logging
import re
from typing import Optional

import httpx

from .base import BaseAsteScraper, Immobile
from .astegiudiziarie import PROVINCE_REGIONI, TIPO_MAP

logger = logging.getLogger(__name__)

# URL microservizi PVP (deployment corrente)
RICERCA_BASE = "https://pvp.giustizia.it/ric-496b258c-986a1b71/ric-ms"
DETAIL_BASE = "https://pvp.giustizia.it/ve-3f723b85-986a1b71/ve-ms"
CONFIG_URL = "https://pvp.giustizia.it/bo-5897bc47-986a1b71/bo-ms/fe-config/area-annunci"
SITE_BASE = "https://pvp.giustizia.it"

# Mappa regioni -> codice regione PVP
REGIONI_CODICE = {
    "Abruzzo": "1", "Basilicata": "2", "Calabria": "3",
    "Campania": "4", "Emilia-Romagna": "5",
    "Friuli-Venezia Giulia": "6", "Lazio": "7",
    "Liguria": "8", "Lombardia": "9", "Marche": "10",
    "Molise": "11", "Piemonte": "12", "Puglia": "13",
    "Sardegna": "14", "Sicilia": "15", "Toscana": "16",
    "Trentino-Alto Adige": "17", "Umbria": "18",
    "Valle d'Aosta": "19", "Veneto": "20",
}


class PVPScraper(BaseAsteScraper):
    """
    Scraper per il Portale delle Vendite Pubbliche (pvp.giustizia.it).
    Usa l'API REST dei microservizi — nessun browser richiesto.
    """

    SOURCE_NAME = "pvp"
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
        """Cerca immobili via API REST PVP. max_pages=0 scarica tutto."""
        results = []
        page_size = 20

        search_body = {
            "tipoLotto": "IMMOBILI",
            "nazione": "ITA",
            "filtroAnnunci": 0,
        }

        if regione:
            codice = REGIONI_CODICE.get(regione)
            if codice:
                search_body["regione"] = codice

        if prezzo_min is not None:
            search_body["prezzoBaseAstaMin"] = prezzo_min
        if prezzo_max is not None:
            search_body["prezzoBaseAstaMax"] = prezzo_max

        # Mappa tipo a categoriaLotto PVP
        if tipo:
            tipo_lower = tipo.lower()
            if "appartamento" in tipo_lower or "residenziale" in tipo_lower:
                search_body["categoriaLotto"] = "IMMOBILE_RESIDENZIALE"
            elif "terreno" in tipo_lower:
                search_body["categoriaLotto"] = "TERRENO"
            elif "commerciale" in tipo_lower or "negozio" in tipo_lower:
                search_body["categoriaLotto"] = "IMMOBILE_COMMERCIALE"

        async with httpx.AsyncClient(timeout=60) as client:
            # Prova a risolvere dinamicamente gli URL dei microservizi
            ricerca_base = RICERCA_BASE
            try:
                config_resp = await client.get(CONFIG_URL, timeout=10)
                if config_resp.status_code == 200:
                    config = config_resp.json()
                    ms_url = config.get("msUrl")
                    if ms_url:
                        ricerca_base = ms_url.rstrip("/")
                        if not ricerca_base.endswith("/ric-ms"):
                            ricerca_base = RICERCA_BASE
                        logger.info(f"[pvp] URL microservizio: {ricerca_base}")
            except Exception:
                logger.debug("[pvp] Uso URL microservizio di default")

            try:
                page_num = 0
                while True:
                    if max_pages > 0 and page_num >= max_pages:
                        break

                    url = (
                        f"{ricerca_base}/ricerca/vendite"
                        f"?page={page_num}&size={page_size}"
                        f"&sort=dataPubblicazione,desc"
                    )
                    logger.info(f"[pvp] API pagina {page_num + 1}...")

                    resp = await client.post(
                        url,
                        json=search_body,
                        headers={"Content-Type": "application/json"},
                    )
                    resp.raise_for_status()
                    data = resp.json()

                    body = data.get("body") or data
                    content = body.get("content") or []
                    if not content:
                        break

                    for item in content:
                        immobile = self._parse_item(item, data_fine)
                        if immobile:
                            results.append(immobile)

                    total_pages = body.get("totalPages", 1)
                    page_num += 1
                    if page_num >= total_pages:
                        break

                    if page_num % 50 == 0:
                        logger.info(
                            f"[pvp] Progresso: {len(results)} immobili, "
                            f"pagina {page_num}/{total_pages}"
                        )

            except Exception as e:
                logger.error(f"[pvp] Errore API: {e}")

        logger.info(f"[pvp] Trovati {len(results)} immobili")
        return results

    def _parse_item(self, item: dict, data_fine: Optional[str] = None) -> Optional[Immobile]:
        if not isinstance(item, dict):
            return None

        annuncio_id = str(item.get("id") or "")
        if not annuncio_id:
            return None

        titolo = item.get("descLotto") or ""
        prezzo = item.get("prezzoBaseAsta") or 0.0
        if isinstance(prezzo, str):
            prezzo = self._safe_float(prezzo) or 0.0

        # Localizzazione
        indirizzo = item.get("indirizzo") or {}
        if isinstance(indirizzo, dict):
            comune = indirizzo.get("citta") or ""
            provincia = indirizzo.get("provincia") or ""
            via = indirizzo.get("via") or ""
        else:
            # Indirizzo è una stringa: prova a estrarre comune/provincia dal
            # campo tribunale o da altri campi disponibili
            via = str(indirizzo)
            comune = item.get("comune") or item.get("citta") or ""
            provincia = item.get("provincia") or ""

        regione = PROVINCE_REGIONI.get(provincia.upper(), "")
        tribunale = item.get("tribunale") or ""

        # Data vendita
        data_raw = item.get("dataVendita") or ""
        data_norm = self._normalize_date(data_raw)
        if not data_norm:
            return None

        if data_fine and data_norm > data_fine:
            return None

        # Tipo immobile
        tipo_raw = (item.get("categoriaLotto") or item.get("tipoLotto") or titolo).lower()
        tipo = "Immobile"
        for k, v in TIPO_MAP.items():
            if k in tipo_raw:
                tipo = v
                break

        url = f"{SITE_BASE}/pvp/it/detail_annuncio.page?idAnnuncio={annuncio_id}"

        # Offerta minima: dal campo API o fallback 75% prezzo base
        offerta_min = item.get("offertaMinima")
        if offerta_min is not None:
            offerta_min = float(offerta_min)
        elif prezzo:
            offerta_min = round(float(prezzo) * 0.75, 2)

        # Immagine principale — prova più nomi di campo dell'API PVP
        foto_url = None
        url_foto_raw = (
            item.get("urlFoto")
            or item.get("urlPhoto")
            or item.get("urlImmagine")
            or item.get("urlImmaginePrincipale")
            or item.get("thumbnailUrl")
            or item.get("thumbnail")
        )
        if url_foto_raw:
            foto_url = url_foto_raw if url_foto_raw.startswith("http") else SITE_BASE + url_foto_raw

        return Immobile(
            id=f"pvp:{annuncio_id}",
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
            lotto=item.get("numeroLotto") or annuncio_id,
            stato_occupazione=None,
            indirizzo=via,
            url_annuncio=url,
            fonte=self.SOURCE_NAME,
        )

    def _normalize_date(self, raw) -> Optional[str]:
        if not raw:
            return None
        raw = str(raw).strip()

        # Timestamp Unix (millisecondi)
        if raw.isdigit() and len(raw) > 8:
            from datetime import datetime
            dt = datetime.utcfromtimestamp(int(raw) / 1000)
            return dt.strftime("%Y-%m-%d")

        # ISO 8601
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", raw)
        if m:
            return m.group(0)

        # DD/MM/YYYY
        m = re.search(r"(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{4})", raw)
        if m:
            d, mo, y = m.group(1), m.group(2), m.group(3)
            return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"

        return None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass
