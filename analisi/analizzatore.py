"""
Analisi strutturata della perizia di stima tramite Claude API.
Estrae: stato di possesso, conformita edilizia, abusi, stima ROI.
"""

import json
import logging

import anthropic

logger = logging.getLogger(__name__)

PROMPT_ANALISI = """\
Sei un consulente immobiliare specializzato in aste giudiziarie italiane.
Analizza la seguente perizia di stima e produci un report strutturato in formato JSON.

Il JSON deve avere questa struttura esatta:
{{
  "indirizzo_estratto": "indirizzo completo estratto dalla perizia",
  "lotto_identificazione": "identificazione catastale del lotto (foglio, particella, sub)",
  "descrizione_immobile": "Descrizione estesa e dettagliata dell'immobile (minimo 150 parole). \
Includi: tipologia e anno di costruzione, piano, superficie lorda e calpestabile, \
composizione interna (numero e tipo di vani, bagni, ripostigli, balconi, cantine, box), \
stato di manutenzione e conservazione (pavimenti, infissi, impianti), \
classe energetica se indicata, pertinenze, caratteristiche particolari (vista, esposizione, \
giardino, posto auto, ascensore), contesto urbanistico (zona residenziale, commerciale, \
servizi nelle vicinanze). Scrivi in italiano in modo discorsivo come un annuncio immobiliare \
professionale ma basato esclusivamente sui dati della perizia.",
  "caratteristiche": {{
    "superficie_mq": 85,
    "vani": 4,
    "bagni": 1,
    "piano": "2",
    "anno_costruzione": "1975",
    "classe_energetica": "G",
    "stato_conservazione": "Mediocre / Buono / Ottimo",
    "riscaldamento": "autonomo / centralizzato / assente",
    "box_auto": "si / no / posto auto",
    "ascensore": true/false,
    "balcone_terrazzo": true/false,
    "cantina": true/false,
    "giardino": true/false
  }},
  "occupato": true/false,
  "titolo_opponibile": true/false,
  "dettagli_possesso": "descrizione dettagliata dello stato di possesso",
  "abusi_edilizi": [
    {{"descrizione": "descrizione dell'abuso", "sanabile": true/false, "costo_stima": 5000}}
  ],
  "conformita_note": "note generali sulla conformita edilizia e urbanistica",
  "prezzo_mercato": 150000,
  "fonte_prezzo_mercato": "frase esatta della perizia da cui e' stato estratto il valore di mercato, oppure null",
  "costi_sanatoria": 5000,
  "spese_condominiali": 3000
}}

REGOLE DI ANALISI:
1. INDIRIZZO E LOTTO: Estrai l'indirizzo completo e l'identificazione catastale (foglio, particella, subalterno).

2. DESCRIZIONE IMMOBILE:
   - Scrivi una descrizione ESTESA e DETTAGLIATA (minimo 150 parole, idealmente 200-300).
   - Includi TUTTE le informazioni che un potenziale acquirente vorrebbe sapere.
   - Stile: annuncio immobiliare professionale, discorsivo, in italiano.
   - Basa la descrizione esclusivamente sui dati presenti nella perizia.
   - "caratteristiche": estrai i singoli valori numerici/categorici. Usa null se non presente nella perizia.

3. STATO DI POSSESSO:
   - "occupato" e' true se l'immobile NON e' libero (occupato dal debitore, da terzi, in locazione, ecc.)
   - "titolo_opponibile" e' true SOLO se il possessore ha un contratto di locazione registrato PRIMA \
del pignoramento, un diritto di abitazione, o altro titolo opponibile alla procedura esecutiva. \
Questo indica RISCHIO ALTO per l'acquirente.
   - "dettagli_possesso": riporta il testo rilevante della perizia sullo stato di possesso.

4. CONFORMITA EDILIZIA:
   - Per ogni abuso edilizio citato nella perizia, crea un elemento in "abusi_edilizi".
   - "sanabile" e' true se la perizia indica che l'abuso e' sanabile ai sensi del DPR 380/2001 \
o normativa regionale equivalente. Cerca le parole "sanabile", "sanabilita", "sanatoria".
   - "costo_stima" e' il costo stimato dal perito per la sanatoria di quel singolo abuso (in EUR). \
Se non indicato, stima tu un valore ragionevole.
   - Se non ci sono abusi, lascia la lista vuota [].

5. VALORI ECONOMICI:
   - "prezzo_mercato": il valore di mercato stimato DAL PERITO per il bene LIBERO \
(NON il prezzo base d'asta). Cercalo SOLO nelle sezioni "stima", "valutazione", \
"valore venale", "valore di mercato", "piu' probabile valore". \
ATTENZIONE: questo deve essere un numero ESPLICITAMENTE scritto dal perito nella perizia. \
NON inventare e NON stimare tu questo valore. Se il perito non indica chiaramente un valore \
di mercato, usa null. E' meglio null che un valore inventato.
   - "fonte_prezzo_mercato": la frase esatta della perizia da cui hai estratto il prezzo di mercato. \
Se prezzo_mercato e' null, anche questo deve essere null.
   - "costi_sanatoria" e' la somma totale dei costi di sanatoria per tutti gli abusi.
   - "spese_condominiali" sono gli arretrati condominiali menzionati nella perizia. \
Se non menzionati, usa null.

6. Se un dato non e' presente o non e' determinabile dalla perizia, usa null. \
NON inventare valori economici — e' preferibile null a una stima non attendibile.

PERIZIA:
{testo_perizia}
"""


async def analizza_perizia(testo: str, immobile: dict) -> dict:
    """
    Analizza il testo della perizia tramite Claude API.

    Args:
        testo: Testo estratto dal PDF della perizia
        immobile: Dict dell'immobile (per offerta_minima e altri dati)

    Returns:
        Dict con i risultati dell'analisi + ROI calcolato
    """
    client = anthropic.Anthropic()  # Legge ANTHROPIC_API_KEY da env

    # Tronca a 50.000 char per stare nel budget token
    testo_troncato = testo[:50000]

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{
            "role": "user",
            "content": PROMPT_ANALISI.format(testo_perizia=testo_troncato),
        }],
    )

    risposta = message.content[0].text

    # Estrai blocco JSON dalla risposta
    if "```json" in risposta:
        risposta = risposta.split("```json", 1)[1].split("```", 1)[0]
    elif "```" in risposta:
        risposta = risposta.split("```", 1)[1].split("```", 1)[0]

    dati = json.loads(risposta.strip())

    # Calcola ROI
    prezzo_mercato = dati.get("prezzo_mercato")
    offerta_minima = immobile.get("offerta_minima") or (
        immobile.get("prezzo", 0) * 0.75
    )
    costi_sanatoria = dati.get("costi_sanatoria") or 0
    spese_condo = dati.get("spese_condominiali") or 0

    roi = None
    if prezzo_mercato and offerta_minima:
        roi = prezzo_mercato - offerta_minima - costi_sanatoria - spese_condo

    dati["offerta_minima"] = offerta_minima
    dati["roi_stimato"] = roi

    return dati
