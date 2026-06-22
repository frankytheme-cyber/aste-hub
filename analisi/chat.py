"""
Chat conversazionale sulla perizia gia' analizzata.
Risponde a domande libere usando come contesto l'analisi strutturata (JSON)
e, se disponibile, il testo grezzo della perizia.
"""

import json
import logging
from typing import Optional

import anthropic

from analisi.analizzatore import _chiama_claude, MODEL_ANALISI

logger = logging.getLogger(__name__)

# Limite di messaggi della conversazione mantenuti come contesto (utente+assistente).
_MAX_STORIA = 20
# Tetto del testo perizia incluso nel contesto (caratteri).
_MAX_TESTO_PERIZIA = 60000

PROMPT_CHAT = """\
Sei un consulente esperto di aste immobiliari giudiziarie italiane.
Rispondi alle domande dell'utente su uno specifico immobile all'asta, la cui perizia
e' gia' stata analizzata. Hai a disposizione, qui sotto:
  1) l'ANALISI STRUTTURATA (JSON) prodotta dal sistema, con i dati gia' verificati;
  2) quando disponibile, il TESTO della perizia di stima.

Regole:
- Rispondi solo sulla base dei dati forniti (analisi + testo perizia). Non inventare numeri,
  date o circostanze non presenti.
- Se l'informazione non e' nei dati, dillo chiaramente e, se utile, suggerisci dove l'utente
  potrebbe reperirla (es. cancelleria del tribunale, amministratore di condominio, visura).
- Usa un tono professionale ma chiaro, in italiano. Vai dritto al punto.
- Quando citi importi o rischi, riconducili ai campi dell'analisi (es. ROI, semaforo rischi,
  stato di possesso, abusi, formalita' pregiudizievoli).
- Quando rilevante, richiama i riferimenti normativi gia' presenti nell'analisi
  (es. art. 560 c.p.c. liberazione, art. 2922 c.c. sconto, art. 63 disp. att. c.c. condominio,
  art. 1027 c.c. servitu'), senza inventarne di nuovi.
- Non ripetere l'intera analisi: rispondi solo a cio' che e' stato chiesto.

ANALISI STRUTTURATA (JSON):
{analisi_json}

TESTO PERIZIA:
{testo_perizia}
"""


def _costruisci_system(analisi: dict) -> str:
    """Compone il system prompt con analisi JSON + testo perizia (se presente)."""
    # Escludi il testo grezzo dal JSON: lo inseriamo separatamente per leggibilita'.
    analisi_pulita = {k: v for k, v in analisi.items() if k != "testo_perizia"}
    analisi_json = json.dumps(analisi_pulita, ensure_ascii=False, indent=2)

    testo = (analisi.get("testo_perizia") or "").strip()
    testo_perizia = (
        testo[:_MAX_TESTO_PERIZIA]
        if testo
        else "[Testo della perizia non disponibile: l'analisi e' stata prodotta da immagini "
             "scansionate. Rispondi usando solo l'analisi strutturata qui sopra.]"
    )

    return PROMPT_CHAT.format(analisi_json=analisi_json, testo_perizia=testo_perizia)


async def chat_perizia(
    domanda: str,
    storia: Optional[list],
    analisi: dict,
) -> str:
    """
    Risponde a una domanda sulla perizia analizzata.

    Args:
        domanda: la nuova domanda dell'utente.
        storia: lista di messaggi precedenti [{"ruolo": "utente"|"assistente", "contenuto": str}].
        analisi: il dict dell'analisi cached (puo' contenere "testo_perizia").

    Returns:
        La risposta testuale dell'assistente.
    """
    client = anthropic.Anthropic(max_retries=4)

    system = _costruisci_system(analisi)

    # Mappa la storia nel formato Anthropic, troncando ai messaggi piu' recenti.
    messages: list[dict] = []
    for m in (storia or [])[-_MAX_STORIA:]:
        contenuto = (m.get("contenuto") or "").strip()
        if not contenuto:
            continue
        ruolo = "assistant" if m.get("ruolo") == "assistente" else "user"
        messages.append({"role": ruolo, "content": contenuto})

    messages.append({"role": "user", "content": domanda.strip()})

    # Garantisce che il primo messaggio sia dell'utente (requisito API).
    if messages[0]["role"] != "user":
        messages = messages[1:]

    message = await _chiama_claude(
        client,
        model=MODEL_ANALISI,
        max_tokens=2048,
        system=[{
            "type": "text",
            "text": system,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=messages,
    )

    u = message.usage
    logger.info(
        "Chat perizia usage — input:%d cache_read:%d cache_write:%d output:%d",
        getattr(u, "input_tokens", 0),
        getattr(u, "cache_read_input_tokens", 0) or 0,
        getattr(u, "cache_creation_input_tokens", 0) or 0,
        getattr(u, "output_tokens", 0),
    )

    if message.stop_reason == "refusal":
        raise RuntimeError("Claude ha rifiutato di rispondere alla domanda.")

    return message.content[0].text.strip()
