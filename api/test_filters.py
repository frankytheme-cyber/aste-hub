"""Test per filtri, ricerca e facets dell'API.

Esecuzione: python -m pytest api/test_filters.py
"""

import pytest
from fastapi.testclient import TestClient

from api import main as api_main
from api.main import _apply_filters, _norm, _split_csv, app


ITEMS = [
    {
        "id": "pvp:1", "titolo": "Appartamento in via Roma", "comune": "Milano",
        "regione": "Lombardia", "provincia": "Milano", "prezzo": 100000.0,
        "data_asta": "2099-01-10", "tipo": "Appartamento", "offerta_minima": 75000.0,
        "tribunale": "Tribunale di Milano", "fonte": "pvp",
    },
    {
        "id": "astegiudiziarie:2", "titolo": "Villa con giardino", "comune": "Verona",
        "regione": "Veneto", "provincia": "Verona", "prezzo": 250000.0,
        "data_asta": "2099-02-01", "tipo": "Villa / Casa indipendente",
        "offerta_minima": 190000.0, "tribunale": "Tribunale di Verona",
        "fonte": "astegiudiziarie",
    },
    {
        # tipo generico ma titolo riconoscibile da _is_immobile; nessuna data
        "id": "astalegale:3", "titolo": "Immobile residenziale in via Marsala",
        "comune": "Cefalù", "regione": "Sicilia", "provincia": "Palermo",
        "prezzo": 50000.0, "data_asta": None, "tipo": "Immobile",
        "offerta_minima": None, "tribunale": "Tribunale di Termini Imerese",
        "fonte": "astalegale",
    },
    {
        # asta gia' svolta: nascosta di default
        "id": "pvp:4", "titolo": "Appartamento in centro", "comune": "Milano",
        "regione": "Lombardia", "provincia": "Milano", "prezzo": 80000.0,
        "data_asta": "2020-01-01", "tipo": "Appartamento",
        "offerta_minima": 60000.0, "tribunale": "Tribunale di Milano", "fonte": "pvp",
    },
]


def _ids(items):
    return {i["id"] for i in items}


def _filtra(**kw):
    args = dict(regione=None, tipo=None, prezzo_min=None, prezzo_max=None,
                data_fine=None, q=None)
    args.update(kw)
    return _apply_filters(ITEMS, args.pop("regione"), args.pop("tipo"),
                          args.pop("prezzo_min"), args.pop("prezzo_max"),
                          args.pop("data_fine"), args.pop("q"), **args)


# ─── Helper di normalizzazione ────────────────────────────────────────────────

def test_norm_accenti():
    assert _norm("Perùgia") == "perugia"
    assert _norm("CEFALÙ") == "cefalu"
    assert _norm(None) == ""
    assert _norm("") == ""


def test_split_csv():
    assert _split_csv("Lombardia,Veneto") == ["lombardia", "veneto"]
    assert _split_csv("Lombardia") == ["lombardia"]
    assert _split_csv("") is None
    assert _split_csv(None) is None
    assert _split_csv(" , ") is None


# ─── _apply_filters ───────────────────────────────────────────────────────────

def test_nasconde_aste_passate_di_default():
    assert _ids(_filtra()) == {"pvp:1", "astegiudiziarie:2", "astalegale:3"}


def test_includi_passate():
    assert "pvp:4" in _ids(_filtra(includi_passate=True))


def test_regione_multi_valore():
    assert _ids(_filtra(regione="lombardia,veneto")) == {"pvp:1", "astegiudiziarie:2"}


def test_regione_sentinella_tutte():
    assert len(_filtra(regione="Tutte le regioni")) == 3


def test_tipo_multi_valore():
    res = _filtra(tipo="Appartamento,Immobile")
    assert _ids(res) == {"pvp:1", "astalegale:3"}


def test_fonte():
    assert _ids(_filtra(fonte="pvp")) == {"pvp:1"}
    assert _ids(_filtra(fonte="pvp,astalegale")) == {"pvp:1", "astalegale:3"}


def test_provincia_e_comune_accent_insensitive():
    assert _ids(_filtra(provincia="milano")) == {"pvp:1"}
    assert _ids(_filtra(comune="cefalu")) == {"astalegale:3"}
    assert _ids(_filtra(comune="Cefalù")) == {"astalegale:3"}


def test_provincia_accetta_anche_la_sigla():
    """I dati usano il nome completo, ma i link vecchi passano la sigla."""
    assert _ids(_filtra(provincia="MI")) == {"pvp:1"}
    assert _ids(_filtra(provincia="mi")) == {"pvp:1"}
    assert _ids(_filtra(provincia="PA")) == {"astalegale:3"}


def test_tribunale():
    assert _ids(_filtra(tribunale="tribunale di milano")) == {"pvp:1"}


def test_data_inizio_esclude_senza_data():
    # a3 non ha data_asta: con data_inizio deve sparire
    assert _ids(_filtra(data_inizio="2099-01-15")) == {"astegiudiziarie:2"}


def test_data_fine_mantiene_senza_data():
    assert _ids(_filtra(data_fine="2099-01-15")) == {"pvp:1", "astalegale:3"}


def test_ricerca_multi_token_and():
    # token su campi diversi (comune + titolo) devono matchare in AND
    assert _ids(_filtra(q="milano appartamento")) == {"pvp:1"}
    assert _filtra(q="milano villa") == []


def test_ricerca_accent_folding():
    assert _ids(_filtra(q="cefalu")) == {"astalegale:3"}
    assert _ids(_filtra(q="cefalù")) == {"astalegale:3"}


# ─── Endpoint (TestClient) ────────────────────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(api_main, "load_from_disk",
                        lambda: {"items": ITEMS, "updated_at": "2099-01-01T00:00:00"})
    monkeypatch.setattr(api_main, "_load_overrides", lambda: {})
    # Niente `with`: si evita il lifespan (che avvierebbe lo scraping in background)
    return TestClient(app)


def test_sort_non_valido_400(client):
    r = client.get("/api/immobili", params={"sort": "bogus"})
    assert r.status_code == 400


def test_sort_offerta_minima_desc(client):
    r = client.get("/api/immobili", params={"sort": "-offerta_minima"})
    assert r.status_code == 200
    offerte = [i["offerta_minima"] for i in r.json()["items"]]
    assert offerte[:2] == [190000.0, 75000.0]
    assert offerte[-1] is None  # i None in coda


def test_immobili_regione_multi(client):
    r = client.get("/api/immobili", params={"regione": "lombardia,veneto"})
    assert r.status_code == 200
    assert r.json()["total"] == 2


def test_facets_globali(client):
    r = client.get("/api/facets")
    assert r.status_code == 200
    d = r.json()
    assert {f["value"] for f in d["fonti"]} == {"pvp", "astegiudiziarie", "astalegale"}
    assert d["comuni"] == []  # senza regione/provincia niente comuni
    assert all({"value", "count"} <= set(f) for f in d["regioni"])


def test_facets_scoped(client):
    r = client.get("/api/facets", params={"regione": "Sicilia"})
    d = r.json()
    assert {f["value"] for f in d["province"]} == {"Palermo"}
    assert {f["value"] for f in d["comuni"]} == {"Cefalù"}
    # le regioni restano globali
    assert len(d["regioni"]) == 3
