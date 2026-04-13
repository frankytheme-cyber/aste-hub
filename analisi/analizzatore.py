"""
Analisi strutturata della perizia di stima tramite Claude API.
Estrae: stato di possesso, conformita edilizia, abusi, stima ROI.
"""

import asyncio
import json
import logging
from typing import Optional

import anthropic

logger = logging.getLogger(__name__)


async def _chiama_claude(client: anthropic.Anthropic, **kwargs) -> anthropic.types.Message:
    """
    Chiama client.messages.create con retry esponenziale su errore 529 (overloaded).
    Fino a 5 tentativi: attese 10s, 20s, 40s, 80s tra un tentativo e l'altro.
    """
    ritardi = [10, 20, 40, 80]
    for tentativo, ritardo in enumerate(ritardi, start=1):
        try:
            return client.messages.create(**kwargs)
        except anthropic.APIStatusError as e:
            if e.status_code == 529:
                logger.warning(
                    "Claude sovraccarico (529) — tentativo %d/%d, riprovo tra %ds",
                    tentativo, len(ritardi) + 1, ritardo,
                )
                await asyncio.sleep(ritardo)
            else:
                raise
    # Ultimo tentativo: lascia propagare l'eccezione
    return client.messages.create(**kwargs)

PROMPT_ANALISI = """\
Sei un Esperto Analista di Aste Immobiliari e Consulente Legale Tecnico specializzato in diritto esecutivo italiano.
Il tuo compito e':
- leggere il testo della perizia (o le immagini, se fornite);
- estrarre solo dati verificabili, senza inventare numeri;
- applicare le regole di analisi con riferimenti normativi precisi;
- restituire solo un JSON valido che rispetti esattamente lo schema definito qui sotto;
- segnalare criticita', incongruenze, dati mancanti, eventuali dubbi di interpretazione.

Regole generali:
- Se un dato non e' presente nella perizia, usa null.
- Non stimare mai valori economici, costi, superfici o date se non esplicitati in modo chiaro.
- Preferisci meno informazioni esatte a molte informazioni ambigue.
- Ogni campo numerico o qualitativo deve essere supportato da una frase o sezione della perizia.
- Se trovi pagine mancanti o contenuti poco leggibili, segnalalo in "criticita".

Schema di output (devi rispettare TIPI e CHIAVI):
{{
  "metadati": {{
    "comune_verificato": "{comune}",
    "indirizzo_verificato": "{indirizzo}",
    "pagine_analizzate": [1, 2, 3, 4],
    "pagine_probabilmente_mancanti": []
  }},
  "soggetto_immobile": {{
    "indirizzo_estratto": "indirizzo come compare nella perizia, puo' contenere errori di trascrizione",
    "zona": "zona residenziale/commerciale/industriale/etc.",
    "lotto_identificazione": "foglio, particella, subalterno, se presenti"
  }},
  "caratteristiche": {{
    "superficie_mq": 85,
    "superficie_commerciale_mq": 85,
    "vani": 4,
    "bagni": 1,
    "piano": "2",
    "anno_costruzione": "1975",
    "classe_energetica": "G",
    "stato_conservazione": "Mediocre / Buono / Ottimo / Da ristrutturare",
    "riscaldamento": "autonomo / centralizzato / assente",
    "box_auto": "si / no / posto auto",
    "ascensore": true,
    "balcone_terrazzo": true,
    "cantina": true,
    "giardino": true
  }},
  "stato_di_possesso": {{
    "occupato": true,
    "tipo_titolo": "locazione / comodato / debitore / occupazione senza titolo / libero",
    "titolo_opponibile": true,
    "data_registrazione_contratto": "YYYY-MM-DD",
    "dettagli_possesso": "testo ESATTO o parafrasi fedele della perizia sullo stato di possesso",
    "canone_locazione_annuo": 7200,
    "canone_locazione_mensile": 600,
    "alert_canone_vile": {{
      "attivo": false,
      "canone_annuo_perizia": 7200,
      "soglia_inopponibilita": 4000,
      "nota_legale": "Cass. Civ. 9877/2022: canone inferiore di 1/3 rispetto al valore di mercato puo' indicare locazione fittizia, dichiarabile inopponibile alla procedura"
    }},
    "alert_comodato": {{
      "attivo": false,
      "nota_legale": "Il comodato non e' mai opponibile alla procedura esecutiva, anche se ha data certa (art. 2923 c.c.)"
    }},
    "rischio_diritto_abitazione": {{
      "presente": false,
      "note": null
    }},
    "pagine_possesso": [3, 7]
  }},
  "conformita_edilizia": {{
    "conforme_edilizia": true,
    "conforme_urbanistica": true,
    "titoli_abilitativi": ["Licenza edilizia n. X/1975", "CILA n. Y/2020"],
    "note_conformita": "sintesi delle note del perito su conformita', difformita', sanatorie, ecc.",
    "abusi_edilizi": [
      {{
        "descrizione": "testo che descrive l'abuso, come indicato nella perizia",
        "sanabile": true,
        "costo_stima_sanatoria": 5000,
        "pagine_abuso": [4, 5]
      }}
    ],
    "alert_fiscalizzazione": {{
      "attivo": false,
      "note": null
    }},
    "alert_superbonus_110": {{
      "presente": false,
      "difformita_rilevate": false,
      "note": null
    }},
    "pagine_conformita": [4, 5]
  }},
  "servitu_passive": {{
    "presenti": false,
    "purgabili_con_decreto_trasferimento": false,
    "lista": [
      "servitu' di passaggio a favore del mappale X, come da atto del ...",
      "mappale utilizzato da terzi per accesso a ..."
    ],
    "impatto_valore_note": "Le servitu' prediali (art. 1027 c.c.) e gli oneri reali NON vengono cancellati dal decreto di trasferimento. L'acquirente acquista il bene con il vincolo.",
    "pagine_servitu": [2, 3]
  }},
  "valori_economici": {{
    "prezzo_mercato": 150000,
    "sconto_giudiziario_applicato_dal_perito": false,
    "valore_ante_sconto_perito": null,
    "fonte_prezzo_mercato": "frase ESATTA (10-15 parole prima e dopo) dalla quale ricavi il numero",
    "valore_asta_minimo": 100000,
    "fonte_valore_asta_minimo": "frase ESATTA associata a questo valore",
    "costi_sanatoria": 5000,
    "spese_condominiali_arretrate": 3000,
    "pagine_valori": [6, 7]
  }},
  "debiti_condominiali": {{
    "arretrati_importo": 3000,
    "spese_ordinarie": 2000,
    "spese_straordinarie": 1000,
    "data_chiusura_bilancio": "30/06",
    "periodo_coperto": "01/07/2022 - 30/06/2024",
    "delibere_lavori_pendenti": null,
    "note_biennio": "testo libero: segnala se la chiusura non e' a dicembre e cosa implica per il biennio (art. 63 disp. att. c.c.)",
    "pagine_condominio": [8, 9]
  }},
  "formalita_pregiudizievoli": {{
    "ipoteche_iscritte": 2,
    "pignoramenti_trascritti": 1,
    "altri_vincoli_pregiudizievoli": 0,
    "costo_unitario_cancellazione": 200,
    "costo_totale_cancellazione": 600,
    "lista_formalita": [
      "Ipoteca volontaria iscritta il ..., a favore di ..., per €...",
      "Pignoramento immobiliare trascritto il ..."
    ],
    "pagine_formalita": [2, 3]
  }},
  "piano_finanziario": {{
    "a_valore_mercato": 150000,
    "b_valore_aggiustato_art2922": 127500,
    "c_costi_sanatoria_con_imprevisti": 6000,
    "d_debito_condominiale_biennio": 3000,
    "e_spese_cancellazione": 2000,
    "prezzo_massimo_offerta": null,
    "offerta_base": {offerta_minima},
    "roi_potenziale": null,
    "roi_percentuale": null,
    "nota_sconto": "Sconto giudiziario 15% applicato automaticamente (art. 2922 c.c.)",
    "nota_calcolo": "B=A*0.85 se sconto non applicato dal perito | C=Sanatoria+20% | E=N_formalita*200 | PMO=B-C-D-E | ROI=A-(Offerta+C+D+E)"
  }},
  "risultati_finanziari": {{
    "offerta_minima": {offerta_minima},
    "profitto_lordo_stimato": null,
    "roi_assoluta": null,
    "roi_percentuale": null
  }},
  "semaforo_rischi": {{
    "occupazione": "verde / giallo / rosso",
    "urbanistica": "verde / giallo / rosso",
    "oneri_condominiali": "verde / giallo / rosso",
    "note_occupazione": "motivazione sintetica",
    "note_urbanistica": "motivazione sintetica",
    "note_oneri": "motivazione sintetica"
  }},
  "criticita": [
    "stato di possesso complesso, con locazione registrata opponibile",
    "presenza di abusi edilizi non ancora sanati"
  ],
  "evidenze_pagina": {{
    "pagine_chiave": [3, 4, 6, 7],
    "note_analista": "testo libero in cui sintetizzi i punti piu' importanti dell'analisi, senza introdurre dati nuovi"
  }}
}}

REGOLE DI ANALISI:

1. INDIRIZZO E LOTTO:
   - Estrai l'indirizzo e l'identificazione catastale come appaiono in perizia.
   - Se uno dei due e' assente, usa null.
   - Non correggere niente: l'indirizzo corretto e' gia' dato nei metadati sopra.

2. STATO DI POSSESSO (art. 2923 c.c.):
   - "tipo_titolo": classifica il titolo tra le opzioni dello schema.
   - "occupato" = true se l'immobile non e' libero.
   - "titolo_opponibile" = true SOLO se il testo menziona contratto di locazione registrato
     PRECEDENTE al pignoramento, diritto di abitazione, o altro titolo espressamente opponibile.
   - Se l'immobile e' locato, estrai il canone (annuo e mensile). Non stimare.

   ALERT "CANONE VILE" (Cass. Civ. 9877/2022):
   - Se canone_locazione_annuo e' presente E prezzo_mercato e' noto:
     soglia_inopponibilita = prezzo_mercato * 0.0264
     (canone di mercato stimato al 4% del valore; soglia di inopponibilita' = 66% di tale canone)
     Se canone_annuo < soglia_inopponibilita: alert_canone_vile.attivo = true.
     Un canone vile puo' indicare locazione fittizia posta ad ostacolo della procedura.

   ALERT "COMODATO":
   - Se tipo_titolo = "comodato": alert_comodato.attivo = true SEMPRE.
     Il comodato non e' mai opponibile alla procedura, nemmeno con data certa (art. 2923 c.c.).

   RISCHIO "DIRITTO DI ABITAZIONE" (art. 540 c.c.):
   - Cerca: decesso comproprietario, "vedovo/a", "casa coniugale", "residenza familiare",
     "coniuge superstite". Se presente: rischio_diritto_abitazione.presente = true.
     Il diritto di abitazione del coniuge superstite e' opponibile anche se non trascritto.
     L'acquirente potrebbe ricevere la nuda proprieta' di fatto.

3. CONFORMITA' EDILIZIA:
   - Elenca tutti i titoli abilitativi in "titoli_abilitativi"
     (Licenza edilizia, Concessione, Permesso di costruire, DIA, CILA, CILAS, ecc.).
   - Se compaiono abusi, elencali tutti in "abusi_edilizi".
   - "sanabile" = true solo se DPR 380/2001 o norma analoga e' richiamata,
     o se il perito usa "sanabile", "sanatoria", "sanabilita'".

   ALERT "FISCALIZZAZIONE":
   - Se il perito descrive un abuso come "non ripristinabile" (con sanzione pecuniaria
     in luogo del ripristino): alert_fiscalizzazione.attivo = true.
     L'abuso permane e puo' ostacolare futuri mutui bancari e rivendita.

   ALERT "SUPERBONUS 110%":
   - Se la perizia menziona Superbonus 110%, CILAS per ecobonus o sismabonus:
     alert_superbonus_110.presente = true.
   - Se contestualmente ci sono abusi o difformita': difformita_rilevate = true.
     Difformita' gravi in presenza di Superbonus possono comportare revoca del beneficio
     con sanzioni per l'intero condominio.

4. VALORI ECONOMICI:
   - "prezzo_mercato": valore FINALE stimato dal perito come se il bene fosse LIBERO.
     Cercalo con TUTTE queste etichette:
     "stima", "valutazione", "valore venale", "valore di mercato", "valore commerciale",
     "valore di liquidazione", "valore di realizzo", "piu' probabile valore",
     "MPV", "VVM", "valore del bene", "valore dell'immobile", "prezzo stimato",
     "valore corrente", "valore attuale", "valore normale", "valore di stima",
     "stimasi in", "si stima in", "stimo in", "il bene e' stimato in",
     "prezzo presumibile di realizzo", "determinato in", "quantificato in", "fissato in",
     oppure come risultato TOTALE di una tabella di comparazione.
     Converti in float: "200.000,00", "200.000 euro", "duecentomila euro", "200 mila euro".
     Se non trovi nessun valore esplicito, usa null.
   - "fonte_prezzo_mercato": frase ESATTA con 10-15 parole di contesto.
   - "valore_asta_minimo": prezzo base d'asta, offerta minima, limite di aggiudicazione.
   - "costi_sanatoria": somma dei costi_stima_sanatoria degli abusi indicati. Null se assenti.
   - "spese_condominiali_arretrate": arretrati condominiali indicati. Non stimare.
   - "sconto_giudiziario_applicato_dal_perito": true se il perito dichiara ESPLICITAMENTE
     di aver gia' applicato una riduzione per la natura forzata della vendita.
     Formule rivelatori: "valore ridotto del X% per vendita forzata", "tenuto conto della
     vendita coatta", "riduzione forfettaria per asta giudiziaria", "valore di liquidazione
     inferiore al mercato libero", "decurtazione per assenza garanzie", "sconto per stato
     esecutivo", "stima per vendita forzata".
     false se il perito indica il valore "libero di mercato" senza riduzioni esplicite
     (la maggioranza delle perizie italiane).
   - "valore_ante_sconto_perito": se sconto_giudiziario_applicato_dal_perito = true,
     cerca il valore indicato PRIMA della riduzione (es. "valore libero = €200.000,
     riduzione 15% = €30.000, valore finale = €170.000" → valore_ante_sconto = 200000).
     null se non indicato o se sconto non applicato.

5. RISULTATI FINANZIARI (calcolo base):
   - "offerta_minima" = {offerta_minima} (valore fornito da me, invariato).
   - "profitto_lordo_stimato" = prezzo_mercato - offerta_minima - (costi_sanatoria o 0)
     - (spese_condominiali_arretrate o 0). Solo se prezzo_mercato non e' null.
   - "roi_assoluta" = stesso di profitto_lordo_stimato.
   - "roi_percentuale" = (profitto / offerta_minima) * 100, arrotondato a 1 decimale.

6. CRITICITA' E EVIDENZE:
   - "criticita'" = lista di stringhe: possesso complesso, abusi, vincoli, dati mancanti,
     incongruenze numeriche, pagine illeggibili.
   - "evidenze_pagina.note_analista" = sintesi senza nuovi dati numerici.

7. DEBITI CONDOMINIALI (art. 63 disp. att. c.c.):
   - Distingui spese_ordinarie e spese_straordinarie se la perizia le riporta separatamente.
   - "delibere_lavori_pendenti": segnala delibere per lavori approvate PRIMA dell'asta
     (Superbonus, rifacimento facciata, ascensore, ecc.). I costi deliberati possono ricadere
     sull'acquirente anche se i lavori non sono ancora iniziati.
   - "data_chiusura_bilancio": cerca la data di chiusura dell'esercizio condominiale.
     Formati comuni: "30 giugno", "30/06", "31 dicembre", "31/12". Null se non trovata.
   - "note_biennio": compila SEMPRE se arretrati_importo non e' null.
     Regola: l'acquirente risponde dell'esercizio in corso al decreto di trasferimento + quello precedente.
     — Chiusura NON dicembre: i debiti tra chiusura bilancio e data asta potrebbero mancare.
     — Chiusura null: impossibile verificare; raccomanda situazione aggiornata dal tribunale.
     — Chiusura dicembre: biennio coperto.

8. PIANO FINANZIARIO — ROI reale (popola SOLO se prezzo_mercato non e' null):
   A = prezzo_mercato (valore libero da perizia)
   B = A * 0.85 se sconto_giudiziario_applicato_dal_perito = false  (art. 2922 c.c.)
       B = A se sconto_giudiziario_applicato_dal_perito = true  (sconto gia' incluso nel prezzo)
   C = costi_sanatoria * 1.20 se non null, altrimenti 0  (+20% per imprevisti)
   D = debiti_condominiali.arretrati_importo se non null, altrimenti 0
   E = formalita_pregiudizievoli.costo_totale_cancellazione se > 0,
       altrimenti 2000 (stima forfettaria se le formalita' non sono rilevate in perizia)
   prezzo_massimo_offerta = B - C - D - E
   offerta_base = {offerta_minima}
   roi_potenziale = A - (offerta_base + C + D + E)
   roi_percentuale = round((roi_potenziale / offerta_base) * 100, 1) se offerta_base > 0
   nota_sconto = indica se B = A (sconto gia' applicato dal perito) o B = A*0.85 (applicato da noi)

9. SEMAFORO DEI RISCHI (uno dei tre valori: "verde", "giallo", "rosso"):
   "occupazione":
   - verde: libero, o solo debitore (sgombero con decreto di trasferimento)
   - giallo: comodato, o locazione senza titolo opponibile
   - rosso: locazione opponibile, diritto abitazione art. 540, alert_canone_vile attivo

   "urbanistica":
   - verde: piena conformita', nessun abuso, nessuna servitu' passiva gravosa
   - giallo: abusi sanabili, difformita' lievi, servitu' passiva con impatto limitato
   - rosso: abusi insanabili, alert_fiscalizzazione attivo, rischio revoca Superbonus,
     servitu' gravosa (es. passaggio obbligatorio da terzi su area esclusiva)

   "oneri_condominiali":
   - verde: nessun arretrato, o importo < 1% del valore mercato
   - giallo: arretrati presenti con biennio coperto (chiusura dicembre)
   - rosso: biennio parzialmente scoperto, delibere lavori pendenti, chiusura non dicembre

10. FORMALITA' PREGIUDIZIEVOLI (iscrizioni e trascrizioni a carico dell'immobile):
    Cerca nella relazione notarile/ipotecaria, nella sezione "gravami" o "formalita'":
    - "ipoteche_iscritte": conta OGNI iscrizione ipotecaria separata (volontaria, giudiziale,
      legale). Includi anche quelle contestuali al pignoramento.
    - "pignoramenti_trascritti": conta ogni pignoramento immobiliare trascritto.
    - "altri_vincoli_pregiudizievoli": sequestri, domande giudiziali, citazioni trascritte.
    - "costo_unitario_cancellazione": usa 200 (stima forfettaria firma + bolli per formalita').
    - "costo_totale_cancellazione" = (ipoteche + pignoramenti + altri) * 200.
      Se nessuna formalita' trovata in perizia: usa 0 (il calcolo Python userà fallback 2000).
    - "lista_formalita": elenca ogni formalita' con creditor, importo e data se disponibili.
    Nota: le cancellazioni sono ordinate dal giudice (art. 586 c.p.c.), ma i costi di
    firma notarile e bolli rimangono a carico dell'acquirente (~150-300€ a formalita').

11. SERVITU' PASSIVE (art. 1027 c.c. — oneri reali NON purgabili):
    Cerca: "servitu'", "onere reale", "mappale utilizzato da terzi", "diritto di passaggio",
    "servitu' di passaggio", "servitu' di veduta", "servitu' di acquedotto",
    "peso reale", "uso civico", "vincolo reale".
    - "presenti": true se la perizia menziona anche una sola servitu' passiva o onere reale.
    - "purgabili_con_decreto_trasferimento": SEMPRE false.
      Le servitu' prediali (art. 1027 c.c.) e gli oneri reali NON vengono cancellati
      dal decreto di trasferimento, a differenza di ipoteche e pignoramenti (art. 586 c.p.c.).
      Il decreto trasferisce il bene CUM ONERE: l'acquirente subentra nel vincolo.
    - "lista": per ogni servitu', riporta il testo ESATTO della perizia o della visura ipotecaria.
    - "impatto_valore_note": descrivi come la servitu' limita utilizzo o valore
      (es. "terzi hanno diritto di transito nel cortile: impedisce recinzione esclusiva").

PERIZIA:
{testo_perizia}

Rispondi solo con un JSON valido. Niente testo prima o dopo, niente markdown, solo JSON puro.
"""


def _calcola_risultati_finanziari(dati: dict, offerta_minima: float) -> None:
    """
    Ricalcola risultati_finanziari e piano_finanziario in Python.
    Il modello puo' sbagliare aritmetica: questo e' il calcolo autorevole.
    Modifica dati in-place.

    Variabili chiave:
    - sconto_giudiziario: se il perito ha gia' applicato il -15%, non raddoppiarlo.
    - costo_cancellazione: calcolato dinamicamente da n_formalita * €200.
    - servitu_passive: non modifica il calcolo ma viene segnalata nelle criticita'.
    """
    ve = dati.get("valori_economici") or {}
    prezzo_mercato = ve.get("prezzo_mercato")
    costi_sanatoria = ve.get("costi_sanatoria") or 0
    spese_condo = ve.get("spese_condominiali_arretrate") or 0
    arretrati = (dati.get("debiti_condominiali") or {}).get("arretrati_importo") or spese_condo

    # ── Sconto giudiziario ────────────────────────────────────────────────────
    # Se il perito ha gia' applicato la riduzione forfettaria del 15%, non raddoppiarla.
    sconto_gia_applicato = bool(ve.get("sconto_giudiziario_applicato_dal_perito"))

    # ── Costo cancellazione formalita' (dinamico) ─────────────────────────────
    fp = dati.get("formalita_pregiudizievoli") or {}
    n_formalita = (
        (fp.get("ipoteche_iscritte") or 0)
        + (fp.get("pignoramenti_trascritti") or 0)
        + (fp.get("altri_vincoli_pregiudizievoli") or 0)
    )
    COSTO_UNITARIO = 200  # €200 a formalita' (firma + bolli)
    if n_formalita > 0:
        costo_cancellazione = n_formalita * COSTO_UNITARIO
        # Aggiorna i campi calcolati nel JSON del modello (possono essere sbagliati)
        fp_ref = dati.setdefault("formalita_pregiudizievoli", {})
        fp_ref["costo_unitario_cancellazione"] = COSTO_UNITARIO
        fp_ref["costo_totale_cancellazione"] = costo_cancellazione
    else:
        # Nessuna formalita' rilevata in perizia: usa stima forfettaria minima
        costo_cancellazione = 2000

    # ── Risultati finanziari base ─────────────────────────────────────────────
    rf = dati.setdefault("risultati_finanziari", {})
    rf["offerta_minima"] = offerta_minima
    if prezzo_mercato is not None:
        profitto = prezzo_mercato - offerta_minima - costi_sanatoria - spese_condo
        rf["profitto_lordo_stimato"] = profitto
        rf["roi_assoluta"] = profitto
        rf["roi_percentuale"] = (
            round((profitto / offerta_minima) * 100, 1) if offerta_minima > 0 else None
        )
    else:
        rf.setdefault("profitto_lordo_stimato", None)
        rf.setdefault("roi_assoluta", None)
        rf.setdefault("roi_percentuale", None)

    # ── Piano finanziario (ROI reale con formula estesa) ──────────────────────
    pf = dati.setdefault("piano_finanziario", {})
    pf["offerta_base"] = offerta_minima

    if prezzo_mercato is not None:
        a = prezzo_mercato
        # B: applica -15% SOLO se il perito non l'ha gia' fatto
        if sconto_gia_applicato:
            b = a
            nota_sconto = "Sconto giudiziario gia' applicato dal perito: B = A (nessuna ulteriore riduzione)"
        else:
            b = round(a * 0.85, 2)
            nota_sconto = "Sconto giudiziario 15% applicato automaticamente (art. 2922 c.c. — assenza garanzia vizi)"
        c = round(costi_sanatoria * 1.20, 2) if costi_sanatoria else 0
        d = arretrati
        e = costo_cancellazione

        pf["a_valore_mercato"] = a
        pf["b_valore_aggiustato_art2922"] = b
        pf["c_costi_sanatoria_con_imprevisti"] = c
        pf["d_debito_condominiale_biennio"] = d
        pf["e_spese_cancellazione"] = e
        pf["nota_sconto"] = nota_sconto
        pf["prezzo_massimo_offerta"] = round(b - c - d - e, 2)
        roi = round(a - (offerta_minima + c + d + e), 2)
        pf["roi_potenziale"] = roi
        pf["roi_percentuale"] = (
            round((roi / offerta_minima) * 100, 1) if offerta_minima > 0 else None
        )
        pf["nota_calcolo"] = "B=A*0.85 se sconto non applicato dal perito | E=N_formalita*200 | PMO=B-C-D-E | ROI=A-(Offerta+C+D+E)"
    else:
        for k in ("a_valore_mercato", "b_valore_aggiustato_art2922",
                  "c_costi_sanatoria_con_imprevisti", "d_debito_condominiale_biennio",
                  "prezzo_massimo_offerta", "roi_potenziale", "roi_percentuale"):
            pf.setdefault(k, None)
        pf.setdefault("nota_calcolo", "B=A*0.85 se sconto non applicato dal perito | E=N_formalita*200 | PMO=B-C-D-E | ROI=A-(Offerta+C+D+E)")


async def analizza_perizia(
    testo: str,
    immobile: dict,
    immagini_pdf: Optional[list] = None,
) -> dict:
    """
    Analizza la perizia tramite Claude API.

    Args:
        testo: Testo estratto dal PDF (puo' essere vuoto se si usano le immagini)
        immobile: Dict dell'immobile (per offerta_minima e altri dati)
        immagini_pdf: Lista di PNG (bytes) delle pagine — usata per PDF scansionati

    Returns:
        Dict con i risultati dell'analisi strutturata + risultati_finanziari calcolati
    """
    import base64

    client = anthropic.Anthropic(max_retries=4)  # Legge ANTHROPIC_API_KEY da env

    comune = immobile.get("comune") or ""
    indirizzo = immobile.get("indirizzo") or immobile.get("url_annuncio") or ""
    offerta_minima = immobile.get("offerta_minima") or (
        immobile.get("prezzo", 0) * 0.75
    ) or 0

    prompt_kwargs = dict(
        comune=comune,
        indirizzo=indirizzo,
        offerta_minima=offerta_minima,
    )

    if immagini_pdf:
        # Modalita' vision (pura o ibrida).
        # Se esiste testo parziale (OCR frammentato), lo si include come contesto
        # per aiutare il modello a interpretare parole difficili nelle immagini.
        if testo and len(testo.strip()) > 200:
            testo_contesto = testo[:20000]
            testo_perizia_msg = (
                "[Testo parziale estratto dalla perizia — OCR potenzialmente frammentato"
                " (timbri o watermark sovrapposti):\n\n"
                + testo_contesto
                + "\n\nLe pagine visive sono allegate qui sotto per una lettura piu' accurata.]"
            )
            logger.info(
                "Analisi ibrida (testo+vision): %d char testo + %d pagine immagine",
                len(testo_contesto), len(immagini_pdf),
            )
        else:
            testo_perizia_msg = "[Le pagine della perizia sono nelle immagini allegate qui sotto.]"
            logger.info("Analisi vision pura: %d pagine inviate a Claude", len(immagini_pdf))

        prompt_text = PROMPT_ANALISI.format(testo_perizia=testo_perizia_msg, **prompt_kwargs)
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
    else:
        # Modalita' testo: tronca a 50.000 char per stare nel budget token
        testo_troncato = testo[:50000]
        content = [{
            "type": "text",
            "text": PROMPT_ANALISI.format(
                testo_perizia=testo_troncato,
                **prompt_kwargs,
            ),
        }]

    message = await _chiama_claude(
        client,
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{"role": "user", "content": content}],
    )

    risposta = message.content[0].text.strip()

    # Gestisci risposte avvolte in blocchi markdown (difensivo)
    if "```json" in risposta:
        risposta = risposta.split("```json", 1)[1].split("```", 1)[0]
    elif "```" in risposta:
        risposta = risposta.split("```", 1)[1].split("```", 1)[0]

    dati = json.loads(risposta.strip())

    # Verifica e ricalcola risultati_finanziari in Python
    # (il modello puo' sbagliare aritmetica o avere offerta_minima errata)
    _calcola_risultati_finanziari(dati, offerta_minima)

    return dati


PROMPT_DESCRIZIONE = """\
Sei un valutatore immobiliare che scrive annunci immobiliari professionali.
Parti dal seguente JSON estratto da una perizia di stima e produci una descrizione estesa e dettagliata
dell'immobile, come se fosse un annuncio per un acquirente informato ma non esperto.

Regole:
- Usa solo i dati gia' presenti nel JSON.
- Non aggiungere nuove informazioni numeriche.
- Scrivi in italiano, in forma discorsiva, ma con stile tecnico e professionale.
- Lunghezza minima 150 parole, se possibile 200-300.
- Rispondi solo con il testo della descrizione, senza titoli, introduzioni o conclusioni.

JSON estratto:
{json_estratto}

Descrizione:
"""


async def genera_descrizione(dati_analisi: dict) -> str:
    """
    Genera una descrizione discorsiva dell'immobile a partire dal JSON di analisi.

    Args:
        dati_analisi: Dict restituito da analizza_perizia

    Returns:
        Stringa con la descrizione dell'immobile (testo puro, senza markup)
    """
    client = anthropic.Anthropic(max_retries=4)

    # Invia solo le sezioni rilevanti per la descrizione, escludendo valori economici
    # e criticita' (non pertinenti a un annuncio)
    sezioni_descrizione = {
        k: dati_analisi[k]
        for k in ("metadati", "soggetto_immobile", "caratteristiche", "stato_di_possesso")
        if k in dati_analisi
    }

    message = await _chiama_claude(
        client,
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": PROMPT_DESCRIZIONE.format(
                json_estratto=json.dumps(sezioni_descrizione, ensure_ascii=False, indent=2)
            ),
        }],
    )

    return message.content[0].text.strip()
