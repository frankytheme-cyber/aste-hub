"""Test per la valutazione rapida dei lotti.

Esecuzione: python -m pytest analisi/test_valutazione.py
"""

from datetime import date

from analisi.valutazione import valutazione_rapida

OGGI = date(2026, 10, 18)


def _omi(medio=2000):
    return lambda comune, tipo: {"medio_mq": medio, "min_mq": 1000, "max_mq": 3000,
                                 "semestre": "2018-S2"}


def _lotto(**extra):
    base = {"tipo": "Appartamento", "comune": "Milano", "prezzo": 100000.0, "mq": 100,
            "data_asta": "2026-12-01"}
    base.update(extra)
    return base


def _livelli(v):
    return [s["livello"] for s in v["segnali"]]


def test_sconto_forte_e_interessante():
    v = valutazione_rapida(_lotto(), _omi(2000), OGGI)  # 1000 €/m² vs 2000
    assert v["prezzo_mq"] == 1000
    assert v["sconto_omi"] == 0.5
    assert v["giudizio"] == "interessante"
    assert v["omi_semestre"] == "2018-S2"


def test_prezzo_sopra_omi_e_segnalato():
    v = valutazione_rapida(_lotto(prezzo=300000.0), _omi(2000), OGGI)
    assert v["sconto_omi"] < 0
    assert v["giudizio"] == "da_valutare"
    assert "medio" in _livelli(v)


def test_quota_parziale_e_rischiosa_e_niente_euro_al_mq():
    """Il prezzo di 1/3 diviso per l'intera superficie sembrerebbe un affare."""
    v = valutazione_rapida(_lotto(diritto="Quota 1/3", prezzo=20000.0), _omi(), OGGI)
    assert v["giudizio"] == "rischioso"
    assert v["prezzo_mq"] is None and v["sconto_omi"] is None


def test_occupato_non_e_interessante_anche_se_scontato():
    v = valutazione_rapida(_lotto(stato_occupazione="Occupato"), _omi(2000), OGGI)
    assert v["sconto_omi"] == 0.5
    assert v["giudizio"] == "da_valutare"


def test_libero_e_un_segnale_positivo():
    v = valutazione_rapida(_lotto(stato_occupazione="Libero"), _omi(2000), OGGI)
    assert v["giudizio"] == "interessante"
    assert _livelli(v).count("positivo") == 2


def test_superficie_implausibile_ignorata():
    """1000 m² per un appartamento e' il terreno di pertinenza, non l'alloggio."""
    v = valutazione_rapida(_lotto(mq=1000), _omi(), OGGI)
    assert v["prezzo_mq"] is None


def test_senza_quotazione_omi():
    v = valutazione_rapida(_lotto(), lambda c, t: None, OGGI)
    assert v["prezzo_mq"] == 1000 and v["sconto_omi"] is None
    assert v["giudizio"] == "da_valutare"


def test_asta_imminente():
    v = valutazione_rapida(_lotto(data_asta="2026-10-21"), _omi(), OGGI)
    assert any("tra 3 giorni" in s["testo"] for s in v["segnali"])


def test_testo_con_migliaia_italiane():
    v = valutazione_rapida(_lotto(prezzo=120000.0, mq=100), _omi(2500), OGGI)
    testo = next(s["testo"] for s in v["segnali"] if s["livello"] == "positivo")
    assert "1.200 €/m²" in testo and "2.500 €/m²" in testo


def test_quotazione_di_zona_ha_la_precedenza():
    zona = lambda codice, tipo: {"medio_mq": 4000, "semestre": "2018-S2", "zona": "B1"}
    v = valutazione_rapida(_lotto(zona_omi="F205:B1"), _omi(2000), OGGI, quotazione_zona=zona)
    assert v["omi_mq"] == 4000 and v["omi_ambito"] == "zona"
    assert any("zona OMI B1" in s["testo"] for s in v["segnali"])


def test_zona_senza_quotazione_ripiega_sul_comune():
    v = valutazione_rapida(_lotto(zona_omi="F205:X9"), _omi(2000), OGGI,
                           quotazione_zona=lambda c, t: None)
    assert v["omi_mq"] == 2000 and v["omi_ambito"] == "comune"
