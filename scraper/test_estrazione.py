"""Test per l'estrazione di dati dal testo e il parsing dei campi dei portali.

Esecuzione: python -m pytest scraper/test_estrazione.py
"""

import pytest

from scraper.astalegale import AstalegaleSpA
from scraper.astegiudiziarie import AsteGiudiziarieSpA, _partecipabile, classifica_tipo_da
from scraper.base import analizza_diritti, estrai_mq, parse_numero
from scraper.pvp import PVPScraper, _stato_occupazione


# ─── parse_numero / _safe_float ───────────────────────────────────────────────

@pytest.mark.parametrize("testo,atteso", [
    ("1.234,56", 1234.56),
    ("143.055,00", 143055.0),
    ("1250.5", 1250.5),      # punto decimale: prima diventava 12505
    ("1.250", 1250.0),       # punto delle migliaia
    ("85", 85.0),
    ("", None),
    ("-", None),
])
def test_parse_numero(testo, atteso):
    assert parse_numero(testo) == atteso


def test_safe_float_prezzo_in_euro():
    assert AstalegaleSpA()._safe_float("€ 107.291,25") == 107291.25


# ─── estrai_mq ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("testo,atteso", [
    ("Appartamento della superficie commerciale di mq. 110,00 al piano primo", 110),
    ("Abitazione al piano secondo della superficie di mq. 31,38.", 31),
    ("Garage al piano seminterrato di 23 metri quadri.", 23),
    ("terreno agricolo della superficie commerciale di 14.635,00 mq", 14635),
    ("immobile residenziale di ca mq 95,00 posto al piano quinto", 95),
    ("Appartamento foglio 12 particella 345 sub 3", None),
    ("", None),
])
def test_estrai_mq(testo, atteso):
    assert estrai_mq(testo) == atteso


# ─── analizza_diritti ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("testo,atteso", [
    ("Diritti pari ad 1/7 di piena proprietà su appartamento", "Quota 1/7"),
    ("Piena proprietà per la quota di 500/1000 di appartamento", "Quota 500/1000"),
    ("1/2 piena proprietà abitazione 2 piano", "Quota 1/2"),
    ("nuda proprietà per la quota di 1/1 di abitazione in villino", "Nuda proprietà"),
    ("DIRITTO DI SUPERFICIE di fabbricato civile", "Diritto di superficie"),
    ("Diritto di usufrutto relativo a fabbricato unifamiliare", "Usufrutto"),
    # Quote intere e civici non sono diritti parziali
    ("Piena proprietà per la quota di 1000/1000 di appartamento", None),
    ("Quota pari a 1/1 del diritto di proprietà su box", None),
    ("Appartamento in Via Roma 1/3, libero da usufrutto", None),
])
def test_analizza_diritti(testo, atteso):
    assert analizza_diritti(testo) == atteso


# ─── Classificazione tipo ─────────────────────────────────────────────────────

def test_campo_generico_cede_al_titolo():
    """"IMMOBILI-ALTRA CATEGORIA" non dice nulla: deve decidere il titolo."""
    assert classifica_tipo_da("IMMOBILI-ALTRA CATEGORIA",
                              "Terreni edificabili urbanizzati.") == "Terreno"
    assert classifica_tipo_da("IMMOBILI", "Deposito al piano terra") == "Magazzino"


def test_villini_non_sono_appartamenti():
    assert classifica_tipo_da("ABITAZIONE IN VILLINI") == "Villa / Casa indipendente"
    assert classifica_tipo_da("ABITAZIONE DI TIPO CIVILE") == "Appartamento"


def test_toponimo_casale_non_e_una_villa():
    assert classifica_tipo_da("Appartamento in Casale Monferrato") == "Appartamento"


def test_tutto_generico_resta_immobile():
    assert classifica_tipo_da("IMMOBILI", "", None) == "Immobile"


# ─── astegiudiziarie ──────────────────────────────────────────────────────────

def _lotto_ag(**extra):
    base = {
        "idLotto": 1, "prezzoBase": 30000.0, "comune": "Giulianova", "provincia": "TE",
        "categoria": "ABITAZIONE IN VILLINI", "tipologia": "IMMOBILI-IMMOBILE RESIDENZIALE",
        "descrizione": "diritti pari ad 1/3 di villino della superficie di mq 140",
        "dataUdienza": "2099-12-10T10:00:00", "venditaTelematica": True,
        "semaforo": {"descrizione": "PARTECIPABILE"},
    }
    base.update(extra)
    return base


def test_astegiudiziarie_parse_campi_nuovi():
    imm = AsteGiudiziarieSpA()._parse_item(_lotto_ag())
    assert imm.tipo == "Villa / Casa indipendente"
    assert imm.diritto == "Quota 1/3"
    assert imm.mq == 140
    assert imm.modalita_partecipazione == "Telematica"
    assert imm.provincia == "Teramo"


def test_astegiudiziarie_non_partecipabili_scartati():
    assert _partecipabile(_lotto_ag())
    assert not _partecipabile(_lotto_ag(semaforo={"descrizione": "NON PIU PARTECIPABILE"}))
    assert _partecipabile(_lotto_ag(semaforo=None))  # dato assente: non si scarta


# ─── PVP ──────────────────────────────────────────────────────────────────────

def test_stato_occupazione_vince_il_peggiore():
    assert _stato_occupazione(["LIBER", "LIBER"]) == "Libero"
    assert _stato_occupazione(["LIBER", "OCCUP"]) == "Occupato"
    assert _stato_occupazione(["NON_SPECIFICATA"]) is None
    assert _stato_occupazione(None) is None


def test_pvp_categoria_bene_e_disponibilita():
    item = {
        "id": 1797368, "categoriaLotto": "IMMOBILE_RESIDENZIALE",
        "categoriaBene": ["ABITAZIONE_IN_VILLINI"], "tipoLotto": "IMMOBILI",
        "indirizzo": {"via": "VIA VENERO 266", "citta": "Monreale", "provincia": "Palermo",
                      "coordinate": {"latitudine": 38.07, "longitudine": 13.28}},
        "prezzoBaseAsta": 114750.0, "dataVendita": "2099-01-19", "disponibilita": ["OCCUP"],
        "descLotto": "Villino sito in Monreale di mq 120",
    }
    imm = PVPScraper()._parse_item(item)
    assert imm.tipo == "Villa / Casa indipendente"
    assert imm.stato_occupazione == "Occupato"
    assert (imm.lat, imm.lng) == (38.07, 13.28)
    assert imm.id_pvp == "1797368"
    assert imm.mq == 120


# ─── astalegale ───────────────────────────────────────────────────────────────

def test_astalegale_id_pvp_e_modalita():
    item = {
        "id": "P4647217", "comune": "Manciano", "provincia": "Grosseto",
        "dataAsta": "12/01/2099 - 10:30", "prezzoNum": 143055, "offertaMinima": "€ 107.291,25",
        "tipologia": "Abitazione di tipo civile", "titolo": "Poggio Murella",
        "descrizione": "Abitazione di mq 90", "modalitaVendita": "Asincrona",
        "posizione": {"lat": 42.67, "lng": 11.55}, "source": "PVP",
        "externalDetailUrl": "https://pvp.giustizia.it/pvp/it/detail_annuncio.page?idAnnuncio=4647217",
    }
    imm = AstalegaleSpA()._parse_item(item, None, None, None)
    assert imm.id_pvp == "4647217"
    assert imm.tipo_vendita == "Senza incanto"
    assert imm.offerta_minima == 107291.25
    assert imm.mq == 90
    assert imm.lat == 42.67
