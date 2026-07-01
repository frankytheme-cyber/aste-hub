import { describe, it, expect } from "vitest";
import {
  calcolaImposteRegistro,
  calcolaCompensoDelegato,
  calcolaCancellazioni,
  calcolaRistrutturazione,
  calcolaDetrazioneIrpef,
  calcolaAffitto,
  stimaImuAnnua,
  calcolaBusinessPlan,
  calcolaRataMutuo,
  quotaInteressiMutuo,
} from "./businessPlan.js";

describe("calcolaImposteRegistro", () => {
  it("prima casa: scatta al minimo di legge €1.000 quando 2% < 1000", () => {
    // rendita 383,22 → valoreCatastale 383,22 × 115,5 = 44.261,91 → 2% = 885,24 < 1000
    const r = calcolaImposteRegistro({ profiloFiscale: "prima_casa", renditaCatastale: 383.22 });
    expect(r.valoreCatastale).toBeCloseTo(44261.91, 2);
    expect(r.impostaRegistro).toBe(1000);
    expect(r.totale).toBe(1100); // 1000 + 50 + 50
  });

  it("prima casa: 2% sopra il minimo", () => {
    // rendita 1000 → valoreCatastale 115.500 → 2% = 2.310
    const r = calcolaImposteRegistro({ profiloFiscale: "prima_casa", renditaCatastale: 1000 });
    expect(r.valoreCatastale).toBe(115500); // verifica NESSUN doppio ×1,05
    expect(r.impostaRegistro).toBe(2310);
    expect(r.totale).toBe(2410);
  });

  it("seconda casa: 9% sul valore catastale con coeff 126", () => {
    const r = calcolaImposteRegistro({ profiloFiscale: "seconda_casa", renditaCatastale: 1000 });
    expect(r.valoreCatastale).toBe(126000);
    expect(r.impostaRegistro).toBe(11340); // 126000 × 9%
    expect(r.totale).toBe(11440); // + 50 + 50
  });

  it("società: registro 9% su prezzo pieno + ipo/cat €200 cad", () => {
    const r = calcolaImposteRegistro({ profiloFiscale: "societa", prezzoAggiudicazione: 100000 });
    expect(r.regime).toBe("registro");
    expect(r.impostaRegistro).toBe(9000);
    expect(r.totale).toBe(9400); // 9000 + 200 + 200
  });

  it("società: IVA 10% → registro/ipo/cat in misura fissa €200", () => {
    const r = calcolaImposteRegistro({ profiloFiscale: "societa", prezzoAggiudicazione: 100000, ivaSocieta: 0.10 });
    expect(r.regime).toBe("iva");
    expect(r.iva).toBe(10000);
    expect(r.totale).toBe(10600); // 10000 + 200 + 200 + 200
  });

  it("società: IVA 22%", () => {
    const r = calcolaImposteRegistro({ profiloFiscale: "societa", prezzoAggiudicazione: 100000, ivaSocieta: 0.22 });
    expect(r.iva).toBe(22000);
    expect(r.totale).toBe(22600);
  });
});

describe("calcolaCompensoDelegato", () => {
  it("≤50k → forfait €2.500 + IVA", () => {
    const r = calcolaCompensoDelegato(50000);
    expect(r.imponibile).toBe(2500);
    expect(r.iva).toBe(550);
    expect(r.totale).toBe(3050);
  });

  it("appena sopra 50k → 2500 + 5% sull'eccedenza", () => {
    const r = calcolaCompensoDelegato(50001);
    expect(r.imponibile).toBeCloseTo(2500.05, 2); // 2500 + 5% × 1
  });

  it("100k → 2500 + 5% × 50k = 5000", () => {
    const r = calcolaCompensoDelegato(100000);
    expect(r.imponibile).toBe(5000);
    expect(r.totale).toBe(6100); // 5000 × 1,22
  });

  it("250k → 5000 + 4% × 150k = 11000", () => {
    const r = calcolaCompensoDelegato(250000);
    expect(r.imponibile).toBe(11000);
  });

  it("500k → 11000 + 3% × 250k = 18500", () => {
    const r = calcolaCompensoDelegato(500000);
    expect(r.imponibile).toBe(18500);
  });

  it("1M → 18500 + 2,5% × 500k = 31000", () => {
    const r = calcolaCompensoDelegato(1000000);
    expect(r.imponibile).toBe(31000);
  });

  it("oltre 1M → clamp all'ultimo scaglione (uguale a 1M)", () => {
    const r = calcolaCompensoDelegato(2000000);
    expect(r.imponibile).toBe(31000);
  });
});

describe("calcolaCancellazioni", () => {
  it("singola trascrizione = €294", () => {
    expect(calcolaCancellazioni([{ tipo: "trascrizione" }], 100000).totale).toBe(294);
  });

  it("iscrizione volontaria (mutuo) = €35", () => {
    expect(calcolaCancellazioni([{ tipo: "iscrizione_volontaria" }], 100000).totale).toBe(35);
  });

  it("iscrizione legale sotto soglia → floor €294", () => {
    // 0,5% di 10.000 = 50 < 294
    expect(calcolaCancellazioni([{ tipo: "iscrizione_legale", valoreCredito: 10000 }], 100000).totale).toBe(294);
  });

  it("iscrizione legale: 0,5% sopra soglia", () => {
    // 0,5% di 100.000 = 500
    expect(calcolaCancellazioni([{ tipo: "iscrizione_legale", valoreCredito: 100000 }], 200000).totale).toBe(500);
  });

  it("iscrizione legale: base limitata all'aggiudicazione se credito maggiore", () => {
    // credito 500k ma aggiudicazione 100k → base 100k → 0,5% = 500
    expect(calcolaCancellazioni([{ tipo: "iscrizione_legale", valoreCredito: 500000 }], 100000).totale).toBe(500);
  });

  it("array misto somma i costi", () => {
    const r = calcolaCancellazioni([{ tipo: "trascrizione" }, { tipo: "iscrizione_volontaria" }], 100000);
    expect(r.totale).toBe(329); // 294 + 35
  });

  it("nessuna formalità = 0", () => {
    expect(calcolaCancellazioni([], 100000).totale).toBe(0);
  });
});

describe("calcolaRistrutturazione", () => {
  it("strategia leggera: 100 mq × 350", () => {
    expect(calcolaRistrutturazione({ superficieMq: 100, strategiaRistrutturazione: "leggera" }).totale).toBe(35000);
  });

  it("override €/mq batte il rate di default", () => {
    const r = calcolaRistrutturazione({ superficieMq: 100, strategiaRistrutturazione: "leggera", costoRistrutturazioneMqOverride: 500 });
    expect(r.rate).toBe(500);
    expect(r.totale).toBe(50000);
  });

  it("refresh: rate base + costi fisici extra", () => {
    const r = calcolaRistrutturazione({ superficieMq: 100, strategiaRistrutturazione: "refresh", costiFisiciExtra: 5000 });
    expect(r.costoMq).toBe(4500); // 100 × 45
    expect(r.totale).toBe(9500);
  });
});

describe("calcolaDetrazioneIrpef", () => {
  it("prima casa 50% sotto il cap, default 1 quota recuperabile", () => {
    const r = calcolaDetrazioneIrpef({ profiloFiscale: "prima_casa" }, 50000);
    expect(r.totale).toBe(25000);
    expect(r.quotaAnnua).toBe(2500);
    expect(r.recuperabile).toBe(2500); // 1 quota
  });

  it("seconda casa 36%, costo sopra cap → base limitata a €96.000", () => {
    const r = calcolaDetrazioneIrpef({ profiloFiscale: "seconda_casa" }, 150000);
    expect(r.baseAmmessa).toBe(96000);
    expect(r.totale).toBe(34560); // 96000 × 36%
  });

  it("tutte le 10 quote recuperabili", () => {
    const r = calcolaDetrazioneIrpef({ profiloFiscale: "prima_casa", quoteDetrazioneRecuperabili: 10 }, 50000);
    expect(r.recuperabile).toBe(25000);
  });

  it("società → nessuna detrazione", () => {
    const r = calcolaDetrazioneIrpef({ profiloFiscale: "societa" }, 50000);
    expect(r.applicabile).toBe(false);
    expect(r.totale).toBe(0);
  });
});

describe("stimaImuAnnua", () => {
  it("stima IMU su base catastale (rendita ×1,05 ×160 × aliquota)", () => {
    // 484,03 × 1,05 × 160 × 0,0106 ≈ 861,96
    expect(stimaImuAnnua(484.03)).toBeCloseTo(861.96, 1);
  });
  it("rendita assente → 0", () => {
    expect(stimaImuAnnua("")).toBe(0);
  });
});

describe("calcolaAffitto", () => {
  const base = { canoneAnnuo: 12000, regimeAffitto: "cedolare21", imuAnnua: 800, spesePctAnnue: 5 };
  it("netto annuo = canone − cedolare 21% − IMU − spese 5%", () => {
    const r = calcolaAffitto(base, 150000, 150000);
    // 12000 − 2520 − 800 − 600 = 8080
    expect(r.imposta).toBe(2520);
    expect(r.spese).toBe(600);
    expect(r.nettoAnnuo).toBe(8080);
  });
  it("incasso netto su 5 anni e rendite", () => {
    const r = calcolaAffitto(base, 150000, 150000);
    expect(r.anni).toBe(5);
    expect(r.incassoNetto).toBe(40400); // 8080 × 5
    expect(r.renditaLordaPct).toBeCloseTo(0.08, 3); // 12000/150000
    expect(r.renditaNettaPct).toBeCloseTo(0.0539, 3); // 8080/150000
    expect(r.roiPeriodo).toBeCloseTo(0.2693, 3); // 40400/150000
  });
  it("regime cedolare 10% e lordo", () => {
    expect(calcolaAffitto({ ...base, regimeAffitto: "cedolare10" }, 150000, 150000).imposta).toBe(1200);
    expect(calcolaAffitto({ ...base, regimeAffitto: "lordo" }, 150000, 150000).imposta).toBe(0);
  });
  it("ROE su equity quando c'è leva", () => {
    const r = calcolaAffitto(base, 150000, 75000);
    expect(r.roePeriodo).toBeCloseTo(0.5387, 3); // 40400/75000
  });
  it("spesa fissa annua (condominio) sottratta dal netto", () => {
    const r = calcolaAffitto({ ...base, speseFisseAnnue: 1200 }, 150000, 150000);
    // 12000 − 2520 − 800 − 600 − 1200 = 6880
    expect(r.speseFisse).toBe(1200);
    expect(r.nettoAnnuo).toBe(6880);
    expect(r.incassoNetto).toBe(34400); // 6880 × 5
  });
});

describe("calcolaBusinessPlan — modalità affitto", () => {
  it("include il blocco affitto e segnala la modalità", () => {
    const r = calcolaBusinessPlan({
      prezzoAggiudicazione: 100000, profiloFiscale: "seconda_casa",
      strategiaRistrutturazione: "refresh", ltvPercent: 0,
      modalitaUscita: "affitto", canoneAnnuo: 9000, regimeAffitto: "cedolare21", imuAnnua: 700, spesePctAnnue: 5,
    });
    expect(r.modalitaUscita).toBe("affitto");
    expect(r.affitto.anni).toBe(5);
    expect(r.affitto.nettoAnnuo).toBe(9000 - 1890 - 700 - 450); // 5960
    expect(r.affitto.incassoNetto).toBe(29800);
  });
  it("default rivendita quando modalità non specificata", () => {
    const r = calcolaBusinessPlan({ prezzoAggiudicazione: 100000, profiloFiscale: "seconda_casa", strategiaRistrutturazione: "refresh" });
    expect(r.modalitaUscita).toBe("rivendita");
  });

  it("affitto + vendita: ritorno totale = incasso affitto + margine rivendita", () => {
    const r = calcolaBusinessPlan({
      prezzoAggiudicazione: 100000, prezzoRivendita: 180000, profiloFiscale: "societa",
      strategiaRistrutturazione: "refresh", ltvPercent: 0,
      modalitaUscita: "affitto_vendita", canoneAnnuo: 9000, regimeAffitto: "lordo", imuAnnua: 0, spesePctAnnue: 0,
    });
    expect(r.modalitaUscita).toBe("affitto_vendita");
    // affitto lordo: netto annuo 9000 → incasso 5 anni 45000 (società → nessuna detrazione)
    expect(r.affitto.incassoNetto).toBe(45000);
    expect(r.affittoVendita.incassoAffitto).toBe(45000);
    expect(r.affittoVendita.margineVendita).toBe(r.kpi.margineNettoNominale);
    expect(r.affittoVendita.ritornoTotale).toBe(round2(45000 + r.kpi.margineNettoNominale));
    expect(r.affittoVendita.roi).toBeCloseTo(r.affittoVendita.ritornoTotale / r.kpi.costoTotaleInvestimento, 6);
  });
});

describe("calcolaBusinessPlan — integrazione e KPI", () => {
  const base = {
    prezzoAggiudicazione: 95000,
    prezzoRivendita: 180000,
    superficieMq: 114,
    renditaCatastale: 383.22,
    profiloFiscale: "prima_casa",
    strategiaRistrutturazione: "leggera",
    ltvPercent: 0,
    formalita: [{ tipo: "trascrizione" }],
    notaio: 2000,
    quoteDetrazioneRecuperabili: 1,
  };

  it("compone il costo totale dai sotto-blocchi", () => {
    const r = calcolaBusinessPlan(base);
    const atteso = round2(
      95000 + r.imposte.totale + r.delegato.totale + 2000 + r.cancellazioni.totale + r.ristrutturazione.totale
    );
    expect(r.kpi.costoTotaleInvestimento).toBe(atteso);
  });

  it("le spese mobilia aumentano il costo totale dell'investimento", () => {
    const senza = calcolaBusinessPlan(base);
    const con = calcolaBusinessPlan({ ...base, speseMobilia: 8000 });
    expect(con.kpi.costoTotaleInvestimento).toBe(round2(senza.kpi.costoTotaleInvestimento + 8000));
    expect(con.kpi.margineNettoNominale).toBe(round2(senza.kpi.margineNettoNominale - 8000));
  });

  it("margine reale = nominale + detrazione recuperabile", () => {
    const r = calcolaBusinessPlan(base);
    expect(r.kpi.margineReale).toBe(round2(r.kpi.margineNettoNominale + r.detrazione.recuperabile));
    expect(r.kpi.roiReale).toBeGreaterThan(r.kpi.roiNominale);
  });

  it("senza leva: equity = costo totale, ROE = ROI nominale", () => {
    const r = calcolaBusinessPlan({ ...base, ltvPercent: 0 });
    expect(r.kpi.mutuo).toBe(0);
    expect(r.kpi.equity).toBe(r.kpi.costoTotaleInvestimento);
    expect(r.kpi.roe).toBe(r.kpi.roiNominale);
  });

  it("con leva 80%: mutuo sul prezzo di aggiudicazione, ROE > ROI", () => {
    const r = calcolaBusinessPlan({ ...base, ltvPercent: 80 });
    expect(r.kpi.mutuo).toBe(76000); // 95000 × 0,8
    expect(r.kpi.equity).toBe(round2(r.kpi.costoTotaleInvestimento - 76000));
    expect(r.kpi.roe).toBeGreaterThan(r.kpi.roiNominale);
  });

  it("LTV oltre 80 viene clampato a 80", () => {
    const r = calcolaBusinessPlan({ ...base, ltvPercent: 150 });
    expect(r.kpi.mutuo).toBe(76000);
  });

  it("input vuoto non produce NaN", () => {
    const r = calcolaBusinessPlan({});
    // Senza dati il ramo seconda casa applica il minimo di registro €1.000 → costo > 0.
    expect(Number.isNaN(r.kpi.costoTotaleInvestimento)).toBe(false);
    expect(Number.isNaN(r.kpi.margineNettoNominale)).toBe(false);
    expect(r.kpi.roiNominale).not.toBeNull();
    expect(Number.isFinite(r.kpi.roiNominale)).toBe(true);
  });

  it("guardia divisione per zero quando costo totale è 0", () => {
    // società senza prezzo: registro 9% di 0 = 0, ipo/cat 200+200=400 → costo 400, non 0.
    // Forziamo costo 0 con notaio negativo che azzera (caso limite difensivo).
    const r = calcolaBusinessPlan({ profiloFiscale: "societa", prezzoAggiudicazione: 0, notaio: -400 });
    expect(r.kpi.costoTotaleInvestimento).toBe(0);
    expect(r.kpi.roiNominale).toBeNull();
    expect(r.kpi.roe).toBeNull();
  });

  it("margine negativo (perdita) produce ROI negativo", () => {
    const r = calcolaBusinessPlan({ ...base, prezzoRivendita: 50000 });
    expect(r.kpi.margineNettoNominale).toBeLessThan(0);
    expect(r.kpi.roiNominale).toBeLessThan(0);
  });

  it("le spese di agenzia aumentano il costo totale dell'investimento", () => {
    const senza = calcolaBusinessPlan(base);
    const con = calcolaBusinessPlan({ ...base, speseAgenzia: 5000 });
    expect(con.kpi.costoTotaleInvestimento).toBe(round2(senza.kpi.costoTotaleInvestimento + 5000));
    expect(con.kpi.margineNettoNominale).toBe(round2(senza.kpi.margineNettoNominale - 5000));
  });

  it("ritorno annuo: default 12 mesi = ritorno nominale", () => {
    const r = calcolaBusinessPlan(base);
    expect(r.kpi.durataMesi).toBe(12);
    expect(r.kpi.margineAnnuo).toBe(r.kpi.margineNettoNominale);
    expect(r.kpi.roiAnnuo).toBe(r.kpi.roiNominale);
  });

  it("ritorno annuo: durata 6 mesi raddoppia il ritorno annualizzato", () => {
    const r = calcolaBusinessPlan({ ...base, durataMesi: 6 });
    expect(r.kpi.margineAnnuo).toBe(round2(r.kpi.margineNettoNominale * 2));
    expect(r.kpi.roiAnnuo).toBe(round2(r.kpi.roiNominale * 2));
  });

  it("ritorno annuo: durata 24 mesi dimezza il ritorno annualizzato", () => {
    const r = calcolaBusinessPlan({ ...base, durataMesi: 24 });
    expect(r.kpi.margineAnnuo).toBe(round2(r.kpi.margineNettoNominale / 2));
    expect(r.kpi.roiAnnuo).toBe(round2(r.kpi.roiNominale / 2));
  });

  it("ritorno annuo: durata non valida (0) ricade su minimo 1 mese", () => {
    const r = calcolaBusinessPlan({ ...base, durataMesi: 0 });
    expect(r.kpi.durataMesi).toBe(1);
    expect(r.kpi.margineAnnuo).toBe(round2(r.kpi.margineNettoNominale * 12));
  });

  it("affitto + vendita: ritorno annuo = ritorno totale ÷ anni", () => {
    const r = calcolaBusinessPlan({ ...base, modalitaUscita: "affitto_vendita", canoneAnnuo: 9000 });
    const av = r.affittoVendita;
    expect(av.ritornoAnnuo).toBe(round2(av.ritornoTotale / r.affitto.anni));
    expect(av.roiAnnuo).toBeCloseTo(av.roi / r.affitto.anni, 10);
  });
});

describe("calcolaRataMutuo / quotaInteressiMutuo", () => {
  it("rata alla francese: 100k a 3,5% per 25 anni ≈ 500,7 €/mese", () => {
    const p = calcolaRataMutuo(100000, 3.5, 25);
    expect(p.nRate).toBe(300);
    expect(p.rataMensile).toBeGreaterThan(500);
    expect(p.rataMensile).toBeLessThan(501);
  });

  it("capitale 0 → rata 0", () => {
    expect(calcolaRataMutuo(0, 3.5, 25).rataMensile).toBe(0);
  });

  it("ripartizione: interessi + capitale = rate pagate, debito residuo coerente", () => {
    const p = calcolaRataMutuo(100000, 4, 25);
    const q = quotaInteressiMutuo(100000, p.iMensile, p.rataMensile, p.nRate, 12);
    expect(q.interessi).toBeGreaterThan(0);
    expect(q.capitaleRimborsato).toBeGreaterThan(0);
    expect(round2(q.interessi + q.capitaleRimborsato)).toBe(round2(p.rataMensile * 12));
    expect(q.debitoResiduo).toBe(round2(100000 - q.capitaleRimborsato));
  });
});

describe("calcolaBusinessPlan — mutuo: ROI/ROE e affitto", () => {
  const base = {
    prezzoAggiudicazione: 95000,
    prezzoRivendita: 180000,
    superficieMq: 114,
    renditaCatastale: 383.22,
    profiloFiscale: "seconda_casa",
    strategiaRistrutturazione: "leggera",
    formalita: [{ tipo: "trascrizione" }],
    notaio: 2000,
  };

  it("ROI invariato col tasso; ROE peggiora per gli interessi (interessi solo nel ROE)", () => {
    const senzaInt = calcolaBusinessPlan({ ...base, ltvPercent: 80, tassoMutuo: 0 });
    const conInt = calcolaBusinessPlan({ ...base, ltvPercent: 80, tassoMutuo: 5 });
    expect(conInt.kpi.roiNominale).toBe(senzaInt.kpi.roiNominale); // ROI non-levered, invariato
    expect(conInt.kpi.interessiFlip).toBeGreaterThan(0);
    expect(senzaInt.kpi.interessiFlip).toBe(0);
    expect(conInt.kpi.roe).toBeLessThan(senzaInt.kpi.roe);          // ROE al netto interessi
    expect(conInt.kpi.margineLeva).toBe(round2(conInt.kpi.margineNettoNominale - conInt.kpi.interessiFlip));
  });

  it("senza leva: nessun interesse, rata 0, ROE = ROI (invariante preservata)", () => {
    const r = calcolaBusinessPlan({ ...base, ltvPercent: 0, tassoMutuo: 5 });
    expect(r.kpi.rataMensile).toBe(0);
    expect(r.kpi.interessiFlip).toBe(0);
    expect(r.kpi.roe).toBe(r.kpi.roiNominale);
  });

  it("affitto cash-on-cash: il netto annuo è ridotto dell'intera rata annua", () => {
    const senza = calcolaBusinessPlan({ ...base, modalitaUscita: "affitto", canoneAnnuo: 12000, ltvPercent: 0 });
    const con = calcolaBusinessPlan({ ...base, modalitaUscita: "affitto", canoneAnnuo: 12000, ltvPercent: 80, tassoMutuo: 4 });
    expect(con.kpi.rataAnnua).toBeGreaterThan(0);
    expect(con.affitto.rata).toBe(con.kpi.rataAnnua);
    expect(con.affitto.nettoAnnuo).toBe(round2(senza.affitto.nettoAnnuo - con.kpi.rataAnnua));
  });

  it("compensoDelegato manuale: sovrascrive gli scaglioni (IVA inclusa, con scorporo)", () => {
    const auto = calcolaBusinessPlan({ ...base });
    const manuale = calcolaBusinessPlan({ ...base, compensoDelegato: 6100 });
    expect(manuale.delegato.totale).toBe(6100);
    expect(round2(manuale.delegato.imponibile + manuale.delegato.iva)).toBe(6100);
    expect(manuale.delegato.totale).not.toBe(auto.delegato.totale);
    // stringa vuota → torna alla stima automatica dagli scaglioni
    const vuoto = calcolaBusinessPlan({ ...base, compensoDelegato: "" });
    expect(vuoto.delegato.totale).toBe(auto.delegato.totale);
  });

  it("senzaDelegato: esclude il compenso delegato dai costi (acquisto non all'asta)", () => {
    const conDelegato = calcolaBusinessPlan({ ...base });
    const senza = calcolaBusinessPlan({ ...base, senzaDelegato: true });
    expect(conDelegato.delegato.totale).toBeGreaterThan(0);
    expect(senza.delegato.totale).toBe(0);
    expect(senza.kpi.costoTotaleInvestimento).toBe(round2(conDelegato.kpi.costoTotaleInvestimento - conDelegato.delegato.totale));
  });

  it("affitto + vendita: il capitale si annulla, il ritorno scende solo degli interessi", () => {
    const noMutuo = calcolaBusinessPlan({ ...base, modalitaUscita: "affitto_vendita", canoneAnnuo: 12000, ltvPercent: 0 });
    const conMutuo = calcolaBusinessPlan({ ...base, modalitaUscita: "affitto_vendita", canoneAnnuo: 12000, ltvPercent: 80, tassoMutuo: 4 });
    expect(conMutuo.affittoVendita.interessiAffitto).toBeGreaterThan(0);
    expect(conMutuo.affittoVendita.ritornoTotale).toBeCloseTo(
      round2(noMutuo.affittoVendita.ritornoTotale - conMutuo.affittoVendita.interessiAffitto), 1
    );
  });
});

const round2 = (n) => Math.round(n * 100) / 100;
