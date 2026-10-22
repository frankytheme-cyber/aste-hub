"""Test per deduplicazione cross-portale, arricchimento immagini e date implausibili.

Esecuzione: python -m pytest scraper/test_orchestratore.py
"""

from datetime import date, timedelta

from scraper.main import (
    ORIZZONTE_ANNI,
    _chiave_lotto,
    _deduplica_cross_portale,
    _enrich_images,
    _integra_fonte_fallita,
    _scarta_date_implausibili,
)


def _lotto(id_, fonte, comune="Rufina", prezzo=100000.0, data="2026-09-17", **extra):
    base = {
        "id": id_, "fonte": fonte, "comune": comune, "prezzo": prezzo,
        "data_asta": data, "titolo": "Appartamento", "immagine": None,
    }
    base.update(extra)
    return base


def _ids(items):
    return sorted(i["id"] for i in items)


# ─── _chiave_lotto ────────────────────────────────────────────────────────────

def test_chiave_richiede_comune_prezzo_data():
    assert _chiave_lotto(_lotto("a", "pvp")) == ("rufina", 100000.0, "2026-09-17")
    assert _chiave_lotto(_lotto("a", "pvp", data=None)) is None
    assert _chiave_lotto(_lotto("a", "pvp", prezzo=0.0)) is None
    assert _chiave_lotto(_lotto("a", "pvp", comune="")) is None


# ─── _deduplica_cross_portale ─────────────────────────────────────────────────

def test_duplicato_cross_portale_collassato():
    """Stesso comune/prezzo/data su portali diversi: resta il migliore."""
    items = [_lotto("pvp:1", "pvp"), _lotto("astegiudiziarie:1", "astegiudiziarie")]
    assert _ids(_deduplica_cross_portale(items)) == ["astegiudiziarie:1"]


def test_vince_chi_ha_immagine():
    items = [
        _lotto("pvp:1", "pvp", immagine="http://x/1.jpg"),
        _lotto("astegiudiziarie:1", "astegiudiziarie"),
    ]
    assert _ids(_deduplica_cross_portale(items)) == ["pvp:1"]


def test_stessa_fonte_mai_collassata():
    """Lotti diversi della stessa procedura condividono prezzo e data."""
    items = [_lotto("pvp:1", "pvp"), _lotto("pvp:2", "pvp")]
    assert _ids(_deduplica_cross_portale(items)) == ["pvp:1", "pvp:2"]


def test_lotti_senza_data_non_collassati():
    """Senza data la chiave degrada a "un lotto in questo comune": non basta."""
    items = [
        _lotto("astalegale:B2390631", "astalegale", prezzo=0.0, data=None),
        _lotto("astalegale:B2390632", "astalegale", prezzo=0.0, data=None),
        _lotto("pvp:9", "pvp", prezzo=0.0, data=None),
    ]
    assert len(_deduplica_cross_portale(items)) == 3


def test_lotti_senza_prezzo_non_collassati():
    items = [_lotto("pvp:1", "pvp", prezzo=0.0), _lotto("astalegale:1", "astalegale", prezzo=0.0)]
    assert len(_deduplica_cross_portale(items)) == 2


# ─── _enrich_images ───────────────────────────────────────────────────────────

def test_immagine_copiata_su_match_esatto():
    items = [
        _lotto("pvp:1", "pvp", immagine="http://x/1.jpg"),
        _lotto("astegiudiziarie:1", "astegiudiziarie"),
    ]
    _enrich_images(items)
    assert items[1]["immagine"] == "http://x/1.jpg"


def test_immagine_non_copiata_senza_data_o_prezzo():
    """Due lotti diversi nello stesso comune non devono scambiarsi la foto."""
    items = [
        _lotto("pvp:1", "pvp", prezzo=0.0, data=None, immagine="http://x/1.jpg"),
        _lotto("astalegale:1", "astalegale", prezzo=0.0, data=None),
    ]
    _enrich_images(items)
    assert items[1]["immagine"] is None


# ─── _scarta_date_implausibili ────────────────────────────────────────────────

def test_scarta_solo_le_date_oltre_orizzonte():
    dentro = (date.today() + timedelta(days=30)).isoformat()
    al_limite = (date.today() + timedelta(days=365 * ORIZZONTE_ANNI - 1)).isoformat()
    items = [
        _lotto("ok:1", "pvp", data=dentro),
        _lotto("ok:2", "pvp", data=al_limite),
        _lotto("ko:1", "astalegale", data="3019-07-03"),
        _lotto("ko:2", "astalegale", data="2202-04-21"),
    ]
    assert _ids(_scarta_date_implausibili(items)) == ["ok:1", "ok:2"]


def test_lotti_senza_data_sopravvivono():
    """Data non ancora fissata non e' una data implausibile."""
    items = [_lotto("a", "astalegale", data=None)]
    assert _ids(_scarta_date_implausibili(items)) == ["a"]


def test_immagine_copiata_per_indirizzo():
    items = [
        _lotto("pvp:1", "pvp", data="2026-09-17", indirizzo="Piazza Umberto I, 11",
               immagine="http://x/1.jpg"),
        _lotto("astalegale:1", "astalegale", data="2026-10-20", prezzo=50000.0,
               indirizzo="Piazza Umberto I, 11"),
    ]
    _enrich_images(items)
    assert items[1]["immagine"] == "http://x/1.jpg"


# ─── Deduplica per id PVP e fusione dei campi ─────────────────────────────────

def test_deduplica_esatta_per_id_pvp():
    """astalegale dichiara l'annuncio PVP d'origine: stesso lotto anche se il
    prezzo differisce (es. arrotondamenti) e la chiave euristica non scatta."""
    items = [
        _lotto("pvp:42", "pvp", prezzo=100000.0, id_pvp="42", stato_occupazione="Libero"),
        _lotto("astalegale:P42", "astalegale", prezzo=100000.5, id_pvp="42",
               immagine="http://x/42.jpg"),
    ]
    res = _deduplica_cross_portale(items)
    assert _ids(res) == ["astalegale:P42"]
    # Il lotto tenuto eredita i campi che solo il PVP espone
    assert res[0]["stato_occupazione"] == "Libero"


def test_fusione_tipo_specifico_su_generico():
    items = [
        _lotto("astegiudiziarie:1", "astegiudiziarie", tipo="Immobile"),
        _lotto("pvp:1", "pvp", tipo="Terreno", mq=5000),
    ]
    res = _deduplica_cross_portale(items)
    assert res[0]["id"] == "astegiudiziarie:1"
    assert res[0]["tipo"] == "Terreno"
    assert res[0]["mq"] == 5000


# ─── Fonte fallita ────────────────────────────────────────────────────────────

def test_fonte_fallita_conserva_i_lotti_precedenti():
    futura = (date.today() + timedelta(days=30)).isoformat()
    passata = (date.today() - timedelta(days=1)).isoformat()
    precedenti = [_lotto(f"pvp:{n}", "pvp", data=futura) for n in range(10)]
    precedenti.append(_lotto("pvp:vecchio", "pvp", data=passata))
    precedenti.append(_lotto("astalegale:1", "astalegale", data=futura))

    nuovi = [_lotto("pvp:0", "pvp", data=futura, prezzo=1.0)]
    res = _integra_fonte_fallita("pvp", nuovi, precedenti)
    assert len(res) == 10                      # 1 nuovo + 9 recuperati
    assert res[0]["prezzo"] == 1.0             # il nuovo vince sul vecchio
    assert "pvp:vecchio" not in _ids(res)      # le aste passate non si recuperano
    assert "astalegale:1" not in _ids(res)     # solo la fonte fallita


def test_fonte_sana_non_viene_toccata():
    precedenti = [_lotto(f"pvp:{n}", "pvp") for n in range(10)]
    nuovi = [_lotto(f"pvp:{n}", "pvp") for n in range(6)]
    assert _integra_fonte_fallita("pvp", nuovi, precedenti) is nuovi
