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

Il messaggio utente contiene, nell'ordine:
  1) una sezione "DATI DI QUESTA PERIZIA" con i valori gia' verificati dal sistema:
     - comune_verificato (stringa)
     - indirizzo_verificato (stringa)
     - offerta_minima (numero in euro, da usare per tutti i calcoli finanziari)
  2) il testo della perizia (o immagini allegate).
Usa SEMPRE questi valori autorevoli per i campi corrispondenti, senza sostituirli con quelli estratti dalla perizia.

Regole generali:
- Se un dato non e' presente nella perizia, usa null.
- Non stimare mai valori economici, costi, superfici o date se non esplicitati in modo chiaro.
- Preferisci meno informazioni esatte a molte informazioni ambigue.
- Ogni campo numerico o qualitativo deve essere supportato da una frase o sezione della perizia.
- Se trovi pagine mancanti o contenuti poco leggibili, segnalalo in "criticita".

Schema di output (devi rispettare TIPI e CHIAVI):
{{
  "metadati": {{
    "comune_verificato": "<usa il valore comune_verificato del messaggio utente>",
    "indirizzo_verificato": "<usa il valore indirizzo_verificato del messaggio utente>",
    "pagine_analizzate": [1, 2, 3, 4],
    "pagine_probabilmente_mancanti": []
  }},
  "soggetto_immobile": {{
    "indirizzo_estratto": "indirizzo come compare nella perizia, puo' contenere errori di trascrizione",
    "zona": "zona residenziale/commerciale/industriale/etc.",
    "lotto_identificazione": "foglio, particella, subalterno, se presenti",
    "diritto_quota": {{
      "quota_venduta": "1/1",
      "percentuale": 100,
      "piena_proprieta": true,
      "tipo_diritto": "piena proprieta' / nuda proprieta' / usufrutto / quota indivisa",
      "nota": "quota e tipo di diritto in vendita, come da perizia"
    }}
  }},
  "caratteristiche": {{
    "superficie_mq": 85,
    "superficie_commerciale_mq": 85,
    "rendita_catastale": 567.34,
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
    "f_spese_asta": null,
    "prezzo_massimo_offerta": null,
    "offerta_base": "<usa il valore offerta_minima del messaggio utente>",
    "roi_potenziale": null,
    "roi_percentuale": null,
    "nota_sconto": "Sconto giudiziario 15% applicato automaticamente (art. 2922 c.c.)",
    "nota_calcolo": "B=A*0.85 se sconto non applicato dal perito | C=Sanatoria+20% | E=N_formalita*200 | F=spese d'asta (imposte+delegato) | PMO=B-C-D-E-F | ROI=A-(Offerta+C+D+E+F)"
  }},
  "risultati_finanziari": {{
    "offerta_minima": "<usa il valore offerta_minima del messaggio utente>",
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
   - "caratteristiche.rendita_catastale": estrai la rendita catastale (in euro) dai dati
     catastali/visura della perizia. Se il lotto ha piu' unita', somma le rendite. null se assente.
   - "soggetto_immobile.diritto_quota": CRITICO. Determina la quota di proprieta' in vendita.
     - "piena ed intera proprieta'" / "1/1" / "100/100" / "intero" → percentuale 100, piena_proprieta true.
     - "quota di 1/2", "quota indivisa pari a 1/3", "meta'", "quota di un terzo" → percentuale <100,
       piena_proprieta FALSE (si vende solo una quota: l'aggiudicatario diventa comproprietario).
     - "quota_venduta": la frazione come da perizia (es. "1/3"). "percentuale": valore numerico (es. 33.33).
     - "tipo_diritto": se si vende nuda proprieta' o usufrutto (non piena proprieta'), indicalo qui.

2. STATO DI POSSESSO (art. 2923 c.c.):
   - "tipo_titolo": classifica il titolo tra le opzioni dello schema.
   - "occupato" = true se l'immobile non e' libero.
   - "titolo_opponibile" = true SOLO se il testo menziona contratto di locazione registrato
     PRECEDENTE al pignoramento, diritto di abitazione, o altro titolo espressamente opponibile.
   - Se l'immobile e' locato, estrai il canone (annuo e mensile). Non stimare.

   LIBERAZIONE EX ART. 560 c.p.c. (come riformato dal D.Lgs. 149/2022 — riforma Cartabia):
   - Se l'occupante e' il DEBITORE esecutato (o suoi familiari) SENZA titolo opponibile,
     l'immobile viene liberato dal CUSTODE giudiziario; il giudice emette l'ordine di
     liberazione che e' attuato dal custode senza bisogno di un autonomo sfratto.
     In "dettagli_possesso" annota che la liberazione e' a cura della procedura (rischio basso).
   - Se l'occupante ha titolo opponibile (es. locazione anteriore al pignoramento con data
     certa), l'ordine di liberazione NON si applica: il rischio resta alto. Riflettilo nel
     semaforo "occupazione".

   ALERT "CANONE VILE" (Cass. Civ. 9877/2022 — canone inferiore di oltre 1/3 al mercato):
   - Se canone_locazione_annuo e' presente E prezzo_mercato e' noto:
     soglia_inopponibilita = prezzo_mercato * 0.0264
     (canone di mercato stimato al 4% del valore; soglia = 66% di tale canone, cioe' il
     criterio "canone inferiore di 1/3 rispetto al valore di mercato" di Cass. 9877/2022)
     Se canone_annuo < soglia_inopponibilita: alert_canone_vile.attivo = true.
     Un canone vile puo' indicare locazione fittizia/simulata posta ad ostacolo della
     procedura, dichiarabile inopponibile. NOTA: il sistema ricalcola questo alert anche
     con i canoni di locazione OMI reali della zona (piu' attendibili della stima al 4%).

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

   DECRETO "SALVA CASA" 2024 (DL 69/2024 conv. L. 105/2024 — modifica del DPR 380/2001):
   - Ha ampliato le TOLLERANZE COSTRUTTIVE (art. 34-bis DPR 380/2001): scostamenti
     dimensionali entro soglie crescenti al diminuire della superficie dell'unita'
     (fino al 2% per unita' > 500 mq, fino al 6% per unita' < 60 mq) NON costituiscono
     piu' difformita' e non richiedono sanatoria.
   - Ha introdotto una sanatoria semplificata per le difformita' formali e per le
     "doppia conformita'" alleggerita (conformita' alla norma vigente al momento della
     domanda, non piu' anche a quella dell'epoca di realizzazione) per gli illeciti minori.
   - Applica questi criteri quando valuti "sanabile": difformita' lievi/parziali rientranti
     nelle nuove tolleranze → tendenzialmente sanabili o irrilevanti; in "note_conformita"
     segnala se l'abuso rientra plausibilmente nel perimetro Salva Casa. Non inventare costi:
     se il perito non quantifica, lascia "costo_stima_sanatoria" = null.

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
   - PLUSVALENZA SUPERBONUS (art. 67 c.1 lett. b-bis TUIR, introdotta dalla L. 213/2023,
     Legge di Bilancio 2024): la rivendita di un immobile su cui sono stati eseguiti
     interventi Superbonus ENTRO 10 ANNI dalla fine dei lavori genera una plusvalenza
     tassabile (imposta sostitutiva 26% o tassazione ordinaria). In "note" dell'alert
     segnala l'impatto fiscale potenziale in caso di rivendita rapida: riduce il ROI
     reale di una strategia "compra-ristruttura-rivendi".

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
   - "offerta_minima" = il valore offerta_minima del messaggio utente (invariato).
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
   F = spese d'asta (imposte di trasferimento + compenso delegato): lascia "f_spese_asta"
       a null, viene stimato automaticamente in base al prezzo e alla tipologia.
   prezzo_massimo_offerta = B - C - D - E - F
   offerta_base = il valore offerta_minima del messaggio utente
   roi_potenziale = A - (offerta_base + C + D + E + F)
   roi_percentuale = round((roi_potenziale / offerta_base) * 100, 1) se offerta_base > 0
   nota_sconto = indica se B = A (sconto gia' applicato dal perito) o B = A*0.85 (applicato da noi)
   NOTA: C/E/F e tutta l'aritmetica vengono comunque ricalcolati in modo autorevole lato server.

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

La perizia (testo e/o immagini) e i dati autorevoli di questo lotto sono forniti nel messaggio utente qui sotto.
Rispondi solo con un JSON valido. Niente testo prima o dopo, niente markdown, solo JSON puro.
"""

# Prompt statico pronto come system message (doppie graffe JSON risolte in singole).
# Riutilizzato identico ad ogni richiesta → cache hit dopo la prima.
PROMPT_SYSTEM_ANALISI = PROMPT_ANALISI.format()

# Modello unico per le due chiamate. Sonnet 4.6 supporta prompt caching con
# prefisso minimo 2048 token (qui ne usiamo ~4475) e ha finestra 1M.
MODEL_ANALISI = "claude-sonnet-4-6"


# ─── Parametri stima spese d'asta (configurabili) ─────────────────────────────
# Stima forfettaria degli oneri di acquisto all'asta a carico dell'aggiudicatario.
# Aliquota imposta di registro sul prezzo di aggiudicazione (base = offerta).
# Default "seconda casa / immobile strumentale" (scenario investitore, conservativo);
# l'aliquota prima casa sarebbe 2%, ma la maggior parte delle aste da reddito non lo è.
ALIQUOTA_IMPOSTA_REGISTRO = 0.09   # residenziale 2ª casa, commerciale, box, magazzino, ufficio
ALIQUOTA_IMPOSTA_TERRENO = 0.15    # terreni (a soggetti non coltivatori diretti / IAP)
IMPOSTA_REGISTRO_MINIMA = 1000     # imposta di registro proporzionale: minimo di legge
# Oneri fissi: imposte ipotecaria+catastale (~€100) + compenso del professionista
# delegato e spese di voltura/trascrizione/registrazione del decreto (~€1.500).
ONERI_FISSI_TRASFERIMENTO = 1600


def _stima_spese_asta(offerta_base: float, tipo: Optional[str]) -> float:
    """Stima gli oneri di acquisto all'asta (imposte di trasferimento + compenso
    delegato) a carico dell'aggiudicatario, in funzione del prezzo di aggiudicazione
    e della tipologia. È una stima forfettaria, dichiarata come tale nel report.
    Base = prezzo di aggiudicazione (ipotesi conservativa; il frontend consente di
    simulare il prezzo-valore sulla rendita catastale per le residenziali)."""
    if not offerta_base or offerta_base <= 0:
        return 0.0
    t = (tipo or "").lower()
    aliquota = ALIQUOTA_IMPOSTA_TERRENO if "terreno" in t else ALIQUOTA_IMPOSTA_REGISTRO
    imposta_registro = max(offerta_base * aliquota, IMPOSTA_REGISTRO_MINIMA)
    return round(imposta_registro + ONERI_FISSI_TRASFERIMENTO, 2)


def _somma_costi_sanatoria(dati: dict) -> Optional[float]:
    """Restituisce i costi di sanatoria indicati in perizia. Preferisce il valore
    aggregato ``valori_economici.costi_sanatoria``; se assente/zero, somma i costi
    dei singoli abusi (``conformita_edilizia.abusi_edilizi[].costo_stima_sanatoria``)
    così le spese di sanatoria della perizia non vengono perse."""
    ve = dati.get("valori_economici") or {}
    aggregato = ve.get("costi_sanatoria")
    if aggregato:
        return aggregato
    abusi = (dati.get("conformita_edilizia") or {}).get("abusi_edilizi") or []
    somma = sum(
        (a.get("costo_stima_sanatoria") or 0)
        for a in abusi
        if isinstance(a, dict)
    )
    return somma or aggregato


def _calcola_risultati_finanziari(dati: dict, offerta_minima: float,
                                  tipo: Optional[str] = None) -> None:
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
    # Costi di sanatoria: aggregati o, in mancanza, sommati dai singoli abusi in perizia.
    costi_sanatoria = _somma_costi_sanatoria(dati) or 0
    if costi_sanatoria and not ve.get("costi_sanatoria"):
        # Riporta nel JSON il totale derivato dai singoli abusi (campo prima vuoto)
        dati.setdefault("valori_economici", {})["costi_sanatoria"] = costi_sanatoria
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

    # ── Piano finanziario (ROI reale con formula estesa) ──────────────────────
    # È la fonte autorevole del ROI: tiene conto di costi sanatoria (+20% imprevisti),
    # debito condominiale e spese di cancellazione delle formalità. risultati_finanziari
    # (l'"headline" mostrata in sidebar) viene derivato da qui, così i due numeri
    # coincidono sempre e non si presentano due ROI diversi nella stessa schermata.
    pf = dati.setdefault("piano_finanziario", {})
    pf["offerta_base"] = offerta_minima
    rf = dati.setdefault("risultati_finanziari", {})
    rf["offerta_minima"] = offerta_minima

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
        # F: stima spese d'asta (imposte di trasferimento + compenso delegato)
        f = _stima_spese_asta(offerta_minima, tipo)

        pf["a_valore_mercato"] = a
        pf["b_valore_aggiustato_art2922"] = b
        pf["c_costi_sanatoria_con_imprevisti"] = c
        pf["d_debito_condominiale_biennio"] = d
        pf["e_spese_cancellazione"] = e
        pf["f_spese_asta"] = f
        pf["nota_sconto"] = nota_sconto
        aliquota_pct = int((ALIQUOTA_IMPOSTA_TERRENO if "terreno" in (tipo or "").lower()
                            else ALIQUOTA_IMPOSTA_REGISTRO) * 100)
        pf["nota_spese_asta"] = (
            f"Stima: imposta di registro {aliquota_pct}% sul prezzo di aggiudicazione "
            f"(ipotesi 2ª casa/strumentale) + ~€{ONERI_FISSI_TRASFERIMENTO} di compenso "
            f"delegato e oneri fissi. Prima casa o prezzo-valore riducono l'importo."
        )
        pf["prezzo_massimo_offerta"] = round(b - c - d - e - f, 2)
        roi = round(a - (offerta_minima + c + d + e + f), 2)
        roi_pct = round((roi / offerta_minima) * 100, 1) if offerta_minima > 0 else None
        pf["roi_potenziale"] = roi
        pf["roi_percentuale"] = roi_pct
        pf["nota_calcolo"] = "B=A*0.85 se sconto non applicato dal perito | E=N_formalita*200 | F=imposte+compenso delegato | PMO=B-C-D-E-F | ROI=A-(Offerta+C+D+E+F)"

        # risultati_finanziari derivato dal piano finanziario (unica fonte di verità)
        rf["profitto_lordo_stimato"] = roi
        rf["roi_assoluta"] = roi
        rf["roi_percentuale"] = roi_pct
    else:
        for k in ("a_valore_mercato", "b_valore_aggiustato_art2922",
                  "c_costi_sanatoria_con_imprevisti", "d_debito_condominiale_biennio",
                  "e_spese_cancellazione", "f_spese_asta",
                  "prezzo_massimo_offerta", "roi_potenziale", "roi_percentuale"):
            pf.setdefault(k, None)
        pf.setdefault("nota_calcolo", "B=A*0.85 se sconto non applicato dal perito | E=N_formalita*200 | F=imposte+compenso delegato | PMO=B-C-D-E-F | ROI=A-(Offerta+C+D+E+F)")
        rf.setdefault("profitto_lordo_stimato", None)
        rf.setdefault("roi_assoluta", None)
        rf.setdefault("roi_percentuale", None)


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

    # Header con i dati autorevoli di questo lotto. Il modello li usa per popolare
    # metadati.comune_verificato, metadati.indirizzo_verificato,
    # risultati_finanziari.offerta_minima e piano_finanziario.offerta_base.
    header_dati = (
        "DATI DI QUESTA PERIZIA (valori autorevoli — usali per i campi corrispondenti):\n"
        f"- comune_verificato: {comune}\n"
        f"- indirizzo_verificato: {indirizzo}\n"
        f"- offerta_minima: {offerta_minima} EUR\n"
    )

    if immagini_pdf:
        # Modalita' vision (pura o ibrida).
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

        content: list[dict] = [{"type": "text", "text": f"{header_dati}\nPERIZIA:\n{testo_perizia_msg}"}]
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
            "text": f"{header_dati}\nPERIZIA:\n{testo_troncato}",
        }]

    message = await _chiama_claude(
        client,
        model=MODEL_ANALISI,
        max_tokens=16000,
        system=[{
            "type": "text",
            "text": PROMPT_SYSTEM_ANALISI,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": content}],
    )

    u = message.usage
    logger.info(
        "Claude usage — input:%d cache_read:%d cache_write:%d output:%d stop:%s",
        getattr(u, "input_tokens", 0),
        getattr(u, "cache_read_input_tokens", 0) or 0,
        getattr(u, "cache_creation_input_tokens", 0) or 0,
        getattr(u, "output_tokens", 0),
        message.stop_reason,
    )

    if message.stop_reason == "max_tokens":
        raise RuntimeError(
            f"Risposta Claude troncata ({u.output_tokens} token output): "
            "aumenta max_tokens o riduci il testo della perizia in input."
        )
    if message.stop_reason == "refusal":
        raise RuntimeError("Claude ha rifiutato di analizzare il documento.")

    risposta = message.content[0].text.strip()

    # Gestisci risposte avvolte in blocchi markdown (difensivo)
    if "```json" in risposta:
        risposta = risposta.split("```json", 1)[1].split("```", 1)[0]
    elif "```" in risposta:
        risposta = risposta.split("```", 1)[1].split("```", 1)[0]

    dati = json.loads(risposta.strip())

    # Verifica e ricalcola risultati_finanziari in Python
    # (il modello puo' sbagliare aritmetica o avere offerta_minima errata)
    _calcola_risultati_finanziari(dati, offerta_minima, tipo=immobile.get("tipo"))

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
        model=MODEL_ANALISI,
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": PROMPT_DESCRIZIONE.format(
                json_estratto=json.dumps(sezioni_descrizione, ensure_ascii=False, indent=2)
            ),
        }],
    )

    return message.content[0].text.strip()
