"""
Scraper per astegiudiziarie.it
Portale autorizzato dal Ministero della Giustizia (Sezione A).
Usa l'API REST pubblica su webapi.astegiudiziarie.it (nessuna auth richiesta).
"""

import asyncio
import logging
import re
from typing import Optional

import httpx

from .base import BaseAsteScraper, Immobile, analizza_diritti, estrai_mq, with_retry

logger = logging.getLogger(__name__)

TIPO_MAP = {
    "appartamento": "Appartamento",
    "villa": "Villa / Casa indipendente",
    "villini": "Villa / Casa indipendente",
    "ville": "Villa / Casa indipendente",
    "casa": "Villa / Casa indipendente",
    "terreno": "Terreno",
    "terreni": "Terreno",
    "edificabile": "Terreno",
    "locale commerciale": "Locale commerciale",
    "negozio": "Locale commerciale",
    "negozi": "Locale commerciale",
    "bottega": "Locale commerciale",
    "botteghe": "Locale commerciale",
    "capannone": "Capannone industriale",
    "capannoni": "Capannone industriale",
    "industriale": "Capannone industriale",
    "industriali": "Capannone industriale",
    "opificio": "Capannone industriale",
    "opifici": "Capannone industriale",
    "garage": "Garage / Box",
    "autorimessa": "Garage / Box",
    "autorimesse": "Garage / Box",
    "rimesse": "Garage / Box",
    "box": "Garage / Box",
    "posto auto": "Garage / Box",
    "posti auto": "Garage / Box",
    "magazzino": "Magazzino",
    "magazzini": "Magazzino",
    "deposito": "Magazzino",
    "depositi": "Magazzino",
    "ufficio": "Ufficio",
    "uffici": "Ufficio",
    "residenziale": "Appartamento",
    "abitazione": "Appartamento",
    "abitazioni": "Appartamento",
    "laboratorio": "Locale commerciale",
    "laboratori": "Locale commerciale",
    "albergo": "Locale commerciale",
    "alberghi": "Locale commerciale",
    "alberghiera": "Locale commerciale",
    "alberghiero": "Locale commerciale",
    "commerciale": "Locale commerciale",
    "commerciali": "Locale commerciale",
    # Vocabolario catastale (campo `categoria` di astegiudiziarie, `categoriaBene`
    # del PVP, `tipologia` di astalegale). Chiavi piu' lunghe di "abitazione":
    # a parita' di posizione vince la piu' lunga, quindi "abitazione in villini"
    # e' una villa e non un appartamento.
    "abitazione in villini": "Villa / Casa indipendente",
    "abitazione in ville": "Villa / Casa indipendente",
    "abitazione in villino": "Villa / Casa indipendente",
    "abitazione in villa": "Villa / Casa indipendente",
    "villino": "Villa / Casa indipendente",
    "villetta": "Villa / Casa indipendente",
    "casa indipendente": "Villa / Casa indipendente",
    "fabbricato rurale": "Villa / Casa indipendente",
    "rustico": "Villa / Casa indipendente",
    "fondo rustico": "Terreno",
    "appezzamento": "Terreno",
    "appezzamenti": "Terreno",
    "lotto edificabile": "Terreno",
    "cantina": "Magazzino",
    "stalle": "Garage / Box",
    "uffici e studi": "Ufficio",
    "studio professionale": "Ufficio",
}

# Valori generici dei campi strutturati: non dicono che cosa sia il bene, quindi
# non devono impedire di guardare il campo successivo (es. il titolo).
_TIPI_GENERICI = {"Immobile"}


def classifica_tipo(testo: str, default: str = "Immobile") -> str:
    """Classifica la tipologia immobiliare da un testo (campo strutturato o titolo libero).

    Strategia: tra le keyword di ``TIPO_MAP`` presenti, vince quella che compare
    PER PRIMA nel testo. È il primato posizionale: in un lotto misto l'asset
    principale è citato per primo (es. "Deposito-magazzino ... con appartamento al
    piano primo" → Magazzino, non Appartamento). A parità di posizione vince la
    chiave più lunga, per evitare falsi positivi da sottostringa (es. "casa" dentro
    "abitazione"). Il match è a confine di parola così "box" non scatta dentro
    "boxe" né "casa" dentro "cascina".
    """
    if not testo:
        return default
    t = testo.lower()
    best = None  # (posizione, -lunghezza, valore) — il minimo è il match preferito
    for k, v in TIPO_MAP.items():
        m = re.search(r"\b" + re.escape(k) + r"\b", t)
        if m:
            cand = (m.start(), -len(k), v)
            if best is None or cand < best:
                best = cand
    return best[2] if best else default


def classifica_tipo_da(*testi: str, default: str = "Immobile") -> str:
    """Classifica provando i testi in ordine, dal piu' specifico al piu' generico.

    I campi strutturati dei portali sono spesso generici ("IMMOBILI",
    "IMMOBILI-ALTRA CATEGORIA"): passarli da soli a ``classifica_tipo`` fa finire
    terreni, capannoni e depositi nel tipo generico "Immobile". Qui un testo che
    non da' un tipo specifico cede il passo al successivo.
    """
    for testo in testi:
        tipo = classifica_tipo(testo or "", default=default)
        if tipo not in _TIPI_GENERICI:
            return tipo
    return default


PROVINCE_REGIONI = {
    # Sigle
    "AG": "Sicilia", "AL": "Piemonte", "AN": "Marche", "AO": "Valle d'Aosta",
    "AR": "Toscana", "AP": "Marche", "AT": "Piemonte", "AV": "Campania",
    "BA": "Puglia", "BT": "Puglia", "BL": "Veneto", "BN": "Campania",
    "BG": "Lombardia", "BI": "Piemonte", "BO": "Emilia-Romagna", "BZ": "Trentino-Alto Adige",
    "BS": "Lombardia", "BR": "Puglia", "CA": "Sardegna", "CL": "Sicilia",
    "CB": "Molise", "CI": "Sardegna", "CE": "Campania", "CT": "Sicilia",
    "CZ": "Calabria", "CH": "Abruzzo", "CO": "Lombardia", "CS": "Calabria",
    "CR": "Lombardia", "KR": "Calabria", "CN": "Piemonte", "EN": "Sicilia",
    "FM": "Marche", "FE": "Emilia-Romagna", "FI": "Toscana", "FG": "Puglia",
    "FC": "Emilia-Romagna", "FR": "Lazio", "GE": "Liguria", "GO": "Friuli-Venezia Giulia",
    "GR": "Toscana", "IM": "Liguria", "IS": "Molise", "SP": "Liguria",
    "AQ": "Abruzzo", "LT": "Lazio", "LE": "Puglia", "LC": "Lombardia",
    "LI": "Toscana", "LO": "Lombardia", "LU": "Toscana", "MC": "Marche",
    "MN": "Lombardia", "MS": "Toscana", "MT": "Basilicata", "VS": "Sardegna",
    "ME": "Sicilia", "MI": "Lombardia", "MO": "Emilia-Romagna", "MB": "Lombardia",
    "NA": "Campania", "NO": "Piemonte", "NU": "Sardegna", "OG": "Sardegna",
    "OT": "Sardegna", "OR": "Sardegna", "PD": "Veneto", "PA": "Sicilia",
    "PR": "Emilia-Romagna", "PV": "Lombardia", "PG": "Umbria", "PU": "Marche",
    "PE": "Abruzzo", "PC": "Emilia-Romagna", "PI": "Toscana", "PT": "Toscana",
    "PN": "Friuli-Venezia Giulia", "PZ": "Basilicata", "PO": "Toscana",
    "RG": "Sicilia", "RA": "Emilia-Romagna", "RC": "Calabria", "RE": "Emilia-Romagna",
    "RI": "Lazio", "RN": "Emilia-Romagna", "RM": "Lazio", "RO": "Veneto",
    "SA": "Campania", "SS": "Sardegna", "SV": "Liguria", "SI": "Toscana",
    "SR": "Sicilia", "SO": "Lombardia", "TA": "Puglia", "TE": "Abruzzo",
    "TR": "Umbria", "TO": "Piemonte", "TP": "Sicilia", "TN": "Trentino-Alto Adige",
    "TV": "Veneto", "TS": "Friuli-Venezia Giulia", "UD": "Friuli-Venezia Giulia",
    "VA": "Lombardia", "VE": "Veneto", "VB": "Piemonte", "VC": "Piemonte",
    "VR": "Veneto", "VV": "Calabria", "VI": "Veneto", "VT": "Lazio",
    # Nomi completi (usati dal PVP e astalegale)
    "AGRIGENTO": "Sicilia", "ALESSANDRIA": "Piemonte", "ANCONA": "Marche",
    "AOSTA": "Valle d'Aosta", "AREZZO": "Toscana", "ASCOLI PICENO": "Marche",
    "ASTI": "Piemonte", "AVELLINO": "Campania", "BARI": "Puglia",
    "BARLETTA-ANDRIA-TRANI": "Puglia", "BELLUNO": "Veneto", "BENEVENTO": "Campania",
    "BERGAMO": "Lombardia", "BIELLA": "Piemonte", "BOLOGNA": "Emilia-Romagna",
    "BOLZANO": "Trentino-Alto Adige", "BRESCIA": "Lombardia", "BRINDISI": "Puglia",
    "CAGLIARI": "Sardegna", "CALTANISSETTA": "Sicilia", "CAMPOBASSO": "Molise",
    "CARBONIA-IGLESIAS": "Sardegna", "CASERTA": "Campania", "CATANIA": "Sicilia",
    "CATANZARO": "Calabria", "CHIETI": "Abruzzo", "COMO": "Lombardia",
    "COSENZA": "Calabria", "CREMONA": "Lombardia", "CROTONE": "Calabria",
    "CUNEO": "Piemonte", "ENNA": "Sicilia", "FERMO": "Marche",
    "FERRARA": "Emilia-Romagna", "FIRENZE": "Toscana", "FOGGIA": "Puglia",
    "FORLI'-CESENA": "Emilia-Romagna", "FORLI-CESENA": "Emilia-Romagna",
    "FORLÌ-CESENA": "Emilia-Romagna",
    "FROSINONE": "Lazio", "GENOVA": "Liguria", "GORIZIA": "Friuli-Venezia Giulia",
    "GROSSETO": "Toscana", "IMPERIA": "Liguria", "ISERNIA": "Molise",
    "LA SPEZIA": "Liguria", "L'AQUILA": "Abruzzo", "LATINA": "Lazio",
    "LECCE": "Puglia", "LECCO": "Lombardia", "LIVORNO": "Toscana",
    "LODI": "Lombardia", "LUCCA": "Toscana", "MACERATA": "Marche",
    "MANTOVA": "Lombardia", "MASSA-CARRARA": "Toscana", "MATERA": "Basilicata",
    "MEDIO CAMPIDANO": "Sardegna", "MESSINA": "Sicilia", "MILANO": "Lombardia",
    "MODENA": "Emilia-Romagna", "MONZA E DELLA BRIANZA": "Lombardia",
    "MONZA": "Lombardia", "NAPOLI": "Campania", "NOVARA": "Piemonte",
    "NUORO": "Sardegna", "OGLIASTRA": "Sardegna", "OLBIA-TEMPIO": "Sardegna",
    "ORISTANO": "Sardegna", "PADOVA": "Veneto", "PALERMO": "Sicilia",
    "PARMA": "Emilia-Romagna", "PAVIA": "Lombardia", "PERUGIA": "Umbria",
    "PESARO E URBINO": "Marche", "PESARO-URBINO": "Marche", "PESCARA": "Abruzzo",
    "PIACENZA": "Emilia-Romagna", "PISA": "Toscana", "PISTOIA": "Toscana",
    "PORDENONE": "Friuli-Venezia Giulia", "POTENZA": "Basilicata", "PRATO": "Toscana",
    "RAGUSA": "Sicilia", "RAVENNA": "Emilia-Romagna", "REGGIO CALABRIA": "Calabria",
    "REGGIO DI CALABRIA": "Calabria",
    "REGGIO EMILIA": "Emilia-Romagna", "REGGIO NELL'EMILIA": "Emilia-Romagna",
    "RIETI": "Lazio", "RIMINI": "Emilia-Romagna", "ROMA": "Lazio", "ROVIGO": "Veneto",
    "SALERNO": "Campania", "SASSARI": "Sardegna", "SAVONA": "Liguria",
    "SIENA": "Toscana", "SIRACUSA": "Sicilia", "SONDRIO": "Lombardia",
    "SUD SARDEGNA": "Sardegna", "TARANTO": "Puglia", "TERAMO": "Abruzzo",
    "TERNI": "Umbria", "TORINO": "Piemonte", "TRAPANI": "Sicilia",
    "TRENTO": "Trentino-Alto Adige", "TREVISO": "Veneto",
    "TRIESTE": "Friuli-Venezia Giulia", "UDINE": "Friuli-Venezia Giulia",
    "VARESE": "Lombardia", "VENEZIA": "Veneto", "VERBANO-CUSIO-OSSOLA": "Piemonte",
    "VERCELLI": "Piemonte", "VERONA": "Veneto", "VIBO VALENTIA": "Calabria",
    "VICENZA": "Veneto", "VITERBO": "Lazio",
}

# Sigla -> nome completo della provincia. astegiudiziarie restituisce le sigle,
# PVP e astalegale i nomi: senza normalizzare, il filtro per provincia si sdoppia
# ("FI" e "Firenze" diventano due voci diverse dello stesso elenco).
# La coerenza con PROVINCE_REGIONI e' verificata da test_province.py.
PROVINCE_NOMI = {
    "AG": "Agrigento", "AL": "Alessandria", "AN": "Ancona", "AO": "Aosta",
    "AP": "Ascoli Piceno", "AQ": "L'Aquila", "AR": "Arezzo", "AT": "Asti",
    "AV": "Avellino", "BA": "Bari", "BG": "Bergamo", "BI": "Biella",
    "BL": "Belluno", "BN": "Benevento", "BO": "Bologna", "BR": "Brindisi",
    "BS": "Brescia", "BT": "Barletta-Andria-Trani", "BZ": "Bolzano",
    "CA": "Cagliari", "CB": "Campobasso", "CE": "Caserta", "CH": "Chieti",
    "CI": "Carbonia-Iglesias", "CL": "Caltanissetta", "CN": "Cuneo",
    "CO": "Como", "CR": "Cremona", "CS": "Cosenza", "CT": "Catania",
    "CZ": "Catanzaro", "EN": "Enna", "FC": "Forlì-Cesena", "FE": "Ferrara",
    "FG": "Foggia", "FI": "Firenze", "FM": "Fermo", "FR": "Frosinone",
    "GE": "Genova", "GO": "Gorizia", "GR": "Grosseto", "IM": "Imperia",
    "IS": "Isernia", "KR": "Crotone", "LC": "Lecco", "LE": "Lecce",
    "LI": "Livorno", "LO": "Lodi", "LT": "Latina", "LU": "Lucca",
    "MB": "Monza e della Brianza", "MC": "Macerata", "ME": "Messina",
    "MI": "Milano", "MN": "Mantova", "MO": "Modena", "MS": "Massa-Carrara",
    "MT": "Matera", "NA": "Napoli", "NO": "Novara", "NU": "Nuoro",
    "OG": "Ogliastra", "OR": "Oristano", "OT": "Olbia-Tempio", "PA": "Palermo",
    "PC": "Piacenza", "PD": "Padova", "PE": "Pescara", "PG": "Perugia",
    "PI": "Pisa", "PN": "Pordenone", "PO": "Prato", "PR": "Parma",
    "PT": "Pistoia", "PU": "Pesaro e Urbino", "PV": "Pavia", "PZ": "Potenza",
    "RA": "Ravenna", "RC": "Reggio di Calabria", "RE": "Reggio Emilia",
    "RG": "Ragusa", "RI": "Rieti", "RM": "Roma", "RN": "Rimini",
    "RO": "Rovigo", "SA": "Salerno", "SI": "Siena", "SO": "Sondrio",
    "SP": "La Spezia", "SR": "Siracusa", "SS": "Sassari", "SV": "Savona",
    "TA": "Taranto", "TE": "Teramo", "TN": "Trento", "TO": "Torino",
    "TP": "Trapani", "TR": "Terni", "TS": "Trieste", "TV": "Treviso",
    "UD": "Udine", "VA": "Varese", "VB": "Verbano-Cusio-Ossola",
    "VC": "Vercelli", "VE": "Venezia", "VI": "Vicenza", "VR": "Verona",
    "VS": "Medio Campidano", "VT": "Viterbo", "VV": "Vibo Valentia",
}

API_BASE = "https://webapi.astegiudiziarie.it/api"
MAX_CONCORRENZA = 6
SITE_BASE = "https://www.astegiudiziarie.it"


def _norm_tipo_vendita(raw: str):
    if not raw:
        return None
    r = raw.lower().replace("_", " ").strip()
    if "senza incanto" in r or "asincrona" in r:
        return "Senza incanto"
    if "con incanto" in r or "sincrona" in r:
        return "Con incanto"
    if "telematica" in r:
        return "Telematica"
    if "trattativa" in r:
        return "Trattativa privata"
    cleaned = raw.strip().replace("_", " ").title()
    return cleaned if cleaned else None


def _norm_modalita(raw: str):
    if not raw:
        return None
    r = raw.lower().replace("_", " ").strip()
    if "telematic" in r or "online" in r:
        return "Telematica"
    if "mista" in r:
        return "Mista"
    if "presenza" in r or "fisica" in r:
        return "In presenza"
    cleaned = raw.strip().replace("_", " ").title()
    return cleaned if cleaned else None


def _partecipabile(item: dict) -> bool:
    """False per i lotti che il portale marca "NON PIU PARTECIPABILE".

    Anche con ``storica: False`` circa un terzo dei lotti restituiti e' gia'
    chiuso (asta deserta, aggiudicata, sospesa). Quelli con data passata li
    nasconderebbe comunque l'API, ma i sospesi hanno data futura e
    comparirebbero come aste aperte.
    """
    semaforo = ((item.get("semaforo") or {}).get("descrizione") or "").upper()
    return not semaforo.startswith("NON")


class AsteGiudiziarieSpA(BaseAsteScraper):
    """
    Scraper per https://www.astegiudiziarie.it
    Usa l'API REST pubblica — nessun browser richiesto.
    """

    SOURCE_NAME = "astegiudiziarie"
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
        """Cerca immobili via API REST. max_pages=0 scarica tutto."""
        results = []

        search_params = {
            "tipoRicerca": 1,
            "idTipologie": [],
            "idCategorie": [],
            "searchOnMap": False,
            "orderBy": 6,
            "storica": False,
            "vetrina": False,
        }

        if regione:
            search_params["regione"] = regione
        if prezzo_min is not None:
            search_params["prezzoDa"] = prezzo_min
        if prezzo_max is not None:
            search_params["prezzoA"] = prezzo_max
        if data_fine:
            search_params["dataVenditaA"] = data_fine

        async with httpx.AsyncClient(timeout=60) as client:
            try:
                # Step 1: cerca tutti gli ID lotto
                logger.info("[astegiudiziarie] Ricerca via API...")

                async def _fetch_map():
                    r = await client.post(
                        f"{API_BASE}/search/map",
                        json=search_params,
                        headers={"Content-Type": "application/json"},
                    )
                    r.raise_for_status()
                    return r

                resp = await with_retry(_fetch_map, descrizione="astegiudiziarie search/map")
                lotti = resp.json()

                if not isinstance(lotti, list):
                    logger.warning(f"[astegiudiziarie] Risposta inattesa: {type(lotti)}")
                    return []

                ids = [item["idLotto"] for item in lotti if "idLotto" in item]
                # Le coordinate arrivano solo dalla mappa, non dal dettaglio.
                coordinate = {
                    item["idLotto"]: (item.get("latitudine"), item.get("longitudine"))
                    for item in lotti if "idLotto" in item
                }
                total = len(ids)
                logger.info(f"[astegiudiziarie] Trovati {total} lotti in mappa")

                # Step 2: carica i dettagli a batch di 20 (limite API), in parallelo.
                # L'API regge bene la concorrenza (misurato: nessun errore fino a 8
                # richieste contemporanee, ~10x piu' veloce che in sequenza).
                page_size = 20
                batch_falliti = 0
                non_partecipabili = 0
                completati = 0
                max_items = (max_pages * page_size) if max_pages > 0 else total
                batches = [ids[i:i + page_size] for i in range(0, min(total, max_items), page_size)]
                sem = asyncio.Semaphore(MAX_CONCORRENZA)

                async def _scarica_batch(n: int, batch: list) -> list:
                    nonlocal batch_falliti, completati

                    async def _fetch_data():
                        r = await client.post(
                            f"{API_BASE}/search/Data",
                            json=batch,
                            headers={"Content-Type": "application/json"},
                        )
                        r.raise_for_status()
                        return r

                    # Un batch fallito dopo i retry costa 20 lotti, non tutti quelli
                    # che restano: si registra e si prosegue.
                    async with sem:
                        try:
                            detail_resp = await with_retry(
                                _fetch_data, descrizione=f"astegiudiziarie search/Data batch {n}"
                            )
                            items = detail_resp.json()
                        except Exception as e:
                            batch_falliti += 1
                            logger.warning(f"[astegiudiziarie] Batch {n} saltato: {e}")
                            return []
                    completati += 1
                    if completati % 100 == 0:
                        logger.info(f"[astegiudiziarie] Progresso: {completati}/{len(batches)} batch")
                    return items if isinstance(items, list) else []

                pagine = await asyncio.gather(
                    *[_scarica_batch(n, b) for n, b in enumerate(batches, start=1)]
                )
                for items in pagine:
                    for item in items:
                        if not _partecipabile(item):
                            non_partecipabili += 1
                            continue
                        immobile = self._parse_item(item)
                        if immobile:
                            lat, lng = coordinate.get(item.get("idLotto"), (None, None))
                            immobile.lat, immobile.lng = lat, lng
                            results.append(immobile)

                if non_partecipabili:
                    logger.info(
                        f"[astegiudiziarie] Saltati {non_partecipabili} lotti non piu' "
                        f"partecipabili (deserti/aggiudicati/sospesi)"
                    )
                if batch_falliti:
                    logger.warning(f"[astegiudiziarie] {batch_falliti} batch non scaricati")

            except Exception as e:
                logger.error(f"[astegiudiziarie] Errore API: {e}")

        logger.info(f"[astegiudiziarie] Trovati {len(results)} immobili")
        return results

    def _parse_item(self, item: dict) -> Optional[Immobile]:
        if not isinstance(item, dict):
            return None

        lotto_id = str(item.get("idLotto") or "")
        if not lotto_id:
            return None

        titolo = item.get("descrizione") or item.get("categoria") or ""
        prezzo = item.get("prezzoBase") or 0.0
        if isinstance(prezzo, str):
            prezzo = self._safe_float(prezzo) or 0.0

        comune = item.get("comune") or ""
        # L'API restituisce la sigla: normalizziamo al nome completo, come fanno
        # gli altri due portali, così il filtro per provincia resta uno solo.
        provincia_raw = (item.get("provincia") or "").strip()
        provincia = PROVINCE_NOMI.get(provincia_raw.upper(), provincia_raw)
        regione = PROVINCE_REGIONI.get(provincia_raw.upper(), "")
        indirizzo = item.get("indirizzo") or ""
        tribunale = item.get("tribunale") or ""

        # Data asta
        data_raw = (
            item.get("dataInizioGara") or item.get("dataUdienza") or
            item.get("dataFineGara") or ""
        )
        data_norm = self._normalize_date(data_raw)
        if not data_norm:
            return None

        # Tipo immobile: `categoria` e' il vocabolario catastale ("ABITAZIONE IN
        # VILLINI", "MAGAZZINO"), molto piu' preciso di `tipologia` ("IMMOBILI-
        # ALTRA CATEGORIA"), che resta l'ultima risorsa dopo il titolo.
        tipo = classifica_tipo_da(
            item.get("categoria"), titolo, item.get("tipologia")
        )

        url = item.get("urlSchedaDettagliata") or ""
        if url and not url.startswith("http"):
            url = SITE_BASE + url

        # Tipo vendita e modalità partecipazione
        tipo_vendita = _norm_tipo_vendita(
            item.get("tipoGara") or item.get("tipoVendita") or item.get("modalitaVendita") or ""
        )
        modalita = _norm_modalita(
            item.get("modalita") or item.get("modalitaPartecipazione") or ""
        )
        if not modalita and item.get("venditaTelematica") is not None:
            modalita = "Telematica" if item["venditaTelematica"] else "In presenza"

        # Offerta minima: 75% del prezzo base (art. 571 c.p.c.)
        offerta_min = round(float(prezzo) * 0.75, 2) if prezzo else None

        # Immagine principale — urlPhoto può esistere anche senza hasFoto=True
        foto_url = None
        url_foto_raw = (
            item.get("urlPhoto")
            or item.get("urlFoto")
            or item.get("urlImmagine")
            or item.get("urlImmaginePrincipale")
        )
        if url_foto_raw:
            foto_url = url_foto_raw if url_foto_raw.startswith("http") else SITE_BASE + url_foto_raw

        return Immobile(
            id=f"astegiudiziarie:{lotto_id}",
            titolo=titolo.strip()[:200] or tipo,
            comune=comune.strip(),
            regione=regione,
            provincia=provincia,
            prezzo=float(prezzo),
            offerta_minima=offerta_min,
            data_asta=data_norm,
            tipo=tipo,
            immagine=foto_url,
            mq=self._safe_int(str(item.get("superficie") or "")) or estrai_mq(titolo),
            tribunale=tribunale,
            lotto=item.get("numeroLotto") or lotto_id,
            stato_occupazione=item.get("statoOccupazione"),
            indirizzo=indirizzo,
            url_annuncio=url,
            tipo_vendita=tipo_vendita,
            modalita_partecipazione=modalita,
            fonte=self.SOURCE_NAME,
            diritto=analizza_diritti(titolo),
        )

    def _normalize_date(self, raw) -> Optional[str]:
        if not raw:
            return None
        raw = str(raw).strip()

        # ISO 8601 / datetime
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", raw)
        if m:
            return m.group(0)

        # DD/MM/YYYY o DD-MM-YYYY
        m = re.search(r"(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{4})", raw)
        if m:
            d, mo, y = m.group(1), m.group(2), m.group(3)
            return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"

        return None

    # Compatibilità: __aenter__/__aexit__ non servono più, ma manteniamo
    # l'interfaccia async context manager per l'orchestratore
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass
