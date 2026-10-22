"""
Valutazione rapida di un lotto, calcolata solo dai dati dell'annuncio.

E' il primo filtro per decidere quali perizie vale la pena analizzare (l'analisi
con Claude costa ed e' lenta): confronta il prezzo base al m² con le quotazioni
OMI del comune e raccoglie i segnali di rischio leggibili gia' dall'annuncio.
Deterministica, nessuna chiamata di rete: va bene per migliaia di lotti.

Limiti dichiarati nell'output:
- la superficie e' estratta dal testo dell'annuncio (non sempre presente/esatta);
- la quotazione OMI e' la mediana delle zone del comune (la zona del lotto non e'
  nota prima della perizia) e il semestre disponibile puo' essere datato.
"""

from datetime import date
from typing import Callable, Optional

# Superfici plausibili per tipologia: fuori da questi intervalli il numero estratto
# dal testo e' quasi certamente un'altra cosa (terreno di pertinenza, superficie
# dell'intero edificio, subalterno) e il €/m² risulterebbe fuorviante.
_MQ_PLAUSIBILI = {
    "Appartamento": (20, 400),
    "Villa / Casa indipendente": (40, 1500),
    "Garage / Box": (8, 120),
    "Ufficio": (15, 3000),
    "Locale commerciale": (15, 5000),
    "Magazzino": (10, 10000),
    "Capannone industriale": (100, 50000),
}

# Soglie sullo sconto del prezzo base rispetto al valore OMI tipico del comune.
SCONTO_INTERESSANTE = 0.30
GIORNI_TEMPI_STRETTI = 10


def _n(valore: int) -> str:
    """1234 -> "1.234" (separatore delle migliaia italiano)."""
    return f"{valore:,}".replace(",", ".")


def _segnale(livello: str, testo: str) -> dict:
    """livello: "alto" (rischio serio), "medio" (da verificare), "positivo", "info"."""
    return {"livello": livello, "testo": testo}


def valutazione_rapida(
    item: dict,
    quotazione: Callable[[str, str], Optional[dict]],
    oggi: Optional[date] = None,
    quotazione_zona: Optional[Callable[[str, str], Optional[dict]]] = None,
) -> dict:
    """Valutazione sintetica di un lotto.

    quotazione: funzione (comune, tipo) -> {"medio_mq", "min_mq", "max_mq",
        "semestre"} o None — di norma ``analisi.omi.quotazione_comunale``.
    quotazione_zona: funzione (zona_omi, tipo) -> stessa forma, di norma
        ``analisi.omi.quotazione_zona``; se il lotto ha ``zona_omi`` e la zona
        ha quotazioni, ha la precedenza sulla mediana comunale.

    Restituisce {"giudizio", "segnali", "prezzo_mq", "omi_mq", "sconto_omi",
    "omi_semestre"}; giudizio in "rischioso" | "interessante" | "da_valutare".
    """
    oggi = oggi or date.today()
    segnali: list[dict] = []
    tipo = item.get("tipo") or ""
    prezzo = item.get("prezzo") or 0
    mq = item.get("mq")
    diritto = item.get("diritto")

    # ── Diritto in vendita ──────────────────────────────────────────────────
    if diritto:
        segnali.append(_segnale(
            "alto",
            f"In vendita: {diritto.lower()}, non la piena proprietà dell'intero. "
            "Difficile da abitare, finanziare e rivendere.",
        ))

    # ── Occupazione ─────────────────────────────────────────────────────────
    stato = (item.get("stato_occupazione") or "").lower()
    if stato.startswith("libero"):
        segnali.append(_segnale("positivo", "Dichiarato libero."))
    elif "liberazione" in stato:
        segnali.append(_segnale("info", "Liberazione in corso a cura del custode."))
    elif stato.startswith("occupato"):
        segnali.append(_segnale(
            "medio",
            f"{item['stato_occupazione']}: verificare in perizia titolo e tempi di liberazione.",
        ))

    # ── Prezzo al m² rispetto all'OMI ───────────────────────────────────────
    prezzo_mq = omi_mq = sconto = semestre = omi_ambito = None
    limiti = _MQ_PLAUSIBILI.get(tipo)
    # Con un diritto parziale il prezzo si riferisce alla quota: il €/m²
    # sull'intera superficie sembrerebbe un affare che non e'.
    if prezzo > 0 and mq and limiti and limiti[0] <= mq <= limiti[1] and not diritto:
        prezzo_mq = round(prezzo / mq)
        q = None
        if quotazione_zona and item.get("zona_omi"):
            q = quotazione_zona(item["zona_omi"], tipo)
            ambito = f"della zona OMI {q['zona']}" if q else None
        if not q:
            q = quotazione(item.get("comune") or "", tipo)
            ambito = "tipico del comune"
        if q and q.get("medio_mq"):
            omi_mq = q["medio_mq"]
            semestre = q.get("semestre")
            omi_ambito = "zona" if q.get("zona") else "comune"
            sconto = round(1 - prezzo_mq / omi_mq, 3)
            rif = f"OMI {semestre}" if semestre else "OMI"
            if sconto >= SCONTO_INTERESSANTE:
                segnali.append(_segnale(
                    "positivo",
                    f"Prezzo base {_n(prezzo_mq)} €/m², {round(sconto * 100)}% sotto il valore "
                    f"{ambito} ({_n(omi_mq)} €/m², {rif}).",
                ))
            elif sconto < 0:
                segnali.append(_segnale(
                    "medio",
                    f"Prezzo base {_n(prezzo_mq)} €/m², sopra il valore {ambito} "
                    f"({_n(omi_mq)} €/m², {rif}).",
                ))

    # ── Tempi ───────────────────────────────────────────────────────────────
    data_asta = item.get("data_asta")
    if data_asta:
        try:
            giorni = (date.fromisoformat(data_asta[:10]) - oggi).days
        except ValueError:
            giorni = None
        if giorni is not None and 0 <= giorni <= GIORNI_TEMPI_STRETTI:
            segnali.append(_segnale(
                "info",
                f"Asta tra {giorni} giorni: tempi stretti per perizia, sopralluogo e cauzione.",
            ))

    livelli = {s["livello"] for s in segnali}
    if "alto" in livelli:
        giudizio = "rischioso"
    elif sconto is not None and sconto >= SCONTO_INTERESSANTE and "medio" not in livelli:
        giudizio = "interessante"
    else:
        giudizio = "da_valutare"

    return {
        "giudizio": giudizio,
        "segnali": segnali,
        "prezzo_mq": prezzo_mq,
        "omi_mq": omi_mq,
        "sconto_omi": sconto,
        "omi_semestre": semestre,
        "omi_ambito": omi_ambito,     # "zona" (dalle coordinate) | "comune" | None
    }
