"""
Scraper per pvp.giustizia.it — Portale delle Vendite Pubbliche
Fonte ufficiale del Ministero della Giustizia.
Usa l'API REST pubblica dei microservizi Entando (nessuna auth richiesta).
"""

import asyncio
import logging
import re
from datetime import date
from typing import Optional

import httpx

from .base import BaseAsteScraper, Immobile, with_retry
from .astegiudiziarie import PROVINCE_REGIONI, classifica_tipo, _norm_tipo_vendita, _norm_modalita

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

PAGE_SIZE = 100
MAX_CONCORRENZA = 4

# Esiti che chiudono un annuncio: sospeso, asta deserta, aggiudicato.
# L'annuncio resta nell'archivio ma la vendita non e' piu' disponibile.
ESITI_CHIUSI = {"SOSPE", "ASDES", "AGGIU"}


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
        """Cerca immobili via API REST PVP. max_pages=0 scarica tutto.

        NB: non usiamo ``filtroAnnunci: 0``. Quel filtro restituisce solo gli
        annunci *pubblicati* di recente (~ultimi 60 giorni), non tutte le vendite
        ancora da svolgere: un'asta di settembre pubblicata in aprile non compare
        (~8.000 lotti su 16.500 mancanti). Scorriamo invece l'archivio completo
        ordinato per data di vendita e partiamo, con una ricerca binaria, dalla
        prima pagina che contiene aste non ancora svolte.
        """
        results = []
        oggi = date.today().isoformat()

        search_body = {
            "tipoLotto": "IMMOBILI",
            "nazione": "ITA",
        }

        # L'endpoint di ricerca ignora il codice regione nel body (verificato:
        # il totale non cambia). Lo passiamo comunque, ma il filtro vero lo
        # applichiamo sui risultati.
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

            async def fetch_pagina(page_num: int) -> dict:
                """Scarica una pagina dell'archivio ordinato per data di vendita.

                L'ordinamento secondario su ``id`` rende deterministico l'ordine a
                parita' di data: senza di esso la paginazione profonda puo'
                riordinare i pari-merito e far sparire annunci tra due richieste.
                """
                url = (
                    f"{ricerca_base}/ricerca/vendite"
                    f"?page={page_num}&size={PAGE_SIZE}"
                    f"&sort=dataVendita,asc&sort=id,asc"
                )

                async def _fetch():
                    r = await client.post(
                        url,
                        json=search_body,
                        headers={"Content-Type": "application/json"},
                    )
                    r.raise_for_status()
                    return r

                resp = await with_retry(_fetch, descrizione=f"pvp pagina {page_num}")
                data = resp.json()
                return data.get("body") or data

            async def prima_pagina_utile(totale_pagine: int) -> int:
                """Ricerca binaria della prima pagina con aste da svolgere.

                Il confronto usa la data massima della pagina, così la pagina a
                cavallo della soglia viene inclusa e non saltata.
                """
                lo, hi = 0, totale_pagine - 1
                while lo < hi:
                    mid = (lo + hi) // 2
                    content = (await fetch_pagina(mid)).get("content") or []
                    if not content:
                        hi = mid
                        continue
                    massima = max((i.get("dataVendita") or "") for i in content)
                    if massima >= oggi:
                        hi = mid
                    else:
                        lo = mid + 1
                return lo

            try:
                body = await fetch_pagina(0)
                totale_pagine = int(body.get("totalPages") or 1)
                totale = int(body.get("totalElements") or 0)

                inizio = await prima_pagina_utile(totale_pagine) if totale_pagine > 1 else 0
                fine = totale_pagine
                if max_pages > 0:
                    fine = min(fine, inizio + max_pages)
                logger.info(
                    f"[pvp] {totale} annunci in archivio: aste da svolgere dalla "
                    f"pagina {inizio} alla {fine - 1}"
                )

                sem = asyncio.Semaphore(MAX_CONCORRENZA)
                completate = 0

                async def _scarica(pg: int) -> list:
                    nonlocal completate
                    async with sem:
                        content = (await fetch_pagina(pg)).get("content") or []
                    completate += 1
                    if completate % 50 == 0:
                        logger.info(
                            f"[pvp] Progresso: {completate}/{fine - inizio} pagine"
                        )
                    return content

                pagine = await asyncio.gather(
                    *[_scarica(pg) for pg in range(inizio, fine)],
                    return_exceptions=True,
                )

                scartati_chiusi = 0
                for pg, esito in zip(range(inizio, fine), pagine):
                    if isinstance(esito, Exception):
                        logger.warning(f"[pvp] Pagina {pg} saltata: {esito}")
                        continue
                    for item in esito:
                        if (item.get("esito") or "").upper() in ESITI_CHIUSI:
                            scartati_chiusi += 1
                            continue
                        immobile = self._parse_item(item, data_fine, data_da=oggi)
                        if not immobile:
                            continue
                        if regione and immobile.regione != regione:
                            continue
                        results.append(immobile)

                if scartati_chiusi:
                    logger.info(
                        f"[pvp] Saltati {scartati_chiusi} annunci chiusi "
                        f"(sospesi/deserti/aggiudicati)"
                    )

            except Exception as e:
                logger.error(f"[pvp] Errore API: {e}")

        logger.info(f"[pvp] Trovati {len(results)} immobili")
        return results

    def _parse_item(
        self,
        item: dict,
        data_fine: Optional[str] = None,
        data_da: Optional[str] = None,
    ) -> Optional[Immobile]:
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

        tribunale = item.get("tribunale") or ""
        regione = PROVINCE_REGIONI.get(provincia.upper(), "")
        if not regione:
            # Alcuni annunci PVP non hanno l'indirizzo compilato: senza regione
            # sarebbero invisibili a qualunque filtro geografico. Il tribunale e'
            # quasi sempre presente e nel capoluogo di provincia.
            citta = re.sub(r"^tribunale\s+(di\s+)?", "", tribunale, flags=re.IGNORECASE)
            regione = PROVINCE_REGIONI.get(citta.strip().upper(), "")

        # Data vendita. L'archivio PVP e' storico: teniamo solo le vendite ancora
        # da svolgere. Le date palesemente errate le scarta l'orchestratore, che
        # applica lo stesso limite a tutti i portali.
        data_norm = self._normalize_date(item.get("dataVendita") or "")
        if not data_norm:
            return None

        if data_da and data_norm < data_da:
            return None
        if data_fine and data_norm > data_fine:
            return None

        # Tipo immobile — PVP usa categoriaLotto come "IMMOBILE_RESIDENZIALE" ecc.
        _CAT_MAP = {
            "immobile_residenziale": "Appartamento",
            "immobile_commerciale": "Locale commerciale",
            "terreno": "Terreno",
            "immobile_industriale": "Capannone industriale",
            "immobile_uffici": "Ufficio",
            "garage": "Garage / Box",
            "immobile_agricolo": "Terreno",
        }
        tipo_raw = (item.get("categoriaLotto") or "").lower()
        tipo = _CAT_MAP.get(tipo_raw, "")
        if not tipo:
            # ALTRA_CATEGORIA o categoria sconosciuta: usa il titolo del lotto
            # con classificazione a primato posizionale (vedi classifica_tipo)
            tipo = classifica_tipo(item.get("tipoLotto") or titolo or "")

        url = f"{SITE_BASE}/pvp/it/detail_annuncio.page?idAnnuncio={annuncio_id}"

        # Tipo vendita e modalità partecipazione
        tipo_vendita = _norm_tipo_vendita(
            item.get("tipoVendita") or item.get("tipoGara") or item.get("modalitaVendita") or ""
        )
        modalita = _norm_modalita(
            item.get("modalitaPartecipazione") or item.get("modalita") or ""
        )

        # Offerta minima: dal campo API o fallback 75% prezzo base
        offerta_min = item.get("offertaMinima")
        if offerta_min is not None:
            offerta_min = float(offerta_min)
        elif prezzo:
            offerta_min = round(float(prezzo) * 0.75, 2)

        # Immagine principale — campi reali dell'API PVP
        foto_url = None
        url_foto_raw = (
            item.get("immagine")
            or item.get("immagineCover")
            or item.get("urlFoto")
            or item.get("urlPhoto")
            or item.get("thumbnailUrl")
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
            tipo_vendita=tipo_vendita,
            modalita_partecipazione=modalita,
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
