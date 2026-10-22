"""Test per lo schema degli output strutturati e la conversione della risposta.

Esecuzione: python -m pytest analisi/test_schema_perizia.py
"""

import asyncio
import json
from types import SimpleNamespace

import analisi.analizzatore as an
from analisi.schema_perizia import SCHEMA_ANALISI, SPEC, normalizza


def _nodi(schema):
    yield schema
    for figlio in (schema.get("properties") or {}).values():
        yield from _nodi(figlio)
    if "items" in schema:
        yield from _nodi(schema["items"])


def test_schema_rispetta_i_limiti_degli_output_strutturati():
    """Max 16 unioni di tipi e 24 opzionali per richiesta: qui zero di entrambi."""
    for nodo in _nodi(SCHEMA_ANALISI):
        assert "anyOf" not in nodo
        assert not isinstance(nodo.get("type"), list)
        if nodo.get("type") == "object":
            assert nodo["additionalProperties"] is False
            assert set(nodo["required"]) == set(nodo["properties"])


def test_nessun_calcolo_finanziario_richiesto_al_modello():
    assert "piano_finanziario" not in SCHEMA_ANALISI["properties"]
    assert "risultati_finanziari" not in SCHEMA_ANALISI["properties"]


def _risposta_minima(**override):
    """Risposta conforme allo schema con tutti i dati 'assenti'."""
    def vuoto(spec):
        if isinstance(spec, dict):
            return {k: vuoto(v) for k, v in spec.items()}
        if isinstance(spec, list):
            return []
        if isinstance(spec, tuple):
            return spec[0]
        return {"S": "", "N": -1, "I": 0, "B": False, "B3": "non_indicato"}[spec]
    dati = vuoto(SPEC)
    for percorso, valore in override.items():
        nodo = dati
        *testa, ultimo = percorso.split(".")
        for k in testa:
            nodo = nodo[k]
        nodo[ultimo] = valore
    return dati


def test_normalizza_convenzioni_in_none():
    d = normalizza(_risposta_minima(**{
        "valori_economici.prezzo_mercato": 150000,
        "stato_di_possesso.occupato": "si",
        "caratteristiche.ascensore": "no",
        "soggetto_immobile.zona": "  centro  ",
    }))
    assert d["valori_economici"]["prezzo_mercato"] == 150000
    assert d["valori_economici"]["costi_sanatoria"] is None        # -1
    assert d["stato_di_possesso"]["occupato"] is True
    assert d["caratteristiche"]["ascensore"] is False
    assert d["caratteristiche"]["cantina"] is None                  # non_indicato
    assert d["soggetto_immobile"]["zona"] == "centro"
    assert d["soggetto_immobile"]["indirizzo_estratto"] is None     # ""
    assert d["formalita_pregiudizievoli"]["ipoteche_iscritte"] == 0


def test_analizza_perizia_legge_il_testo_dopo_il_thinking(monkeypatch):
    """Con il pensiero adattivo la risposta puo' iniziare con un blocco thinking."""
    risposta = _risposta_minima(**{"valori_economici.prezzo_mercato": 200000})
    message = SimpleNamespace(
        stop_reason="end_turn", model=an.MODEL_ANALISI,
        usage=SimpleNamespace(input_tokens=1, output_tokens=1),
        content=[SimpleNamespace(type="thinking", thinking=""),
                 SimpleNamespace(type="text", text=json.dumps(risposta))],
    )
    chiamate = []

    async def finto_claude(client, **kwargs):
        chiamate.append(kwargs)
        return message

    monkeypatch.setattr(an, "_chiama_claude", finto_claude)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    dati = asyncio.run(an.analizza_perizia(
        "testo perizia", {"offerta_minima": 100000.0, "tipo": "Appartamento"}))

    assert chiamate[0]["output_config"]["format"]["schema"] is SCHEMA_ANALISI
    assert chiamate[0]["model"] == "claude-sonnet-5-5"
    # Il piano finanziario lo calcola Python dai valori estratti
    assert dati["piano_finanziario"]["a_valore_mercato"] == 200000
    assert dati["risultati_finanziari"]["offerta_minima"] == 100000.0
    assert dati["piano_finanziario"]["roi_potenziale"] is not None


def test_rifiuto_solleva_errore():
    msg = SimpleNamespace(stop_reason="refusal", content=[])
    try:
        an.testo_risposta(msg)
    except RuntimeError:
        return
    raise AssertionError("un rifiuto non deve essere letto come risposta")
