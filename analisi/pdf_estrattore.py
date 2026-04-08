"""
Download e estrazione testo da PDF di perizie.
Usa pypdfium2 (motore PDFium di Chrome) come estrattore principale,
con fallback a pdfplumber per i PDF che PDFium non riesce a leggere.
"""

import io
import logging
from typing import Optional

import httpx
import pypdfium2 as pdfium

logger = logging.getLogger(__name__)

# Headers per evitare blocchi dai portali
DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
}


async def scarica_pdf(url: str, headers: Optional[dict] = None) -> bytes:
    """Scarica il PDF dal portale sorgente."""
    hdrs = {**DEFAULT_HEADERS, **(headers or {})}
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        resp = await client.get(url, headers=hdrs)
        resp.raise_for_status()
        return resp.content


def _estrai_con_pdfium(pdf_bytes: bytes) -> str:
    """Estrae testo con pypdfium2 (motore PDFium di Chrome)."""
    pagine = []
    pdf = pdfium.PdfDocument(pdf_bytes)
    try:
        for i in range(len(pdf)):
            page = pdf[i]
            textpage = page.get_textpage()
            testo = textpage.get_text_range()
            textpage.close()
            page.close()
            if testo and testo.strip():
                pagine.append(testo.strip())
    finally:
        pdf.close()
    return "\n\n--- Pagina ---\n\n".join(pagine)


def _estrai_con_pdfplumber(pdf_bytes: bytes) -> str:
    """Fallback: estrae testo con pdfplumber."""
    import pdfplumber
    pagine = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for p in pdf.pages:
            testo = p.extract_text()
            if testo:
                pagine.append(testo)
    return "\n\n--- Pagina ---\n\n".join(pagine)


def estrai_testo(pdf_bytes: bytes) -> str:
    """Estrae tutto il testo dal PDF. Prova pypdfium2, poi pdfplumber."""
    # Tentativo 1: pypdfium2
    try:
        testo = _estrai_con_pdfium(pdf_bytes)
        if testo and len(testo) > 50:
            logger.debug("Testo estratto con pypdfium2: %d caratteri", len(testo))
            return testo
    except Exception as e:
        logger.warning("pypdfium2 fallito: %s", e)

    # Tentativo 2: pdfplumber
    try:
        testo = _estrai_con_pdfplumber(pdf_bytes)
        if testo and len(testo) > 50:
            logger.debug("Testo estratto con pdfplumber: %d caratteri", len(testo))
            return testo
    except Exception as e:
        logger.warning("pdfplumber fallito: %s", e)

    return ""


def conta_pagine(pdf_bytes: bytes) -> int:
    try:
        pdf = pdfium.PdfDocument(pdf_bytes)
        n = len(pdf)
        pdf.close()
        return n
    except Exception:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            return len(pdf.pages)
