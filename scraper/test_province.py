"""Test di coerenza delle mappe provincia.

PROVINCE_NOMI e' scritta a mano: questi test la verificano contro
PROVINCE_REGIONI, che contiene sia le sigle sia i nomi completi.

Esecuzione: python -m pytest scraper/test_province.py
"""

from scraper.astegiudiziarie import PROVINCE_NOMI, PROVINCE_REGIONI

# Sigle osservate nei dati dei tre portali: la mappa deve coprirle tutte.
SIGLE_NEI_DATI = (
    "AG AL AN AO AP AQ AR AT AV BA BG BI BN BO BR BS BT BZ CA CB CE CH CI CL CN "
    "CO CR CS CT CZ EN FC FE FG FI FM FR GE GO GR KR LC LE LI LT LU MB MC ME MI "
    "MN MO MS NA NO NU OG OR OT PA PC PD PE PG PI PN PO PT PU PV PZ RA RC RE RG "
    "RI RM RN SA SI SO SP SR SS SV TA TE TN TO TP TR TS TV UD VA VB VC VE VR VS VT VV"
).split()


def test_ogni_sigla_e_una_sigla_valida():
    for sigla in PROVINCE_NOMI:
        assert len(sigla) == 2 and sigla.isupper(), sigla
        assert sigla in PROVINCE_REGIONI, f"{sigla} manca in PROVINCE_REGIONI"


def test_ogni_nome_e_noto():
    for sigla, nome in PROVINCE_NOMI.items():
        assert nome.upper() in PROVINCE_REGIONI, f"{nome} ({sigla}) manca in PROVINCE_REGIONI"


def test_sigla_e_nome_puntano_alla_stessa_regione():
    """Il controllo che smaschera un abbinamento sbagliato (es. PT -> Prato)."""
    for sigla, nome in PROVINCE_NOMI.items():
        assert PROVINCE_REGIONI[sigla] == PROVINCE_REGIONI[nome.upper()], (
            f"{sigla} -> {nome}: {PROVINCE_REGIONI[sigla]} != "
            f"{PROVINCE_REGIONI[nome.upper()]}"
        )


def test_nomi_senza_duplicati():
    nomi = list(PROVINCE_NOMI.values())
    assert len(nomi) == len(set(nomi)), "due sigle mappano sullo stesso nome"


def test_copre_tutte_le_sigle_viste_nei_dati():
    mancanti = [s for s in SIGLE_NEI_DATI if s not in PROVINCE_NOMI]
    assert not mancanti, f"sigle non mappate: {mancanti}"
