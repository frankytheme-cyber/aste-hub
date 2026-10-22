"""
Schema JSON dell'analisi perizia per gli output strutturati di Claude
(``output_config.format``), e conversione della risposta nel formato usato dal
resto dell'applicazione.

Perche' non ci sono null nello schema: gli output strutturati ammettono al
massimo 16 parametri con unione di tipi (``anyOf`` o ``["number", "null"]``) e
24 opzionali, mentre la perizia ha ~100 campi che possono mancare. Si usano
quindi convenzioni senza unioni, riconvertite in None da ``normalizza``:

    testo assente           -> ""             (S)
    numero assente          -> -1             (N; importi, superfici e conteggi sono >= 0)
    si'/no non determinabile -> "non_indicato" (B3; "si"/"no" -> True/False)

Schema e conversione nascono dalla stessa SPEC, così non possono divergere.
I calcoli finanziari (piano_finanziario, risultati_finanziari) non fanno parte
dell'output del modello: li esegue analizzatore._calcola_risultati_finanziari.
"""

# Tipi foglia della specifica
S, N, I, B, B3 = "S", "N", "I", "B", "B3"
LS, LI = ["S"], ["I"]               # liste di stringhe / di interi
SEMAFORO = ("verde", "giallo", "rosso")

SPEC = {
    "metadati": {
        "comune_verificato": S,
        "indirizzo_verificato": S,
        "pagine_analizzate": LI,
        "pagine_probabilmente_mancanti": LI,
    },
    "soggetto_immobile": {
        "indirizzo_estratto": S,
        "zona": S,
        "lotto_identificazione": S,
        "diritto_quota": {
            "quota_venduta": S,
            "percentuale": N,
            "piena_proprieta": B3,
            "tipo_diritto": S,
            "nota": S,
        },
    },
    "caratteristiche": {
        "superficie_mq": N,
        "superficie_commerciale_mq": N,
        "rendita_catastale": N,
        "vani": N,
        "bagni": N,
        "piano": S,
        "anno_costruzione": S,
        "classe_energetica": S,
        "stato_conservazione": S,
        "riscaldamento": S,
        "box_auto": S,
        "ascensore": B3,
        "balcone_terrazzo": B3,
        "cantina": B3,
        "giardino": B3,
    },
    "stato_di_possesso": {
        "occupato": B3,
        "tipo_titolo": S,
        "titolo_opponibile": B3,
        "data_registrazione_contratto": S,
        "dettagli_possesso": S,
        "canone_locazione_annuo": N,
        "canone_locazione_mensile": N,
        "alert_canone_vile": {
            "attivo": B,
            "canone_annuo_perizia": N,
            "soglia_inopponibilita": N,
            "nota_legale": S,
        },
        "alert_comodato": {"attivo": B, "nota_legale": S},
        "rischio_diritto_abitazione": {"presente": B, "note": S},
        "pagine_possesso": LI,
    },
    "conformita_edilizia": {
        "conforme_edilizia": B3,
        "conforme_urbanistica": B3,
        "titoli_abilitativi": LS,
        "note_conformita": S,
        "abusi_edilizi": [{
            "descrizione": S,
            "sanabile": B3,
            "costo_stima_sanatoria": N,
            "pagine_abuso": LI,
        }],
        "alert_fiscalizzazione": {"attivo": B, "note": S},
        "alert_superbonus_110": {"presente": B, "difformita_rilevate": B, "note": S},
        "pagine_conformita": LI,
    },
    "servitu_passive": {
        "presenti": B,
        "purgabili_con_decreto_trasferimento": B,
        "lista": LS,
        "impatto_valore_note": S,
        "pagine_servitu": LI,
    },
    "valori_economici": {
        "prezzo_mercato": N,
        "sconto_giudiziario_applicato_dal_perito": B,
        "valore_ante_sconto_perito": N,
        "fonte_prezzo_mercato": S,
        "valore_asta_minimo": N,
        "fonte_valore_asta_minimo": S,
        "costi_sanatoria": N,
        "spese_condominiali_arretrate": N,
        "compenso_delegato": N,
        "pagine_valori": LI,
    },
    "debiti_condominiali": {
        "arretrati_importo": N,
        "spese_ordinarie": N,
        "spese_straordinarie": N,
        "data_chiusura_bilancio": S,
        "periodo_coperto": S,
        "delibere_lavori_pendenti": S,
        "note_biennio": S,
        "pagine_condominio": LI,
    },
    "formalita_pregiudizievoli": {
        "ipoteche_iscritte": I,
        "pignoramenti_trascritti": I,
        "altri_vincoli_pregiudizievoli": I,
        "costo_unitario_cancellazione": N,
        "costo_totale_cancellazione": N,
        "lista_formalita": LS,
        "pagine_formalita": LI,
    },
    "semaforo_rischi": {
        "occupazione": SEMAFORO,
        "urbanistica": SEMAFORO,
        "oneri_condominiali": SEMAFORO,
        "note_occupazione": S,
        "note_urbanistica": S,
        "note_oneri": S,
    },
    "criticita": LS,
    "evidenze_pagina": {
        "pagine_chiave": LI,
        "note_analista": S,
    },
}


def _schema(spec) -> dict:
    if isinstance(spec, dict):
        return {
            "type": "object",
            "properties": {k: _schema(v) for k, v in spec.items()},
            "required": list(spec),
            "additionalProperties": False,
        }
    if isinstance(spec, list):
        return {"type": "array", "items": _schema(spec[0])}
    if isinstance(spec, tuple):
        return {"type": "string", "enum": list(spec)}
    return {
        S: {"type": "string"},
        N: {"type": "number"},
        I: {"type": "integer"},
        B: {"type": "boolean"},
        B3: {"type": "string", "enum": ["si", "no", "non_indicato"]},
    }[spec]


SCHEMA_ANALISI = _schema(SPEC)

CONVENZIONI = """\
CONVENZIONI PER I DATI ASSENTI (l'output e' vincolato a uno schema senza null):
- testo non presente in perizia: stringa vuota "";
- numero non presente in perizia (importi, superfici, vani, canoni, percentuali): -1;
- si'/no non determinabile dalla perizia: "non_indicato" (altrimenti "si" o "no");
- elenchi senza elementi: lista vuota [].
Nell'esempio di schema i campi si'/no (es. ascensore, occupato, sanabile) compaiono
come true/false: nell'output vanno scritti "si", "no" o "non_indicato".
Dove le regole qui sotto dicono "null", applica queste convenzioni. Non usare mai
-1 o "" per un dato che la perizia riporta: valgono solo per i dati assenti."""


def _converti(spec, valore):
    if isinstance(spec, dict):
        valore = valore if isinstance(valore, dict) else {}
        return {k: _converti(v, valore.get(k)) for k, v in spec.items()}
    if isinstance(spec, list):
        return [_converti(spec[0], v) for v in (valore or [])]
    if isinstance(spec, tuple):
        return valore if valore in spec else None
    if spec == S:
        return valore.strip() or None if isinstance(valore, str) else None
    if spec == N:
        return valore if isinstance(valore, (int, float)) and valore >= 0 else None
    if spec == I:
        return valore if isinstance(valore, int) and valore >= 0 else 0
    if spec == B:
        return bool(valore)
    if spec == B3:
        return {"si": True, "no": False}.get(valore)
    return valore


def normalizza(dati: dict) -> dict:
    """Risposta del modello (convenzioni senza null) -> dict con None per i dati
    assenti, nella stessa forma prodotta prima degli output strutturati."""
    return _converti(SPEC, dati)
