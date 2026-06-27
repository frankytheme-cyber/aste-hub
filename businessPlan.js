/**
 * businessPlan.js — Core di calcolo del Business Plan di fattibilità per
 * operazioni di trading immobiliare (flipping) da aste giudiziarie.
 *
 * Modulo PURO: nessun side-effect, nessuna dipendenza da React o I/O. Tutti gli
 * importi sono in EUR. Le aliquote/coefficienti rispecchiano la legislazione
 * italiana su esecuzioni e trasferimenti immobiliari. Queste costanti sono la
 * sorgente canonica anche per `recomputeFinanze` in case-asta.jsx (che le importa
 * da qui per non divergere).
 */

// ─── Costanti fiscali: imposte di registro / prezzo-valore ───────────────────
// Coefficienti prezzo-valore (rendita catastale → valore catastale): la rendita
// è già rivalutata ×1,05 dentro il coefficiente, quindi NON va moltiplicata di
// nuovo per 1,05. ×1,05 ×100 ×110 = 115,5 (prima casa); ×1,05 ×100 ×120 = 126.
export const COEFF_PV_PRIMA_CASA = 115.5;
export const COEFF_PV_SECONDA_CASA = 126;
export const ALIQUOTA_PRIMA_CASA = 0.02;
export const ALIQUOTA_SECONDA_CASA = 0.09;
export const ALIQUOTA_SOCIETA_REGISTRO = 0.09;
export const IMPOSTA_REGISTRO_MINIMA = 1000; // solo sul registro proporzionale (PF)
export const ONERI_FISSI_TRASFERIMENTO = 1600; // usato dal modello legacy lato sidebar

// Imposte ipotecaria + catastale in misura fissa
export const IPOCAT_PRIVATO = 50;  // ciascuna (persona fisica, prima/seconda casa)
export const IPOCAT_SOCIETA = 200; // ciascuna (atti soggetti a registro/IVA proporzionale per impresa)

// ─── Detrazione IRPEF sulle ristrutturazioni ─────────────────────────────────
export const DETRAZIONE_PRIMA_CASA = 0.50;   // abitazione principale
export const DETRAZIONE_SECONDA_CASA = 0.36; // altri immobili
export const DETRAZIONE_CAP = 96000;         // tetto di spesa ammessa
export const DETRAZIONE_QUOTE = 10;          // quote annuali

// ─── Cancellazione formalità pregiudizievoli ─────────────────────────────────
export const CANCELLAZIONE_TRASCRIZIONE = 294;       // 200 ipotecaria + 59 bollo + 35 tassa
export const CANCELLAZIONE_ISCRIZIONE_VOLONTARIA = 35; // mutuo bancario (esente ex art. 15 DPR 601/1973)
export const CANCELLAZIONE_ALIQUOTA_LEGALE = 0.005;  // 0,5% per iscrizioni legali/giudiziali
export const CANCELLAZIONE_MIN_LEGALE = 294;         // minimo 200 + 59 + 35

// ─── Ristrutturazione €/mq per strategia (default; override possibile) ────────
export const RATE_RISTRUTTURAZIONE = {
  refresh: 45,    // ripristino minimo / refresh: range 40-50 → punto medio
  leggera: 350,   // rifacimento bagni e finiture superficiali
  completa: 675,  // rifacimento totale impianti e massetti: range 650-700 → punto medio
};

// ─── IVA ──────────────────────────────────────────────────────────────────────
export const IVA_DELEGATO = 0.22; // compenso del professionista delegato

// ─── Messa a rendita (affitto) ───────────────────────────────────────────────
export const CEDOLARE_SECCA = 0.21;        // cedolare secca regime ordinario
export const CEDOLARE_CONCORDATO = 0.10;   // cedolare secca canone concordato
export const ANNI_AFFITTO = 5;             // orizzonte di calcolo della messa a rendita
export const RIVALUTAZIONE_RENDITA = 1.05; // rivalutazione rendita catastale
export const COEFF_IMU_ABITATIVO = 160;    // moltiplicatore IMU fabbricati cat. A (escl. A/10)
export const ALIQUOTA_IMU_DEFAULT = 0.0106; // 10,6‰ aliquota ordinaria seconda casa

// ─── Helpers numerici ─────────────────────────────────────────────────────────
const round2 = (n) => Math.round(n * 100) / 100;
/** Converte v in numero finito; ritorna `d` (default 0) per null/NaN/stringhe vuote. */
export const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : d);

/**
 * @typedef {Object} FormalitaInput
 * @property {'trascrizione'|'iscrizione_volontaria'|'iscrizione_legale'} tipo
 * @property {number} [valoreCredito]  // rilevante solo per iscrizione_legale
 */

/**
 * @typedef {Object} BusinessPlanInput
 * @property {number} prezzoAggiudicazione
 * @property {number} prezzoRivendita
 * @property {number} superficieMq
 * @property {number} renditaCatastale
 * @property {'prima_casa'|'seconda_casa'|'societa'} profiloFiscale
 * @property {'refresh'|'leggera'|'completa'} strategiaRistrutturazione
 * @property {number} [costoRistrutturazioneMqOverride]  // €/mq; se >0 sostituisce il rate di default
 * @property {number} ltvPercent                         // mutuo d'asta 0-80 (% sul prezzo di aggiudicazione)
 * @property {FormalitaInput[]} [formalita]
 * @property {number} [costiFisiciExtra]                 // risoluzione problemi fisici (infiltrazioni, ecc.)
 * @property {number} [notaio]
 * @property {0.10|0.22|null} [ivaSocieta]               // regime IVA per società; null = registro 9%
 * @property {number} [quoteDetrazioneRecuperabili]      // quote annue effettivamente recuperabili (default 1)
 */

// ─── A) Imposte di registro (meccanismo del prezzo-valore) ───────────────────
export function calcolaImposteRegistro(input) {
  const { profiloFiscale, renditaCatastale, prezzoAggiudicazione, ivaSocieta } = input;
  const rendita = num(renditaCatastale);
  const aggiudicazione = num(prezzoAggiudicazione);

  if (profiloFiscale === "societa") {
    // Base = prezzo PIENO di aggiudicazione (no prezzo-valore per le imprese).
    if (ivaSocieta === 0.10 || ivaSocieta === 0.22) {
      const iva = round2(aggiudicazione * ivaSocieta);
      return {
        regime: "iva",
        baseImponibile: aggiudicazione,
        iva,
        impostaRegistro: 200, // registro in misura fissa quando c'è IVA
        ipotecaria: IPOCAT_SOCIETA,
        catastale: IPOCAT_SOCIETA,
        totale: round2(iva + 200 + IPOCAT_SOCIETA * 2),
      };
    }
    const registro = round2(aggiudicazione * ALIQUOTA_SOCIETA_REGISTRO);
    return {
      regime: "registro",
      baseImponibile: aggiudicazione,
      iva: 0,
      impostaRegistro: registro,
      ipotecaria: IPOCAT_SOCIETA,
      catastale: IPOCAT_SOCIETA,
      totale: round2(registro + IPOCAT_SOCIETA * 2),
    };
  }

  // Persona fisica: prezzo-valore sul valore catastale.
  const isPrima = profiloFiscale === "prima_casa";
  const coeff = isPrima ? COEFF_PV_PRIMA_CASA : COEFF_PV_SECONDA_CASA;
  const aliquota = isPrima ? ALIQUOTA_PRIMA_CASA : ALIQUOTA_SECONDA_CASA;
  const valoreCatastale = round2(rendita * coeff); // coeff include già ×1,05
  const registro = Math.max(round2(valoreCatastale * aliquota), IMPOSTA_REGISTRO_MINIMA);
  return {
    regime: "prezzo_valore",
    baseImponibile: valoreCatastale,
    valoreCatastale,
    iva: 0,
    impostaRegistro: registro,
    ipotecaria: IPOCAT_PRIVATO,
    catastale: IPOCAT_PRIVATO,
    totale: round2(registro + IPOCAT_PRIVATO * 2),
  };
}

// ─── B) Compenso del professionista delegato (scaglioni progressivi + IVA) ────
export function calcolaCompensoDelegato(prezzoAggiudicazione) {
  const p = num(prezzoAggiudicazione);
  if (p <= 0) return { imponibile: 0, iva: 0, totale: 0 }; // nessuna aggiudicazione → nessun compenso
  // Scaglioni cumulativi: ≤50k forfait €2.500; poi % sulla quota parte eccedente.
  const scaglioni = [
    { fino: 50000, fisso: 2500, aliquota: null },
    { fino: 100000, aliquota: 0.05 },
    { fino: 250000, aliquota: 0.04 },
    { fino: 500000, aliquota: 0.03 },
    { fino: 1000000, aliquota: 0.025 },
  ];
  let imponibile = 0;
  let precedente = 0;
  for (const s of scaglioni) {
    if (s.fisso != null) {
      imponibile += s.fisso; // copre lo scaglione fino a 50k
    } else if (p > precedente) {
      const eccedenza = Math.min(p, s.fino) - precedente;
      imponibile += eccedenza * s.aliquota;
    }
    precedente = s.fino;
    if (p <= s.fino) break;
  }
  // Oltre 1M: non definito dalla normativa di riferimento → clamp all'ultimo scaglione.
  imponibile = round2(imponibile);
  const iva = round2(imponibile * IVA_DELEGATO);
  return { imponibile, iva, totale: round2(imponibile + iva) };
}

// ─── C) Cancellazione formalità pregiudizievoli ──────────────────────────────
export function calcolaCancellazioni(formalita = [], prezzoAggiudicazione) {
  const agg = num(prezzoAggiudicazione);
  let totale = 0;
  const dettaglio = [];
  for (const f of formalita || []) {
    let costo = 0;
    if (f.tipo === "trascrizione") {
      costo = CANCELLAZIONE_TRASCRIZIONE;
    } else if (f.tipo === "iscrizione_volontaria") {
      costo = CANCELLAZIONE_ISCRIZIONE_VOLONTARIA;
    } else if (f.tipo === "iscrizione_legale") {
      const credito = num(f.valoreCredito, agg);
      const base = Math.min(credito, agg); // 0,5% sul credito o sull'aggiudicazione se minore
      costo = Math.max(round2(base * CANCELLAZIONE_ALIQUOTA_LEGALE), CANCELLAZIONE_MIN_LEGALE);
    }
    totale += costo;
    dettaglio.push({ tipo: f.tipo, costo: round2(costo) });
  }
  return { totale: round2(totale), dettaglio };
}

// ─── Ristrutturazione ─────────────────────────────────────────────────────────
export function calcolaRistrutturazione(input) {
  const { superficieMq, strategiaRistrutturazione, costoRistrutturazioneMqOverride, costiFisiciExtra } = input;
  const mq = num(superficieMq);
  const rateBase = RATE_RISTRUTTURAZIONE[strategiaRistrutturazione] ?? 0;
  const override = num(costoRistrutturazioneMqOverride);
  const rate = override > 0 ? override : rateBase;
  const extra = num(costiFisiciExtra);
  const costoMq = round2(mq * rate);
  return { rate, costoMq, extra: round2(extra), totale: round2(costoMq + extra) };
}

// ─── D) Detrazione IRPEF sui lavori di ristrutturazione ──────────────────────
export function calcolaDetrazioneIrpef(input, costoRistrutturazione) {
  const { profiloFiscale } = input;
  if (profiloFiscale === "societa") {
    return { applicabile: false, percentuale: 0, baseAmmessa: 0, totale: 0, quotaAnnua: 0, quoteRecuperabili: 0, recuperabile: 0 };
  }
  const perc = profiloFiscale === "prima_casa" ? DETRAZIONE_PRIMA_CASA : DETRAZIONE_SECONDA_CASA;
  const baseAmmessa = Math.min(num(costoRistrutturazione), DETRAZIONE_CAP);
  const totale = round2(baseAmmessa * perc);
  const quotaAnnua = round2(totale / DETRAZIONE_QUOTE);
  // Per un flip rivenduto rapidamente solo poche quote annue sono realmente
  // capienti su IRPEF; default 1 quota. Clamp tra 0 e 10.
  const quoteRecuperabili = Math.max(0, Math.min(DETRAZIONE_QUOTE, num(input.quoteDetrazioneRecuperabili, 1)));
  const recuperabile = round2(quotaAnnua * quoteRecuperabili);
  return { applicabile: true, percentuale: perc, baseAmmessa, totale, quotaAnnua, quoteRecuperabili, recuperabile };
}

// ─── E) Messa a rendita: stima IMU + calcolo affitto sull'orizzonte richiesto ─
// Stima IMU annua su base catastale (seconda casa, l'affitto esclude la prima casa):
// rendita ×1,05 ×160 × aliquota.
export function stimaImuAnnua(rendita, aliquota = ALIQUOTA_IMU_DEFAULT) {
  return round2(num(rendita) * RIVALUTAZIONE_RENDITA * COEFF_IMU_ABITATIVO * num(aliquota, ALIQUOTA_IMU_DEFAULT));
}

export function calcolaAffitto(input, costoTotale, equity) {
  const canone = num(input.canoneAnnuo);
  const regime = input.regimeAffitto || "cedolare21";
  const aliquota = regime === "cedolare10" ? CEDOLARE_CONCORDATO : regime === "lordo" ? 0 : CEDOLARE_SECCA;
  const imu = num(input.imuAnnua);
  const spesePct = Math.max(0, num(input.spesePctAnnue)) / 100;
  const speseFisse = num(input.speseFisseAnnue);     // condominio + altre spese fisse annue
  const imposta = round2(canone * aliquota);
  const spese = round2(canone * spesePct);           // manutenzione ordinaria + sfitto a carico del proprietario
  const nettoAnnuo = round2(canone - imposta - imu - spese - speseFisse);
  const incassoNetto = round2(nettoAnnuo * ANNI_AFFITTO);
  return {
    anni: ANNI_AFFITTO, canone, regime, aliquota, imposta, imu, spese, spesePct, speseFisse,
    nettoAnnuo, incassoNetto,
    // Rapporti percentuali NON arrotondati: li formatta pct() a 1 decimale (un round2
    // qui appiattirebbe 5,4% → 5,0%, troppo grossolano per un rendimento da locazione).
    renditaLordaPct: costoTotale > 0 ? canone / costoTotale : null,
    renditaNettaPct: costoTotale > 0 ? nettoAnnuo / costoTotale : null,
    roiPeriodo: costoTotale > 0 ? incassoNetto / costoTotale : null,
    roePeriodo: equity > 0 ? incassoNetto / equity : null,
  };
}

// ─── F) Funzione principale + KPI di ritorno ─────────────────────────────────
export function calcolaBusinessPlan(input = {}) {
  const aggiudicazione = num(input.prezzoAggiudicazione);
  const rivendita = num(input.prezzoRivendita);
  const ltv = Math.max(0, Math.min(80, num(input.ltvPercent))) / 100;
  const notaio = num(input.notaio);

  const imposte = calcolaImposteRegistro(input);
  const delegato = calcolaCompensoDelegato(aggiudicazione);
  const cancellazioni = calcolaCancellazioni(input.formalita, aggiudicazione);
  const ristrutturazione = calcolaRistrutturazione(input);
  const detrazione = calcolaDetrazioneIrpef(input, ristrutturazione.totale);

  const costoTotaleInvestimento = round2(
    aggiudicazione +
      imposte.totale +
      delegato.totale +
      notaio +
      cancellazioni.totale +
      ristrutturazione.totale
  );

  const margineNettoNominale = round2(rivendita - costoTotaleInvestimento);
  const roiNominale = costoTotaleInvestimento > 0 ? round2(margineNettoNominale / costoTotaleInvestimento) : null;

  const margineReale = round2(margineNettoNominale + detrazione.recuperabile);
  const roiReale = costoTotaleInvestimento > 0 ? round2(margineReale / costoTotaleInvestimento) : null;

  // Mutuo d'asta: finanzia il prezzo di aggiudicazione (max ~80%), non il costo
  // totale del progetto. L'equity è quindi il costo totale meno il mutuo erogato.
  const mutuo = round2(aggiudicazione * ltv);
  const equity = round2(costoTotaleInvestimento - mutuo);

  const roe = equity > 0 ? round2(margineNettoNominale / equity) : null;
  const roeReale = equity > 0 ? round2(margineReale / equity) : null;

  // Messa a rendita (affitto) sull'orizzonte di ANNI_AFFITTO anni.
  const affitto = calcolaAffitto(input, costoTotaleInvestimento, equity);

  // Scenario combinato "affitto + vendita": incasso netto dei 5 anni di locazione
  // + margine di rivendita finale al valore "Rivendita stimata" (nessuna imposta
  // sulla plusvalenza: a ≥5 anni di detenzione la PF è esente).
  const ritornoTotale = round2(affitto.incassoNetto + margineNettoNominale);
  const ritornoReale = round2(ritornoTotale + detrazione.recuperabile);
  const affittoVendita = {
    incassoAffitto: affitto.incassoNetto,
    margineVendita: margineNettoNominale,
    ritornoTotale,
    ritornoReale,
    roi: costoTotaleInvestimento > 0 ? ritornoTotale / costoTotaleInvestimento : null,
    roiReale: costoTotaleInvestimento > 0 ? ritornoReale / costoTotaleInvestimento : null,
    roe: equity > 0 ? ritornoTotale / equity : null,
    roeReale: equity > 0 ? ritornoReale / equity : null,
  };

  const modalitaUscita = ["affitto", "affitto_vendita"].includes(input.modalitaUscita)
    ? input.modalitaUscita : "rivendita";

  return {
    input: { ...input },
    modalitaUscita,
    imposte,
    delegato,
    cancellazioni,
    ristrutturazione,
    detrazione,
    affitto,
    affittoVendita,
    kpi: {
      costoTotaleInvestimento,
      margineNettoNominale,
      roiNominale,
      margineReale,
      roiReale,
      mutuo,
      equity,
      roe,
      roeReale,
    },
  };
}
