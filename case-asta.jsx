/**
 * Case all'Asta — Frontend React
 * Si connette al backend FastAPI su http://localhost:8000
 * Dati reali da PVP (Ministero Giustizia) e portali autorizzati
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  ONERI_FISSI_TRASFERIMENTO,
  ALIQUOTA_PRIMA_CASA,
  ALIQUOTA_SECONDA_CASA,
  IMPOSTA_REGISTRO_MINIMA,
  COEFF_PV_PRIMA_CASA,
  COEFF_PV_SECONDA_CASA,
  RATE_RISTRUTTURAZIONE,
  stimaImuAnnua,
  calcolaBusinessPlan,
  calcolaCompensoDelegato,
} from "./businessPlan.js";

const API_BASE = "/api";

// Passa le immagini esterne tramite proxy per aggirare la hotlink protection
function proxyImg(url) {
  if (!url) return null;
  if (url.startsWith("/api/image-proxy")) return url;
  return `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`;
}

const REGIONI = [
  "Tutte le regioni","Abruzzo","Basilicata","Calabria","Campania","Emilia-Romagna",
  "Friuli-Venezia Giulia","Lazio","Liguria","Lombardia","Marche","Molise",
  "Piemonte","Puglia","Sardegna","Sicilia","Toscana","Trentino-Alto Adige",
  "Umbria","Valle d'Aosta","Veneto"
];

const TIPOLOGIE = [
  "Tutti","Appartamento","Villa / Casa indipendente","Terreno",
  "Locale commerciale","Capannone industriale","Garage / Box",
  "Magazzino","Ufficio","Immobile",
];

const FONTI_INFO = {
  pvp:             { label:"PVP — Min. Giustizia",  color:"#2e6db4", url:"https://pvp.giustizia.it/pvp/" },
  astegiudiziarie: { label:"Astegiudiziarie.it",    color:"#2d7a4f", url:"https://www.astegiudiziarie.it/" },
  astalegale:      { label:"Astalegale.net",         color:"#6b46a3", url:"https://www.astalegale.net/" },
  asteimmobili:    { label:"Asteimmobili.it",        color:"#b5502e", url:"https://www.asteimmobili.it/" },
  astetelematiche: { label:"Astetelematiche.it",     color:"#c07800", url:"https://www.astetelematiche.it/" },
};

const TIPO_ICON = {
  "Appartamento": "apartment",
  "Villa / Casa indipendente": "villa",
  "Terreno": "landscape",
  "Locale commerciale": "storefront",
  "Capannone industriale": "factory",
  "Garage / Box": "garage",
  "Magazzino": "warehouse",
  "Ufficio": "business",
  "Immobile": "home",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Icon({ name, size = 20, color, style: extra }) {
  return (
    <span
      className="material-icons"
      style={{ fontSize: size, color, lineHeight: 1, verticalAlign: "middle", ...extra }}
    >
      {name}
    </span>
  );
}

function fmt(n) {
  if (!n || n <= 0) return "N/D";
  return n.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function daysUntil(d) {
  if (!d) return null;
  const diff = Math.ceil((new Date(d) - new Date()) / 86400000);
  return diff >= 0 ? diff : null;
}

// ─── Componenti UI ────────────────────────────────────────────────────────────

function StatusBar({ status, onScrape, scraping, scrapeComplete }) {
  if (!status) return null;
  const hasData = status.count > 0;
  const date = status.updated_at
    ? new Date(status.updated_at).toLocaleString("it-IT", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" })
    : "—";

  const progress = status.progress;
  const pct = progress ? Math.round((progress.completati / progress.totale) * 100) : 0;

  return (
    <div style={{
      padding:"7px 24px",
      background: scrapeComplete ? "#d1fae5" : hasData ? "#e8f5ee" : "#fef3c7",
      borderBottom: `1px solid ${scrapeComplete ? "#6ee7b7" : hasData ? "#c2dece" : "#f3dfa0"}`,
      fontSize: 12, fontFamily:"var(--font-body)",
      transition:"background 0.4s ease",
    }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <span style={{ display:"flex", alignItems:"center", gap:6, color: hasData ? "#1a5e36" : "#8a6d00", fontWeight:500 }}>
          <Icon
            name={status.scraping_in_progress ? "sync" : hasData ? "check_circle" : "warning_amber"}
            size={15}
            color={scrapeComplete ? "#059669" : hasData ? "#2d7a4f" : "#a07800"}
            style={status.scraping_in_progress ? { animation:"spin 1.2s linear infinite" } : {}}
          />
          {status.scraping_in_progress
            ? <>Scraping in corso... {progress ? `${progress.completati}/${progress.totale} fonti — ${fmt(progress.immobili_trovati)} immobili` : ""}</>
            : scrapeComplete
              ? <>Download completato — {fmt(status.count)} immobili caricati</>
              : hasData
                ? <>{fmt(status.count)} immobili &middot; aggiornato {date}</>
                : "Nessun dato disponibile. Avvia il primo scraping."}
        </span>
        <button
          onClick={onScrape}
          disabled={scraping}
          style={{
            display:"flex", alignItems:"center", gap:5,
            padding:"5px 14px", borderRadius:6, border:"none",
            background: scraping ? "#ccc" : "var(--navy)",
            color:"#fff", fontSize:11, fontWeight:600, cursor: scraping ? "default" : "pointer",
            letterSpacing: 0.2,
            transition:"background 0.2s",
          }}
        >
          <Icon
            name={scraping ? "sync" : "refresh"}
            size={14}
            color="#fff"
            style={scraping ? { animation:"spin 1s linear infinite" } : {}}
          />
          {scraping ? "Aggiornamento..." : "Aggiorna dati"}
        </button>
      </div>

      {/* Barra di progresso */}
      {status.scraping_in_progress && (
        <div style={{ marginTop:6 }}>
          <div style={{
            height:6, borderRadius:3,
            background:"rgba(0,0,0,0.08)",
            overflow:"hidden",
          }}>
            <div style={{
              height:"100%", borderRadius:3,
              background:"linear-gradient(90deg, #2d7a4f, #4ade80)",
              width: `${pct}%`,
              transition:"width 0.5s ease",
            }} />
          </div>
          {progress?.fonti_ok?.length > 0 && (
            <div style={{ fontSize:10, color:"#1a5e36", marginTop:3, opacity:0.7 }}>
              Completati: {progress.fonti_ok.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FonteBadge({ fonte, compact }) {
  const f = FONTI_INFO[fonte] || { label: fonte, color: "#888" };
  return (
    <span style={{
      background: f.color + "12", color: f.color,
      border: `1px solid ${f.color}25`,
      borderRadius: 4, padding: compact ? "1px 6px" : "2px 8px",
      fontSize: compact ? 10 : 11, fontWeight: 600,
      whiteSpace: "nowrap",
      fontFamily: "var(--font-body)",
    }}>
      {f.label}
    </span>
  );
}

function PropertyImage({ src, tipo, height = 180, urlAnnuncio }) {
  const icon = TIPO_ICON[tipo] || "home";
  const [err, setErr] = useState(false);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(null);

  // Reset quando cambia l'immagine (es. nuova ricerca con stesse card riutilizzate)
  useEffect(() => {
    setErr(false);
    setLoaded(false);
  }, [src]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const placeholder = (
    <div style={{
      display:"flex", alignItems:"center", justifyContent:"center",
      background:"linear-gradient(145deg, var(--cream-dark) 0%, var(--cream) 100%)",
      height, width:"100%",
    }}>
      <Icon name={icon} size={36} color="var(--border)" />
    </div>
  );

  if (!src || err) {
    // Per annunci senza immagine mostra placeholder con link al portale
    if (urlAnnuncio) {
      return (
        <a href={urlAnnuncio} target="_blank" rel="noopener noreferrer"
          title="Vedi annuncio sul portale" style={{ display:"block", position:"relative" }}>
          {placeholder}
          <div style={{
            position:"absolute", bottom:6, right:6,
            background:"rgba(0,0,0,0.45)", borderRadius:4,
            padding:"2px 7px", fontSize:10, color:"#fff", fontWeight:600,
            display:"flex", alignItems:"center", gap:3,
          }}>
            <Icon name="open_in_new" size={11} color="#fff" />
            Vedi sul portale
          </div>
        </a>
      );
    }
    return <div ref={ref}>{placeholder}</div>;
  }

  return (
    <div ref={ref} style={{ height, width:"100%", overflow:"hidden", position:"relative",
      background:"linear-gradient(145deg, var(--cream-dark) 0%, var(--cream) 100%)" }}>
      {!loaded && (
        <div style={{ position:"absolute", inset:0,
          display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Icon name={icon} size={36} color="var(--border)" />
        </div>
      )}
      {visible && (
        <img
          src={src}
          alt={tipo}
          onLoad={() => setLoaded(true)}
          onError={() => setErr(true)}
          style={{
            objectFit:"cover", width:"100%", height, display:"block",
            opacity: loaded ? 1 : 0,
            transition: "opacity 0.3s ease",
          }}
        />
      )}
    </div>
  );
}

function CardImmobile({ item, onClick, index, isWishlisted, onToggleWishlist }) {
  const days = daysUntil(item.data_asta);

  return (
    <article
      onClick={() => onClick(item)}
      style={{
        background:"var(--white)", borderRadius:"var(--radius)",
        border:"1px solid var(--border)",
        cursor:"pointer",
        transition:"transform 0.2s ease, box-shadow 0.2s ease",
        overflow:"hidden", display:"flex", flexDirection:"column",
        animation: `fadeUp 0.35s ease ${index * 0.04}s both`,
        fontFamily:"var(--font-body)",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.boxShadow = "0 8px 30px rgba(12,27,51,0.10)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Immagine */}
      <div style={{ position:"relative", overflow:"hidden" }}>
        <PropertyImage src={proxyImg(item.immagine)} tipo={item.tipo} height={175} />

        {/* Overlay data asta — molti lotti sono pubblicati prima che la data
            di vendita sia fissata: lo diciamo invece di lasciare il vuoto */}
        <div style={{
          position:"absolute", top:10, left:10,
          background:"var(--white)",
          color: item.data_asta ? "var(--navy)" : "var(--ink-muted)",
          borderRadius:6, padding:"4px 9px",
          fontSize:11, fontWeight:600,
          display:"flex", alignItems:"center", gap:4,
          boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
        }}>
          <Icon name="event" size={13} color={item.data_asta ? "var(--navy)" : "var(--ink-muted)"} />
          {fmtDate(item.data_asta) || "Data da definire"}
        </div>

        {/* Top-right: cuore wishlist + badge giorni */}
        <div style={{ position:"absolute", top:10, right:10, display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
          <button
            onClick={e => { e.stopPropagation(); onToggleWishlist && onToggleWishlist(item); }}
            title={isWishlisted ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
            style={{
              background: isWishlisted ? "var(--red)" : "rgba(255,255,255,0.92)",
              border:"none", borderRadius:"50%",
              width:32, height:32, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow:"0 2px 8px rgba(0,0,0,0.18)",
              transition:"all 0.15s",
            }}
          >
            <Icon name={isWishlisted ? "favorite" : "favorite_border"} size={17} color={isWishlisted ? "#fff" : "var(--red)"} />
          </button>
          {days !== null && days <= 30 && (
            <div style={{
              background: days <= 7 ? "var(--red)" : "var(--terra)",
              color:"#fff", borderRadius:6, padding:"4px 8px",
              fontSize:10, fontWeight:700, letterSpacing:0.3,
              textTransform:"uppercase",
            }}>
              {days === 0 ? "Oggi" : days === 1 ? "Domani" : `${days}g`}
            </div>
          )}
        </div>
      </div>

      {/* Contenuto */}
      <div style={{ padding:"14px 16px 16px", flex:1, display:"flex", flexDirection:"column", gap:8 }}>
        {/* Localita' */}
        {(item.comune || item.provincia) && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([item.indirizzo, item.comune, item.provincia].filter(Boolean).join(", "))}`}
            target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ display:"flex", alignItems:"center", gap:4, lineHeight:1, textDecoration:"none" }}
          >
            <Icon name="location_on" size={15} color="var(--terra)" />
            <span style={{ fontSize:15, fontWeight:700, color:"var(--navy)" }}>
              {item.comune || ""}
            </span>
            {item.provincia && (
              <span style={{ fontSize:13, color:"var(--ink-muted)", fontWeight:500 }}>
                {item.provincia}
              </span>
            )}
            {item.regione && (
              <span style={{ fontSize:11, color:"var(--ink-muted)", fontWeight:400 }}>
                · {item.regione}
              </span>
            )}
          </a>
        )}

        {/* Tipo + badge */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
          <span style={{
            display:"flex", alignItems:"center", gap:4,
            fontSize:11, color:"var(--ink-muted)", fontWeight:500,
          }}>
            <Icon name={TIPO_ICON[item.tipo] || "home"} size={14} color="var(--ink-muted)" />
            {item.tipo}
            {item.mq > 0 && <>&nbsp;&middot;&nbsp;{item.mq} m²</>}
          </span>
          <FonteBadge fonte={item.fonte} compact />
        </div>

        {/* Alert quota parziale — non si acquista il 100% della proprietà */}
        {(() => {
          const q = rilevaQuotaParziale(item);
          return q.parziale ? (
            <div style={{
              display:"flex", alignItems:"center", gap:5, width:"fit-content",
              fontSize:11, fontWeight:700, color:"var(--red)",
              background:"#fdeaea", border:"1px solid #f0c4c4", borderRadius:6, padding:"3px 8px",
            }}>
              <Icon name="report" size={13} color="var(--red)" />
              Quota parziale{q.quota && !["parziale","indivisa"].includes(q.quota) ? ` ${q.quota}` : ""} · non 100%
            </div>
          ) : null;
        })()}

        {/* Tipo vendita + modalità */}
        {(item.tipo_vendita || item.modalita_partecipazione) && (
          <div style={{
            display:"flex", alignItems:"center", gap:5, flexWrap:"wrap",
            fontSize:11, color:"var(--ink-muted)",
          }}>
            <Icon name="gavel" size={12} color="var(--ink-muted)" />
            {item.tipo_vendita}
            {item.tipo_vendita && item.modalita_partecipazione && <span>&nbsp;·&nbsp;</span>}
            {item.modalita_partecipazione && item.modalita_partecipazione}
          </div>
        )}

        {/* Titolo */}
        <div style={{
          fontWeight:500, fontSize:13, color:"var(--ink)", lineHeight:1.4,
          overflow:"hidden", textOverflow:"ellipsis",
          display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical",
        }}>
          {item.titolo}
        </div>

        {/* Prezzi */}
        <div style={{ marginTop:"auto", paddingTop:4 }}>
          <div style={{
            fontFamily:"var(--font-display)", fontWeight:700,
            fontSize:22, color:"var(--navy)", letterSpacing:-0.5, lineHeight:1,
          }}>
            {item.prezzo > 0 ? <>€ {fmt(item.prezzo)}</> : "Prezzo N/D"}
          </div>
          {item.offerta_minima > 0 && (
            <div style={{
              fontSize:12, color:"var(--green)", fontWeight:500, marginTop:4,
              display:"flex", alignItems:"center", gap:3,
            }}>
              <Icon name="south" size={12} color="var(--green)" />
              Offerta minima € {fmt(item.offerta_minima)}
            </div>
          )}
        </div>

        {/* Tribunale */}
        {item.tribunale && (
          <div style={{
            fontSize:11, color:"var(--ink-muted)",
            display:"flex", alignItems:"center", gap:4,
            paddingTop:6, borderTop:"1px solid var(--cream-dark)",
            marginTop:2,
          }}>
            <Icon name="balance" size={13} color="var(--ink-muted)" />
            Tribunale di {item.tribunale}
          </div>
        )}
      </div>
    </article>
  );
}

// ─── AnalisiPanel helpers ─────────────────────────────────────────────────────

const SEMAFORO = {
  verde:  { dot: "#2d7a4f", label: "Basso",     bg: "#e8f5ee", text: "#1a5e36" },
  giallo: { dot: "#d69e00", label: "Moderato",  bg: "#fdf6e0", text: "#7a5a00" },
  rosso:  { dot: "#b52020", label: "Alto",      bg: "#fdeaea", text: "#8a1616" },
};

function euro(n) {
  if (n == null || n === 0) return "—";
  return `€\u00a0${fmt(n)}`;
}

function Eyebrow({ icon, children, accent = "var(--terra)" }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
      fontSize: 10, fontWeight: 700, color: "var(--ink-muted)",
      textTransform: "uppercase", letterSpacing: 1.4,
    }}>
      {icon && <Icon name={icon} size={13} color={accent} />}
      <span>{children}</span>
      <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function DataTable({ rows }) {
  const visible = rows.filter(r => r && r.value != null && r.value !== "" && r.value !== false);
  if (!visible.length) return null;
  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden",
      background: "var(--white)",
    }}>
      {visible.map((r, i) => (
        <div key={i} style={{
          display: "grid", gridTemplateColumns: "1fr auto", gap: 12,
          padding: "9px 14px", alignItems: "baseline",
          borderBottom: i < visible.length - 1 ? "1px solid var(--border)" : "none",
          background: i % 2 === 1 ? "rgba(246,244,240,0.6)" : "var(--white)",
        }}>
          <span style={{
            fontSize: 11.5, color: "var(--ink-light)", fontWeight: 500,
            letterSpacing: 0.15,
          }}>
            {r.label}
          </span>
          <span style={{
            fontSize: 13, color: "var(--ink)", fontWeight: 600,
            fontFamily: r.mono ? "var(--font-display)" : "var(--font-body)",
            fontVariantNumeric: r.mono ? "tabular-nums" : "normal",
            textAlign: "right",
          }}>
            {r.value === true ? "Sì" : r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Prose({ children, muted = false }) {
  if (!children) return null;
  return (
    <p style={{
      fontFamily: "var(--font-display)",
      fontSize: 14.5, lineHeight: 1.7,
      color: muted ? "var(--ink-light)" : "var(--ink)",
      maxWidth: "68ch",
      margin: "0",
    }}>
      {children}
    </p>
  );
}

function Callout({ level = "info", title, children, legal }) {
  const palette = {
    danger: { accent: "var(--red)",    bg: "#fdeaea", border: "#f0c4c4", text: "#8a1616" },
    warn:   { accent: "#c28a00",       bg: "#fdf6e0", border: "#ead9a6", text: "#7a5a00" },
    info:   { accent: "var(--navy)",   bg: "#eef2f8", border: "#cfd7e6", text: "var(--navy)" },
    good:   { accent: "var(--green)",  bg: "#e8f5ee", border: "#c2dece", text: "#1a5e36" },
  }[level];
  return (
    <div style={{
      display: "flex", gap: 10, padding: "12px 14px 12px 12px",
      background: palette.bg, borderRadius: 3,
      borderLeft: `3px solid ${palette.accent}`,
    }}>
      <Icon
        name={level === "danger" ? "report" : level === "warn" ? "warning_amber" : level === "good" ? "check_circle" : "info"}
        size={18} color={palette.accent}
        style={{ marginTop: 1, flexShrink: 0 }}
      />
      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: palette.text, flex: 1 }}>
        {title && (
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: 0.8, marginBottom: 4, color: palette.accent,
          }}>
            {title}
          </div>
        )}
        {children && <div style={{ fontFamily: "var(--font-display)", fontSize: 13.5, lineHeight: 1.6 }}>{children}</div>}
        {legal && (
          <div style={{
            marginTop: 6, paddingTop: 6, borderTop: `1px dotted ${palette.border}`,
            fontSize: 10.5, color: "var(--ink-muted)", fontStyle: "italic",
            letterSpacing: 0.2,
          }}>
            {legal}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stima spese d'asta lato client (toggle prima/seconda casa) ───────────────
// Rispecchia la logica server (_stima_spese_asta) per ricalcolare F, PMO e ROI al
// volo quando l'utente cambia regime fiscale, senza round-trip al backend.
// Le costanti fiscali condivise sono importate da businessPlan.js (sorgente unica)
// per evitare divergenze tra questo modello e il Business Plan generator.
const ALIQUOTA_TERRENO = 0.15;

function isResidenziale(tipo) {
  const t = (tipo || "").toLowerCase();
  return t.includes("appartamento") || t.includes("villa") || t.includes("casa");
}

// Rileva se l'asta vende una QUOTA PARZIALE (non il 100% della proprietà): si
// diventa comproprietari, non proprietari unici — rischio rilevante. Sorgente
// preferita l'analisi perizia; fallback sul testo dell'annuncio (vale per tutti).
function rilevaQuotaParziale(item, analisi) {
  const dq = analisi?.soggetto_immobile?.diritto_quota;
  if (dq && (dq.piena_proprieta === false ||
             (typeof dq.percentuale === "number" && dq.percentuale < 100))) {
    return { parziale: true, quota: dq.quota_venduta || (dq.percentuale != null ? `${dq.percentuale}%` : null) };
  }
  const txt = ((item?.titolo || "") + " " + (item?.descrizione || "")).toLowerCase();
  if (!txt.trim()) return { parziale: false, quota: null };
  const uni = txt.match(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛]/);
  const indivisa = /quota\s+indivisa/.test(txt);
  // Frazione X/Y (con X<Y) ancorata a un termine di proprietà, per evitare i
  // falsi positivi dei civici/date (es. "Via Roma 1/3").
  let frac = null;
  const re = /(quota|propriet\w*|diritto|pari a|della quota|per la quota)[^0-9]{0,25}(\d{1,3})\s*\/\s*(\d{1,3})/g;
  let m;
  while ((m = re.exec(txt))) {
    const num = +m[2], den = +m[3];
    if (den > 0 && num < den) { frac = `${num}/${den}`; break; }
  }
  const parole = /(un mezzo|un terzo|un quarto|due terzi|tre quarti)/.test(txt) ||
                 (/\bmet[àa]\b/.test(txt) && /(quota|propriet)/.test(txt));
  const parziale = !!(indivisa || frac || uni || parole);
  const quota = frac || (uni ? uni[0] : (indivisa ? "indivisa" : (parziale ? "parziale" : null)));
  return { parziale, quota };
}

function recomputeFinanze(analisi, primaCasa, prezzoValore, renditaOverride) {
  const pf = analisi?.piano_finanziario || {};
  const a = pf.a_valore_mercato, b = pf.b_valore_aggiustato_art2922, off = pf.offerta_base;
  const c = pf.c_costi_sanatoria_con_imprevisti || 0;
  const d = pf.d_debito_condominiale_biennio || 0;
  const e = pf.e_spese_cancellazione || 0;
  const tipo = analisi?.tipo || "";
  const residenziale = isResidenziale(tipo);
  const isTerreno = (tipo || "").toLowerCase().includes("terreno");
  // L'agevolazione prima casa si applica solo agli immobili residenziali.
  const effPrimaCasa = !!primaCasa && residenziale;
  const aliquota = effPrimaCasa
    ? ALIQUOTA_PRIMA_CASA
    : (isTerreno ? ALIQUOTA_TERRENO : ALIQUOTA_SECONDA_CASA);
  const aliquotaPct = Math.round(aliquota * 100);
  // Rendita catastale: override manuale dell'utente, altrimenti dal valore estratto.
  const renditaNum = (renditaOverride != null && renditaOverride !== "")
    ? Number(renditaOverride)
    : (analisi?.caratteristiche?.rendita_catastale ?? null);
  const rendita = (renditaNum && renditaNum > 0) ? renditaNum : null;
  // Prezzo-valore: solo residenziale, con rendita disponibile (art. 1 c.497 L.266/2005).
  const pvAttivo = !!prezzoValore && residenziale && rendita != null;
  const coeff = effPrimaCasa ? COEFF_PV_PRIMA_CASA : COEFF_PV_SECONDA_CASA;
  // Dati base mancanti: restituisci i valori salvati dal server.
  if (a == null || off == null) {
    return {
      f: pf.f_spese_asta, pmo: pf.prezzo_massimo_offerta,
      roi: pf.roi_potenziale, roiPct: pf.roi_percentuale,
      aliquotaPct, residenziale, effPrimaCasa, rendita, pvAttivo, coeff, baseImponibile: null,
    };
  }
  const baseImponibile = pvAttivo ? rendita * coeff : off;
  const impostaRegistro = Math.max(baseImponibile * aliquota, IMPOSTA_REGISTRO_MINIMA);
  const f = Math.round(impostaRegistro + ONERI_FISSI_TRASFERIMENTO);
  const pmo = Math.round((b - c - d - e - f) * 100) / 100;
  const roi = Math.round((a - (off + c + d + e + f)) * 100) / 100;
  const roiPct = off > 0 ? Math.round((roi / off) * 1000) / 10 : null;
  return {
    f, pmo, roi, roiPct, aliquotaPct, residenziale, effPrimaCasa,
    rendita, pvAttivo, coeff, baseImponibile: Math.round(baseImponibile),
  };
}

function AnalisiPanel({ analisi, finanze, primaCasa = false, setPrimaCasa,
                        prezzoValore = false, setPrezzoValore, rendita = "", setRendita }) {
  if (!analisi) return null;
  const fz = finanze || recomputeFinanze(analisi, primaCasa, prezzoValore, rendita);

  const c   = analisi.caratteristiche || {};
  const sdp = analisi.stato_di_possesso || {};
  const ce  = analisi.conformita_edilizia || {};
  const ve  = analisi.valori_economici || {};
  const rf  = analisi.risultati_finanziari || {};
  const si  = analisi.soggetto_immobile || {};
  const pf  = analisi.piano_finanziario || {};
  const sem = analisi.semaforo_rischi || {};
  const dc  = analisi.debiti_condominiali || {};
  const fp  = analisi.formalita_pregiudizievoli || {};
  const sv  = analisi.servitu_passive || {};
  const crit = analisi.criticita || [];
  const note  = analisi.evidenze_pagina?.note_analista;

  const sectionStyle = {
    marginBottom: 26,
  };

  // Scheda tecnica — griglia compatta
  const scheda = [
    { icon: "straighten",     label: "Superficie",       value: c.superficie_mq ? `${c.superficie_mq} m²` : null },
    { icon: "meeting_room",   label: "Vani",             value: c.vani },
    { icon: "bathtub",        label: "Bagni",            value: c.bagni },
    { icon: "stairs",         label: "Piano",            value: c.piano },
    { icon: "calendar_month", label: "Anno costruzione", value: c.anno_costruzione },
    { icon: "bolt",           label: "Classe energetica",value: c.classe_energetica },
    { icon: "thermostat",     label: "Riscaldamento",    value: c.riscaldamento },
    { icon: "build",          label: "Stato",            value: c.stato_conservazione },
  ].filter(d => d.value != null && d.value !== "");

  const extras = [
    c.ascensore          && { icon: "elevator",    label: "Ascensore" },
    c.balcone_terrazzo   && { icon: "balcony",     label: "Balcone / Terrazzo" },
    c.cantina            && { icon: "inventory_2", label: "Cantina" },
    c.giardino           && { icon: "yard",        label: "Giardino" },
    c.box_auto && c.box_auto !== "no" && { icon: "garage", label: c.box_auto === "posto auto" ? "Posto auto" : "Box auto" },
  ].filter(Boolean);

  const schedaRows = [
    { label: "Superficie",       value: c.superficie_mq ? `${c.superficie_mq} m²` : null },
    { label: "Superficie comm.", value: c.superficie_commerciale_mq && c.superficie_commerciale_mq !== c.superficie_mq ? `${c.superficie_commerciale_mq} m²` : null },
    { label: "Vani",             value: c.vani,               mono: true },
    { label: "Bagni",            value: c.bagni,              mono: true },
    { label: "Piano",            value: c.piano },
    { label: "Anno costruzione", value: c.anno_costruzione,   mono: true },
    { label: "Classe energetica",value: c.classe_energetica },
    { label: "Riscaldamento",    value: c.riscaldamento },
    { label: "Stato conservazione", value: c.stato_conservazione },
  ];

  const amenities = [
    c.ascensore          && { icon: "elevator",    label: "Ascensore" },
    c.balcone_terrazzo   && { icon: "balcony",     label: "Balcone / Terrazzo" },
    c.cantina            && { icon: "inventory_2", label: "Cantina" },
    c.giardino           && { icon: "yard",        label: "Giardino" },
    c.box_auto && c.box_auto !== "no" && { icon: "garage", label: c.box_auto === "posto auto" ? "Posto auto" : "Box auto" },
  ].filter(Boolean);

  const possessoRows = [
    { label: "Titolo",             value: sdp.tipo_titolo },
    { label: "Immobile",           value: sdp.occupato == null ? null : (sdp.occupato ? "Occupato" : "Libero") },
    { label: "Titolo opponibile",  value: sdp.titolo_opponibile == null ? null : sdp.titolo_opponibile },
    { label: "Registrazione",      value: sdp.data_registrazione_contratto },
    { label: "Canone annuo",       value: euro(sdp.canone_locazione_annuo), mono: true },
    { label: "Canone mensile",     value: euro(sdp.canone_locazione_mensile), mono: true },
  ];

  const condoRows = [
    { label: "Arretrati totali",      value: dc.arretrati_importo != null ? euro(dc.arretrati_importo) : null, mono: true },
    { label: "Spese ordinarie",       value: dc.spese_ordinarie    != null ? euro(dc.spese_ordinarie)    : null, mono: true },
    { label: "Spese straordinarie",   value: dc.spese_straordinarie != null ? euro(dc.spese_straordinarie) : null, mono: true },
    { label: "Chiusura bilancio",     value: dc.data_chiusura_bilancio },
    { label: "Periodo coperto",       value: dc.periodo_coperto },
  ];

  const hasFormalita = (fp.ipoteche_iscritte || 0) + (fp.pignoramenti_trascritti || 0) + (fp.altri_vincoli_pregiudizievoli || 0) > 0
    || (fp.lista_formalita || []).length > 0;

  const semaforoRows = [
    { key: "occupazione",         label: "Occupazione",          val: sem.occupazione,         note: sem.note_occupazione },
    { key: "urbanistica",         label: "Urbanistica",          val: sem.urbanistica,         note: sem.note_urbanistica },
    { key: "oneri_condominiali",  label: "Oneri condominiali",   val: sem.oneri_condominiali,  note: sem.note_oneri },
  ].filter(r => r.val);

  const hasPiano = ve.prezzo_mercato != null && pf.a_valore_mercato != null;

  return (
    <div style={{ animation: "fadeUp 0.3s ease" }}>
      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "flex-end", justifyContent: "space-between",
        gap: 16, flexWrap: "wrap", marginBottom: 24,
        paddingBottom: 14, borderBottom: "2px solid var(--ink)",
      }}>
        <div>
          <div style={{
            fontSize: 10, fontWeight: 700, color: "var(--terra)",
            textTransform: "uppercase", letterSpacing: 2, marginBottom: 4,
          }}>
            Dossier &middot; Perizia di Stima
          </div>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700,
            color: "var(--ink)", lineHeight: 1.1, letterSpacing: -0.4,
          }}>
            Analisi dell'immobile
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {analisi.fonte_pdf_url && (
            <a
              href={analisi.fonte_pdf_url} target="_blank" rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 11.5, fontWeight: 600, color: "var(--navy)",
                textDecoration: "none", padding: "6px 11px",
                background: "var(--white)", borderRadius: 3,
                border: "1px solid var(--ink)", letterSpacing: 0.3,
                textTransform: "uppercase",
              }}
            >
              <Icon name="picture_as_pdf" size={14} color="var(--red)" />
              Perizia PDF
            </a>
          )}
          <div style={{ fontSize: 10.5, color: "var(--ink-muted)", fontFamily: "var(--font-display)", fontStyle: "italic" }}>
            {analisi.analizzato_il ? new Date(analisi.analizzato_il).toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
            {analisi.pagine_analizzate && <> &middot; {analisi.pagine_analizzate} pp.</>}
          </div>
        </div>
      </div>

      {/* ── Semaforo Rischi ── */}
      {semaforoRows.length > 0 && (
        <div style={sectionStyle}>
          <Eyebrow icon="traffic">Semaforo dei Rischi</Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {semaforoRows.map((r) => {
              const s = SEMAFORO[r.val] || SEMAFORO.giallo;
              return (
                <div key={r.key} style={{
                  display: "flex", gap: 14, alignItems: "flex-start",
                  padding: "14px 16px",
                  background: "var(--white)",
                  borderRadius: 4,
                  borderLeft: `3px solid ${s.dot}`,
                  border: "1px solid var(--border)",
                  borderLeftWidth: 3,
                }}>
                  <span style={{
                    width: 12, height: 12, borderRadius: "50%",
                    background: s.dot, boxShadow: `0 0 0 4px ${s.dot}22`,
                    flexShrink: 0, marginTop: 6,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      display: "flex", alignItems: "baseline", gap: 12,
                      flexWrap: "wrap", marginBottom: r.note ? 6 : 0,
                    }}>
                      <span style={{
                        fontSize: 13, fontWeight: 700, color: "var(--ink)",
                        letterSpacing: 0.1,
                      }}>
                        {r.label}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: s.text,
                        textTransform: "uppercase", letterSpacing: 1,
                        padding: "2px 8px", background: s.bg, borderRadius: 2,
                      }}>
                        Rischio {s.label}
                      </span>
                    </div>
                    {r.note && (
                      <div style={{
                        fontFamily: "var(--font-display)",
                        fontSize: 13.5, lineHeight: 1.6,
                        color: "var(--ink-light)",
                      }}>
                        {r.note}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Piano Finanziario (art. 2922) ── */}
      <div style={sectionStyle}>
        <Eyebrow icon="savings">Piano Finanziario &middot; art. 2922 c.c.</Eyebrow>
        {hasPiano && fz.residenziale && setPrimaCasa && (
          <div style={{ margin: "2px 0 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "var(--ink-muted)", marginRight: 2 }}>Regime spese d'asta:</span>
              {[{ k: false, l: "2ª casa · 9%" }, { k: true, l: "Prima casa · 2%" }].map(o => (
                <button key={String(o.k)} onClick={() => setPrimaCasa(o.k)} style={{
                  fontSize: 11, fontWeight: 600, padding: "4px 11px", borderRadius: 999, cursor: "pointer",
                  border: "1px solid var(--border)",
                  background: primaCasa === o.k ? "var(--navy)" : "var(--white)",
                  color: primaCasa === o.k ? "#fff" : "var(--ink-light)",
                  transition: "background 0.15s, color 0.15s",
                }}>{o.l}</button>
              ))}
            </div>
            {setPrezzoValore && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, color: "var(--ink-light)", cursor: "pointer" }}>
                  <input type="checkbox" checked={prezzoValore} onChange={e => setPrezzoValore(e.target.checked)}
                    style={{ cursor: "pointer", accentColor: "var(--navy)" }} />
                  Prezzo-valore <span style={{ color: "var(--ink-muted)" }}>(base = rendita catastale)</span>
                </label>
                {prezzoValore && (
                  <span style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, color: "var(--ink-muted)" }}>
                    Rendita €
                    <input type="number" value={rendita}
                      onChange={e => setRendita(e.target.value)}
                      placeholder={analisi?.caratteristiche?.rendita_catastale ?? "es. 567"}
                      style={{
                        width: 90, fontSize: 11, padding: "3px 7px", borderRadius: 6,
                        border: "1px solid var(--border)", fontFamily: "var(--font-body)",
                      }} />
                  </span>
                )}
              </div>
            )}
            {prezzoValore && !fz.pvAttivo && (
              <div style={{ fontSize: 10.5, color: "var(--terra)", fontStyle: "italic" }}>
                Inserisci la rendita catastale per applicare il prezzo-valore.
              </div>
            )}
            {fz.pvAttivo && (
              <div style={{ fontSize: 10.5, color: "var(--ink-muted)", fontStyle: "italic" }}>
                Base imponibile = rendita {euro(fz.rendita)} × {fz.coeff} = {euro(fz.baseImponibile)} (anziché il prezzo di aggiudicazione).
              </div>
            )}
          </div>
        )}
        {hasPiano ? (
          <div style={{
            border: "1px solid var(--ink)", borderRadius: 4, overflow: "hidden",
            background: "var(--white)",
          }}>
            {[
              { k: "A", label: "Valore di mercato (perito)",          val: pf.a_valore_mercato },
              { k: "B", label: "Valore aggiustato −15%",               val: pf.b_valore_aggiustato_art2922,    sub: pf.nota_sconto },
              { k: "C", label: "Costi sanatoria + 20% imprevisti",     val: pf.c_costi_sanatoria_con_imprevisti, neg: true },
              { k: "D", label: "Debito condominiale biennio",          val: pf.d_debito_condominiale_biennio,    neg: true },
              { k: "E", label: "Spese cancellazione formalità",        val: pf.e_spese_cancellazione,            neg: true },
              { k: "F", label: "Spese d'asta (imposte + compenso delegato)", val: fz.f, neg: true,
                sub: `Stima: imposta di registro ${fz.aliquotaPct}% su ${fz.pvAttivo ? "valore catastale (prezzo-valore)" : "prezzo di aggiudicazione"} (${fz.effPrimaCasa ? "prima casa" : "2ª casa / strumentale"}) + ~€ 1.600 oneri fissi e compenso delegato.` },
            ].map((r, i, arr) => (
              <div key={r.k} style={{
                display: "grid", gridTemplateColumns: "32px 1fr auto",
                padding: "11px 16px", alignItems: "baseline", gap: 14,
                borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
              }}>
                <span style={{
                  fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 700,
                  color: "var(--terra)", fontStyle: "italic",
                }}>({r.k})</span>
                <span style={{ fontSize: 12.5, color: "var(--ink)" }}>
                  {r.label}
                  {r.sub && (
                    <div style={{ fontSize: 10.5, color: "var(--ink-muted)", fontStyle: "italic", marginTop: 2, fontFamily: "var(--font-display)" }}>
                      {r.sub}
                    </div>
                  )}
                </span>
                <span style={{
                  fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600,
                  color: r.val == null ? "var(--ink-muted)" : r.neg ? "var(--ink-light)" : "var(--ink)",
                  fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                }}>
                  {r.val == null ? "—" : `${r.neg ? "−\u00a0" : ""}${euro(Math.abs(r.val)).replace("€\u00a0", "€\u00a0")}`}
                </span>
              </div>
            ))}
            {/* PMO + ROI evidenziati */}
            <div style={{
              background: "var(--ink)", color: "var(--white)",
              padding: "14px 16px",
              display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "baseline",
            }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase", opacity: 0.65 }}>
                  Prezzo massimo offerta
                </div>
                <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 2, fontFamily: "var(--font-display)", fontStyle: "italic" }}>
                  B − C − D − E − F
                </div>
              </div>
              <div style={{
                fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700,
                fontVariantNumeric: "tabular-nums", letterSpacing: -0.4,
              }}>
                {euro(fz.pmo)}
              </div>
            </div>
            <div style={{
              background: fz.roi > 0 ? "#e8f5ee" : fz.roi < 0 ? "#fdeaea" : "var(--cream)",
              padding: "13px 16px",
              display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "baseline",
              borderTop: "1px solid var(--border)",
            }}>
              <div>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase",
                  color: fz.roi > 0 ? "#1a5e36" : fz.roi < 0 ? "#8a1616" : "var(--ink-light)",
                }}>
                  ROI potenziale
                </div>
                <div style={{ fontSize: 10.5, color: "var(--ink-muted)", marginTop: 2, fontFamily: "var(--font-display)", fontStyle: "italic" }}>
                  su offerta base {euro(pf.offerta_base)}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{
                  fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700,
                  color: fz.roi > 0 ? "#1a5e36" : fz.roi < 0 ? "#8a1616" : "var(--ink)",
                  fontVariantNumeric: "tabular-nums", letterSpacing: -0.3,
                }}>
                  {fz.roi == null ? "—" : `${fz.roi > 0 ? "+" : fz.roi < 0 ? "−" : ""}${euro(Math.abs(fz.roi))}`}
                </div>
                {fz.roiPct != null && (
                  <div style={{
                    fontSize: 11.5, fontWeight: 700,
                    color: fz.roi > 0 ? "#1a5e36" : fz.roi < 0 ? "#8a1616" : "var(--ink-muted)",
                    fontFamily: "var(--font-display)",
                  }}>
                    {fz.roi > 0 ? "+" : ""}{fz.roiPct}%
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <Callout level="warn" title="Valore di mercato non disponibile">
            La perizia non contiene una stima esplicita: il Piano Finanziario non è calcolabile.
            {(ve.costi_sanatoria > 0 || ve.spese_condominiali_arretrate > 0) && (
              <div style={{ marginTop: 6 }}>
                Costi rilevati: {ve.costi_sanatoria > 0 && <>sanatoria {euro(ve.costi_sanatoria)}</>}
                {ve.costi_sanatoria > 0 && ve.spese_condominiali_arretrate > 0 && ", "}
                {ve.spese_condominiali_arretrate > 0 && <>spese condominiali {euro(ve.spese_condominiali_arretrate)}</>}.
              </div>
            )}
          </Callout>
        )}
        {ve.fonte_prezzo_mercato && hasPiano && (
          <div style={{
            marginTop: 10, fontSize: 11.5, color: "var(--ink-muted)",
            fontStyle: "italic", fontFamily: "var(--font-display)", lineHeight: 1.5,
            paddingLeft: 12, borderLeft: "2px solid var(--border)",
          }}>
            «{ve.fonte_prezzo_mercato}»
          </div>
        )}
      </div>

      {/* ── Scheda Tecnica ── */}
      {schedaRows.some(r => r.value != null) && (
        <div style={sectionStyle}>
          <Eyebrow icon="straighten">Scheda Tecnica</Eyebrow>
          <DataTable rows={schedaRows} />
          {amenities.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {amenities.map((b, i) => (
                <span key={i} style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "4px 10px", borderRadius: 2,
                  background: "var(--cream-dark)", color: "var(--ink)",
                  fontSize: 11, fontWeight: 500, letterSpacing: 0.2,
                  border: "1px solid var(--border)",
                }}>
                  <Icon name={b.icon} size={13} color="var(--terra)" /> {b.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Identificazione ── */}
      {(si.indirizzo_estratto || si.lotto_identificazione || si.zona) && (
        <div style={sectionStyle}>
          <Eyebrow icon="location_on">Identificazione</Eyebrow>
          <DataTable rows={[
            { label: "Indirizzo (da perizia)", value: si.indirizzo_estratto },
            { label: "Zona",                    value: si.zona },
            { label: "Foglio / Part. / Sub.",   value: si.lotto_identificazione, mono: true },
          ]} />
        </div>
      )}

      {/* ── Stato di Possesso ── */}
      <div style={sectionStyle}>
        <Eyebrow icon="vpn_key">Stato di Possesso</Eyebrow>
        <DataTable rows={possessoRows} />
        {sdp.dettagli_possesso && (
          <div style={{ marginTop: 12 }}>
            <Prose>{sdp.dettagli_possesso}</Prose>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {sdp.alert_canone_vile?.attivo && (
            <Callout level="danger" title="Canone vile — possibile locazione fittizia"
              legal={sdp.alert_canone_vile.nota_legale || "Cass. Civ. 9877/2022"}>
              Canone indicato {euro(sdp.alert_canone_vile.canone_annuo_perizia)}/anno contro soglia
              di inopponibilità {euro(sdp.alert_canone_vile.soglia_inopponibilita)}/anno. Il giudice
              potrebbe dichiarare il contratto inopponibile alla procedura.
            </Callout>
          )}
          {sdp.alert_comodato?.attivo && (
            <Callout level="danger" title="Comodato non opponibile"
              legal={sdp.alert_comodato.nota_legale || "art. 2923 c.c."}>
              Il comodato non è mai opponibile alla procedura esecutiva, anche se munito di data certa.
            </Callout>
          )}
          {sdp.rischio_diritto_abitazione?.presente && (
            <Callout level="danger" title="Rischio diritto di abitazione"
              legal="art. 540 c.c. — coniuge superstite">
              {sdp.rischio_diritto_abitazione.note ||
                "Possibile acquisto di nuda proprietà di fatto: il coniuge superstite mantiene il diritto d'uso, opponibile anche senza trascrizione."}
            </Callout>
          )}
        </div>
      </div>

      {/* ── Conformità Edilizia ── */}
      <div style={sectionStyle}>
        <Eyebrow icon="architecture">Conformità Edilizia</Eyebrow>

        {(ce.titoli_abilitativi || []).length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{
              fontSize: 10.5, color: "var(--ink-muted)", fontWeight: 600,
              textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6,
            }}>
              Titoli abilitativi
            </div>
            <ul style={{
              listStyle: "none", padding: 0, margin: 0,
              display: "flex", flexDirection: "column", gap: 4,
            }}>
              {ce.titoli_abilitativi.map((t, i) => (
                <li key={i} style={{
                  fontSize: 12.5, color: "var(--ink)", paddingLeft: 16,
                  position: "relative", fontFamily: "var(--font-display)",
                }}>
                  <span style={{
                    position: "absolute", left: 0, top: 8, width: 6, height: 1,
                    background: "var(--terra)",
                  }} />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        )}

        {ce.abusi_edilizi && ce.abusi_edilizi.length > 0 ? (
          <div style={{
            border: "1px solid var(--ink)", borderRadius: 4, overflow: "hidden",
            background: "var(--white)",
          }}>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 90px 110px",
              background: "var(--ink)", color: "var(--white)",
              fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2,
            }}>
              <div style={{ padding: "9px 14px" }}>Abuso</div>
              <div style={{ padding: "9px 10px", textAlign: "center" }}>Sanabile</div>
              <div style={{ padding: "9px 14px", textAlign: "right" }}>Costo stima</div>
            </div>
            {ce.abusi_edilizi.map((a, i) => (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "1fr 90px 110px",
                borderBottom: i < ce.abusi_edilizi.length - 1 ? "1px solid var(--border)" : "none",
                fontSize: 12.5, alignItems: "baseline",
              }}>
                <div style={{ padding: "10px 14px", color: "var(--ink)", fontFamily: "var(--font-display)", lineHeight: 1.45 }}>
                  {a.descrizione}
                </div>
                <div style={{
                  padding: "10px", textAlign: "center",
                  fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
                  color: a.sanabile ? "var(--green)" : "var(--red)",
                }}>
                  {a.sanabile ? "Sì" : "No"}
                </div>
                <div style={{
                  padding: "10px 14px", textAlign: "right",
                  fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums",
                  fontWeight: 600, color: "var(--ink)",
                }}>
                  {a.costo_stima_sanatoria ? euro(a.costo_stima_sanatoria) : a.costo_stima ? euro(a.costo_stima) : "—"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Callout level="good">Nessun abuso edilizio rilevato in perizia.</Callout>
        )}

        {ce.note_conformita && (
          <div style={{ marginTop: 12 }}>
            <Prose muted>{ce.note_conformita}</Prose>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {ce.alert_fiscalizzazione?.attivo && (
            <Callout level="danger" title="Fiscalizzazione — abuso non ripristinabile"
              legal="sanzione pecuniaria in luogo del ripristino">
              {ce.alert_fiscalizzazione.note || "L'abuso permane sull'immobile: può ostacolare futuri mutui bancari e la rivendita."}
            </Callout>
          )}
          {ce.alert_superbonus_110?.presente && (
            <Callout
              level={ce.alert_superbonus_110.difformita_rilevate ? "danger" : "warn"}
              title={ce.alert_superbonus_110.difformita_rilevate ? "Superbonus 110% con difformità" : "Superbonus 110% rilevato"}
              legal={ce.alert_superbonus_110.difformita_rilevate ? "rischio revoca beneficio per l'intero condominio" : null}>
              {ce.alert_superbonus_110.note || "Interventi agevolati con bonus edilizio. Verificare la conformità di tutte le opere prima dell'offerta."}
            </Callout>
          )}
        </div>
      </div>

      {/* ── Servitù Passive ── */}
      {sv.presenti && (
        <div style={sectionStyle}>
          <Eyebrow icon="signpost" accent="var(--red)">Servitù Passive &middot; art. 1027 c.c.</Eyebrow>
          <Callout level="danger" title="Non purgabili con decreto di trasferimento">
            Le servitù prediali e gli oneri reali non vengono cancellati dal decreto (art. 586 c.p.c.).
            L'acquirente subentra nel vincolo <em>cum onere</em>.
          </Callout>
          {(sv.lista || []).length > 0 && (
            <ul style={{
              listStyle: "none", padding: 0, margin: "12px 0 0 0",
              display: "flex", flexDirection: "column", gap: 6,
            }}>
              {sv.lista.map((s, i) => (
                <li key={i} style={{
                  fontSize: 12.5, color: "var(--ink)", paddingLeft: 16,
                  position: "relative", fontFamily: "var(--font-display)", lineHeight: 1.55,
                }}>
                  <span style={{
                    position: "absolute", left: 0, top: 9, width: 6, height: 1,
                    background: "var(--red)",
                  }} />
                  {s}
                </li>
              ))}
            </ul>
          )}
          {sv.impatto_valore_note && (
            <div style={{ marginTop: 12 }}>
              <Prose muted>{sv.impatto_valore_note}</Prose>
            </div>
          )}
        </div>
      )}

      {/* ── Debiti Condominiali ── */}
      {(condoRows.some(r => r.value) || dc.delibere_lavori_pendenti || dc.note_biennio) && (
        <div style={sectionStyle}>
          <Eyebrow icon="apartment">Debiti Condominiali &middot; art. 63 disp. att. c.c.</Eyebrow>
          <DataTable rows={condoRows} />
          {dc.delibere_lavori_pendenti && (
            <div style={{ marginTop: 10 }}>
              <Callout level="warn" title="Delibere lavori pendenti">
                {dc.delibere_lavori_pendenti}. I costi deliberati possono ricadere sull'acquirente anche se i lavori non sono ancora iniziati.
              </Callout>
            </div>
          )}
          {dc.note_biennio && (
            <div style={{ marginTop: 12 }}>
              <Prose muted>{dc.note_biennio}</Prose>
            </div>
          )}
        </div>
      )}

      {/* ── Formalità Pregiudizievoli ── */}
      {hasFormalita && (
        <div style={sectionStyle}>
          <Eyebrow icon="gavel">Formalità Pregiudizievoli</Eyebrow>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
            border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden",
            background: "var(--white)",
          }}>
            {[
              { label: "Ipoteche",      val: fp.ipoteche_iscritte || 0 },
              { label: "Pignoramenti",  val: fp.pignoramenti_trascritti || 0 },
              { label: "Altri vincoli", val: fp.altri_vincoli_pregiudizievoli || 0 },
            ].map((x, i, arr) => (
              <div key={x.label} style={{
                padding: "14px 12px", textAlign: "center",
                borderRight: i < arr.length - 1 ? "1px solid var(--border)" : "none",
              }}>
                <div style={{
                  fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700,
                  color: x.val > 0 ? "var(--ink)" : "var(--ink-muted)",
                  lineHeight: 1, fontVariantNumeric: "tabular-nums",
                }}>
                  {x.val}
                </div>
                <div style={{
                  marginTop: 4, fontSize: 10, fontWeight: 600,
                  color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: 1,
                }}>
                  {x.label}
                </div>
              </div>
            ))}
          </div>
          {(fp.lista_formalita || []).length > 0 && (
            <ul style={{
              listStyle: "none", padding: 0, margin: "12px 0 0 0",
              display: "flex", flexDirection: "column", gap: 5,
            }}>
              {fp.lista_formalita.map((f, i) => (
                <li key={i} style={{
                  fontSize: 12, color: "var(--ink-light)", paddingLeft: 14,
                  position: "relative", fontFamily: "var(--font-display)", lineHeight: 1.5,
                }}>
                  <span style={{
                    position: "absolute", left: 0, top: 8, width: 5, height: 1,
                    background: "var(--ink-muted)",
                  }} />
                  {f}
                </li>
              ))}
            </ul>
          )}
          {fp.costo_totale_cancellazione != null && (
            <div style={{
              marginTop: 10, display: "flex", justifyContent: "space-between",
              alignItems: "baseline", padding: "8px 14px",
              background: "var(--cream-dark)", borderRadius: 3,
              fontSize: 11.5,
            }}>
              <span style={{ color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
                Costo cancellazione stimato
              </span>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
                {euro(fp.costo_totale_cancellazione)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Quotazioni OMI ── */}
      {analisi.quotazioni_omi && (
        <div style={sectionStyle}>
          <Eyebrow icon="account_balance">Quotazioni OMI &middot; Agenzia delle Entrate</Eyebrow>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden",
            background: "var(--white)",
          }}>
            {[
              { label: "Min €/m²", value: analisi.quotazioni_omi.cotazione_min_mq },
              { label: "Max €/m²", value: analisi.quotazioni_omi.cotazione_max_mq },
            ].map((r, i) => (
              <div key={r.label} style={{
                padding: "14px 16px",
                borderRight: i === 0 ? "1px solid var(--border)" : "none",
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: 1 }}>
                  {r.label}
                </div>
                <div style={{
                  fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700,
                  color: "var(--ink)", marginTop: 3, fontVariantNumeric: "tabular-nums",
                }}>
                  {euro(r.value)}
                </div>
              </div>
            ))}
          </div>

          {analisi.quotazioni_omi.valore_medio != null && (
            <div style={{ marginTop: 10 }}>
              <DataTable rows={[
                { label: "Valore stimato minimo",  value: euro(analisi.quotazioni_omi.valore_min),    mono: true },
                { label: "Valore stimato medio",   value: euro(analisi.quotazioni_omi.valore_medio),  mono: true },
                { label: "Valore stimato massimo", value: euro(analisi.quotazioni_omi.valore_max),    mono: true },
                analisi.roi_omi != null && { label: "ROI su base OMI",
                  value: `${analisi.roi_omi > 0 ? "+" : ""}${euro(Math.abs(analisi.roi_omi))}`,
                  mono: true },
              ].filter(Boolean)} />
            </div>
          )}

          <div style={{
            marginTop: 8, fontSize: 10.5, color: "var(--ink-muted)",
            display: "flex", gap: 14, flexWrap: "wrap", fontFamily: "var(--font-display)",
            fontStyle: "italic",
          }}>
            {analisi.quotazioni_omi.semestre && <span>{analisi.quotazioni_omi.semestre}</span>}
            {analisi.quotazioni_omi.n_zone > 1 && <span>Media su {analisi.quotazioni_omi.n_zone} zone</span>}
            <span>{analisi.quotazioni_omi.fonte}</span>
          </div>
        </div>
      )}

      {/* ── Criticità e Note Analista ── */}
      {(crit.length > 0 || note) && (
        <div style={sectionStyle}>
          <Eyebrow icon="edit_note">Criticità &amp; Note dell'Analista</Eyebrow>
          {crit.length > 0 && (
            <ul style={{
              listStyle: "none", padding: 0, margin: 0,
              display: "flex", flexDirection: "column", gap: 8,
            }}>
              {crit.map((k, i) => (
                <li key={i} style={{
                  display: "flex", gap: 10, alignItems: "flex-start",
                  paddingLeft: 2,
                }}>
                  <span style={{
                    width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                    background: "var(--terra)", color: "var(--white)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700, fontFamily: "var(--font-display)",
                    marginTop: 2,
                  }}>
                    {i + 1}
                  </span>
                  <span style={{
                    fontFamily: "var(--font-display)", fontSize: 13.5,
                    color: "var(--ink)", lineHeight: 1.55, flex: 1,
                  }}>
                    {k}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {note && (
            <blockquote style={{
              margin: crit.length > 0 ? "16px 0 0 0" : "0",
              padding: "4px 0 4px 16px",
              borderLeft: "3px solid var(--terra)",
              fontFamily: "var(--font-display)",
              fontSize: 14, fontStyle: "italic",
              color: "var(--ink-light)", lineHeight: 1.7,
              maxWidth: "68ch",
            }}>
              {note}
            </blockquote>
          )}
        </div>
      )}
    </div>
  );
}

// Domande suggerite per avviare la conversazione sulla perizia.
const CHAT_SUGGERIMENTI = [
  "L'immobile è occupato? Da chi e con quale titolo?",
  "Quali sono i rischi principali di questo lotto?",
  "Ci sono abusi edilizi o difformità?",
  "Conviene economicamente? Spiega il ROI.",
];

function ChatPerizia({ item }) {
  const [messaggi, setMessaggi] = useState([]);   // {ruolo:"utente"|"assistente", contenuto}
  const [bozza, setBozza] = useState("");
  const [loading, setLoading] = useState(false);
  const [errore, setErrore] = useState(null);
  const scrollRef = useRef(null);
  const prevItemId = useRef(null);

  // Reset conversazione al cambio immobile
  useEffect(() => {
    if (item?.id !== prevItemId.current) {
      setMessaggi([]);
      setBozza("");
      setErrore(null);
      setLoading(false);
      prevItemId.current = item?.id || null;
    }
  }, [item?.id]);

  // Scroll automatico in fondo a ogni nuovo messaggio
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messaggi, loading]);

  const invia = async (testo) => {
    const domanda = (testo ?? bozza).trim();
    if (!domanda || loading || !item) return;

    const storia = messaggi;  // storia precedente la nuova domanda
    setMessaggi(m => [...m, { ruolo: "utente", contenuto: domanda }]);
    setBozza("");
    setErrore(null);
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/immobili/${encodeURIComponent(item.id)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domanda, storia }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: `Errore ${r.status}` }));
        throw new Error(err.detail || `Errore ${r.status}`);
      }
      const d = await r.json();
      setMessaggi(m => [...m, { ruolo: "assistente", contenuto: d.risposta }]);
    } catch (e) {
      setErrore(e.message);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      invia();
    }
  };

  return (
    <div style={{ background:"var(--white)", borderRadius:12, padding:"24px 28px", border:"1px solid var(--border)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
        <Icon name="forum" size={20} color="var(--terra)" />
        <h3 style={{ margin:0, fontSize:16, fontWeight:700, color:"var(--ink)" }}>
          Chiedi alla perizia
        </h3>
      </div>
      <p style={{ margin:"0 0 16px", fontSize:13, color:"var(--ink-light)", lineHeight:1.6 }}>
        Fai domande libere sull'immobile: le risposte si basano sull'analisi e sul testo della perizia.
      </p>

      {/* Cronologia */}
      {messaggi.length > 0 && (
        <div
          ref={scrollRef}
          style={{
            display:"flex", flexDirection:"column", gap:12,
            maxHeight:380, overflowY:"auto", marginBottom:16,
            padding:"4px 2px",
          }}
        >
          {messaggi.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.ruolo === "utente" ? "flex-end" : "flex-start",
              maxWidth:"85%",
              background: m.ruolo === "utente" ? "var(--terra)" : "#f5f3ef",
              color: m.ruolo === "utente" ? "#fff" : "var(--ink)",
              padding:"10px 14px", borderRadius:12, fontSize:14, lineHeight:1.6,
              whiteSpace:"pre-wrap", wordBreak:"break-word",
            }}>
              {m.contenuto}
            </div>
          ))}
          {loading && (
            <div style={{
              alignSelf:"flex-start", background:"#f5f3ef", color:"var(--ink-light)",
              padding:"10px 14px", borderRadius:12, fontSize:14,
              display:"flex", alignItems:"center", gap:8,
            }}>
              <Icon name="sync" size={16} style={{ animation:"spin 1s linear infinite" }} />
              Sto leggendo la perizia…
            </div>
          )}
        </div>
      )}

      {/* Suggerimenti (solo a conversazione vuota) */}
      {messaggi.length === 0 && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:16 }}>
          {CHAT_SUGGERIMENTI.map((s, i) => (
            <button
              key={i}
              onClick={() => invia(s)}
              disabled={loading}
              style={{
                fontSize:12.5, color:"var(--ink)", background:"var(--white)",
                border:"1px solid var(--border)", borderRadius:999,
                padding:"7px 13px", cursor: loading ? "default" : "pointer",
                lineHeight:1.3, textAlign:"left",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {errore && (
        <div style={{
          display:"flex", alignItems:"flex-start", gap:8,
          padding:"10px 12px", borderRadius:10, marginBottom:12,
          background:"#fef2f2", border:"1px solid #f5c6c6",
          color:"var(--red)", fontSize:13,
        }}>
          <Icon name="error_outline" size={16} color="var(--red)" style={{ marginTop:1, flexShrink:0 }} />
          <div>{errore}</div>
        </div>
      )}

      {/* Input */}
      <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
        <textarea
          value={bozza}
          onChange={e => setBozza(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Scrivi una domanda sulla perizia…"
          rows={1}
          style={{
            flex:1, resize:"none", minHeight:42, maxHeight:120,
            padding:"11px 14px", fontSize:14, lineHeight:1.5,
            borderRadius:10, border:"1px solid var(--border)",
            fontFamily:"inherit", color:"var(--ink)", outline:"none",
          }}
        />
        <button
          onClick={() => invia()}
          disabled={loading || !bozza.trim()}
          style={{
            display:"flex", alignItems:"center", justifyContent:"center",
            width:42, height:42, flexShrink:0,
            background: loading || !bozza.trim() ? "var(--border)" : "var(--terra)",
            color:"#fff", border:"none", borderRadius:10,
            cursor: loading || !bozza.trim() ? "default" : "pointer",
          }}
          title="Invia"
        >
          <Icon name="send" size={20} color="#fff" />
        </button>
      </div>
    </div>
  );
}

// URL dei documenti manuali dell'immobile (formato lista nuovo + fallback legacy a URL singolo).
// Ritorna sempre almeno una stringa vuota, così la UI mostra un campo iniziale.
function docsCustomFromItem(item) {
  const docs = Array.isArray(item?.documenti_url_custom)
    ? item.documenti_url_custom
    : (item?.perizia_url_custom ? [item.perizia_url_custom] : []);
  return docs.length ? [...docs] : [""];
}

// ─── Business Plan generator (trading immobiliare / flipping aste) ───────────
const BP_PROFILI = [
  { k: "prima_casa", label: "Prima Casa (PF)" },
  { k: "seconda_casa", label: "Seconda Casa (PF)" },
  { k: "societa", label: "Società / Impresa" },
];
const BP_STRATEGIE = [
  { k: "refresh", label: "Refresh", desc: `~${RATE_RISTRUTTURAZIONE.refresh} €/m²` },
  { k: "leggera", label: "Leggera", desc: `~${RATE_RISTRUTTURAZIONE.leggera} €/m²` },
  { k: "completa", label: "Completa", desc: `~${RATE_RISTRUTTURAZIONE.completa} €/m²` },
];
const BP_TIPI_FORMALITA = [
  { k: "trascrizione", label: "Trascrizione (pignoramento/sentenza) — €294" },
  { k: "iscrizione_volontaria", label: "Iscrizione volontaria (mutuo) — €35" },
  { k: "iscrizione_legale", label: "Iscrizione legale/giudiziale — 0,5% (min €294)" },
];

// Pre-compila l'input del Business Plan dai dati estratti dalla perizia (se presente).
function bpInputDaAnalisi(item, analisi) {
  const c = analisi?.caratteristiche || {};
  const ve = analisi?.valori_economici || {};
  const fp = analisi?.formalita_pregiudizievoli || {};
  const sdp = analisi?.stato_di_possesso || {};
  const dc = analisi?.debiti_condominiali || {};
  const canone = sdp.canone_locazione_annuo
    || (sdp.canone_locazione_mensile ? Math.round(sdp.canone_locazione_mensile * 12) : "")
    || "";
  const formalita = [];
  for (let i = 0; i < (fp.pignoramenti_trascritti || 0); i++) formalita.push({ tipo: "trascrizione", valoreCredito: "" });
  for (let i = 0; i < (fp.ipoteche_iscritte || 0); i++) formalita.push({ tipo: "iscrizione_volontaria", valoreCredito: "" });
  for (let i = 0; i < (fp.altri_vincoli_pregiudizievoli || 0); i++) formalita.push({ tipo: "trascrizione", valoreCredito: "" });
  // Compenso delegato: priorità al valore estratto dalla perizia/ordinanza (se presente);
  // in mancanza, stima dagli scaglioni sul prezzo di aggiudicazione; altrimenti vuoto.
  const aggiudicazione = item?.offerta_minima || item?.prezzo || "";
  const compensoDelegato = ve.compenso_delegato
    || (aggiudicazione ? calcolaCompensoDelegato(aggiudicazione).totale : "");
  return {
    // Info immobile: precompilate dall'immobile in modalità collegata, vuote in
    // modalità libera (item privo di questi campi). Persistite insieme al resto del bp.
    immobile: {
      titolo: item?.titolo || "",
      indirizzo: item?.indirizzo || "",
      comune: item?.comune || "",
      provincia: item?.provincia || "",
      tipo: item?.tipo || "",
      descrizione: "",
      linkAnnuncio: item?.url_annuncio || "",
    },
    prezzoAggiudicazione: aggiudicazione,
    compensoDelegato,
    prezzoRivendita: ve.prezzo_mercato || "",
    superficieMq: c.superficie_commerciale_mq || c.superficie_mq || item?.mq || "",
    renditaCatastale: c.rendita_catastale || "",
    profiloFiscale: "seconda_casa",
    strategiaRistrutturazione: "leggera",
    costoRistrutturazioneMqOverride: "",
    ltvPercent: 0,
    tassoMutuo: 3.5,
    durataMutuoAnni: 25,
    formalita,
    costiFisiciExtra: "",
    notaio: 2000,
    speseMobilia: "",
    speseAgenzia: "",
    durataMesi: 12,
    ivaSocieta: null,
    quoteDetrazioneRecuperabili: 1,
    // Confronto strumenti finanziari (costo-opportunità del capitale)
    btpNome: "BTP · titolo di Stato",
    btpTasso: 3.5,
    etfNome: "ETF a distribuzione",
    etfDistribuzione: 2.5,
    etfCrescita: 3.0,
    // Messa a rendita (affitto)
    modalitaUscita: "rivendita",
    canoneAnnuo: canone,
    regimeAffitto: "cedolare21",
    imuAnnua: c.rendita_catastale ? stimaImuAnnua(c.rendita_catastale) : "",
    spesePctAnnue: 5,
    speseFisseAnnue: dc.spese_ordinarie || "",
  };
}

// Note descrittive estratte dalla perizia (sola lettura, contesto per l'utente).
function bpNoteDaAnalisi(analisi) {
  const ce = analisi?.conformita_edilizia || {};
  const sdp = analisi?.stato_di_possesso || {};
  const abusi = (ce.abusi_edilizi || []).map(a => a.descrizione).filter(Boolean);
  return {
    difformita: [ce.note_conformita, ...abusi].filter(Boolean).join(" "),
    occupazione: sdp.dettagli_possesso || (sdp.occupato ? "Immobile occupato." : ""),
  };
}

// Persistenza locale del Business Plan compilato, per immobile (come la wishlist).
const BP_STORAGE_KEY = "aste_businessplan";
function caricaBpSalvato(id) {
  if (!id) return null;
  try {
    const all = JSON.parse(localStorage.getItem(BP_STORAGE_KEY) || "{}");
    return all[id] || null; // { savedAt, data }
  } catch { return null; }
}
function salvaBpSalvato(id, data) {
  if (!id) return null;
  const savedAt = new Date().toISOString();
  try {
    const all = JSON.parse(localStorage.getItem(BP_STORAGE_KEY) || "{}");
    all[id] = { savedAt, data };
    localStorage.setItem(BP_STORAGE_KEY, JSON.stringify(all));
  } catch { /* storage pieno o non disponibile */ }
  return savedAt;
}

// Genera una versione stampabile del Business Plan con i tre scenari a confronto
// (vendita, affitto, affitto + vendita) e la apre in una nuova finestra per la stampa.
function stampaBusinessPlan(item, bp, r, standalone = false) {
  const n = (v) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : 0);
  const e = (v) => v == null ? "—" : `${v < 0 ? "− " : ""}€ ${Math.round(Math.abs(v)).toLocaleString("it-IT")}`;
  const p = (v) => v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const k = r.kpi, af = r.affitto, avx = r.affittoVendita, imp = r.imposte, bench = r.benchmark;
  const isAffitto = bp.modalitaUscita === "affitto";
  const isAffittoVendita = bp.modalitaUscita === "affitto_vendita";
  // ROE annualizzato e ritorno totale dell'operazione sull'equity, secondo la modalità di uscita.
  const roeAnnuoAttivo = isAffitto ? (af.roePeriodo != null ? af.roePeriodo / af.anni : null)
    : isAffittoVendita ? avx.roeAnnuo : k.roeAnnuo;
  const opTotaleEquity = isAffitto ? af.incassoNetto : isAffittoVendita ? avx.ritornoTotale : k.margineLeva;
  const profilo = (BP_PROFILI.find(x => x.k === bp.profiloFiscale) || {}).label || bp.profiloFiscale || "—";
  const strat = (BP_STRATEGIE.find(x => x.k === bp.strategiaRistrutturazione) || {}).label || "—";
  const regimeImp = imp.regime === "iva" ? "IVA" : imp.regime === "prezzo_valore" ? "prezzo-valore" : "registro";
  const titolo = item?.titolo || (standalone ? "Business plan" : "Immobile all'asta");
  const luogo = [item?.indirizzo, item?.comune, item?.provincia].filter(Boolean).join(", ");
  const linkAnnuncio = item?.linkAnnuncio || item?.url_annuncio || "";

  // Testo del prezzo: "base d'asta" solo per i piani collegati a un'asta; "di acquisto" per i piani liberi.
  const prezzoTxt = standalone
    ? `Prezzo di acquisto ${e(n(item?.prezzo))}`
    : `Prezzo base d'asta ${e(n(item?.prezzo))}${item?.offerta_minima ? `, offerta minima ${e(n(item.offerta_minima))}` : ""}`;
  const intro = `Analisi di fattibilità finanziaria per ${esc(item?.tipo || "l'immobile")}${luogo || item?.comune ? ` in ${esc(luogo || item?.comune)}` : ""}. `
    + prezzoTxt
    + `${bp.superficieMq ? `, superficie ${esc(bp.superficieMq)} m²` : ""}. `
    + `Il documento confronta tre strategie di uscita a parità di costo d'investimento: rivendita immediata, messa a rendita quinquennale e affitto seguito dalla rivendita finale.`;

  const conMutuo = n(bp.ltvPercent) > 0;
  const composizioneRows = `
<tr><td>${standalone ? "Prezzo di acquisto" : "Prezzo di aggiudicazione"}</td><td class="r">${e(n(bp.prezzoAggiudicazione))}</td></tr>
${imp.totale > 0 ? `<tr><td>Imposte (${regimeImp})</td><td class="r">${e(imp.totale)}</td></tr>` : ""}
${r.delegato.totale > 0 ? `<tr><td>Compenso delegato + IVA</td><td class="r">${e(r.delegato.totale)}</td></tr>` : ""}
${n(bp.notaio) > 0 ? `<tr><td>Notaio</td><td class="r">${e(n(bp.notaio))}</td></tr>` : ""}
${n(bp.speseAgenzia) > 0 ? `<tr><td>Agenzia</td><td class="r">${e(n(bp.speseAgenzia))}</td></tr>` : ""}
${n(bp.speseMobilia) > 0 ? `<tr><td>Mobilia / arredo</td><td class="r">${e(n(bp.speseMobilia))}</td></tr>` : ""}
${r.cancellazioni.totale > 0 ? `<tr><td>Cancellazione formalità</td><td class="r">${e(r.cancellazioni.totale)}</td></tr>` : ""}
${r.ristrutturazione.totale > 0 ? `<tr><td>Ristrutturazione</td><td class="r">${e(r.ristrutturazione.totale)}</td></tr>` : ""}
<tr class="total"><td>Costo totale investimento</td><td class="r">${e(k.costoTotaleInvestimento)}</td></tr>`;
  const finanziamentoBlock = conMutuo ? `
<h2>Finanziamento — mutuo${standalone ? "" : " d'asta"}</h2>
<table>
<tr><td>Importo mutuo (LTV ${n(bp.ltvPercent)}%)</td><td class="r">${e(k.mutuo)}</td></tr>
<tr><td>Capitale proprio (equity)</td><td class="r">${e(k.equity)}</td></tr>
<tr><td>Rata mensile (${n(bp.tassoMutuo)}% · ${n(bp.durataMutuoAnni)} anni)</td><td class="r">${e(k.rataMensile)}/mese</td></tr>
<tr><td>Rata annua</td><td class="r">${e(k.rataAnnua)}</td></tr>
<tr><td>Interessi ${isAffitto || isAffittoVendita ? `(${af.anni} anni)` : `(${k.durataMesi} mesi)`}</td><td class="r">${e(isAffitto || isAffittoVendita ? avx.interessiAffitto : k.interessiFlip)}</td></tr>
<tr><td>Debito residuo a fine periodo</td><td class="r">${e(isAffitto || isAffittoVendita ? avx.debitoResiduo : k.debitoResiduoFlip)}</td></tr>
</table>` : "";

  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8">
<title>Business Plan — ${esc(item?.comune || item?.titolo || "immobile")}</title>
<style>
@page{size:A4;margin:16mm}
*{box-sizing:border-box}
body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:12px;line-height:1.5;margin:0}
.eyebrow{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#b5502e;font-weight:700;margin-bottom:4px}
h1{font-size:21px;color:#0c1b33;margin:0 0 4px;line-height:1.2}
.sub{color:#666;font-size:11.5px;margin-bottom:14px}
.intro{font-size:12px;margin:0 0 4px;color:#333}
h2{font-size:11px;color:#0c1b33;border-bottom:2px solid #b5502e;padding-bottom:4px;margin:20px 0 8px;text-transform:uppercase;letter-spacing:1px}
table{width:100%;border-collapse:collapse}
td{padding:3px 0;vertical-align:baseline}
td.r{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.dati{display:flex;gap:36px}.dati table{width:50%}
.cols{display:flex;gap:36px;align-items:flex-start}.cols>div{flex:1;min-width:0}
.cards{display:flex;gap:10px;margin-top:6px}
.card{flex:1;border:1px solid #ddd;border-radius:7px;padding:11px 13px}
.card .t{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#b5502e;font-weight:700;margin-bottom:7px}
.card .big{font-size:19px;font-weight:800;color:#0c1b33;font-variant-numeric:tabular-nums;line-height:1}
.card .neg{color:#b52020}.card .pos{color:#1a7a44}
.card .cap{font-size:10px;color:#888;margin:2px 0 7px}
.card .row{display:flex;justify-content:space-between;font-size:11px;margin-top:4px;color:#444}
.card .row b{font-variant-numeric:tabular-nums;color:#1a1a1a}
.total td{border-top:1px solid #999;font-weight:700;padding-top:6px}
</style></head><body>
<div class="eyebrow">Business Plan${standalone ? "" : " · Asta giudiziaria"}</div>
<h1>${esc(titolo)}</h1>
<div class="sub">${esc(luogo)}${item?.tribunale ? " · Trib. " + esc(item.tribunale) : ""}${item?.lotto ? " · Lotto " + esc(item.lotto) : ""}</div>
<p class="intro">${intro}</p>
${linkAnnuncio ? `<p class="intro" style="margin-top:2px">Annuncio: <a href="${esc(linkAnnuncio)}" style="color:#b5502e">${esc(linkAnnuncio)}</a></p>` : ""}

<h2>Dati dell'operazione</h2>
<div class="dati">
<table>
<tr><td>${standalone ? "Prezzo di acquisto" : "Prezzo aggiudicazione"}</td><td class="r">${e(n(bp.prezzoAggiudicazione))}</td></tr>
<tr><td>Prezzo rivendita stimato</td><td class="r">${e(n(bp.prezzoRivendita))}</td></tr>
<tr><td>Superficie</td><td class="r">${bp.superficieMq ? esc(bp.superficieMq) + " m²" : "—"}</td></tr>
<tr><td>Rendita catastale</td><td class="r">${e(n(bp.renditaCatastale))}</td></tr>
</table>
<table>
<tr><td>Profilo fiscale</td><td class="r">${esc(profilo)}</td></tr>
<tr><td>Ristrutturazione</td><td class="r">${esc(strat)} · ${e(r.ristrutturazione.totale)}</td></tr>
<tr><td>${standalone ? "Leva (mutuo)" : "Leva mutuo d'asta"}</td><td class="r">${n(bp.ltvPercent) > 0 ? `${n(bp.ltvPercent)}% · ${e(k.mutuo)}` : "nessuna (100% capitale proprio)"}</td></tr>
<tr><td>Canone annuo (affitto)</td><td class="r">${e(n(bp.canoneAnnuo))}</td></tr>
</table>
</div>

${conMutuo ? `
<div class="cols">
<div><h2>Composizione dei costi</h2><table>${composizioneRows}</table></div>
<div>${finanziamentoBlock}</div>
</div>
` : `
<h2>Composizione dei costi</h2>
<table>${composizioneRows}</table>
`}

<h2>Scenari di uscita a confronto</h2>
<div class="cards">
  <div class="card">
    <div class="t">Vendita · flip</div>
    <div class="big ${k.margineNettoNominale >= 0 ? "pos" : "neg"}">${e(k.margineNettoNominale)}</div>
    <div class="cap">Margine netto nominale</div>
    <div class="row"><span>ROI</span><b>${p(k.roiNominale)}</b></div>
    <div class="row"><span>ROE${n(bp.ltvPercent) > 0 ? " (netto interessi)" : ""}</span><b>${p(k.roe)}</b></div>
    ${n(bp.ltvPercent) > 0 ? `<div class="row"><span>Interessi mutuo (${k.durataMesi} mesi)</span><b>${e(k.interessiFlip)}</b></div>` : ""}
    <div class="row"><span>Ritorno annuo (${k.durataMesi} mesi)</span><b>${e(k.margineAnnuo)} · ${p(k.roiAnnuo)}</b></div>
  </div>
  <div class="card">
    <div class="t">Affitto · ${af.anni} anni</div>
    <div class="big ${af.nettoAnnuo >= 0 ? "pos" : "neg"}">${p(af.renditaNettaPct)}</div>
    <div class="cap">Rendita netta annua${af.rata > 0 ? " cash-on-cash" : ""} (lorda ${p(af.renditaLordaPct)})</div>
    ${af.rata > 0 ? `<div class="row"><span>Rata mutuo annua</span><b>− ${e(af.rata)}</b></div>` : ""}
    <div class="row"><span>Netto annuo</span><b>${e(af.nettoAnnuo)}</b></div>
    <div class="row"><span>Incasso ${af.anni} anni</span><b>${e(af.incassoNetto)}</b></div>
    <div class="row"><span>ROI · ROE</span><b>${p(af.roiPeriodo)} · ${p(af.roePeriodo)}</b></div>
  </div>
  <div class="card">
    <div class="t">Affitto + Vendita</div>
    <div class="big ${avx.ritornoTotale >= 0 ? "pos" : "neg"}">${e(avx.ritornoTotale)}</div>
    <div class="cap">Ritorno totale ${af.anni} anni</div>
    <div class="row"><span>Affitto ${af.anni}a</span><b>${e(avx.incassoAffitto)}</b></div>
    <div class="row"><span>Margine vendita</span><b>${e(avx.margineVendita)}</b></div>
    <div class="row"><span>ROI · ROE</span><b>${p(avx.roi)} · ${p(avx.roe)}</b></div>
    <div class="row"><span>Ritorno annuo (media ${af.anni}a)</span><b>${e(avx.ritornoAnnuo)} · ${p(avx.roiAnnuo)}</b></div>
  </div>
</div>

<h2>Confronto con strumenti finanziari</h2>
<p class="intro">Costo-opportunità dello stesso capitale proprio (${e(bench.capitale)}) investito altrove, su un orizzonte di ${bench.anni % 1 === 0 ? bench.anni : String(bench.anni.toFixed(1)).replace(".", ",")} anni. Rendimenti netti indicati dall'utente.</p>
<table>
<tr><td></td><td class="r">Rendim. annuo</td><td class="r">Ritorno totale</td></tr>
<tr class="total"><td>Operazione immobiliare (ROE annuo)</td><td class="r">${p(roeAnnuoAttivo)}</td><td class="r">${e(opTotaleEquity)}</td></tr>
<tr><td>${esc(bp.btpNome || "BTP")} · ${String((bench.btp.tasso * 100).toFixed(1)).replace(".", ",")}% netto</td><td class="r">${p(bench.btp.roiAnnuoPct)}</td><td class="r">${e(bench.btp.totale)}</td></tr>
<tr><td>${esc(bp.etfNome || "ETF a distribuzione")} · ${String((bench.etf.distribuzione * 100).toFixed(1)).replace(".", ",")}% + rivalut. ${String((bench.etf.crescita * 100).toFixed(1)).replace(".", ",")}%</td><td class="r">${p(bench.etf.roiAnnuoPct)}</td><td class="r">${e(bench.etf.totale)}</td></tr>
</table>

<script>window.onload=function(){window.focus();window.print();}</script>
</body></html>`;

  const w = window.open("", "_blank", "width=920,height=1000");
  if (!w) { alert("Abilita i popup del browser per stampare il business plan."); return; }
  w.document.write(html);
  w.document.close();
}

// Tile editabile per lo strip dei dati operazione (numero serif sovrascrivibile).
function BPStat({ label, value, onChange, suffix, step, isEuro }) {
  return (
    <div className="bp-stat" style={{ background: "var(--cream)", border: "1px solid var(--border)", borderRadius: 9, padding: "11px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, minWidth: 0 }}>
        {isEuro && <span style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600, color: "var(--ink-muted)" }}>€</span>}
        <input
          className="no-focus-ring" type="number" step={step} value={value ?? ""}
          onChange={e => onChange(e.target.value)}
          style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", padding: 0, outline: "none",
                   fontFamily: "var(--font-display)", fontSize: 21, fontWeight: 700, color: "var(--navy)", fontVariantNumeric: "tabular-nums" }}
        />
        {suffix && <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-muted)" }}>{suffix}</span>}
      </div>
    </div>
  );
}

// Etichetta di gruppo per la colonna dei parametri.
function BPGroupLabel({ icon, children, hint }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 11 }}>
      <Icon name={icon} size={14} color="var(--terra)" style={{ alignSelf: "center" }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--navy)", textTransform: "uppercase", letterSpacing: 1 }}>{children}</span>
      {hint && <span style={{ fontSize: 11, color: "var(--ink-muted)", fontStyle: "italic" }}>{hint}</span>}
    </div>
  );
}

function BusinessPlanPanel({ item, analisi, standalone = false, onSaved }) {
  const [bp, setBp] = useState(() => caricaBpSalvato(item?.id)?.data || bpInputDaAnalisi(item, analisi));
  const [salvatoIl, setSalvatoIl] = useState(() => caricaBpSalvato(item?.id)?.savedAt || null);
  const [dirty, setDirty] = useState(false);

  // Reagisce al cambio immobile (ricarica i dati salvati o precompila) e all'arrivo
  // dell'analisi perizia (precompila SOLO se non ci sono dati salvati dall'utente).
  const analisiKey = analisi?.analizzato_il || (analisi ? "ready" : null);
  const prevItemId = useRef(item?.id);
  const prevKey = useRef(analisiKey);
  useEffect(() => {
    const itemChanged = item?.id !== prevItemId.current;
    const analisiChanged = analisiKey !== prevKey.current;
    if (itemChanged) {
      const salvato = caricaBpSalvato(item?.id);
      setBp(salvato?.data || bpInputDaAnalisi(item, analisi));
      setSalvatoIl(salvato?.savedAt || null);
      setDirty(false);
    } else if (analisiChanged && !caricaBpSalvato(item?.id)) {
      setBp(bpInputDaAnalisi(item, analisi));
    }
    prevItemId.current = item?.id;
    prevKey.current = analisiKey;
  }, [item, analisi, analisiKey]);

  const set = (campo, valore) => { setBp(p => ({ ...p, [campo]: valore })); setDirty(true); };
  const setImm = (campo, valore) => { setBp(p => ({ ...p, immobile: { ...(p.immobile || {}), [campo]: valore } })); setDirty(true); };
  const setForm = (i, campo, valore) => {
    setBp(p => ({ ...p, formalita: p.formalita.map((f, idx) => idx === i ? { ...f, [campo]: valore } : f) })); setDirty(true);
  };
  const addForm = () => { setBp(p => ({ ...p, formalita: [...p.formalita, { tipo: "trascrizione", valoreCredito: "" }] })); setDirty(true); };
  const delForm = (i) => { setBp(p => ({ ...p, formalita: p.formalita.filter((_, idx) => idx !== i) })); setDirty(true); };

  const handleSalva = () => { setSalvatoIl(salvaBpSalvato(item?.id, bp)); setDirty(false); onSaved?.(item?.id); };
  const handleReimposta = () => { setBp(bpInputDaAnalisi(item, analisi)); setDirty(true); };
  const handleStampa = () => {
    const itStampa = standalone ? { id: item?.id, ...(bp.immobile || {}), prezzo: bp.prezzoAggiudicazione } : item;
    stampaBusinessPlan(itStampa, bp, r, standalone);
  };

  const r = useMemo(() => calcolaBusinessPlan(standalone ? { ...bp, senzaDelegato: true } : bp), [bp, standalone]);
  const k = r.kpi;
  const note = bpNoteDaAnalisi(analisi);
  const imm = bp.immobile || {};
  const pct = (v) => v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`;
  // euro con segno: gestisce i negativi (l'helper fmt() globale mostra "N/D" per i valori ≤ 0).
  const euroSigned = (v) => v == null ? "—" : `${v < 0 ? "− " : ""}€ ${Math.round(Math.abs(v)).toLocaleString("it-IT")}`;
  const isSocieta = bp.profiloFiscale === "societa";
  const inUtile = k.margineNettoNominale >= 0;
  const isAffitto = bp.modalitaUscita === "affitto";
  const isAffittoVendita = bp.modalitaUscita === "affitto_vendita";
  const isLocazione = isAffitto || isAffittoVendita;
  const af = r.affitto;
  const avx = r.affittoVendita;

  // Costo-opportunità: rendimento annualizzato e ritorno totale dell'operazione SULL'EQUITY,
  // scelti in base alla modalità di uscita, da confrontare col benchmark BTP/ETF.
  const bench = r.benchmark;
  const roeAnnuoAttivo = isAffitto ? (af.roePeriodo != null ? af.roePeriodo / af.anni : null)
    : isAffittoVendita ? avx.roeAnnuo
    : k.roeAnnuo;
  const opTotaleEquity = isAffitto ? af.incassoNetto
    : isAffittoVendita ? avx.ritornoTotale
    : k.margineLeva;
  const miglioreBenchmark = Math.max(bench.btp.roiAnnuoPct ?? -Infinity, bench.etf.roiAnnuoPct ?? -Infinity);
  const extraRendimento = roeAnnuoAttivo != null && Number.isFinite(miglioreBenchmark)
    ? roeAnnuoAttivo - miglioreBenchmark : null;

  const ctrlStyle = { padding: "9px 11px", border: "1px solid var(--border)", borderRadius: 7, fontSize: 13.5, background: "var(--white)", color: "var(--ink)", fontFamily: "var(--font-body)", width: "100%" };
  const groupSep = { borderTop: "1px solid var(--border)", paddingTop: 20, marginTop: 20 };

  // Riga della composizione costi (etichetta + importo allineato a destra).
  const CostRow = ({ label, value, strong }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12,
                  padding: strong ? "12px 0 2px" : "6px 0",
                  borderTop: strong ? "1px solid var(--border)" : "none", marginTop: strong ? 6 : 0 }}>
      <span style={{ fontSize: strong ? 12.5 : 12, color: strong ? "var(--navy)" : "var(--ink-light)", fontWeight: strong ? 700 : 500 }}>{label}</span>
      <span style={{ fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums", fontSize: strong ? 15 : 13, fontWeight: strong ? 700 : 600, color: "var(--ink)" }}>{value}</span>
    </div>
  );

  // Chip KPI dentro il verdetto (sfondo navy).
  const VerdictChip = ({ label, value, sub }) => (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", marginTop: 1 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ background: "var(--white)", borderRadius: 12, padding: "26px 30px 30px", border: "1px solid var(--border)" }}>
      {/* Intestazione */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 5 }}>
            <Icon name="savings" size={14} color="var(--terra)" /> Business Plan
          </div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 25, fontWeight: 700, color: "var(--navy)", margin: 0, lineHeight: 1.15 }}>
            {standalone ? (imm.titolo || "Business plan libero") : "Fattibilità dell'operazione di rivendita"}
          </h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 7 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleStampa}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "var(--white)", color: "var(--navy)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "10px 16px", fontWeight: 600, fontSize: 13, fontFamily: "var(--font-body)",
                cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
              }}>
              <Icon name="print" size={16} color="var(--navy)" /> Stampa
            </button>
            <button onClick={handleSalva} disabled={salvatoIl && !dirty}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                background: dirty || !salvatoIl ? "var(--navy)" : "var(--cream)",
                color: dirty || !salvatoIl ? "#fff" : "var(--ink-muted)",
                border: dirty || !salvatoIl ? "none" : "1px solid var(--border)",
                borderRadius: 8, padding: "10px 18px", fontWeight: 600, fontSize: 13, fontFamily: "var(--font-body)",
                cursor: salvatoIl && !dirty ? "default" : "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
              }}>
              <Icon name={salvatoIl && !dirty ? "check" : "save"} size={16} color={dirty || !salvatoIl ? "#fff" : "var(--ink-muted)"} />
              {salvatoIl && !dirty ? "Salvato" : "Salva business plan"}
            </button>
          </div>
          {salvatoIl ? (
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11 }}>
              <span style={{ color: dirty ? "var(--terra)" : "var(--green)" }}>
                {dirty
                  ? "Modifiche non salvate"
                  : `Salvato ${new Date(salvatoIl).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`}
              </span>
              {!standalone && (
                <button onClick={handleReimposta}
                  style={{ background: "none", border: "none", color: "var(--ink-muted)", cursor: "pointer", fontSize: 11, textDecoration: "underline", fontFamily: "var(--font-body)", padding: 0 }}>
                  Reimposta dai dati perizia
                </button>
              )}
            </div>
          ) : standalone ? (
            <div style={{ fontSize: 11.5, color: "var(--ink-muted)", fontStyle: "italic", maxWidth: 260, textAlign: "right", lineHeight: 1.5 }}>
              Inserisci i dati dell'immobile e dell'operazione, poi salva il business plan.
            </div>
          ) : !analisi ? (
            <div style={{ fontSize: 11.5, color: "var(--ink-muted)", fontStyle: "italic", maxWidth: 260, textAlign: "right", lineHeight: 1.5 }}>
              Avvia l'analisi della perizia per precompilare i dati, oppure inseriscili a mano.
            </div>
          ) : null}
        </div>
      </div>

      {/* ZONA 0 — Dati immobile (solo modalità libera): info inserite a mano */}
      {standalone && (
        <div style={{ marginBottom: 24, paddingBottom: 24, borderBottom: "1px solid var(--border)" }}>
          <BPGroupLabel icon="home_work">Dati immobile</BPGroupLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <label style={{ display: "block", gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>Titolo</span>
              <input type="text" value={imm.titolo ?? ""} onChange={e => setImm("titolo", e.target.value)}
                placeholder="es. Trilocale con box" style={{ ...ctrlStyle, marginTop: 4 }} />
            </label>
            <label style={{ display: "block", gridColumn: "1 / -1" }}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>Via / indirizzo</span>
                {[imm.indirizzo, imm.comune].some(Boolean) && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([imm.indirizzo, imm.comune, imm.provincia].filter(Boolean).join(", "))}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--terra)", textDecoration: "none" }}>
                    <Icon name="location_on" size={13} color="var(--terra)" /> Google Maps
                  </a>
                )}
              </span>
              <input type="text" value={imm.indirizzo ?? ""} onChange={e => setImm("indirizzo", e.target.value)}
                placeholder="es. Via Roma 12" style={{ ...ctrlStyle, marginTop: 4 }} />
            </label>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>Comune</span>
              <input type="text" value={imm.comune ?? ""} onChange={e => setImm("comune", e.target.value)}
                placeholder="es. Milano" style={{ ...ctrlStyle, marginTop: 4 }} />
            </label>
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>Provincia</span>
              <input type="text" value={imm.provincia ?? ""} onChange={e => setImm("provincia", e.target.value)}
                placeholder="es. MI" style={{ ...ctrlStyle, marginTop: 4 }} />
            </label>
            <label style={{ display: "block", gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>Tipo immobile</span>
              <input type="text" value={imm.tipo ?? ""} onChange={e => setImm("tipo", e.target.value)}
                placeholder="es. Appartamento, Villa, Terreno" style={{ ...ctrlStyle, marginTop: 4 }} />
            </label>
            <label style={{ display: "block", gridColumn: "1 / -1" }}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>Link annuncio</span>
                {imm.linkAnnuncio && (
                  <a href={imm.linkAnnuncio} target="_blank" rel="noopener noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--terra)", textDecoration: "none" }}>
                    <Icon name="open_in_new" size={13} color="var(--terra)" /> Apri
                  </a>
                )}
              </span>
              <input type="url" value={imm.linkAnnuncio ?? ""} onChange={e => setImm("linkAnnuncio", e.target.value)}
                placeholder="https://…" style={{ ...ctrlStyle, marginTop: 4 }} />
            </label>
            <label style={{ display: "block", gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>Descrizione / note</span>
              <textarea value={imm.descrizione ?? ""} onChange={e => setImm("descrizione", e.target.value)}
                placeholder="Stato, criticità, occupazione, contesto…" rows={3}
                style={{ ...ctrlStyle, marginTop: 4, resize: "vertical", fontFamily: "var(--font-body)" }} />
            </label>
          </div>
        </div>
      )}

      {/* ZONA 1 — Dati operazione (strip editabile), suddivisa per natura delle voci */}
      <div className="bp-facts" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 24 }}>
        {(() => {
          const StripLabel = ({ icon, children }) => (
            <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 7, marginTop: 2 }}>
              <Icon name={icon} size={13} color="var(--terra)" />
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--navy)", textTransform: "uppercase", letterSpacing: 1 }}>{children}</span>
            </div>
          );
          return (
            <>
              <StripLabel icon="tune">Valori operazione</StripLabel>
              <BPStat label={standalone ? "Prezzo acquisto" : "Aggiudicazione"} isEuro value={bp.prezzoAggiudicazione} onChange={v => set("prezzoAggiudicazione", v)} />
              <BPStat label="Rivendita stimata" isEuro value={bp.prezzoRivendita} onChange={v => set("prezzoRivendita", v)} />
              <BPStat label="Superficie" suffix="m²" value={bp.superficieMq} onChange={v => set("superficieMq", v)} />
              <BPStat label="Rendita catastale" isEuro step="0.01" value={bp.renditaCatastale} onChange={v => set("renditaCatastale", v)} />

              {!standalone && (
                <>
                  <StripLabel icon="gavel">Spese d'asta</StripLabel>
                  <BPStat label="Compenso delegato +IVA" isEuro value={bp.compensoDelegato} onChange={v => set("compensoDelegato", v)} />
                </>
              )}

              <StripLabel icon="shopping_cart">Spese di acquisto</StripLabel>
              <BPStat label="Spese notaio" isEuro value={bp.notaio} onChange={v => set("notaio", v)} />
              <BPStat label="Spese agenzia" isEuro value={bp.speseAgenzia} onChange={v => set("speseAgenzia", v)} />
              <BPStat label="Spese mobilia" isEuro value={bp.speseMobilia} onChange={v => set("speseMobilia", v)} />
            </>
          );
        })()}
      </div>

      {/* ZONA 2 — Parametri (sinistra) + Verdetto live (destra) */}
      <div className="bp-body" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.45fr) minmax(0,1fr)", gap: 32 }}>

        {/* ── Parametri ── */}
        <div>
          {/* Strategia di uscita: rivendita (flip) vs messa a rendita (affitto) */}
          <div>
            <BPGroupLabel icon="alt_route">Strategia di uscita</BPGroupLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 7 }}>
              {[
                { k: "rivendita", icon: "sell", label: "Rivendita", desc: "flip" },
                { k: "affitto", icon: "key", label: "Affitto", desc: "5 anni" },
                { k: "affitto_vendita", icon: "real_estate_agent", label: "Affitto + Vendita", desc: "5 anni + uscita" },
              ].map(m => {
                const on = bp.modalitaUscita === m.k;
                return (
                  <button key={m.k} onClick={() => set("modalitaUscita", m.k)}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                      padding: "10px 6px", borderRadius: 8, cursor: "pointer", textAlign: "center",
                      border: `1px solid ${on ? "var(--navy)" : "var(--border)"}`,
                      background: on ? "var(--navy)" : "var(--white)", color: on ? "#fff" : "var(--ink)",
                      transition: "all 0.12s",
                    }}>
                    <Icon name={m.icon} size={17} color={on ? "#fff" : "var(--ink-muted)"} />
                    <span style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.15 }}>{m.label}</span>
                    <span style={{ fontSize: 10.5, opacity: on ? 0.7 : 0.55 }}>{m.desc}</span>
                  </button>
                );
              })}
            </div>
            {bp.modalitaUscita === "rivendita" && (
              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12 }}>
                <span style={{ fontSize: 12.5, color: "var(--ink-light)" }}>
                  Durata operazione <span style={{ color: "var(--ink-muted)" }}>(mesi, acquisto → rivendita)</span>
                </span>
                <input type="number" min="1" step="1" value={bp.durataMesi ?? ""} onChange={e => set("durataMesi", e.target.value)}
                  placeholder="12" style={{ ...ctrlStyle, width: 80, textAlign: "center" }} />
              </label>
            )}
          </div>

          {/* Parametri affitto (modalità messa a rendita e affitto + vendita) */}
          {isLocazione && (
            <div style={groupSep}>
              <BPGroupLabel icon="payments" hint={`netto ${euro(af.nettoAnnuo)}/anno`}>Affitto — canone e spese</BPGroupLabel>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>Canone annuo (€)</span>
                  <input type="number" value={bp.canoneAnnuo ?? ""} onChange={e => set("canoneAnnuo", e.target.value)}
                    placeholder="es. 9.600" style={{ ...ctrlStyle, marginTop: 4 }} />
                </label>
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>Regime fiscale</span>
                  <select value={bp.regimeAffitto} onChange={e => set("regimeAffitto", e.target.value)} style={{ ...ctrlStyle, marginTop: 4 }}>
                    <option value="cedolare21">Cedolare secca 21%</option>
                    <option value="cedolare10">Cedolare 10% (concordato)</option>
                    <option value="lordo">Nessuna imposta (lordo)</option>
                  </select>
                </label>
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>IMU annua (€)</span>
                  <input type="number" value={bp.imuAnnua ?? ""} onChange={e => set("imuAnnua", e.target.value)}
                    placeholder="stima da rendita" style={{ ...ctrlStyle, marginTop: 4 }} />
                </label>
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>Spese/sfitto (% canone)</span>
                  <input type="number" value={bp.spesePctAnnue ?? ""} onChange={e => set("spesePctAnnue", e.target.value)}
                    style={{ ...ctrlStyle, marginTop: 4 }} />
                </label>
                <label style={{ display: "block", gridColumn: "1 / -1" }}>
                  <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>Spese fisse annue — condominio, ecc. (€)</span>
                  <input type="number" value={bp.speseFisseAnnue ?? ""} onChange={e => set("speseFisseAnnue", e.target.value)}
                    placeholder="es. condominio, assicurazione" style={{ ...ctrlStyle, marginTop: 4 }} />
                </label>
              </div>
            </div>
          )}

          {/* Profilo fiscale */}
          <div style={groupSep}>
            <BPGroupLabel icon="account_balance">Profilo fiscale</BPGroupLabel>
            <div style={{ display: "grid", gridTemplateColumns: isSocieta ? "1fr 1fr" : "1fr", gap: 10 }}>
              <select value={bp.profiloFiscale} onChange={e => set("profiloFiscale", e.target.value)} style={ctrlStyle}>
                {BP_PROFILI.map(p => <option key={p.k} value={p.k}>{p.label}</option>)}
              </select>
              {isSocieta && (
                <select
                  value={bp.ivaSocieta == null ? "registro" : String(bp.ivaSocieta)}
                  onChange={e => set("ivaSocieta", e.target.value === "registro" ? null : Number(e.target.value))}
                  style={ctrlStyle}>
                  <option value="registro">Registro 9%</option>
                  <option value="0.1">IVA 10% (da impresa)</option>
                  <option value="0.22">IVA 22% (lusso/strum.)</option>
                </select>
              )}
            </div>
          </div>

          {/* Strategia ristrutturazione */}
          <div style={groupSep}>
            <BPGroupLabel icon="construction" hint={`${euro(r.ristrutturazione.rate)}/m² · ${euro(r.ristrutturazione.totale)} totali`}>Ristrutturazione</BPGroupLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 7 }}>
              {BP_STRATEGIE.map(s => {
                const on = bp.strategiaRistrutturazione === s.k;
                return (
                  <button key={s.k} onClick={() => { set("strategiaRistrutturazione", s.k); set("costoRistrutturazioneMqOverride", ""); }}
                    style={{
                      textAlign: "center", padding: "10px 8px", borderRadius: 8, cursor: "pointer",
                      border: `1px solid ${on ? "var(--navy)" : "var(--border)"}`,
                      background: on ? "var(--navy)" : "var(--white)", color: on ? "#fff" : "var(--ink)",
                      transition: "all 0.12s",
                    }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{s.label}</div>
                    <div style={{ fontSize: 10.5, opacity: on ? 0.75 : 0.6, marginTop: 2 }}>{s.desc}</div>
                  </button>
                );
              })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: bp.strategiaRistrutturazione === "refresh" ? "1fr 1fr" : "1fr", gap: 10, marginTop: 10 }}>
              <label style={{ display: "block" }}>
                <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>Override €/m² (opz.)</span>
                <input type="number" value={bp.costoRistrutturazioneMqOverride ?? ""} onChange={e => set("costoRistrutturazioneMqOverride", e.target.value)}
                  placeholder={`${r.ristrutturazione.rate}`} style={{ ...ctrlStyle, marginTop: 4 }} />
              </label>
              {bp.strategiaRistrutturazione === "refresh" && (
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>Problemi fisici (€)</span>
                  <input type="number" value={bp.costiFisiciExtra ?? ""} onChange={e => set("costiFisiciExtra", e.target.value)}
                    placeholder="infiltrazioni…" style={{ ...ctrlStyle, marginTop: 4 }} />
                </label>
              )}
            </div>
          </div>

          {/* Leva finanziaria */}
          <div style={groupSep}>
            <BPGroupLabel icon="account_balance_wallet" hint={standalone ? "solo sul prezzo di acquisto" : "solo sul prezzo di aggiudicazione"}>{standalone ? "Leva — mutuo" : "Leva — mutuo d'asta"}</BPGroupLabel>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <input type="range" min="0" max="80" step="5" value={bp.ltvPercent}
                onChange={e => set("ltvPercent", Number(e.target.value))}
                style={{ flex: 1, accentColor: "var(--terra)" }} />
              <span style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, color: "var(--navy)", minWidth: 48, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{bp.ltvPercent}%</span>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <div style={{ flex: 1, background: "var(--cream)", borderRadius: 7, padding: "8px 12px" }}>
                <div style={{ fontSize: 10, color: "var(--ink-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 }}>Mutuo</div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>{euro(k.mutuo)}</div>
              </div>
              <div style={{ flex: 1, background: "var(--cream)", borderRadius: 7, padding: "8px 12px" }}>
                <div style={{ fontSize: 10, color: "var(--ink-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 }}>Capitale proprio</div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>{euro(k.equity)}</div>
              </div>
            </div>
            {bp.ltvPercent > 0 && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                  <label style={{ display: "block" }}>
                    <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>Tasso mutuo (% annuo)</span>
                    <input type="number" step="0.1" min="0" value={bp.tassoMutuo ?? ""} onChange={e => set("tassoMutuo", e.target.value)}
                      placeholder="3,5" style={{ ...ctrlStyle, marginTop: 4 }} />
                  </label>
                  <label style={{ display: "block" }}>
                    <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600 }}>Durata ammortamento (anni)</span>
                    <input type="number" step="1" min="1" value={bp.durataMutuoAnni ?? ""} onChange={e => set("durataMutuoAnni", e.target.value)}
                      placeholder="25" style={{ ...ctrlStyle, marginTop: 4 }} />
                  </label>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginTop: 10, padding: "9px 12px", background: "var(--cream)", borderRadius: 7 }}>
                  <span style={{ fontSize: 11.5, color: "var(--ink-light)" }}>
                    Rata mensile <span style={{ color: "var(--ink-muted)" }}>· interessi su {k.durataMesi} mesi {euro(k.interessiFlip)}</span>
                  </span>
                  <span style={{ fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 16, color: "var(--navy)" }}>
                    {euro(k.rataMensile)}/mese
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Detrazione + Formalità (due colonne su largo) */}
          <div style={groupSep}>
            <BPGroupLabel icon="gavel">Gravami e detrazioni</BPGroupLabel>
            {!isSocieta && (
              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                <span style={{ fontSize: 12.5, color: "var(--ink-light)" }}>Quote detrazione IRPEF recuperabili <span style={{ color: "var(--ink-muted)" }}>(su 10)</span></span>
                <input type="number" min="0" max="10" value={bp.quoteDetrazioneRecuperabili ?? ""} onChange={e => set("quoteDetrazioneRecuperabili", e.target.value)}
                  style={{ ...ctrlStyle, width: 70, textAlign: "center" }} />
              </label>
            )}
            <div style={{ fontSize: 11.5, color: "var(--ink-muted)", fontWeight: 600, marginBottom: 8 }}>Formalità da cancellare</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {bp.formalita.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--ink-muted)", fontStyle: "italic", padding: "2px 0" }}>Nessuna formalità — aggiungine se presenti gravami da cancellare.</div>
              )}
              {bp.formalita.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select value={f.tipo} onChange={e => setForm(i, "tipo", e.target.value)} style={{ ...ctrlStyle, flex: 1, fontSize: 12, padding: "8px 10px" }}>
                    {BP_TIPI_FORMALITA.map(t => <option key={t.k} value={t.k}>{t.label}</option>)}
                  </select>
                  {f.tipo === "iscrizione_legale" && (
                    <input type="number" placeholder="credito €" value={f.valoreCredito ?? ""} onChange={e => setForm(i, "valoreCredito", e.target.value)}
                      style={{ ...ctrlStyle, width: 110, padding: "8px 10px" }} />
                  )}
                  <button onClick={() => delForm(i)} title="Rimuovi" style={{ border: "1px solid var(--border)", background: "var(--white)", borderRadius: 7, cursor: "pointer", padding: "7px 8px", lineHeight: 0 }}>
                    <Icon name="close" size={15} color="var(--ink-muted)" />
                  </button>
                </div>
              ))}
              <button onClick={addForm} style={{ alignSelf: "flex-start", border: "1px dashed var(--border)", background: "transparent", borderRadius: 7, cursor: "pointer", padding: "7px 13px", fontSize: 12, color: "var(--navy)", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                <Icon name="add" size={14} color="var(--navy)" /> Aggiungi formalità
              </button>
            </div>
          </div>
        </div>

        {/* ── Verdetto live (sticky) ── */}
        <div className="bp-verdict" style={{ position: "sticky", top: 70, alignSelf: "start", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Hero: signature element — margine (rivendita), rendita (affitto) o ritorno totale (affitto+vendita) */}
          {bp.modalitaUscita === "rivendita" ? (
          <div style={{ background: "var(--navy)", borderRadius: 12, padding: "22px 24px", boxShadow: "0 6px 24px rgba(12,27,51,0.18)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>Margine netto nominale</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 42, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums",
                          color: inUtile ? "#79d7a4" : "#ff9d9d" }}>
              {inUtile ? "+" : "−"} €&nbsp;{fmt(Math.abs(k.margineNettoNominale))}
            </div>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.6)", marginTop: 8 }}>
              Rivendita {euro(Number(bp.prezzoRivendita) || 0)} − costo {euro(k.costoTotaleInvestimento)}
              {r.detrazione.recuperabile > 0 && ` · reale ${euroSigned(k.margineReale)}`}
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
              <VerdictChip label="ROI nominale" value={pct(k.roiNominale)} sub={r.detrazione.recuperabile > 0 ? `reale ${pct(k.roiReale)}` : null} />
              <VerdictChip label={bp.ltvPercent > 0 ? "ROE (leva)" : "ROE"} value={pct(k.roe)} sub={bp.ltvPercent > 0 ? `equity ${euro(k.equity)} · −int ${euro(k.interessiFlip)}` : "= ROI senza leva"} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1.2 }}>
                Ritorno annuo <span style={{ textTransform: "none", letterSpacing: 0, opacity: 0.8 }}>su {k.durataMesi} mesi</span>
              </span>
              <span style={{ fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 18, color: k.margineAnnuo >= 0 ? "#79d7a4" : "#ff9d9d" }}>
                {euroSigned(k.margineAnnuo)} · {pct(k.roiAnnuo)}
              </span>
            </div>
          </div>
          ) : isAffitto ? (
          <div style={{ background: "var(--navy)", borderRadius: 12, padding: "22px 24px", boxShadow: "0 6px 24px rgba(12,27,51,0.18)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>Rendita netta annua</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 42, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums",
                          color: af.nettoAnnuo >= 0 ? "#79d7a4" : "#ff9d9d" }}>
              {pct(af.renditaNettaPct)}
            </div>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.6)", marginTop: 8 }}>
              Netto {euroSigned(af.nettoAnnuo)}/anno · lorda {pct(af.renditaLordaPct)} · incasso {af.anni} anni {euroSigned(af.incassoNetto)}
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
              <VerdictChip label={`ROI ${af.anni} anni`} value={pct(af.roiPeriodo)} sub={`su ${euro(k.costoTotaleInvestimento)}`} />
              <VerdictChip label={bp.ltvPercent > 0 ? `ROE ${af.anni} anni (leva)` : `ROE ${af.anni} anni`} value={pct(af.roePeriodo)} sub={bp.ltvPercent > 0 ? `equity ${euro(k.equity)}` : "= ROI senza leva"} />
            </div>
          </div>
          ) : (
          <div style={{ background: "var(--navy)", borderRadius: 12, padding: "22px 24px", boxShadow: "0 6px 24px rgba(12,27,51,0.18)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>Ritorno totale {af.anni} anni · affitto + vendita</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 42, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums",
                          color: avx.ritornoTotale >= 0 ? "#79d7a4" : "#ff9d9d" }}>
              {euroSigned(avx.ritornoTotale)}
            </div>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.6)", marginTop: 8 }}>
              Affitto {euroSigned(avx.incassoAffitto)} + rivendita {euroSigned(avx.margineVendita)}
              {r.detrazione.recuperabile > 0 && ` · reale ${euroSigned(avx.ritornoReale)}`}
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
              <VerdictChip label={`ROI ${af.anni} anni`} value={pct(avx.roi)} sub={r.detrazione.recuperabile > 0 ? `reale ${pct(avx.roiReale)}` : `su ${euro(k.costoTotaleInvestimento)}`} />
              <VerdictChip label={bp.ltvPercent > 0 ? `ROE ${af.anni} anni (leva)` : `ROE ${af.anni} anni`} value={pct(avx.roe)} sub={bp.ltvPercent > 0 ? `equity ${euro(k.equity)}` : "= ROI senza leva"} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1.2 }}>
                Ritorno annuo <span style={{ textTransform: "none", letterSpacing: 0, opacity: 0.8 }}>media su {af.anni} anni</span>
              </span>
              <span style={{ fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 18, color: avx.ritornoAnnuo >= 0 ? "#79d7a4" : "#ff9d9d" }}>
                {euroSigned(avx.ritornoAnnuo)} · {pct(avx.roiAnnuo)}
              </span>
            </div>
          </div>
          )}

          {/* Dettaglio rendita annua (affitto e affitto + vendita) */}
          {isLocazione && (
            <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--navy)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Rendita annua (lordo → netto)</div>
              <CostRow label="Canone lordo annuo" value={euro(af.canone)} />
              <CostRow label={af.regime === "lordo" ? "Imposta" : `Cedolare ${(af.aliquota * 100).toFixed(0)}%`} value={euroSigned(-af.imposta)} />
              <CostRow label="IMU annua" value={euroSigned(-af.imu)} />
              <CostRow label={`Spese / sfitto ${(af.spesePct * 100).toFixed(0)}%`} value={euroSigned(-af.spese)} />
              {af.speseFisse > 0 && <CostRow label="Spese fisse (condominio, ecc.)" value={euroSigned(-af.speseFisse)} />}
              {af.rata > 0 && <CostRow label={`Rata mutuo (${euro(k.rataMensile)}/mese × 12)`} value={euroSigned(-af.rata)} />}
              <CostRow label={af.rata > 0 ? "Netto annuo (cash-on-cash)" : "Netto annuo"} value={euroSigned(af.nettoAnnuo)} strong />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: 8, marginTop: 4, fontSize: 12, color: "var(--ink-light)" }}>
                <span>Incasso netto {af.anni} anni</span>
                <span style={{ fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "var(--green)" }}>{euroSigned(af.incassoNetto)}</span>
              </div>
            </div>
          )}

          {/* Uscita: affitto + vendita finale */}
          {isAffittoVendita && (
            <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--navy)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Ritorno {af.anni} anni (affitto + uscita)</div>
              <CostRow label={`Incasso netto affitto ${af.anni} anni${af.rata > 0 ? " (cash-on-cash)" : ""}`} value={euroSigned(avx.incassoAffitto)} />
              <CostRow label={af.rata > 0 ? "Rivendita netto debito residuo" : "Margine rivendita finale"} value={euroSigned(avx.margineVendita)} />
              <CostRow label="Ritorno totale" value={euroSigned(avx.ritornoTotale)} strong />
            </div>
          )}

          {/* Composizione costi */}
          <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 18px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--navy)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Composizione costi</div>
            {(() => {
              const impLabel = `Imposte (${r.imposte.regime === "iva" ? "IVA" : r.imposte.regime === "prezzo_valore" ? "prezzo-valore" : "registro"})`;
              // Spese d'asta (specifiche dell'esecuzione): compenso delegato — solo nel
              // BP della singola asta — e cancellazione formalità/gravami.
              const speseAsta = [
                !standalone && r.delegato.totale > 0 && { l: "Compenso delegato +IVA", v: r.delegato.totale },
                r.cancellazioni.totale > 0 && { l: "Cancellazione formalità", v: r.cancellazioni.totale },
              ].filter(Boolean);
              // Spese del normale acquisto (valide anche fuori dall'asta).
              const speseAcquisto = [
                r.imposte.totale > 0 && { l: impLabel, v: r.imposte.totale },
                Number(bp.notaio) > 0 && { l: "Notaio", v: Number(bp.notaio) },
                Number(bp.speseAgenzia) > 0 && { l: "Agenzia", v: Number(bp.speseAgenzia) },
                Number(bp.speseMobilia) > 0 && { l: "Mobilia / arredo", v: Number(bp.speseMobilia) },
                r.ristrutturazione.totale > 0 && { l: "Ristrutturazione", v: r.ristrutturazione.totale },
              ].filter(Boolean);
              const GroupLabel = ({ children }) => (
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 12, marginBottom: 2 }}>{children}</div>
              );
              return (
                <>
                  <CostRow label={standalone ? "Prezzo di acquisto" : "Aggiudicazione"} value={euro(Number(bp.prezzoAggiudicazione) || 0)} />
                  {standalone ? (
                    <>
                      {speseAsta.length > 0 && <GroupLabel>Gravami</GroupLabel>}
                      {speseAsta.map(x => <CostRow key={x.l} label={x.l} value={euro(x.v)} />)}
                      {speseAcquisto.length > 0 && <GroupLabel>Spese di acquisto</GroupLabel>}
                      {speseAcquisto.map(x => <CostRow key={x.l} label={x.l} value={euro(x.v)} />)}
                    </>
                  ) : (
                    <>
                      {r.imposte.totale > 0 && <CostRow label={impLabel} value={euro(r.imposte.totale)} />}
                      {r.delegato.totale > 0 && <CostRow label="Compenso delegato +IVA" value={euro(r.delegato.totale)} />}
                      {Number(bp.notaio) > 0 && <CostRow label="Notaio" value={euro(Number(bp.notaio))} />}
                      {Number(bp.speseAgenzia) > 0 && <CostRow label="Agenzia" value={euro(Number(bp.speseAgenzia))} />}
                      {Number(bp.speseMobilia) > 0 && <CostRow label="Mobilia / arredo" value={euro(Number(bp.speseMobilia))} />}
                      {r.cancellazioni.totale > 0 && <CostRow label="Cancellazione formalità" value={euro(r.cancellazioni.totale)} />}
                      {r.ristrutturazione.totale > 0 && <CostRow label="Ristrutturazione" value={euro(r.ristrutturazione.totale)} />}
                    </>
                  )}
                  <CostRow label="Costo totale investimento" value={euro(k.costoTotaleInvestimento)} strong />
                </>
              );
            })()}
          </div>

          {/* Avvisi */}
          {!isSocieta && r.detrazione.totale > 0 && (
            <Callout level="good" title="Detrazione IRPEF lavori">
              {`${(r.detrazione.percentuale * 100).toFixed(0)}% su ${euro(r.detrazione.baseAmmessa)} = ${euro(r.detrazione.totale)} in 10 anni (${euro(r.detrazione.quotaAnnua)}/anno). Nel margine reale: ${r.detrazione.quoteRecuperabili} quota/e = ${euro(r.detrazione.recuperabile)}.`}
            </Callout>
          )}
          {bp.profiloFiscale === "prima_casa" && (
            <Callout level="warn" title="Rischio decadenza prima casa" legal="Art. 1 nota II-bis Tariffa parte I DPR 131/1986">
              Rivendere entro 5 anni senza riacquisto entro 1 anno fa decadere l'agevolazione (recupero imposte + sanzione 30%). Per un flip rapido valuta "Seconda Casa".
            </Callout>
          )}
        </div>
      </div>

      {/* ── Confronto con altri investimenti (a tutta larghezza, editabile inline) ── */}
      {(() => {
        const orizzonteTxt = bench.anni % 1 === 0 ? bench.anni : bench.anni.toFixed(1).replace(".", ",");
        // Scala delle barre sul rendimento annuo più alto tra i tre (minimo positivo per evitare /0).
        const maxAnnuo = Math.max(roeAnnuoAttivo || 0, bench.btp.roiAnnuoPct || 0, bench.etf.roiAnnuoPct || 0, 0.0001);
        const barW = (v) => `${Math.max(0, Math.min(100, ((v || 0) / maxAnnuo) * 100))}%`;

        // Input percentuale editabile inline: numero + "%" affiancati in un riquadro pill.
        // type="text" + inputMode decimal per accettare la virgola; il valore viene
        // normalizzato a punto (compatibile con num()), ma mostrato con la virgola.
        const RateInput = ({ value, onChange }) => {
          const display = value == null || value === "" ? "" : String(value).replace(".", ",");
          const handle = (raw) => {
            let s = raw.replace(",", ".").replace(/[^\d.]/g, "");
            const i = s.indexOf(".");
            if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, ""); // un solo punto
            onChange(s);
          };
          return (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "4px 8px",
                           border: "1px solid var(--border)", borderRadius: 8, background: "var(--white)" }}>
              <input className="bp-rate no-focus-ring" type="text" inputMode="decimal" value={display} onChange={e => handle(e.target.value)}
                style={{ width: 42, border: "none", background: "transparent", padding: 0, outline: "none",
                         fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 15,
                         color: "var(--navy)", textAlign: "right" }} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-muted)" }}>%</span>
            </span>
          );
        };

        // Riga-barra di uno strumento. `accent` = colore barra; `nome`/`onNome` = titolo (editabile se onNome è passato);
        // `controls` = input dei tassi.
        const BarRow = ({ accent, nome, onNome, controls, annuoPct, totale, evidenzia }) => (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(210px, 260px) 1fr", gap: 16, alignItems: "center",
                        padding: "14px 16px", borderRadius: 10,
                        background: evidenzia ? "var(--navy)" : "var(--cream)",
                        border: evidenzia ? "none" : "1px solid var(--border)" }}>
            <div>
              {onNome ? (
                <input className="bp-name" type="text" value={nome} onChange={e => onNome(e.target.value)}
                  style={{ width: "100%", padding: "3px 6px", marginLeft: -6, marginBottom: 7, outline: "none",
                           fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 700, color: "var(--navy)", background: "transparent" }} />
              ) : (
                <div style={{ fontSize: 14, fontWeight: 700, color: evidenzia ? "#fff" : "var(--navy)", marginBottom: controls ? 7 : 0 }}>{nome}</div>
              )}
              {controls}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ flex: 1, height: 22, borderRadius: 6, background: evidenzia ? "rgba(255,255,255,0.14)" : "var(--cream-dark)", overflow: "hidden" }}>
                <div style={{ width: barW(annuoPct), height: "100%", borderRadius: 6, background: accent,
                              transition: "width 0.25s ease" }} />
              </div>
              <div style={{ minWidth: 130, textAlign: "right" }}>
                <div style={{ fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 20,
                              color: evidenzia ? "#fff" : (annuoPct != null && annuoPct < 0 ? "var(--terra)" : "var(--navy)") }}>
                  {pct(annuoPct)}<span style={{ fontSize: 11, fontWeight: 600, opacity: 0.65 }}> /anno</span>
                </div>
                <div style={{ fontSize: 11.5, color: evidenzia ? "rgba(255,255,255,0.6)" : "var(--ink-muted)", fontVariantNumeric: "tabular-nums" }}>
                  totale {euroSigned(totale)}
                </div>
              </div>
            </div>
          </div>
        );

        // Miglior alternativa finanziaria (per rendimento annuo) e vincitore del confronto.
        const bestAlt = (bench.etf.roiAnnuoPct ?? -Infinity) >= (bench.btp.roiAnnuoPct ?? -Infinity)
          ? { nome: bp.etfNome || "ETF a distribuzione" }
          : { nome: bp.btpNome || "BTP" };
        const operazioneVince = extraRendimento != null && extraRendimento >= 0;

        return (
          <div style={{ marginTop: 26, paddingTop: 24, borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 5 }}>
              <Icon name="trending_up" size={14} color="var(--terra)" /> Confronto con altri investimenti
            </div>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--navy)", margin: "0 0 4px" }}>
              Stesso capitale, dove rende di più?
            </h3>
            <div style={{ fontSize: 12.5, color: "var(--ink-light)", marginBottom: 16 }}>
              Capitale proprio <b>{euro(bench.capitale)}</b> investito per <b>{orizzonteTxt} anni</b> · <span style={{ color: "var(--terra)", fontWeight: 600 }}>inserisci i rendimenti netti attesi qui sotto</span>
            </div>

            {/* Verdetto sintetico: nomina lo strumento vincitore e mostra il vantaggio come valore positivo */}
            {extraRendimento != null && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap",
                            padding: "14px 18px", borderRadius: 10, marginBottom: 14,
                            background: operazioneVince ? "var(--green-bg)" : "var(--terra-light)",
                            border: `1px solid ${operazioneVince ? "var(--green)" : "var(--terra)"}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <Icon name={operazioneVince ? "check_circle" : "account_balance"} size={22} color={operazioneVince ? "var(--green)" : "var(--terra)"} />
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>
                      {operazioneVince ? "Conviene l'operazione immobiliare" : `Conviene di più ${bestAlt.nome}`}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-light)", marginTop: 1 }}>
                      {operazioneVince
                        ? `Rende più della miglior alternativa (${bestAlt.nome})`
                        : "Rende più dell'operazione immobiliare, a parità di capitale"}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <span style={{ fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 24,
                                 color: operazioneVince ? "var(--green)" : "var(--terra)" }}>
                    +{pct(Math.abs(extraRendimento))}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" }}> /anno di vantaggio</span>
                </div>
              </div>
            )}

            {/* Barre a confronto */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <BarRow
                evidenzia accent="#79d7a4"
                nome={`Operazione immobiliare · ${isAffitto ? "affitto" : isAffittoVendita ? "affitto + vendita" : "rivendita"}`}
                annuoPct={roeAnnuoAttivo} totale={opTotaleEquity}
              />
              <BarRow
                accent="var(--navy)"
                nome={bp.btpNome ?? "BTP"} onNome={v => set("btpNome", v)}
                controls={
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink-light)" }}>
                    <RateInput value={bp.btpTasso} onChange={v => set("btpTasso", v)} />
                    <span>netto/anno</span>
                  </div>
                }
                annuoPct={bench.btp.roiAnnuoPct} totale={bench.btp.totale}
              />
              <BarRow
                accent="var(--terra)"
                nome={bp.etfNome ?? "ETF a distribuzione"} onNome={v => set("etfNome", v)}
                controls={
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink-light)", flexWrap: "wrap" }}>
                    <RateInput value={bp.etfDistribuzione} onChange={v => set("etfDistribuzione", v)} />
                    <span>dividendo netto +</span>
                    <RateInput value={bp.etfCrescita} onChange={v => set("etfCrescita", v)} />
                    <span>crescita netta</span>
                  </div>
                }
                annuoPct={bench.etf.roiAnnuoPct} totale={bench.etf.totale}
              />
            </div>

            <div style={{ fontSize: 10.5, color: "var(--ink-muted)", fontStyle: "italic", marginTop: 12, letterSpacing: 0.2 }}>
              Confronto a parità di capitale proprio ({euro(bench.capitale)}) e orizzonte ({orizzonteTxt} anni). I rendimenti degli strumenti
              finanziari sono quelli netti (al netto di imposte e costi) che inserisci tu. Per l'operazione si usa il ROE annualizzato
              (rendimento sul capitale proprio).
            </div>
          </div>
        );
      })()}

      {/* Note dalla perizia (sola lettura, a tutta larghezza) */}
      {(note.difformita || note.occupazione) && (
        <div style={{ display: "grid", gridTemplateColumns: note.difformita && note.occupazione ? "1fr 1fr" : "1fr", gap: 10, marginTop: 22, paddingTop: 22, borderTop: "1px solid var(--border)" }}>
          {note.difformita && <Callout level="warn" title="Difformità / criticità fisiche">{note.difformita}</Callout>}
          {note.occupazione && <Callout level="info" title="Occupazione">{note.occupazione}</Callout>}
        </div>
      )}

      <div style={{ fontSize: 10.5, color: "var(--ink-muted)", fontStyle: "italic", marginTop: 16, letterSpacing: 0.2 }}>
        Stime indicative su prezzo-valore, scaglioni del compenso delegato e cancellazione formalità secondo la prassi delle esecuzioni immobiliari. Verifica sempre con notaio e professionista delegato.
        {isAffittoVendita && " Lo scenario Affitto + Vendita assume la rivendita al valore “Rivendita stimata” senza imposta sulla plusvalenza (detenzione ≥ 5 anni, esente per le persone fisiche)."}
      </div>
    </div>
  );
}

// ─── Sezione Business Plan indipendente (piani "liberi", non legati a un immobile) ──
// Riusa lo stesso BusinessPlanPanel del dettaglio immobile: ogni futura ottimizzazione
// al pannello vale automaticamente per entrambe le sezioni. Qui si gestisce solo la
// lista dei piani salvati. Persistenza nello stesso store del BP, con id prefissati
// "libero:" per distinguerli dai piani collegati a un immobile.
const LIBERO_PREFIX = "libero:";
function caricaPianiLiberi() {
  try {
    const all = JSON.parse(localStorage.getItem(BP_STORAGE_KEY) || "{}");
    return Object.entries(all)
      .filter(([id]) => id.startsWith(LIBERO_PREFIX))
      .map(([id, v]) => {
        let roi = null;
        try { roi = calcolaBusinessPlan(v.data).kpi.roiNominale; } catch { /* dati incompleti */ }
        return {
          id,
          savedAt: v.savedAt,
          titolo: v.data?.immobile?.titolo || "",
          indirizzo: v.data?.immobile?.indirizzo || "",
          comune: v.data?.immobile?.comune || "",
          roi,
        };
      })
      .sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
  } catch { return []; }
}
function eliminaPianoLibero(id) {
  try {
    const all = JSON.parse(localStorage.getItem(BP_STORAGE_KEY) || "{}");
    delete all[id];
    localStorage.setItem(BP_STORAGE_KEY, JSON.stringify(all));
  } catch { /* storage non disponibile */ }
}

function BusinessPlanLibero() {
  const [plans, setPlans] = useState(() => caricaPianiLiberi());
  const [selectedId, setSelectedId] = useState(null);
  const refresh = () => setPlans(caricaPianiLiberi());
  const pct = (v) => v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`;

  const nuovo = () => setSelectedId(LIBERO_PREFIX + Date.now());
  const elimina = (id) => {
    eliminaPianoLibero(id);
    if (selectedId === id) setSelectedId(null);
    refresh();
  };

  const btnNuovo = (
    <button onClick={nuovo}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        background: "var(--navy)", color: "#fff", border: "none",
        borderRadius: 8, padding: "10px 18px", fontWeight: 600, fontSize: 13,
        fontFamily: "var(--font-body)", cursor: "pointer",
      }}>
      <Icon name="add" size={17} color="#fff" /> Nuovo business plan
    </button>
  );

  if (selectedId) {
    return (
      <div>
        <button onClick={() => { setSelectedId(null); refresh(); }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 16,
            background: "var(--white)", color: "var(--ink-light)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "8px 14px", fontWeight: 600, fontSize: 13,
            fontFamily: "var(--font-body)", cursor: "pointer",
          }}>
          <Icon name="arrow_back" size={16} color="var(--ink-light)" /> Tutti i business plan
        </button>
        <BusinessPlanPanel standalone item={{ id: selectedId }} analisi={null} onSaved={refresh} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-light)" }}>
          <Icon name="savings" size={16} color="var(--terra)" />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--navy)" }}>
            {plans.length}
          </span>
          business plan salvat{plans.length === 1 ? "o" : "i"}
        </div>
        {btnNuovo}
      </div>

      {plans.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "var(--ink-muted)" }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%", margin: "0 auto 16px",
            background: "var(--cream-dark)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon name="savings" size={28} color="var(--ink-muted)" />
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 17, color: "var(--ink-light)", marginBottom: 6 }}>
            Nessun business plan
          </div>
          <div style={{ fontSize: 13, marginBottom: 20 }}>
            Crea un'analisi di fattibilità per un immobile inserendo i dati a mano
          </div>
          {btnNuovo}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))", gap: 18 }}>
          {plans.map(p => (
            <div key={p.id}
              onClick={() => setSelectedId(p.id)}
              style={{
                background: "var(--white)", border: "1px solid var(--border)", borderRadius: 12,
                padding: "18px 20px", cursor: "pointer", transition: "border-color 0.15s, box-shadow 0.15s",
                display: "flex", flexDirection: "column", gap: 10,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--navy)"; e.currentTarget.style.boxShadow = "0 2px 10px rgba(0,0,0,0.06)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--navy)", lineHeight: 1.2 }}>
                    {p.titolo || "Business plan senza titolo"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 3 }}>
                    {[p.indirizzo, p.comune].filter(Boolean).join(", ") || "—"}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); elimina(p.id); }}
                  title="Elimina"
                  style={{
                    background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6,
                    color: "var(--ink-muted)", display: "flex", flexShrink: 0,
                  }}>
                  <Icon name="delete_outline" size={18} color="var(--ink-muted)" />
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <span style={{ fontSize: 11, color: "var(--ink-muted)" }}>
                  ROI <b style={{ fontFamily: "var(--font-display)", fontSize: 14, color: p.roi != null && p.roi >= 0 ? "var(--green)" : "var(--red)" }}>{pct(p.roi)}</b>
                </span>
                <span style={{ fontSize: 10.5, color: "var(--ink-muted)" }}>
                  {p.savedAt ? new Date(p.savedAt).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }) : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailPage({ item, onClose, isWishlisted, onToggleWishlist, onItemUpdate }) {
  const [analisi, setAnalisi] = useState(null);
  const [analisiLoading, setAnalisiLoading] = useState(false);
  const [analisiError, setAnalisiError] = useState(null);
  const [documenti, setDocumenti] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editIndirizzo, setEditIndirizzo] = useState("");
  const [editDocumenti, setEditDocumenti] = useState([""]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [primaCasa, setPrimaCasa] = useState(false);
  const [prezzoValore, setPrezzoValore] = useState(false);
  const [rendita, setRendita] = useState("");
  const [detailTab, setDetailTab] = useState("panoramica");
  const prevItemId = useRef(null);

  // Ricalcolo finanziario dinamico (regime fiscale + prezzo-valore). Coerente tra
  // piano finanziario e ROI di sidebar perché entrambi leggono da qui.
  const finanze = recomputeFinanze(analisi, primaCasa, prezzoValore, rendita);

  // Reset stato e carica analisi cached quando cambia immobile
  useEffect(() => {
    if (item?.id !== prevItemId.current) {
      setAnalisi(null);
      setAnalisiError(null);
      setAnalisiLoading(false);
      setDocumenti(null);
      setDocLoading(false);
      setEditOpen(false);
      setEditError(null);
      setPrimaCasa(false);
      setPrezzoValore(false);
      setRendita("");
      setDetailTab("panoramica");
      setEditIndirizzo(item?.indirizzo || "");
      setEditDocumenti(docsCustomFromItem(item));
      prevItemId.current = item?.id || null;

      // Auto-fetch analisi cached
      if (item?.id) {
        fetch(`${API_BASE}/immobili/${encodeURIComponent(item.id)}/analisi`)
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) setAnalisi(d); })
          .catch(() => {});
      }
    }
  }, [item?.id]);

  // Blocca scroll body quando la pagina di dettaglio e' aperta
  useEffect(() => {
    if (item) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [item]);

  const handleDocumenti = async () => {
    if (!item || documenti) return;
    setDocLoading(true);
    try {
      const r = await fetch(`${API_BASE}/immobili/${encodeURIComponent(item.id)}/documenti`);
      if (r.ok) {
        setDocumenti(await r.json());
      } else {
        setDocumenti({ documenti: [], errore: `Errore ${r.status}` });
      }
    } catch {
      setDocumenti({ documenti: [], errore: "Errore di rete" });
    }
    finally { setDocLoading(false); }
  };

  const handleAnalisi = async () => {
    if (!item) return;
    setAnalisiLoading(true);
    setAnalisiError(null);
    try {
      const r = await fetch(`${API_BASE}/immobili/${encodeURIComponent(item.id)}/analisi`, { method: "POST" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: `Errore ${r.status}` }));
        throw new Error(err.detail || `Errore ${r.status}`);
      }
      setAnalisi(await r.json());
    } catch (e) {
      setAnalisiError(e.message);
    } finally {
      setAnalisiLoading(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!item) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const docs = editDocumenti.map(u => u.trim()).filter(Boolean);
      const body = {
        indirizzo: editIndirizzo.trim(),
        documenti_url: docs,
      };
      const r = await fetch(`${API_BASE}/immobili/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: `Errore ${r.status}` }));
        throw new Error(err.detail || `Errore ${r.status}`);
      }
      const updated = await r.json();
      onItemUpdate && onItemUpdate(updated);
      setEditOpen(false);
      // Se la lista documenti e' cambiata, invalida l'analisi cached
      const docsPrec = (Array.isArray(item.documenti_url_custom)
        ? item.documenti_url_custom
        : (item.perizia_url_custom ? [item.perizia_url_custom] : [])).join("|");
      if (docs.join("|") !== docsPrec) {
        try {
          await fetch(`${API_BASE}/immobili/${encodeURIComponent(item.id)}/analisi`, { method: "DELETE" });
        } catch (_) {}
        setAnalisi(null);
        setDocumenti(null);
      }
    } catch (e) {
      setEditError(e.message);
    } finally {
      setEditSaving(false);
    }
  };

  const handleRianalizza = async () => {
    if (!item || analisiLoading) return;
    setAnalisiLoading(true);
    setAnalisiError(null);
    setAnalisi(null);
    try {
      await fetch(`${API_BASE}/immobili/${encodeURIComponent(item.id)}/analisi`, { method: "DELETE" });
    } catch (_) {}
    try {
      const r = await fetch(`${API_BASE}/immobili/${encodeURIComponent(item.id)}/analisi`, { method: "POST" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: `Errore ${r.status}` }));
        throw new Error(err.detail || `Errore ${r.status}`);
      }
      setAnalisi(await r.json());
    } catch (e) {
      setAnalisiError(e.message);
    } finally {
      setAnalisiLoading(false);
    }
  };

  if (!item) return null;

  const location = [item.indirizzo, item.comune, item.provincia, item.regione].filter(Boolean).join(", ");
  const days = daysUntil(item.data_asta);
  const c = analisi?.caratteristiche || {};

  // Caratteristiche griglia — da analisi se disponibili, altrimenti da item
  const chars = [
    { icon:"straighten", label:"Superficie", value: c.superficie_mq ? `${c.superficie_mq} m²` : item.mq ? `${item.mq} m²` : null },
    { icon:"meeting_room", label:"Vani", value: c.vani },
    { icon:"bathtub", label:"Bagni", value: c.bagni },
    { icon:"stairs", label:"Piano", value: c.piano ?? item.piano },
    { icon:"calendar_month", label:"Anno costruzione", value: c.anno_costruzione },
    { icon:"bolt", label:"Classe energetica", value: c.classe_energetica },
    { icon:"thermostat", label:"Riscaldamento", value: c.riscaldamento },
    { icon:"build", label:"Stato conservazione", value: c.stato_conservazione },
    { icon:TIPO_ICON[item.tipo]||"home", label:"Tipologia", value: item.tipo },
    { icon:"balance", label:"Tribunale", value: item.tribunale },
    { icon:"tag", label:"Lotto", value: item.lotto },
    { icon:"update", label:"Aggiornato", value: item.scraped_at ? new Date(item.scraped_at).toLocaleDateString("it-IT") : null },
  ].filter(d => d.value != null && d.value !== "");

  // Badge features dall'analisi
  const badges = [
    c.ascensore && { icon: "elevator", label: "Ascensore" },
    c.balcone_terrazzo && { icon: "balcony", label: "Balcone/Terrazzo" },
    c.cantina && { icon: "inventory_2", label: "Cantina" },
    c.giardino && { icon: "yard", label: "Giardino" },
    c.box_auto && c.box_auto !== "no" && { icon: "garage", label: c.box_auto === "posto auto" ? "Posto auto" : "Box auto" },
  ].filter(Boolean);

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:1000,
      background:"var(--cream)",
      overflowY:"auto",
      fontFamily:"var(--font-body)",
      animation:"fadeUp 0.25s ease",
    }}>
      {/* ── Top bar ── */}
      <div style={{
        position:"sticky", top:0, zIndex:10,
        background:"var(--navy)", padding:"10px 24px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
      }}>
        <button
          onClick={onClose}
          style={{
            display:"flex", alignItems:"center", gap:6,
            background:"rgba(255,255,255,0.1)", border:"none", borderRadius:6,
            padding:"7px 14px", cursor:"pointer", color:"#fff", fontSize:13, fontWeight:500,
            fontFamily:"var(--font-body)", transition:"background 0.15s",
          }}
          onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,0.18)"}
          onMouseLeave={e => e.currentTarget.style.background="rgba(255,255,255,0.1)"}
        >
          <Icon name="arrow_back" size={18} color="#fff" /> Torna alla ricerca
        </button>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {onToggleWishlist && (
            <button
              onClick={() => onToggleWishlist(item)}
              title={isWishlisted ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
              style={{
                display:"flex", alignItems:"center", gap:5,
                background: isWishlisted ? "rgba(239,68,68,0.25)" : "rgba(255,255,255,0.1)",
                border: isWishlisted ? "1px solid rgba(239,68,68,0.5)" : "1px solid transparent",
                borderRadius:6, padding:"7px 14px", cursor:"pointer",
                color: isWishlisted ? "#fca5a5" : "#fff",
                fontSize:12, fontWeight:600, fontFamily:"var(--font-body)", transition:"all 0.15s",
              }}
            >
              <Icon name={isWishlisted ? "favorite" : "favorite_border"} size={16} color={isWishlisted ? "#fca5a5" : "#fff"} />
              {isWishlisted ? "Preferito" : "Salva"}
            </button>
          )}
          <FonteBadge fonte={item.fonte} />
        </div>
      </div>

      {/* ── Contenuto principale ── */}
      <div style={{ maxWidth:1320, margin:"0 auto", padding:"0 24px 60px" }}>

        {/* ── Hero image — contenuta nel layout, non a tutta larghezza ── */}
        <div style={{ position:"relative", background:"var(--cream-dark)", overflow:"hidden", borderRadius:14, marginTop:24, border:"1px solid var(--border)" }}>
          <PropertyImage src={proxyImg(item.immagine)} tipo={item.tipo} height={300} urlAnnuncio={!item.immagine ? item.url_annuncio : null} />
          {days !== null && days <= 30 && (
            <div style={{
              position:"absolute", top:16, right:16,
              background: days <= 7 ? "var(--red)" : "var(--terra)",
              color:"#fff", borderRadius:8, padding:"5px 13px",
              fontSize:12, fontWeight:700, letterSpacing:0.3, textTransform:"uppercase",
              boxShadow:"0 2px 10px rgba(0,0,0,0.2)",
            }}>
              {days === 0 ? "Oggi" : days === 1 ? "Domani" : `${days} giorni`}
            </div>
          )}
          <div style={{ position:"absolute", bottom:16, left:16, display:"flex", gap:7 }}>
            <span style={{
              display:"inline-flex", alignItems:"center", gap:5,
              background:"rgba(12,27,51,0.72)", backdropFilter:"blur(4px)",
              color:"#fff", borderRadius:6, padding:"5px 12px",
              fontSize:12, fontWeight:600,
            }}>
              <Icon name={TIPO_ICON[item.tipo] || "home"} size={14} color="#fff" />
              {item.tipo}
            </span>
            {item.fonte && (
              <span style={{
                display:"inline-flex", alignItems:"center",
                background:"rgba(12,27,51,0.72)", backdropFilter:"blur(4px)",
                color:"#fff", borderRadius:6, padding:"5px 12px",
                fontSize:11, fontWeight:600,
              }}>
                {(FONTI_INFO[item.fonte] || { label: item.fonte }).label}
              </span>
            )}
          </div>
        </div>

        {/* Titolo + prezzo */}
        <div style={{
          display:"flex", justifyContent:"space-between", alignItems:"flex-start",
          padding:"22px 0 16px", gap:24, borderBottom:"1px solid var(--border)",
        }}>
          <div style={{ flex:1, minWidth:0 }}>
            <h1 style={{
              margin:"0 0 8px", fontFamily:"var(--font-display)", fontSize:22, fontWeight:700,
              color:"var(--navy)", lineHeight:1.3, letterSpacing:-0.3,
            }}>
              {item.titolo}
            </h1>
            {(item.comune || item.provincia) && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`}
                target="_blank" rel="noopener noreferrer"
                style={{ display:"inline-flex", alignItems:"center", gap:4, color:"var(--ink-muted)", fontSize:13, textDecoration:"none" }}
              >
                <Icon name="location_on" size={14} color="var(--terra)" />
                {[item.indirizzo, item.comune, item.provincia, item.regione].filter(Boolean).join(", ")}
              </a>
            )}
          </div>
          <div style={{ textAlign:"right", flexShrink:0 }}>
            <div style={{ fontSize:9.5, fontWeight:700, color:"var(--ink-muted)", textTransform:"uppercase", letterSpacing:0.8, marginBottom:4 }}>
              Prezzo base d'asta
            </div>
            <div style={{
              fontFamily:"var(--font-display)", fontWeight:700,
              fontSize:30, color:"var(--navy)", letterSpacing:-0.5, lineHeight:1,
            }}>
              {item.prezzo > 0 ? <>€ {fmt(item.prezzo)}</> : "N/D"}
            </div>
            {item.offerta_minima > 0 && (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:4, fontSize:12, color:"var(--green)", fontWeight:600, marginTop:5 }}>
                <Icon name="south" size={12} color="var(--green)" />
                Offerta min. € {fmt(item.offerta_minima)}
              </div>
            )}
          </div>
        </div>

        {/* Alert prominente: vendita di quota parziale (non 100% della proprietà) */}
        {(() => {
          const q = rilevaQuotaParziale(item, analisi);
          if (!q.parziale) return null;
          const quotaTxt = q.quota && !["parziale", "indivisa"].includes(q.quota)
            ? `una quota di ${q.quota}` : "solo una quota indivisa";
          return (
            <div style={{ margin: "16px 0 0" }}>
              <Callout level="danger" title="Attenzione: vendita di quota parziale"
                legal="Acquistando una quota indivisa diventi comproprietario insieme agli altri titolari (art. 1100 c.c.): non disponi liberamente del bene e di norma segue una divisione giudiziale o una nuova vendita dell'intero. Verifica sempre la quota negli atti prima di offrire.">
                Questa asta mette in vendita <strong>{quotaTxt}</strong> della proprietà, <strong>non il 100%</strong>.
              </Callout>
            </div>
          );
        })()}

        {/* Stats chips */}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", padding:"14px 0 22px" }}>
          {[
            c.superficie_mq ? { icon:"straighten", label:`${c.superficie_mq} m²` } : item.mq ? { icon:"straighten", label:`${item.mq} m²` } : null,
            c.vani ? { icon:"meeting_room", label:`${c.vani} locali` } : null,
            c.bagni ? { icon:"bathtub", label:`${c.bagni} bagno${c.bagni > 1 ? "i" : ""}` } : null,
            (c.piano || item.piano) ? { icon:"stairs", label:`Piano ${c.piano || item.piano}` } : null,
            c.anno_costruzione ? { icon:"calendar_month", label:String(c.anno_costruzione) } : null,
            c.classe_energetica ? { icon:"bolt", label:`Cl. ${c.classe_energetica}` } : null,
            item.tipo_vendita ? { icon:"gavel", label:item.tipo_vendita } : null,
            item.modalita_partecipazione ? { icon:(item.modalita_partecipazione||"").toLowerCase().includes("telematic") ? "computer" : "location_city", label:item.modalita_partecipazione } : null,
          ].filter(Boolean).map((chip, i) => (
            <div key={i} style={{
              display:"inline-flex", alignItems:"center", gap:5,
              padding:"5px 12px", borderRadius:20,
              background:"var(--white)", border:"1px solid var(--border)",
              fontSize:12.5, color:"var(--ink)", fontWeight:500,
            }}>
              <Icon name={chip.icon} size={13} color="var(--ink-muted)" />
              {chip.label}
            </div>
          ))}
        </div>

        {/* ── Tab di navigazione ── */}
        <div style={{ display:"flex", gap:4, borderBottom:"1px solid var(--border)", marginBottom:24 }}>
          {[
            { k:"panoramica",   icon:"description", label:"Panoramica" },
            { k:"businessplan", icon:"savings",      label:"Business Plan" },
          ].map(t => {
            const on = detailTab === t.k;
            return (
              <button key={t.k} onClick={() => setDetailTab(t.k)} style={{
                display:"flex", alignItems:"center", gap:7, padding:"11px 18px",
                background:"transparent", border:"none", cursor:"pointer",
                borderBottom:`2px solid ${on ? "var(--terra)" : "transparent"}`, marginBottom:-1,
                color: on ? "var(--navy)" : "var(--ink-muted)",
                fontWeight: on ? 700 : 500, fontSize:14, fontFamily:"var(--font-body)",
                transition:"color 0.15s",
              }}>
                <Icon name={t.icon} size={17} color={on ? "var(--terra)" : "var(--ink-muted)"} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* ── Grid: contenuto | sidebar (tab Panoramica) ── */}
        {detailTab === "panoramica" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 340px", gap:28, alignItems:"start" }}>

          {/* ── Colonna sinistra: contenuto ── */}
          <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

            {/* Descrizione */}
            {analisi?.descrizione_immobile ? (
              <div style={{ background:"var(--white)", borderRadius:12, padding:"22px 24px", border:"1px solid var(--border)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:14, fontSize:11, fontWeight:700, color:"var(--navy)", textTransform:"uppercase", letterSpacing:1 }}>
                  <Icon name="description" size={16} color="var(--terra)" /> Descrizione dell'immobile
                </div>
                <div style={{ fontSize:14, color:"var(--ink)", lineHeight:1.75, whiteSpace:"pre-line" }}>
                  {analisi.descrizione_immobile}
                </div>
                {badges.length > 0 && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:16, paddingTop:14, borderTop:"1px solid var(--border)" }}>
                    {badges.map((b, i) => (
                      <span key={i} style={{
                        display:"inline-flex", alignItems:"center", gap:4,
                        padding:"5px 12px", borderRadius:20,
                        background:"var(--green-bg)", color:"var(--green)", fontSize:12, fontWeight:600,
                      }}>
                        <Icon name={b.icon} size={14} color="var(--green)" /> {b.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ background:"var(--white)", borderRadius:12, padding:"22px 24px", border:"1px solid var(--border)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:14, fontSize:11, fontWeight:700, color:"var(--navy)", textTransform:"uppercase", letterSpacing:1 }}>
                  <Icon name="info" size={16} color="var(--terra)" /> Descrizione dal portale
                </div>
                <div style={{ fontSize:14, color:"var(--ink)", lineHeight:1.7 }}>{item.titolo}</div>
                <div style={{ marginTop:14, paddingTop:14, borderTop:"1px solid var(--border)", fontSize:12, color:"var(--ink-muted)", fontStyle:"italic" }}>
                  Avvia l'analisi della perizia per ottenere una descrizione dettagliata dell'immobile.
                </div>
              </div>
            )}

            {/* Caratteristiche */}
            {chars.length > 0 && (
              <div style={{ background:"var(--white)", borderRadius:12, padding:"22px 24px", border:"1px solid var(--border)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:14, fontSize:11, fontWeight:700, color:"var(--navy)", textTransform:"uppercase", letterSpacing:1 }}>
                  <Icon name="list_alt" size={16} color="var(--terra)" /> Caratteristiche
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:1, borderRadius:8, overflow:"hidden", border:"1px solid var(--border)" }}>
                  {chars.map((d, i) => (
                    <div key={d.label} style={{
                      background:"var(--cream)", padding:"12px 14px",
                      borderBottom: i < chars.length - 3 ? "1px solid var(--border)" : "none",
                      borderRight: (i + 1) % 3 !== 0 ? "1px solid var(--border)" : "none",
                    }}>
                      <div style={{ display:"flex", alignItems:"center", gap:4, fontSize:10, color:"var(--ink-muted)", fontWeight:600, textTransform:"uppercase", letterSpacing:0.4, marginBottom:3 }}>
                        <Icon name={d.icon} size={12} color="var(--ink-muted)" /> {d.label}
                      </div>
                      <div style={{ fontSize:14, fontWeight:600, color:"var(--ink)" }}>{d.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Analisi perizia */}
            {analisi && (
              <div style={{ background:"var(--white)", borderRadius:12, padding:"28px 32px", border:"1px solid var(--border)" }}>
                <AnalisiPanel analisi={analisi} finanze={finanze}
                  primaCasa={primaCasa} setPrimaCasa={setPrimaCasa}
                  prezzoValore={prezzoValore} setPrezzoValore={setPrezzoValore}
                  rendita={rendita} setRendita={setRendita} />
              </div>
            )}

            {/* Chat sulla perizia */}
            {analisi && <ChatPerizia item={item} />}

            {/* Errore analisi */}
            {analisiError && (
              <div style={{
                display:"flex", alignItems:"flex-start", gap:8,
                padding:"14px 16px", borderRadius:10,
                background:"#fef2f2", border:"1px solid #f5c6c6",
                color:"var(--red)", fontSize:13,
              }}>
                <Icon name="error_outline" size={18} color="var(--red)" style={{ marginTop:1, flexShrink:0 }} />
                <div>{analisiError}</div>
              </div>
            )}
          </div>

          {/* ── Sidebar destra (sticky) ── */}
          <div style={{ position:"sticky", top:70, display:"flex", flexDirection:"column", gap:10 }}>

            {/* Dati d'asta */}
            <div style={{
              background:"var(--white)", borderRadius:12, overflow:"hidden",
              border:"1px solid var(--border)", boxShadow:"0 1px 6px rgba(12,27,51,0.06)",
            }}>
              <div style={{
                padding:"14px 18px",
                background: days !== null && days <= 7 ? "#fef6f6" : "var(--cream)",
                borderBottom:"1px solid var(--border)",
                display:"flex", alignItems:"center", justifyContent:"space-between", gap:8,
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <Icon name="event" size={20} color={days !== null && days <= 7 ? "var(--red)" : "var(--terra)"} />
                  <div>
                    <div style={{ fontSize:9, fontWeight:700, color:"var(--ink-muted)", textTransform:"uppercase", letterSpacing:0.8, marginBottom:1 }}>
                      Data asta
                    </div>
                    <div style={{
                      fontSize:15, fontWeight:700, lineHeight:1.2,
                      color: item.data_asta ? "var(--navy)" : "var(--ink-muted)",
                    }}>
                      {fmtDate(item.data_asta) || "Non ancora fissata"}
                    </div>
                  </div>
                </div>
                {days !== null && (
                  <div style={{
                    fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:6,
                    background: days === 0 ? "var(--red)" : days <= 7 ? "#fdeaea" : "var(--terra-light)",
                    color: days === 0 ? "#fff" : days <= 7 ? "var(--red)" : "var(--terra)",
                  }}>
                    {days === 0 ? "Oggi" : days === 1 ? "Domani" : `${days}g`}
                  </div>
                )}
              </div>

              {(item.tipo_vendita || item.modalita_partecipazione) && (
                <div style={{ padding:"10px 18px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                  {item.tipo_vendita && (
                    <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <Icon name="gavel" size={13} color="var(--ink-muted)" />
                      <span style={{ fontSize:12, fontWeight:600, color:"var(--ink)" }}>{item.tipo_vendita}</span>
                    </div>
                  )}
                  {item.tipo_vendita && item.modalita_partecipazione && <span style={{ color:"var(--border)" }}>|</span>}
                  {item.modalita_partecipazione && (
                    <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <Icon
                        name={(item.modalita_partecipazione||"").toLowerCase().includes("telematic") ? "computer" : (item.modalita_partecipazione||"").toLowerCase().includes("mista") ? "devices" : "location_city"}
                        size={13} color="var(--ink-muted)"
                      />
                      <span style={{ fontSize:12, fontWeight:600, color:"var(--ink)" }}>{item.modalita_partecipazione}</span>
                    </div>
                  )}
                </div>
              )}

              {(item.tribunale || item.lotto) && (
                <div style={{ padding:"10px 18px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                  {item.tribunale && (
                    <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:11.5, color:"var(--ink-muted)" }}>
                      <Icon name="balance" size={13} color="var(--ink-muted)" /> Trib. {item.tribunale}
                    </div>
                  )}
                  {item.lotto && (
                    <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:11.5, color:"var(--ink-muted)" }}>
                      <Icon name="tag" size={13} color="var(--ink-muted)" /> {item.lotto}
                    </div>
                  )}
                </div>
              )}

              {finanze.roi != null && analisi?.valori_economici?.prezzo_mercato != null && (
                <div style={{
                  padding:"10px 18px",
                  background: finanze.roi > 0 ? "#f0faf5" : "#fef2f2",
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                }}>
                  <span style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, color:"var(--ink-muted)" }}>ROI stimato</span>
                  <span style={{
                    fontFamily:"var(--font-display)", fontWeight:700, fontSize:16,
                    color: finanze.roi > 0 ? "#1a5e36" : "var(--red)",
                  }}>
                    {finanze.roi > 0 ? "+" : ""}€ {fmt(Math.abs(finanze.roi))}
                  </span>
                </div>
              )}
            </div>

            {/* CTA */}
            {item.url_annuncio && (
              <a
                href={item.url_annuncio} target="_blank" rel="noopener noreferrer"
                style={{
                  display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                  background:"var(--navy)", color:"#fff", borderRadius:10,
                  padding:"13px 20px", textDecoration:"none",
                  fontWeight:600, fontSize:13.5, fontFamily:"var(--font-body)",
                  transition:"background 0.15s",
                  boxShadow:"0 2px 12px rgba(12,27,51,0.18)",
                }}
                onMouseEnter={e => e.currentTarget.style.background="var(--navy-soft)"}
                onMouseLeave={e => e.currentTarget.style.background="var(--navy)"}
              >
                <Icon name="open_in_new" size={16} color="#fff" /> Vedi annuncio ufficiale
              </a>
            )}

            {/* Strumenti */}
            <div style={{ background:"var(--white)", borderRadius:12, overflow:"hidden", border:"1px solid var(--border)" }}>
              <div style={{ padding:"10px 12px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                <button
                  onClick={handleAnalisi}
                  disabled={analisiLoading || !!analisi}
                  style={{
                    display:"flex", alignItems:"center", justifyContent:"center", gap:7,
                    background: analisi ? "var(--green)" : "var(--terra)",
                    color:"#fff", borderRadius:8,
                    padding:"10px 10px", border:"none",
                    fontWeight:600, fontSize:12,
                    cursor: analisiLoading || !!analisi ? "default" : "pointer",
                    opacity: analisi ? 0.88 : 1,
                    transition:"background 0.15s",
                    fontFamily:"var(--font-body)", position:"relative",
                  }}
                >
                  <Icon
                    name={analisi ? "check_circle" : analisiLoading ? "sync" : "analytics"}
                    size={16} color="#fff"
                    style={analisiLoading ? { animation:"spin 1s linear infinite" } : {}}
                  />
                  <span>{analisi ? "Analisi pronta" : analisiLoading ? "Analisi..." : "Analizza perizia"}</span>
                  {analisi && !analisiLoading && (
                    <button
                      onClick={e => { e.stopPropagation(); handleRianalizza(); }}
                      title="Rianalizza da zero"
                      style={{
                        position:"absolute", top:4, right:4,
                        background:"rgba(0,0,0,0.18)", border:"none", borderRadius:4,
                        padding:"2px", cursor:"pointer", display:"flex", alignItems:"center",
                      }}
                    >
                      <Icon name="refresh" size={11} color="rgba(255,255,255,0.9)" />
                    </button>
                  )}
                </button>

                <button
                  onClick={handleDocumenti}
                  disabled={docLoading || !!documenti}
                  style={{
                    display:"flex", alignItems:"center", justifyContent:"center", gap:7,
                    background:"var(--cream)", color:"var(--ink-muted)", borderRadius:8,
                    padding:"10px 10px", border:"1px solid var(--border)",
                    fontWeight:600, fontSize:12,
                    cursor: docLoading || !!documenti ? "default" : "pointer",
                    fontFamily:"var(--font-body)", transition:"background 0.15s",
                  }}
                >
                  <Icon
                    name={docLoading ? "sync" : documenti?.documenti?.length ? "folder" : "folder_open"}
                    size={16} color={documenti?.documenti?.length ? "var(--terra)" : "var(--ink-muted)"}
                    style={docLoading ? { animation:"spin 1s linear infinite" } : {}}
                  />
                  <span>{docLoading ? "Caricamento..." : documenti?.documenti?.length ? `${documenti.documenti.length} doc.` : "Documenti"}</span>
                </button>
              </div>

              {documenti && documenti.documenti.length > 0 && (
                <div style={{ borderTop:"1px solid var(--border)", display:"flex", flexDirection:"column" }}>
                  {documenti.documenti.map((doc, i) => (
                    <a
                      key={i} href={doc.url} target="_blank" rel="noopener noreferrer"
                      style={{
                        display:"flex", alignItems:"center", gap:8, padding:"9px 14px",
                        borderBottom: i < documenti.documenti.length - 1 ? "1px solid var(--border)" : "none",
                        textDecoration:"none", fontSize:11.5, color:"var(--ink)", transition:"background 0.12s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background="var(--cream)"}
                      onMouseLeave={e => e.currentTarget.style.background="transparent"}
                    >
                      <Icon name="picture_as_pdf" size={15} color="var(--red)" />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:600, fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{doc.titolo}</div>
                        <div style={{ fontSize:9.5, color:"var(--ink-muted)", textTransform:"uppercase", letterSpacing:0.3 }}>{doc.tipo}</div>
                      </div>
                      <Icon name="download" size={13} color="var(--ink-muted)" />
                    </a>
                  ))}
                </div>
              )}
              {documenti && documenti.documenti.length === 0 && (
                <div style={{ borderTop:"1px solid var(--border)", padding:"10px 14px", fontSize:11, color:"var(--ink-muted)", fontStyle:"italic", textAlign:"center" }}>
                  Nessun documento trovato.
                </div>
              )}

              {/* Correzioni */}
              <div style={{ borderTop:"1px solid var(--border)" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"9px 14px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:10.5, fontWeight:600, color:"var(--ink-muted)", textTransform:"uppercase", letterSpacing:0.4 }}>
                    <Icon name="edit_note" size={13} color="var(--ink-muted)" /> Correzioni
                  </div>
                  <button
                    onClick={() => { setEditOpen(v => !v); setEditError(null); }}
                    style={{
                      display:"flex", alignItems:"center", gap:3,
                      background:"transparent", border:"none", cursor:"pointer",
                      color:"var(--navy)", fontSize:11, fontWeight:600,
                      fontFamily:"var(--font-body)", padding:"3px 6px", borderRadius:5,
                    }}
                  >
                    <Icon name={editOpen ? "close" : "edit"} size={12} color="var(--navy)" />
                    {editOpen ? "Chiudi" : "Modifica"}
                  </button>
                </div>

                {!editOpen && (docsCustomFromItem(item).some(Boolean) || item.indirizzo) && (
                  <div style={{ padding:"0 14px 10px", display:"flex", flexDirection:"column", gap:4, fontSize:11, color:"var(--ink-muted)" }}>
                    {item.indirizzo && (
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <Icon name="pin_drop" size={11} color="var(--ink-muted)" />
                        <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.indirizzo}</span>
                      </div>
                    )}
                    {docsCustomFromItem(item).filter(Boolean).map((url, i, arr) => (
                      <div key={i} style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <Icon name="link" size={11} color="var(--terra)" />
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          style={{ color:"var(--navy)", textDecoration:"none", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {arr.length > 1 ? `Documento ${i + 1} (link manuale)` : "Perizia (link manuale)"}
                        </a>
                      </div>
                    ))}
                  </div>
                )}

                {editOpen && (
                  <div style={{ padding:"0 14px 12px", display:"flex", flexDirection:"column", gap:9 }}>
                    <div>
                      <label style={{ display:"block", fontSize:9.5, fontWeight:700, color:"var(--ink-muted)", textTransform:"uppercase", letterSpacing:0.4, marginBottom:4 }}>
                        Indirizzo
                      </label>
                      <input
                        type="text" value={editIndirizzo} onChange={e => setEditIndirizzo(e.target.value)}
                        placeholder="Via Roma 1, ..."
                        style={{ width:"100%", padding:"7px 10px", border:"1px solid var(--border)", borderRadius:6, fontSize:12, fontFamily:"var(--font-body)", background:"var(--cream)", color:"var(--ink)", boxSizing:"border-box" }}
                      />
                    </div>
                    <div>
                      <label style={{ display:"block", fontSize:9.5, fontWeight:700, color:"var(--ink-muted)", textTransform:"uppercase", letterSpacing:0.4, marginBottom:4 }}>
                        Documenti da analizzare (PDF)
                      </label>
                      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                        {editDocumenti.map((url, i) => (
                          <div key={i} style={{ display:"flex", alignItems:"center", gap:5 }}>
                            <input
                              type="url" value={url}
                              onChange={e => setEditDocumenti(docs => docs.map((d, j) => j === i ? e.target.value : d))}
                              placeholder="https://... (perizia, integrazione, allegato)"
                              style={{ flex:1, padding:"7px 10px", border:"1px solid var(--border)", borderRadius:6, fontSize:12, fontFamily:"var(--font-body)", background:"var(--cream)", color:"var(--ink)", boxSizing:"border-box" }}
                            />
                            {editDocumenti.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setEditDocumenti(docs => docs.filter((_, j) => j !== i))}
                                title="Rimuovi documento"
                                style={{ display:"flex", alignItems:"center", background:"transparent", border:"none", cursor:"pointer", padding:3, color:"var(--ink-muted)" }}
                              >
                                <Icon name="close" size={14} color="var(--ink-muted)" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditDocumenti(docs => [...docs, ""])}
                        style={{ display:"flex", alignItems:"center", gap:4, background:"transparent", border:"none", cursor:"pointer", color:"var(--navy)", fontSize:11, fontWeight:600, fontFamily:"var(--font-body)", padding:"5px 0 0", marginTop:2 }}
                      >
                        <Icon name="add" size={13} color="var(--navy)" /> Aggiungi documento
                      </button>
                      <div style={{ fontSize:10, color:"var(--ink-muted)", marginTop:3 }}>
                        I documenti elencati sostituiscono quelli dei portali e vengono analizzati insieme. Modificandoli l'analisi verrà rigenerata.
                      </div>
                    </div>
                    {editError && (
                      <div style={{ fontSize:11, color:"var(--red)", background:"#fef2f2", border:"1px solid #f5c6c6", borderRadius:5, padding:"5px 9px" }}>
                        {editError}
                      </div>
                    )}
                    <div style={{ display:"flex", gap:7 }}>
                      <button
                        onClick={handleSaveEdit} disabled={editSaving}
                        style={{
                          flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:5,
                          background:"var(--navy)", color:"#fff", border:"none", borderRadius:6, padding:"7px 10px",
                          fontSize:12, fontWeight:600, fontFamily:"var(--font-body)",
                          cursor: editSaving ? "default" : "pointer", opacity: editSaving ? 0.7 : 1,
                        }}
                      >
                        <Icon name={editSaving ? "sync" : "save"} size={13} color="#fff" style={editSaving ? { animation:"spin 1s linear infinite" } : {}} />
                        {editSaving ? "Salvataggio..." : "Salva"}
                      </button>
                      <button
                        onClick={() => { setEditOpen(false); setEditIndirizzo(item.indirizzo || ""); setEditDocumenti(docsCustomFromItem(item)); setEditError(null); }}
                        disabled={editSaving}
                        style={{
                          background:"var(--cream)", color:"var(--ink-muted)", border:"1px solid var(--border)", borderRadius:6, padding:"7px 12px",
                          fontSize:12, fontWeight:600, fontFamily:"var(--font-body)", cursor: editSaving ? "default" : "pointer",
                        }}
                      >
                        Annulla
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Fonte */}
              <div style={{ borderTop:"1px solid var(--border)", padding:"8px 14px", display:"flex", alignItems:"center", gap:7, background:"var(--cream)" }}>
                <span style={{ fontSize:10.5, color:"var(--ink-muted)", fontWeight:500 }}>Fonte:</span>
                <FonteBadge fonte={item.fonte} compact />
              </div>
            </div>

          </div>
          {/* Fine sidebar */}

        </div>
        )}
        {/* Fine grid */}

        {/* Business Plan generator (flipping) — tab dedicato */}
        {detailTab === "businessplan" && (
          <BusinessPlanPanel item={item} analisi={analisi} />
        )}

      </div>
    </div>
  );
}

function Skeleton({ index }) {
  return (
    <div style={{
      background:"var(--white)", borderRadius:"var(--radius)",
      border:"1px solid var(--border)",
      overflow:"hidden",
      animation: `fadeUp 0.3s ease ${index * 0.05}s both`,
    }}>
      <div style={{
        height:175,
        background:"linear-gradient(90deg, var(--cream-dark) 25%, var(--cream) 50%, var(--cream-dark) 75%)",
        backgroundSize:"800px 100%",
        animation:"shimmer 1.5s ease-in-out infinite",
      }} />
      <div style={{ padding:16 }}>
        {[65, 90, 45, 80].map((w, i) => (
          <div key={i} style={{
            height: i === 3 ? 22 : 12, width:`${w}%`,
            background:"var(--cream-dark)", borderRadius:4,
            marginBottom:10,
          }} />
        ))}
      </div>
    </div>
  );
}

// ─── App Principale ───────────────────────────────────────────────────────────

// Stato iniziale letto dall'URL: i filtri sono condivisibili via link.
const URL_INIT = (() => {
  const p = new URLSearchParams(window.location.search);
  return {
    search: p.get("q") || "",
    regione: p.get("regione") || "Tutte le regioni",
    provincia: p.get("provincia") || "",
    comune: p.get("comune") || "",
    tipi: (p.get("tipi") || "").split(",").filter(Boolean),
    fonti: (p.get("fonti") || "").split(",").filter(Boolean),
    prezzoMin: p.get("prezzo_min") || "",
    prezzoMax: p.get("prezzo_max") || "",
    dataInizio: p.get("da") || "",
    dataFine: p.get("a") || "",
    sortBy: p.get("sort") || "data_asta",
    id: p.get("id") || null,
  };
})();

export default function CaseAstaApp() {
  const [regione, setRegione]     = useState(URL_INIT.regione);
  const [provincia, setProvincia] = useState(URL_INIT.provincia);
  const [comune, setComune]       = useState(URL_INIT.comune);
  const [tipi, setTipi]           = useState(URL_INIT.tipi);
  const [fonti, setFonti]         = useState(URL_INIT.fonti);
  const [prezzoMin, setPrezzoMin] = useState(URL_INIT.prezzoMin);
  const [prezzoMax, setPrezzoMax] = useState(URL_INIT.prezzoMax);
  const [dataInizio, setDataInizio] = useState(URL_INIT.dataInizio);
  const [dataFine, setDataFine]   = useState(URL_INIT.dataFine);
  const [search, setSearch]       = useState(URL_INIT.search);
  const [sortBy, setSortBy]       = useState(URL_INIT.sortBy);
  const [facets, setFacets]       = useState(null);

  const [items, setItems]         = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [status, setStatus]       = useState(null);
  const [scraping, setScraping]   = useState(false);
  const [scrapeComplete, setScrapeComplete] = useState(false);
  const [selected, setSelected]   = useState(null);
  const [offset, setOffset]       = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView]           = useState("ricerca"); // "ricerca" | "businessplan"
  const [showWishlist, setShowWishlist] = useState(false);
  const [wishlist, setWishlist]   = useState(() => {
    try { return JSON.parse(localStorage.getItem("aste_wishlist") || "{}"); }
    catch { return {}; }
  });
  const [savedSearches, setSavedSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem("aste_saved_searches") || "[]"); }
    catch { return []; }
  });

  const toggleWishlist = useCallback((item) => {
    setWishlist(prev => {
      const next = { ...prev };
      if (next[item.id]) delete next[item.id];
      else next[item.id] = item;
      localStorage.setItem("aste_wishlist", JSON.stringify(next));
      return next;
    });
  }, []);

  const buildSearchLabel = (s, reg, prov, com, tipiSel, pMin, pMax) => {
    const parts = [];
    if (s) parts.push(`"${s}"`);
    if (com) parts.push(com);
    else if (prov) parts.push(prov);
    else if (reg !== "Tutte le regioni") parts.push(reg);
    if (tipiSel.length) parts.push(tipiSel.join(", "));
    if (pMin && pMax) parts.push(`€${Math.round(pMin/1000)}k–${Math.round(pMax/1000)}k`);
    else if (pMin) parts.push(`>€${Math.round(pMin/1000)}k`);
    else if (pMax) parts.push(`<€${Math.round(pMax/1000)}k`);
    return parts.join(" · ") || "Ricerca";
  };

  const saveSearch = useCallback(() => {
    const name = buildSearchLabel(search, regione, provincia, comune, tipi, prezzoMin, prezzoMax);
    const entry = {
      id: Date.now(),
      name,
      filters: { search, regione, provincia, comune, tipi, fonti, prezzoMin, prezzoMax, dataInizio, dataFine, sortBy },
    };
    setSavedSearches(prev => {
      const next = [...prev, entry];
      localStorage.setItem("aste_saved_searches", JSON.stringify(next));
      return next;
    });
  }, [search, regione, provincia, comune, tipi, fonti, prezzoMin, prezzoMax, dataInizio, dataFine, sortBy]);

  const applySearch = useCallback((entry) => {
    const f = entry.filters;
    setSearch(f.search || "");
    setRegione(f.regione || "Tutte le regioni");
    setProvincia(f.provincia || "");
    setComune(f.comune || "");
    // Le ricerche salvate prima del multi-tipo hanno `tipo` stringa singola.
    setTipi(Array.isArray(f.tipi) ? f.tipi : (f.tipo && f.tipo !== "Tutti" ? [f.tipo] : []));
    setFonti(Array.isArray(f.fonti) ? f.fonti : []);
    setPrezzoMin(f.prezzoMin || "");
    setPrezzoMax(f.prezzoMax || "");
    setDataInizio(f.dataInizio || "");
    setDataFine(f.dataFine || "");
    setSortBy(f.sortBy || "data_asta");
    setOffset(0);
  }, []);

  const deleteSavedSearch = useCallback((id) => {
    setSavedSearches(prev => {
      const next = prev.filter(s => s.id !== id);
      localStorage.setItem("aste_saved_searches", JSON.stringify(next));
      return next;
    });
  }, []);

  const debounceRef = useRef(null);
  const LIMIT = 30;

  const prevScraping = useRef(false);
  const needsReload = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/status`);
      if (r.ok) {
        const d = await r.json();
        setStatus(d);

        // Se lo scraping era in corso e ora e' finito, segnala reload
        if (prevScraping.current && !d.scraping_in_progress) {
          setScraping(false);
          setScrapeComplete(true);
          setTimeout(() => setScrapeComplete(false), 5000);
          needsReload.current = true;
        }
        prevScraping.current = d.scraping_in_progress;

        if (d.scraping_in_progress) {
          setScraping(true);
          setTimeout(fetchStatus, 3000);
        }
      }
    } catch { setStatus(null); }
  }, []);

  const fetchImmobili = useCallback(async (currentOffset = 0) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: currentOffset, sort: sortBy });
      if (regione !== "Tutte le regioni") params.set("regione", regione);
      if (provincia) params.set("provincia", provincia);
      if (comune) params.set("comune", comune);
      if (tipi.length) params.set("tipo", tipi.join(","));
      if (fonti.length) params.set("fonte", fonti.join(","));
      if (prezzoMin) params.set("prezzo_min", prezzoMin);
      if (prezzoMax) params.set("prezzo_max", prezzoMax);
      if (dataInizio) params.set("data_inizio", dataInizio);
      if (dataFine) params.set("data_fine", dataFine);
      if (search) params.set("q", search);

      const r = await fetch(`${API_BASE}/immobili?${params}`);
      if (!r.ok) throw new Error(`Errore API: ${r.status}`);
      const data = await r.json();

      setItems(currentOffset === 0 ? data.items : prev => [...prev, ...data.items]);
      setTotal(data.total);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [regione, provincia, comune, tipi, fonti, prezzoMin, prezzoMax, dataInizio, dataFine, search, sortBy]);

  const handleScrape = async () => {
    setScraping(true);
    try {
      const params = new URLSearchParams();
      if (regione !== "Tutte le regioni") params.set("regione", regione);
      // Lo scraper accetta un solo tipo: lo si passa solo se la selezione e' univoca.
      if (tipi.length === 1) params.set("tipo", tipi[0]);
      if (prezzoMin) params.set("prezzo_min", prezzoMin);
      if (prezzoMax) params.set("prezzo_max", prezzoMax);
      if (dataFine) params.set("data_fine", dataFine);
      await fetch(`${API_BASE}/scrape?${params}`, { method: "POST" });
      // Il polling in fetchStatus gestisce il resto
      await fetchStatus();
    } catch (e) {
      setScraping(false);
      setError("Errore avvio scraping: " + e.message);
    }
  };

  const resetFilters = () => {
    setRegione("Tutte le regioni"); setTipi([]);
    setProvincia(""); setComune(""); setFonti([]);
    setPrezzoMin(""); setPrezzoMax("");
    setDataInizio(""); setDataFine(""); setSearch(""); setSortBy("data_asta");
    setOffset(0);
  };

  const activeFilterCount = [
    regione !== "Tutte le regioni", provincia, comune,
    tipi.length > 0, fonti.length > 0,
    prezzoMin, prezzoMax, dataInizio, dataFine,
  ].filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0;
  const hasAnyFilter = Boolean(search) || hasActiveFilters;

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Ricarica dati quando lo scraping finisce
  useEffect(() => {
    if (needsReload.current && status && !status.scraping_in_progress) {
      needsReload.current = false;
      setOffset(0);
      fetchImmobili(0);
    }
  }, [status]);

  const requestFetch = useCallback((delay) => {
    setOffset(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchImmobili(0), delay);
  }, [fetchImmobili]);

  // Campi di testo: debounce pieno per non rilanciare la fetch a ogni tasto.
  useEffect(() => { requestFetch(300); }, [search, comune, prezzoMin, prezzoMax]);

  // Select e date: fetch quasi immediata. Al mount i due effect coalescono
  // (il secondo cancella il timer del primo) → una sola fetch iniziale.
  useEffect(() => { requestFetch(10); }, [regione, provincia, tipi, fonti, dataInizio, dataFine, sortBy]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // Valori distinti per i filtri (facets), limitati a regione/provincia correnti.
  useEffect(() => {
    const params = new URLSearchParams();
    if (regione !== "Tutte le regioni") params.set("regione", regione);
    if (provincia) params.set("provincia", provincia);
    fetch(`${API_BASE}/facets?${params}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setFacets(d); })
      .catch(() => {});
  }, [regione, provincia]);

  // ── Persistenza URL e navigazione dettaglio ──
  const itemsRef = useRef([]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  // id richiesto via deep-link ma non ancora caricato: va preservato nell'URL.
  const pendingIdRef = useRef(URL_INIT.id);

  const buildUrl = useCallback((detailId) => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (regione !== "Tutte le regioni") p.set("regione", regione);
    if (provincia) p.set("provincia", provincia);
    if (comune) p.set("comune", comune);
    if (tipi.length) p.set("tipi", tipi.join(","));
    if (fonti.length) p.set("fonti", fonti.join(","));
    if (prezzoMin) p.set("prezzo_min", prezzoMin);
    if (prezzoMax) p.set("prezzo_max", prezzoMax);
    if (dataInizio) p.set("da", dataInizio);
    if (dataFine) p.set("a", dataFine);
    if (sortBy !== "data_asta") p.set("sort", sortBy);
    if (detailId) p.set("id", detailId);
    const qs = p.toString();
    return qs ? `?${qs}` : window.location.pathname;
  }, [search, regione, provincia, comune, tipi, fonti, prezzoMin, prezzoMax, dataInizio, dataFine, sortBy]);

  // I filtri usano replaceState: niente entry di history mentre si digita.
  useEffect(() => {
    const id = selected ? selected.id : pendingIdRef.current;
    window.history.replaceState(window.history.state, "", buildUrl(id));
  }, [buildUrl, selected]);

  const openDetail = useCallback((item) => {
    setSelected(item);
    window.history.pushState({ detail: true }, "", buildUrl(item.id));
  }, [buildUrl]);

  const closeDetail = useCallback(() => {
    if (window.history.state?.detail) {
      window.history.back(); // il popstate qui sotto azzera selected
    } else {
      // Arrivo da deep-link: nessuna entry di history da cui tornare.
      setSelected(null);
      pendingIdRef.current = null;
      window.history.replaceState(window.history.state, "", buildUrl(null));
    }
  }, [buildUrl]);

  const loadDetail = useCallback(async (id) => {
    const local = itemsRef.current.find(i => i.id === id);
    if (local) { setSelected(local); pendingIdRef.current = null; return; }
    try {
      const r = await fetch(`${API_BASE}/immobili/${encodeURIComponent(id)}`);
      if (r.ok) {
        setSelected(await r.json());
        pendingIdRef.current = null;
        return;
      }
    } catch { /* backend non raggiungibile */ }
    pendingIdRef.current = null;
    window.history.replaceState(window.history.state, "", buildUrl(null));
  }, [buildUrl]);

  // Tasto Indietro/Avanti: apre o chiude il dettaglio in base a ?id nell'URL.
  useEffect(() => {
    const onPop = () => {
      const id = new URLSearchParams(window.location.search).get("id");
      if (!id) { setSelected(null); pendingIdRef.current = null; }
      else loadDetail(id);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [loadDetail]);

  // Deep-link: ?id presente nell'URL all'apertura della pagina.
  useEffect(() => {
    if (URL_INIT.id) loadDetail(URL_INIT.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inputBase = {
    padding:"9px 12px", borderRadius:7, border:"1px solid var(--border)",
    fontSize:13, background:"var(--white)", color:"var(--ink)",
    width:"100%", boxSizing:"border-box",
    fontFamily:"var(--font-body)",
    transition:"border-color 0.15s, box-shadow 0.15s",
  };

  const filterLabel = {
    display:"block", fontSize:11, fontWeight:600, color:"var(--ink-muted)",
    marginBottom:4, textTransform:"uppercase", letterSpacing:0.3,
  };

  const chipBase = {
    padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:600,
    cursor:"pointer", fontFamily:"var(--font-body)", transition:"all 0.15s",
    border:"1px solid var(--border)", background:"var(--cream)", color:"var(--ink-light)",
  };

  const tipiOptions = facets?.tipi
    ?? TIPOLOGIE.filter(t => t !== "Tutti").map(t => ({ value: t, count: null }));
  const fontiOptions = facets?.fonti
    ?? Object.keys(FONTI_INFO).map(f => ({ value: f, count: null }));
  const regioniOptions = facets?.regioni?.length
    ? [{ value: "Tutte le regioni", count: null }, ...facets.regioni]
    : REGIONI.map(r => ({ value: r, count: null }));

  return (
    <div style={{ fontFamily:"var(--font-body)", background:"var(--cream)", minHeight:"100vh" }}>

      {/* ── Header ── */}
      <header style={{
        background:"var(--navy)", padding:"20px 24px",
        color:"#fff", position:"relative", overflow:"hidden",
      }}>
        {/* Subtle pattern */}
        <div style={{
          position:"absolute", inset:0, opacity:0.04,
          backgroundImage: `repeating-linear-gradient(90deg, #fff 0px, #fff 1px, transparent 1px, transparent 60px),
                            repeating-linear-gradient(0deg, #fff 0px, #fff 1px, transparent 1px, transparent 60px)`,
        }} />
        <div style={{ maxWidth:1200, margin:"0 auto", position:"relative" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <div style={{
                width:38, height:38, borderRadius:8,
                background:"rgba(255,255,255,0.12)",
                display:"flex", alignItems:"center", justifyContent:"center",
              }}>
                <Icon name="gavel" size={22} color="#fff" />
              </div>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <h1 style={{
                    margin:0, fontFamily:"var(--font-display)",
                    fontSize:17, fontWeight:700, letterSpacing:-0.2,
                  }}>
                    Case all'Asta
                  </h1>
                  <span style={{
                    background:"var(--terra)", borderRadius:4,
                    padding:"2px 8px", fontSize:9, fontWeight:700,
                    letterSpacing:1, textTransform:"uppercase",
                  }}>Live</span>
                </div>
                <p style={{ margin:0, opacity:0.5, fontSize:11, marginTop:2 }}>
                  Dati in tempo reale da PVP — Ministero della Giustizia e portali autorizzati
                </p>
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              {/* Nav sezioni */}
              <nav style={{
                display:"flex", gap:4, background:"rgba(255,255,255,0.08)",
                border:"1px solid rgba(255,255,255,0.12)", borderRadius:9, padding:4,
              }}>
                {[
                  { k:"ricerca",      icon:"search",  label:"Ricerca" },
                  { k:"businessplan", icon:"savings", label:"Business Plan" },
                ].map(v => {
                  const on = view === v.k;
                  return (
                    <button key={v.k} onClick={() => setView(v.k)}
                      style={{
                        display:"flex", alignItems:"center", gap:6,
                        background: on ? "#fff" : "transparent",
                        border:"none", borderRadius:6, padding:"7px 14px", cursor:"pointer",
                        color: on ? "var(--navy)" : "rgba(255,255,255,0.75)",
                        fontSize:13, fontWeight:600, fontFamily:"var(--font-body)", transition:"all 0.15s",
                      }}>
                      <Icon name={v.icon} size={16} color={on ? "var(--navy)" : "rgba(255,255,255,0.75)"} />
                      {v.label}
                    </button>
                  );
                })}
              </nav>

              {view === "ricerca" && (
                <button
                  onClick={() => setShowWishlist(v => !v)}
                  style={{
                    display:"flex", alignItems:"center", gap:7,
                    background: showWishlist ? "rgba(239,68,68,0.25)" : "rgba(255,255,255,0.1)",
                    border: showWishlist ? "1px solid rgba(239,68,68,0.5)" : "1px solid rgba(255,255,255,0.15)",
                    borderRadius:8, padding:"8px 16px", cursor:"pointer",
                    color: showWishlist ? "#fca5a5" : "#fff",
                    fontSize:13, fontWeight:600, fontFamily:"var(--font-body)", transition:"all 0.15s",
                  }}
                >
                  <Icon name={showWishlist ? "favorite" : "favorite_border"} size={18} color={showWishlist ? "#fca5a5" : "#fff"} />
                  Preferiti
                  {Object.keys(wishlist).length > 0 && (
                    <span style={{
                      background: showWishlist ? "#fca5a5" : "var(--red)",
                      color:"#fff", borderRadius:10,
                      minWidth:18, height:18, fontSize:11, fontWeight:700,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      padding:"0 5px",
                    }}>
                      {Object.keys(wishlist).length}
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {view === "ricerca" && (
        <StatusBar status={status} onScrape={handleScrape} scraping={scraping} scrapeComplete={scrapeComplete} />
      )}

      <div style={{ maxWidth:1200, margin:"0 auto", padding:"20px 24px 40px" }}>

        {view === "businessplan" && <BusinessPlanLibero />}

        {view === "ricerca" && (<>

        {/* ── Search + Filters ── */}
        <div style={{ marginBottom:24 }}>
          {/* Main search row */}
          <div style={{
            display:"flex", gap:10, alignItems:"stretch",
            background:"var(--white)", borderRadius:"var(--radius)",
            border:"1px solid var(--border)", padding:6,
            boxShadow:"0 1px 4px rgba(0,0,0,0.04)",
          }}>
            <div style={{ flex:1, display:"flex", alignItems:"center", gap:8, padding:"0 10px" }}>
              <Icon name="search" size={20} color="var(--ink-muted)" />
              <input
                className="no-focus-ring"
                style={{
                  border:"none", outline:"none", fontSize:14, background:"transparent",
                  color:"var(--ink)", width:"100%", padding:"10px 0",
                  fontFamily:"var(--font-body)",
                }}
                placeholder="Cerca per comune, provincia, regione, tipologia, indirizzo..."
                aria-label="Cerca immobili"
                value={search} onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              <select
                aria-label="Filtra per regione"
                style={{
                  ...inputBase, width:"auto", minWidth:140,
                  border: regione !== "Tutte le regioni" ? "1px solid var(--navy)" : "1px solid var(--border)",
                  background: regione !== "Tutte le regioni" ? "#eef1f7" : "var(--cream)",
                }}
                value={regione}
                onChange={e => { setRegione(e.target.value); setProvincia(""); setComune(""); }}
              >
                {regioniOptions.map(r => (
                  <option key={r.value} value={r.value}>
                    {r.count != null ? `${r.value} (${fmt(r.count)})` : r.value}
                  </option>
                ))}
              </select>
              <select
                aria-label="Ordina risultati"
                style={{
                  ...inputBase, width:"auto", minWidth:100,
                  background:"var(--cream)",
                }}
                value={sortBy} onChange={e => setSortBy(e.target.value)}
              >
                <option value="data_asta">Data asta</option>
                <option value="prezzo">Prezzo ↑</option>
                <option value="-prezzo">Prezzo ↓</option>
                <option value="offerta_minima">Offerta min ↑</option>
                <option value="-offerta_minima">Offerta min ↓</option>
                <option value="-mq">Superficie ↓</option>
              </select>
              <button
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen(!filtersOpen)}
                style={{
                  display:"flex", alignItems:"center", gap:4,
                  padding:"9px 14px", borderRadius:7,
                  border: hasActiveFilters ? "1px solid var(--terra)" : "1px solid var(--border)",
                  background: hasActiveFilters ? "var(--terra-light)" : "var(--cream)",
                  color: hasActiveFilters ? "var(--terra)" : "var(--ink-light)",
                  cursor:"pointer", fontSize:12, fontWeight:600,
                  fontFamily:"var(--font-body)",
                  transition:"all 0.15s",
                }}
              >
                <Icon name="tune" size={16} color={hasActiveFilters ? "var(--terra)" : "var(--ink-muted)"} />
                Filtri
                {hasActiveFilters && (
                  <span style={{
                    background:"var(--terra)", color:"#fff", borderRadius:"50%",
                    width:16, height:16, fontSize:10, fontWeight:700,
                    display:"flex", alignItems:"center", justifyContent:"center",
                  }}>
                    {activeFilterCount}
                  </span>
                )}
              </button>
              {hasAnyFilter && (
                <button
                  onClick={saveSearch}
                  title="Salva questa ricerca"
                  style={{
                    display:"flex", alignItems:"center", gap:4,
                    padding:"9px 12px", borderRadius:7,
                    border:"1px solid var(--border)",
                    background:"var(--cream)", color:"var(--ink-light)",
                    cursor:"pointer", fontSize:12, fontWeight:600,
                    fontFamily:"var(--font-body)", transition:"all 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor="var(--navy)"; e.currentTarget.style.color="var(--navy)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.color="var(--ink-light)"; }}
                >
                  <Icon name="bookmark_add" size={16} color="currentColor" />
                  Salva
                </button>
              )}
            </div>
          </div>

          {/* Ricerche salvate */}
          {savedSearches.length > 0 && (
            <div style={{
              display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginTop:8,
            }}>
              <span style={{
                display:"flex", alignItems:"center", gap:4,
                fontSize:11, color:"var(--ink-muted)", fontWeight:600,
                whiteSpace:"nowrap",
              }}>
                <Icon name="bookmarks" size={13} color="var(--ink-muted)" />
                Salvate:
              </span>
              {savedSearches.map(s => (
                <div key={s.id} style={{
                  display:"inline-flex", alignItems:"center", gap:3,
                  padding:"4px 6px 4px 10px", borderRadius:20,
                  background:"var(--white)", border:"1px solid var(--border)",
                  fontSize:12, color:"var(--ink)",
                  transition:"border-color 0.15s",
                }}>
                  <span
                    onClick={() => applySearch(s)}
                    style={{ cursor:"pointer", lineHeight:1 }}
                    title="Applica ricerca"
                  >
                    {s.name}
                  </span>
                  <button
                    onClick={() => deleteSavedSearch(s.id)}
                    title="Rimuovi"
                    style={{
                      display:"flex", alignItems:"center", justifyContent:"center",
                      background:"none", border:"none", cursor:"pointer",
                      padding:"1px", borderRadius:"50%", color:"var(--ink-muted)",
                      lineHeight:1,
                    }}
                  >
                    <Icon name="close" size={13} color="var(--ink-muted)" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Expanded filters */}
          {filtersOpen && (
            <div style={{
              background:"var(--white)", borderRadius:"0 0 var(--radius) var(--radius)",
              border:"1px solid var(--border)", borderTop:"none",
              padding:"16px 18px", marginTop:-1,
              display:"flex", flexDirection:"column", gap:14,
              animation:"fadeUp 0.2s ease",
            }}>
              <div style={{
                display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))",
                gap:12, alignItems:"end",
              }}>
                <div>
                  <label htmlFor="filtro-provincia" style={filterLabel}>Provincia</label>
                  <select
                    id="filtro-provincia" style={inputBase} value={provincia}
                    onChange={e => { setProvincia(e.target.value); setComune(""); }}
                  >
                    <option value="">Tutte</option>
                    {(facets?.province || []).map(p => (
                      <option key={p.value} value={p.value}>{p.value} ({fmt(p.count)})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="filtro-comune" style={filterLabel}>Comune</label>
                  <input
                    id="filtro-comune" list="comuni-list" style={inputBase}
                    placeholder={facets?.comuni?.length ? "Cerca comune..." : "Prima scegli regione o provincia"}
                    value={comune} onChange={e => setComune(e.target.value)}
                  />
                  <datalist id="comuni-list">
                    {(facets?.comuni || []).map(c => <option key={c.value} value={c.value} />)}
                  </datalist>
                </div>
                <div>
                  <label htmlFor="filtro-prezzo-min" style={filterLabel}>Prezzo min €</label>
                  <input id="filtro-prezzo-min" type="number" style={inputBase} placeholder="20.000" value={prezzoMin} onChange={e => setPrezzoMin(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="filtro-prezzo-max" style={filterLabel}>Prezzo max €</label>
                  <input id="filtro-prezzo-max" type="number" style={inputBase} placeholder="200.000" value={prezzoMax} onChange={e => setPrezzoMax(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="filtro-data-inizio" style={filterLabel}>Asta dal</label>
                  <input id="filtro-data-inizio" type="date" style={inputBase} value={dataInizio} onChange={e => setDataInizio(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="filtro-data-fine" style={filterLabel}>Asta entro il</label>
                  <input id="filtro-data-fine" type="date" style={inputBase} value={dataFine} onChange={e => setDataFine(e.target.value)} />
                </div>
              </div>
              <div>
                <span style={filterLabel}>Tipologia</span>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {tipiOptions.map(t => {
                    const active = tipi.includes(t.value);
                    return (
                      <button
                        key={t.value} aria-pressed={active}
                        onClick={() => setTipi(prev =>
                          active ? prev.filter(x => x !== t.value) : [...prev, t.value])}
                        style={{
                          ...chipBase,
                          border: active ? "1px solid var(--navy)" : "1px solid var(--border)",
                          background: active ? "#eef1f7" : "var(--cream)",
                          color: active ? "var(--navy)" : "var(--ink-light)",
                        }}
                      >
                        {t.value}{t.count != null ? ` (${fmt(t.count)})` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", gap:12, flexWrap:"wrap" }}>
                <div>
                  <span style={filterLabel}>Fonte</span>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {fontiOptions.map(f => {
                      const active = fonti.includes(f.value);
                      const color = FONTI_INFO[f.value]?.color || "var(--navy)";
                      return (
                        <button
                          key={f.value} aria-pressed={active}
                          onClick={() => setFonti(prev =>
                            active ? prev.filter(x => x !== f.value) : [...prev, f.value])}
                          style={{
                            ...chipBase,
                            border: active ? `1px solid ${color}` : "1px solid var(--border)",
                            background: active ? color + "14" : "var(--cream)",
                            color: active ? color : "var(--ink-light)",
                          }}
                        >
                          {FONTI_INFO[f.value]?.label || f.value}{f.count != null ? ` (${fmt(f.count)})` : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  onClick={resetFilters}
                  style={{
                    display:"flex", alignItems:"center", gap:4,
                    padding:"9px 14px", borderRadius:7, border:"1px solid var(--border)",
                    background:"var(--cream)", cursor:"pointer", fontSize:12, color:"var(--ink-muted)",
                    fontWeight:600, fontFamily:"var(--font-body)", whiteSpace:"nowrap",
                  }}
                >
                  <Icon name="restart_alt" size={15} color="var(--ink-muted)" /> Reset
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Results header ── */}
        {!loading && !showWishlist && (
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:16 }}>
            <div style={{ fontSize:13, color:"var(--ink-light)" }}>
              <span style={{
                fontFamily:"var(--font-display)", fontWeight:700, fontSize:18, color:"var(--navy)", marginRight:6,
              }}>
                {fmt(total)}
              </span>
              immobil{total === 1 ? "e" : "i"}
            </div>
            <div style={{ fontSize:11, color:"var(--ink-muted)" }}>
              {items.length} di {fmt(total)} caricati
            </div>
          </div>
        )}
        {showWishlist && (
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"var(--ink-light)" }}>
              <Icon name="favorite" size={16} color="var(--red)" />
              <span style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:18, color:"var(--navy)" }}>
                {Object.keys(wishlist).length}
              </span>
              preferit{Object.keys(wishlist).length === 1 ? "o salvato" : "i salvati"}
            </div>
            {Object.keys(wishlist).length > 0 && (
              <button
                onClick={() => { setWishlist({}); localStorage.removeItem("aste_wishlist"); }}
                style={{
                  display:"flex", alignItems:"center", gap:4,
                  padding:"5px 12px", borderRadius:6, border:"1px solid var(--border)",
                  background:"var(--cream)", cursor:"pointer", fontSize:11,
                  color:"var(--ink-muted)", fontFamily:"var(--font-body)",
                }}
              >
                <Icon name="delete_outline" size={14} color="var(--ink-muted)" /> Svuota
              </button>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            display:"flex", alignItems:"flex-start", gap:10,
            padding:"14px 18px", borderRadius:"var(--radius)",
            background:"#fef2f2", border:"1px solid #f5c6c6",
            color:"var(--red)", marginBottom:20, fontSize:13,
          }}>
            <Icon name="error_outline" size={18} color="var(--red)" style={{ marginTop:1 }} />
            <div>
              {error}
              {error.includes("fetch") && (
                <div style={{ marginTop:6, fontSize:12, color:"var(--ink-muted)" }}>
                  Assicurati che il backend FastAPI sia avviato: <code style={{ background:"var(--cream)", padding:"1px 5px", borderRadius:3 }}>python -m api.main</code>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Grid ── */}
        {showWishlist && Object.keys(wishlist).length === 0 && (
          <div style={{ textAlign:"center", padding:"80px 20px", color:"var(--ink-muted)" }}>
            <div style={{
              width:64, height:64, borderRadius:"50%", margin:"0 auto 16px",
              background:"var(--cream-dark)", display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              <Icon name="favorite_border" size={28} color="var(--ink-muted)" />
            </div>
            <div style={{ fontFamily:"var(--font-display)", fontWeight:600, fontSize:17, color:"var(--ink-light)", marginBottom:6 }}>
              Nessun preferito salvato
            </div>
            <div style={{ fontSize:13 }}>Clicca il cuore su una card per salvare un immobile</div>
          </div>
        )}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(310px, 1fr))", gap:18 }}>
          {showWishlist
            ? Object.values(wishlist).map((item, i) => (
                <CardImmobile key={item.id} item={item} onClick={openDetail} index={i}
                  isWishlisted={true} onToggleWishlist={toggleWishlist} />
              ))
            : loading && items.length === 0
              ? Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} index={i} />)
              : items.map((item, i) => (
                  <CardImmobile key={item.id} item={item} onClick={openDetail} index={i}
                    isWishlisted={!!wishlist[item.id]} onToggleWishlist={toggleWishlist} />
                ))
          }
        </div>

        {/* Empty state */}
        {!loading && items.length === 0 && !error && (
          <div style={{ textAlign:"center", padding:"80px 20px", color:"var(--ink-muted)" }}>
            <div style={{
              width:64, height:64, borderRadius:"50%", margin:"0 auto 16px",
              background:"var(--cream-dark)",
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              <Icon name={status?.count === 0 ? "search_off" : "filter_list_off"} size={28} color="var(--ink-muted)" />
            </div>
            <div style={{ fontFamily:"var(--font-display)", fontWeight:600, fontSize:17, color:"var(--ink-light)", marginBottom:6 }}>
              {status?.count === 0
                ? "Nessun dato disponibile"
                : "Nessun immobile corrisponde ai filtri"}
            </div>
            <div style={{ fontSize:13, marginBottom:20 }}>
              {status?.count === 0
                ? "Avvia lo scraping per popolare il database"
                : "Prova a modificare i criteri di ricerca"}
            </div>
            {status?.count === 0 && (
              <button
                onClick={handleScrape}
                style={{
                  display:"inline-flex", alignItems:"center", gap:6,
                  padding:"11px 24px", borderRadius:8,
                  background:"var(--navy)", color:"#fff", border:"none",
                  fontWeight:600, cursor:"pointer", fontSize:13,
                  fontFamily:"var(--font-body)",
                }}
              >
                <Icon name="rocket_launch" size={16} color="#fff" /> Avvia primo scraping
              </button>
            )}
          </div>
        )}

        {/* Load more */}
        {items.length < total && !loading && (
          <div style={{ textAlign:"center", marginTop:28 }}>
            <button
              onClick={() => {
                const newOffset = offset + LIMIT;
                setOffset(newOffset);
                fetchImmobili(newOffset);
              }}
              style={{
                display:"inline-flex", alignItems:"center", gap:6,
                padding:"11px 32px", borderRadius:8, border:"1px solid var(--border)",
                background:"var(--white)", cursor:"pointer", fontWeight:600,
                fontSize:13, color:"var(--ink-light)",
                fontFamily:"var(--font-body)",
                transition:"all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor="var(--navy)"; e.currentTarget.style.color="var(--navy)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.color="var(--ink-light)"; }}
            >
              <Icon name="expand_more" size={18} />
              Carica altri ({fmt(total - items.length)} rimanenti)
            </button>
          </div>
        )}

        </>)}

        {/* ── Footer ── */}
        <footer style={{
          marginTop:40, paddingTop:20,
          borderTop:"1px solid var(--border)",
          display:"flex", flexWrap:"wrap", alignItems:"center", justifyContent:"space-between", gap:12,
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--ink-muted)" }}>
            <Icon name="verified" size={14} color="var(--ink-muted)" />
            Fonti ufficiali — Sezione A Min. Giustizia
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {Object.entries(FONTI_INFO).map(([k, f]) => (
              <a key={k} href={f.url} target="_blank" rel="noopener noreferrer"
                style={{
                  display:"inline-flex", alignItems:"center", gap:3,
                  fontSize:10, color:f.color, textDecoration:"none",
                  background:f.color+"0a", border:`1px solid ${f.color}20`,
                  borderRadius:4, padding:"3px 8px", fontWeight:600,
                  transition:"background 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.background=f.color+"18"}
                onMouseLeave={e => e.currentTarget.style.background=f.color+"0a"}
              >
                {f.label}
                <Icon name="north_east" size={10} color={f.color} />
              </a>
            ))}
          </div>
        </footer>
      </div>

      <DetailPage item={selected} onClose={closeDetail}
        isWishlisted={selected ? !!wishlist[selected.id] : false}
        onToggleWishlist={toggleWishlist}
        onItemUpdate={(updated) => {
          setSelected(updated);
          setItems(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i));
        }} />
    </div>
  );
}
