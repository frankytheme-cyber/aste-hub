"""
Analisi strutturata della perizia di stima tramite Claude API.
Estrae: stato di possesso, conformita edilizia, abusi, stima ROI.
"""

import json
import logging
from typing import Optional

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
  "fonte_prezzo_mercato": "frase ESATTA (minimo 10-15 parole di contesto) della perizia da cui e' stato estratto il valore di mercato, oppure null se prezzo_mercato e' null",
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
   - "prezzo_mercato": il valore di mercato FINALE stimato DAL PERITO per il bene come se fosse \
LIBERO (NON il prezzo base d'asta, NON il valore di aggiudicazione minima). \
Cercalo con TUTTE queste label (non limitarti alle prime): \
"stima", "valutazione", "valore venale", "valore di mercato", "valore commerciale", \
"valore di liquidazione", "valore di realizzo", "piu' probabile valore", \
"piu' probabile valore di mercato libero", "MPV", "VVM", "valore del bene", \
"valore dell'immobile", "prezzo stimato", "stima del valore", \
"valore corrente", "valore attuale", "valore normale", "valore di stima", \
"stimasi in", "si stima in", "stimo in", "il bene e' stimato in", \
"prezzo presumibile di realizzo", "determinato in", "quantificato in", "fissato in", \
oppure come risultato TOTALE di una tabella di comparazione o di stima per valori unitari \
(es. valore unitario x superficie = importo finale). \
Nota sui formati: converti in float qualunque formato italiano: \
"200.000,00", "200.000", "€ 200.000", "duecentomila euro", "200 mila euro". \
ATTENZIONE: estrai SOLO un numero scritto esplicitamente dal perito — NON inventare questo valore. \
Se dopo aver cercato con tutte le label sopra e in tutti i totali di tabella non trovi nulla, usa null.
   - "fonte_prezzo_mercato": copia qui la frase ESATTA (con almeno 10-15 parole di contesto \
prima e dopo il numero) dalla quale hai ricavato prezzo_mercato. \
Se prezzo_mercato e' null, usa null anche qui.
   - "costi_sanatoria" e' la somma totale dei costi di sanatoria per tutti gli abusi.
   - "spese_condominiali" sono gli arretrati condominiali menzionati nella perizia. \
Se non menzionati, usa null.

6. Se un dato non e' presente o non e' determinabile dalla perizia, usa null. \
NON inventare valori economici — e' preferibile null a una stima non attendibile.

7. DATI DI RIFERIMENTO VERIFICATI (fonte: database aste, NON la perizia):
   Comune: {comune}
   Indirizzo: {indirizzo}
   Questi dati sono certi. Usali come ANCORAGGIO:
   - Se nella perizia trovi nomi di luoghi simili ma diversi (es. una citta' sbagliata, \
una via con nome storpiato), dai SEMPRE priorita' ai dati di riferimento verificati sopra.
   - La "descrizione_immobile" deve menzionare il comune corretto: {comune}.
   - NON usare la tua conoscenza geografica per descrivere la citta': \
attieniti solo a quanto scritto nella perizia, usando {comune} come nome del comune.

PERIZIA:
{testo_perizia}
"""


async def analizza_perizia(
    testo: str,
    immobile: dict,
    immagini_pdf: Optional[list] = None,
) -> dict:
    """
    Analizza la perizia tramite Claude API.

    Args:
        testo: Testo estratto dal PDF (può essere vuoto se si usano le immagini)
        immobile: Dict dell'immobile (per offerta_minima e altri dati)
        immagini_pdf: Lista di PNG (bytes) delle pagine — usata per PDF scansionati

    Returns:
        Dict con i risultati dell'analisi + ROI calcolato
    """
    import base64

    client = anthropic.Anthropic()  # Legge ANTHROPIC_API_KEY da env

    comune = immobile.get("comune") or ""
    indirizzo = immobile.get("indirizzo") or immobile.get("url_annuncio") or ""

    if immagini_pdf:
        # Modalità vision: le pagine arrivano come immagini PNG
        prompt_text = PROMPT_ANALISI.format(
            testo_perizia="[Le pagine della perizia sono nelle immagini allegate qui sotto.]",
            comune=comune,
            indirizzo=indirizzo,
        )
        content: list[dict] = [{"type": "text", "text": prompt_text}]
        for img_bytes in immagini_pdf:
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": base64.b64encode(img_bytes).decode(),
                },
            })
        logger.info(
            "Analisi vision: %d pagine inviate a Claude", len(immagini_pdf)
        )
    else:
        # Modalità testo: tronca a 50.000 char per stare nel budget token
        testo_troncato = testo[:50000]
        content = [{
            "type": "text",
            "text": PROMPT_ANALISI.format(
                testo_perizia=testo_troncato,
                comune=comune,
                indirizzo=indirizzo,
            ),
        }]

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{"role": "user", "content": content}],
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
