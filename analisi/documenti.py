"""
Recupero on-demand degli URL dei documenti (PDF) allegati a un lotto d'asta.
Scrapa la pagina HTML di dettaglio di ciascun portale per estrarre i link ai PDF.
"""

import logging
import re

import httpx

logger = logging.getLogger(__name__)

# ─── Classificazione tipo documento ──────────────────────────────────────────

_KEYWORDS_PERIZIA = ("perizia", "stima", "ctu", "consulenza tecnica", "valutazione")
_KEYWORDS_ORDINANZA = ("ordinanza", "decreto")
_KEYWORDS_AVVISO = ("avviso", "bando")


def _classify_documento(desc: str) -> str:
    """Classifica un documento in base al titolo/descrizione o URL."""
    desc_lower = desc.lower()
    if any(k in desc_lower for k in _KEYWORDS_PERIZIA):
        return "perizia"
    if any(k in desc_lower for k in _KEYWORDS_ORDINANZA):
        return "ordinanza"
    if any(k in desc_lower for k in _KEYWORDS_AVVISO):
        return "avviso"
    return "altro"


_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)


# ─── Astegiudiziarie.it ─────────────────────────────────────────────────────

async def _fetch_doc_astegiudiziarie(id_lotto: str, immobile: dict) -> list[dict]:
    """
    Recupera documenti da astegiudiziarie.it.
    I PDF (perizia, avviso) sono link nella pagina HTML di dettaglio,
    con pattern: /allegato/perizia-*.pdf/{idLotto}
    """
    site_base = "https://www.astegiudiziarie.it"

    # Ottieni la URL della scheda dettagliata
    url_scheda = immobile.get("url_annuncio")
    if not url_scheda:
        # Fallback: costruisci dall'API
        api_base = "https://webapi.astegiudiziarie.it/api"
        headers = {"Content-Type": "application/json", "User-Agent": _UA}
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{api_base}/search/Data",
                json=[int(id_lotto)],
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, list) and data:
                url_scheda = data[0].get("urlSchedaDettagliata", "")
                if url_scheda and not url_scheda.startswith("http"):
                    url_scheda = site_base + url_scheda

    if not url_scheda:
        return []

    # Scarica la pagina HTML e cerca i link ai PDF
    headers = {"User-Agent": _UA}
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(url_scheda, headers=headers)
        resp.raise_for_status()
        html = resp.text

    # Estrai link PDF: /allegato/*.pdf/{id}
    pdf_pattern = re.compile(
        r'href=["\']([^"\']*?/allegato/[^"\']*?\.pdf[^"\']*?)["\']',
        re.IGNORECASE,
    )
    pdf_urls = set()
    docs = []
    for match in pdf_pattern.finditer(html):
        url = match.group(1)
        if not url.startswith("http"):
            url = site_base + url
        if url not in pdf_urls:
            pdf_urls.add(url)
            # Il path indica il tipo: /allegato/perizia-*.pdf/{id}
            # Estrai il nome file (penultimo segmento, prima dell'ID)
            parts = [p for p in url.split("/") if p]
            nome_file = next((p for p in parts if p.endswith(".pdf")), parts[-1])
            tipo = _classify_documento(nome_file)
            titolo = nome_file.replace(".pdf", "").replace("-", " ").strip()
            docs.append({"tipo": tipo, "titolo": titolo.title(), "url": url})

    return docs


# ─── PVP (Portale Vendite Pubbliche) ────────────────────────────────────────

async def _fetch_doc_pvp(id_annuncio: str, immobile: dict) -> list[dict]:
    """
    PVP: i documenti sono protetti da autenticazione (401).
    Non accessibili via API pubblica.
    """
    logger.info(
        "[pvp] I documenti del PVP non sono accessibili via API pubblica. "
        "Consulta la pagina ufficiale dell'annuncio."
    )
    return []


# ─── Astalegale.net ──────────────────────────────────────────────────────────

async def _fetch_doc_astalegale(id_lotto: str, immobile: dict) -> list[dict]:
    """
    Recupera documenti da astalegale.net.
    I PDF sono su documents.astalegale.net, link nella pagina HTML di dettaglio.
    """
    url_scheda = immobile.get("url_annuncio", "")
    if not url_scheda:
        return []

    headers = {
        "User-Agent": _UA,
        "Referer": "https://www.astalegale.net/",
    }

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(url_scheda, headers=headers)
        resp.raise_for_status()
        html = resp.text

    # Estrai link a documents.astalegale.net
    doc_pattern = re.compile(
        r'href=["\']([^"\']*documents\.astalegale\.net[^"\']*)["\']',
        re.IGNORECASE,
    )
    doc_urls = set()
    docs = []
    for match in doc_pattern.finditer(html):
        url = match.group(1)
        if url not in doc_urls:
            doc_urls.add(url)
            # Prova a classificare dal contesto HTML circostante
            start = max(0, match.start() - 200)
            context = html[start:match.end()].lower()
            tipo = _classify_documento(context)
            docs.append({"tipo": tipo, "titolo": "Documento allegato", "url": url})

    # Se c'e' un solo documento, probabilmente e' la perizia
    if len(docs) == 1 and docs[0]["tipo"] == "altro":
        docs[0]["tipo"] = "perizia"
        docs[0]["titolo"] = "Perizia di stima"

    return docs


# ─── Dispatcher principale ───────────────────────────────────────────────────

_FETCHERS = {
    "astegiudiziarie": _fetch_doc_astegiudiziarie,
    "pvp": _fetch_doc_pvp,
    "astalegale": _fetch_doc_astalegale,
}


async def fetch_documenti_per_fonte(immobile: dict) -> list[dict]:
    """
    Recupera i documenti (PDF) allegati a un lotto d'asta.
    Dispatcha alla funzione specifica in base alla fonte.

    Returns:
        Lista di dict {tipo, titolo, url}
    """
    fonte = immobile.get("fonte", "")
    raw_id = immobile.get("id", "")
    lotto_id = raw_id.split(":", 1)[1] if ":" in raw_id else raw_id

    fetcher = _FETCHERS.get(fonte)
    if not fetcher:
        logger.warning(f"Fonte sconosciuta per documenti: {fonte}")
        return []

    try:
        return await fetcher(lotto_id, immobile)
    except Exception as e:
        logger.error(f"Errore recupero documenti ({fonte}): {e}")
        return []
