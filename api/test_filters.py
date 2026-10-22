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


# ─── Diritti, occupazione, valutazione ────────────────────────────────────────

def _con(id_, **campi):
    return {**next(i for i in ITEMS if i["id"] == id_), **campi}


def test_solo_piena_proprieta_e_solo_liberi():
    items = [_con("pvp:1", diritto="Quota 1/2"),
             _con("astegiudiziarie:2", stato_occupazione="Libero"),
             _con("astalegale:3", stato_occupazione="Occupato")]
    base = dict(regione=None, tipo=None, prezzo_min=None, prezzo_max=None,
                data_fine=None, q=None)
    assert _ids(_apply_filters(items, *base.values(), solo_piena_proprieta=True)) == \
        {"astegiudiziarie:2", "astalegale:3"}
    assert _ids(_apply_filters(items, *base.values(), solo_liberi=True)) == {"astegiudiziarie:2"}


def test_lista_include_la_valutazione(client):
    items = client.get("/api/immobili").json()["items"]
    assert all("valutazione" in i and "giudizio" in i["valutazione"] for i in items)


def test_sort_sconto_omi(client, monkeypatch):
    monkeypatch.setattr(api_main.omi, "quotazione_comunale",
                        lambda comune, tipo: {"medio_mq": 2000, "semestre": "2018-S2"})
    items = [_con("pvp:1", mq=100),                       # 1000 €/m² → sconto 50%
             _con("astegiudiziarie:2", mq=150, tipo="Appartamento"),  # 1667 €/m² → 17%
             _con("astalegale:3")]                         # senza mq → in coda
    monkeypatch.setattr(api_main, "load_from_disk",
                        lambda: {"items": items, "updated_at": "2099-01-01T00:00:00"})
    r = client.get("/api/immobili", params={"sort": "-sconto_omi"})
    assert r.status_code == 200
    assert [i["id"] for i in r.json()["items"]] == ["pvp:1", "astegiudiziarie:2", "astalegale:3"]


# ─── Scraping e sicurezza ─────────────────────────────────────────────────────

def test_scrape_ignora_i_filtri(client, monkeypatch):
    """Uno scraping filtrato sostituirebbe l'intero catalogo con un sottoinsieme."""
    chiamate = []

    async def finto_scrape(*args, **kwargs):
        chiamate.append((args, kwargs))

    monkeypatch.setattr(api_main, "_background_scrape", finto_scrape)
    r = client.post("/api/scrape", params={"regione": "Lombardia", "prezzo_max": 1000})
    assert r.status_code == 200
    assert chiamate == [((), {})]


def test_image_proxy_rifiuta_domini_esterni(client):
    for url in ("http://127.0.0.1:8000/api/status",
                "http://169.254.169.254/latest/meta-data/",
                "https://astegiudiziarie.it.evil.com/x.jpg"):
        r = client.get("/api/image-proxy", params={"url": url})
        assert r.status_code == 400, url


def test_analisi_cached_non_espone_il_testo_perizia(client, monkeypatch):
    import analisi.cache as cache_mod
    monkeypatch.setattr(cache_mod, "get_analisi",
                        lambda _id: {"immobile_id": "pvp:1", "testo_perizia": "x" * 1000})
    r = client.post("/api/immobili/pvp%3A1/analisi")
    assert r.status_code == 200
    assert "testo_perizia" not in r.json()
