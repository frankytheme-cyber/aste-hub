"""Test per l'assegnazione della zona OMI dalle coordinate.

Esecuzione: python -m pytest analisi/test_zone_omi.py
"""

import asyncio
import io
import zipfile

import pytest

import analisi.zone_omi as zo


def _placemark(codcom, codzona, poligoni):
    """poligoni: [(esterno, [buchi])], anelli come liste di (lng, lat)."""
    def coord(anello):
        return " ".join(f"{x},{y},0" for x, y in anello + anello[:1])
    geom = "".join(
        "<Polygon><outerBoundaryIs><LinearRing><coordinates>" + coord(est) +
        "</coordinates></LinearRing></outerBoundaryIs>" +
        "".join("<innerBoundaryIs><LinearRing><coordinates>" + coord(b) +
                "</coordinates></LinearRing></innerBoundaryIs>" for b in buchi) +
        "</Polygon>"
        for est, buchi in poligoni
    )
    return (f'<Placemark><ExtendedData><Data name="CODCOM"><value>{codcom}</value></Data>'
            f'<Data name="CODZONA"><value>{codzona}</value></Data></ExtendedData>'
            f"<MultiGeometry>{geom}</MultiGeometry></Placemark>")


QUADRATO = [(10.0, 40.0), (11.0, 40.0), (11.0, 41.0), (10.0, 41.0)]
BUCO = [(10.4, 40.4), (10.6, 40.4), (10.6, 40.6), (10.4, 40.6)]
ISOLA = [(12.0, 40.0), (12.5, 40.0), (12.5, 40.5), (12.0, 40.5)]

KML = ("<kml><Document>"
       + _placemark("A001", "B1", [(QUADRATO, [BUCO]), (ISOLA, [])])
       + _placemark("A001", "C2", [(BUCO, [])])
       + "</Document></kml>")


def test_punto_nella_zona_giusta():
    zone = zo.zone_da_kml(KML)
    assert zo.zona_del_punto(40.2, 10.2, zone) == "A001:B1"


def test_buco_appartiene_alla_zona_interna():
    """Le zone centrali sono spesso buchi della zona che le circonda."""
    zone = zo.zone_da_kml(KML)
    assert zo.zona_del_punto(40.5, 10.5, zone) == "A001:C2"


def test_secondo_poligono_della_stessa_zona():
    zone = zo.zone_da_kml(KML)
    assert zo.zona_del_punto(40.25, 12.25, zone) == "A001:B1"


def test_punto_fuori_da_tutte_le_zone():
    zone = zo.zone_da_kml(KML)
    assert zo.zona_del_punto(45.0, 9.0, zone) is None


@pytest.fixture
def kmz_locale(tmp_path, monkeypatch):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("Provincia di PROVA 2018-2.kml", "<kml/>")
        z.writestr("Comuni/Comune di PROVA 2018-2.kml", KML)
    percorso = tmp_path / "Provincia di PROVA 2018-2.kmz"
    percorso.write_bytes(buf.getvalue())

    async def finto_download(client):
        return [str(percorso)]

    monkeypatch.setattr(zo, "_scarica_kmz", finto_download)
    monkeypatch.setattr(zo, "ZONE_DIR", str(tmp_path))
    monkeypatch.setattr(zo, "CACHE_FILE", str(tmp_path / "assegnazioni.json"))
    return percorso


def test_assegna_zone_e_cache(kmz_locale, monkeypatch):
    items = [{"id": "a", "lat": 40.2, "lng": 10.2}, {"id": "b", "lat": 45.0, "lng": 9.0},
             {"id": "c", "lat": None, "lng": None}]
    assert asyncio.run(zo.assegna_zone(items)) == 1
    assert [i["zona_omi"] for i in items] == ["A001:B1", None, None]

    # Seconda passata: tutto dalla cache, nessun download.
    async def vietato(client):
        raise AssertionError("non deve riscaricare")
    monkeypatch.setattr(zo, "_scarica_kmz", vietato)
    items2 = [{"id": "a", "lat": 40.2, "lng": 10.2}, {"id": "b", "lat": 45.0, "lng": 9.0}]
    assert asyncio.run(zo.assegna_zone(items2)) == 1
