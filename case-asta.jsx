/**
 * Case all'Asta — Frontend React
 * Si connette al backend FastAPI su http://localhost:8000
 * Dati reali da PVP (Ministero Giustizia) e portali autorizzati
 */

import { useState, useEffect, useCallback, useRef } from "react";

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

        {/* Overlay data asta */}
        {item.data_asta && (
          <div style={{
            position:"absolute", top:10, left:10,
            background:"var(--white)", color:"var(--navy)",
            borderRadius:6, padding:"4px 9px",
            fontSize:11, fontWeight:600,
            display:"flex", alignItems:"center", gap:4,
            boxShadow:"0 2px 8px rgba(0,0,0,0.12)",
          }}>
            <Icon name="event" size={13} color="var(--navy)" />
            {fmtDate(item.data_asta)}
          </div>
        )}

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

function AnalisiPanel({ analisi }) {
  if (!analisi) return null;

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
                  B − C − D − E
                </div>
              </div>
              <div style={{
                fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700,
                fontVariantNumeric: "tabular-nums", letterSpacing: -0.4,
              }}>
                {euro(pf.prezzo_massimo_offerta)}
              </div>
            </div>
            <div style={{
              background: pf.roi_potenziale > 0 ? "#e8f5ee" : pf.roi_potenziale < 0 ? "#fdeaea" : "var(--cream)",
              padding: "13px 16px",
              display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "baseline",
              borderTop: "1px solid var(--border)",
            }}>
              <div>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase",
                  color: pf.roi_potenziale > 0 ? "#1a5e36" : pf.roi_potenziale < 0 ? "#8a1616" : "var(--ink-light)",
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
                  color: pf.roi_potenziale > 0 ? "#1a5e36" : pf.roi_potenziale < 0 ? "#8a1616" : "var(--ink)",
                  fontVariantNumeric: "tabular-nums", letterSpacing: -0.3,
                }}>
                  {pf.roi_potenziale == null ? "—" : `${pf.roi_potenziale > 0 ? "+" : pf.roi_potenziale < 0 ? "−" : ""}${euro(Math.abs(pf.roi_potenziale))}`}
                </div>
                {pf.roi_percentuale != null && (
                  <div style={{
                    fontSize: 11.5, fontWeight: 700,
                    color: pf.roi_potenziale > 0 ? "#1a5e36" : pf.roi_potenziale < 0 ? "#8a1616" : "var(--ink-muted)",
                    fontFamily: "var(--font-display)",
                  }}>
                    {pf.roi_potenziale > 0 ? "+" : ""}{pf.roi_percentuale}%
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

function DetailPage({ item, onClose, isWishlisted, onToggleWishlist, onItemUpdate }) {
  const [analisi, setAnalisi] = useState(null);
  const [analisiLoading, setAnalisiLoading] = useState(false);
  const [analisiError, setAnalisiError] = useState(null);
  const [documenti, setDocumenti] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editIndirizzo, setEditIndirizzo] = useState("");
  const [editPeriziaUrl, setEditPeriziaUrl] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const prevItemId = useRef(null);

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
      setEditIndirizzo(item?.indirizzo || "");
      setEditPeriziaUrl(item?.perizia_url_custom || "");
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
      const body = {
        indirizzo: editIndirizzo.trim(),
        perizia_url: editPeriziaUrl.trim(),
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
      // Se e' stato aggiornato l'URL perizia, invalida l'analisi cached
      if (body.perizia_url && body.perizia_url !== (item.perizia_url_custom || "")) {
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

      {/* ── Hero image — larghezza piena ── */}
      <div style={{ width:"100%", position:"relative", background:"var(--cream-dark)", overflow:"hidden" }}>
        <PropertyImage src={proxyImg(item.immagine)} tipo={item.tipo} height={400} urlAnnuncio={!item.immagine ? item.url_annuncio : null} />
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

      {/* ── Contenuto principale ── */}
      <div style={{ maxWidth:1100, margin:"0 auto", padding:"0 24px 60px" }}>

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

        {/* ── Grid: contenuto | sidebar ── */}
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
                <AnalisiPanel analisi={analisi} />
              </div>
            )}

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
              {item.data_asta && (
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
                      <div style={{ fontSize:15, fontWeight:700, color:"var(--navy)", lineHeight:1.2 }}>
                        {fmtDate(item.data_asta)}
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
              )}

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

              {analisi?.risultati_finanziari?.roi_assoluta != null && analisi?.valori_economici?.prezzo_mercato != null && (
                <div style={{
                  padding:"10px 18px",
                  background: analisi.risultati_finanziari.roi_assoluta > 0 ? "#f0faf5" : "#fef2f2",
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                }}>
                  <span style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5, color:"var(--ink-muted)" }}>ROI stimato</span>
                  <span style={{
                    fontFamily:"var(--font-display)", fontWeight:700, fontSize:16,
                    color: analisi.risultati_finanziari.roi_assoluta > 0 ? "#1a5e36" : "var(--red)",
                  }}>
                    {analisi.risultati_finanziari.roi_assoluta > 0 ? "+" : ""}€ {fmt(Math.abs(analisi.risultati_finanziari.roi_assoluta))}
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

                {!editOpen && (item.perizia_url_custom || item.indirizzo) && (
                  <div style={{ padding:"0 14px 10px", display:"flex", flexDirection:"column", gap:4, fontSize:11, color:"var(--ink-muted)" }}>
                    {item.indirizzo && (
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <Icon name="pin_drop" size={11} color="var(--ink-muted)" />
                        <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.indirizzo}</span>
                      </div>
                    )}
                    {item.perizia_url_custom && (
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <Icon name="link" size={11} color="var(--terra)" />
                        <a href={item.perizia_url_custom} target="_blank" rel="noopener noreferrer"
                          style={{ color:"var(--navy)", textDecoration:"none", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          Perizia (link manuale)
                        </a>
                      </div>
                    )}
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
                        URL perizia (PDF)
                      </label>
                      <input
                        type="url" value={editPeriziaUrl} onChange={e => setEditPeriziaUrl(e.target.value)}
                        placeholder="https://..."
                        style={{ width:"100%", padding:"7px 10px", border:"1px solid var(--border)", borderRadius:6, fontSize:12, fontFamily:"var(--font-body)", background:"var(--cream)", color:"var(--ink)", boxSizing:"border-box" }}
                      />
                      {item.perizia_url_custom && (
                        <div style={{ fontSize:10, color:"var(--ink-muted)", marginTop:3 }}>Cambiandolo l'analisi verrà rigenerata.</div>
                      )}
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
                        onClick={() => { setEditOpen(false); setEditIndirizzo(item.indirizzo || ""); setEditPeriziaUrl(item.perizia_url_custom || ""); setEditError(null); }}
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
        {/* Fine grid */}

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

export default function CaseAstaApp() {
  const [regione, setRegione]     = useState("Tutte le regioni");
  const [tipo, setTipo]           = useState("Tutti");
  const [prezzoMin, setPrezzoMin] = useState("");
  const [prezzoMax, setPrezzoMax] = useState("");
  const [dataFine, setDataFine]   = useState("");
  const [search, setSearch]       = useState("");
  const [sortBy, setSortBy]       = useState("data_asta");

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

  const buildSearchLabel = (s, reg, tip, pMin, pMax) => {
    const parts = [];
    if (s) parts.push(`"${s}"`);
    if (reg !== "Tutte le regioni") parts.push(reg);
    if (tip !== "Tutti") parts.push(tip);
    if (pMin && pMax) parts.push(`€${Math.round(pMin/1000)}k–${Math.round(pMax/1000)}k`);
    else if (pMin) parts.push(`>€${Math.round(pMin/1000)}k`);
    else if (pMax) parts.push(`<€${Math.round(pMax/1000)}k`);
    return parts.join(" · ") || "Ricerca";
  };

  const saveSearch = useCallback(() => {
    const name = buildSearchLabel(search, regione, tipo, prezzoMin, prezzoMax);
    const entry = {
      id: Date.now(),
      name,
      filters: { search, regione, tipo, prezzoMin, prezzoMax, dataFine, sortBy },
    };
    setSavedSearches(prev => {
      const next = [...prev, entry];
      localStorage.setItem("aste_saved_searches", JSON.stringify(next));
      return next;
    });
  }, [search, regione, tipo, prezzoMin, prezzoMax, dataFine, sortBy]);

  const applySearch = useCallback((entry) => {
    const f = entry.filters;
    setSearch(f.search || "");
    setRegione(f.regione || "Tutte le regioni");
    setTipo(f.tipo || "Tutti");
    setPrezzoMin(f.prezzoMin || "");
    setPrezzoMax(f.prezzoMax || "");
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
      if (tipo !== "Tutti") params.set("tipo", tipo);
      if (prezzoMin) params.set("prezzo_min", prezzoMin);
      if (prezzoMax) params.set("prezzo_max", prezzoMax);
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
  }, [regione, tipo, prezzoMin, prezzoMax, dataFine, search, sortBy]);

  const handleScrape = async () => {
    setScraping(true);
    try {
      const params = new URLSearchParams();
      if (regione !== "Tutte le regioni") params.set("regione", regione);
      if (tipo !== "Tutti") params.set("tipo", tipo);
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
    setRegione("Tutte le regioni"); setTipo("Tutti");
    setPrezzoMin(""); setPrezzoMax("");
    setDataFine(""); setSearch(""); setSortBy("data_asta");
    setOffset(0);
  };

  const hasActiveFilters = regione !== "Tutte le regioni" || tipo !== "Tutti" ||
    prezzoMin || prezzoMax || dataFine;
  const hasAnyFilter = search || regione !== "Tutte le regioni" || tipo !== "Tutti" ||
    prezzoMin || prezzoMax || dataFine;

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Ricarica dati quando lo scraping finisce
  useEffect(() => {
    if (needsReload.current && status && !status.scraping_in_progress) {
      needsReload.current = false;
      setOffset(0);
      fetchImmobili(0);
    }
  }, [status]);

  useEffect(() => {
    setOffset(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchImmobili(0), 300);
    return () => clearTimeout(debounceRef.current);
  }, [regione, tipo, prezzoMin, prezzoMax, dataFine, search, sortBy]);

  const inputBase = {
    padding:"9px 12px", borderRadius:7, border:"1px solid var(--border)",
    fontSize:13, background:"var(--white)", color:"var(--ink)",
    width:"100%", boxSizing:"border-box",
    fontFamily:"var(--font-body)",
    transition:"border-color 0.15s, box-shadow 0.15s",
  };

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
          </div>
        </div>
      </header>

      <StatusBar status={status} onScrape={handleScrape} scraping={scraping} scrapeComplete={scrapeComplete} />

      <div style={{ maxWidth:1200, margin:"0 auto", padding:"20px 24px 40px" }}>

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
                value={search} onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              <select
                style={{
                  ...inputBase, width:"auto", minWidth:140,
                  border: regione !== "Tutte le regioni" ? "1px solid var(--navy)" : "1px solid var(--border)",
                  background: regione !== "Tutte le regioni" ? "#eef1f7" : "var(--cream)",
                }}
                value={regione} onChange={e => setRegione(e.target.value)}
              >
                {REGIONI.map(r => <option key={r}>{r}</option>)}
              </select>
              <select
                style={{
                  ...inputBase, width:"auto", minWidth:100,
                  background:"var(--cream)",
                }}
                value={sortBy} onChange={e => setSortBy(e.target.value)}
              >
                <option value="data_asta">Data asta</option>
                <option value="prezzo">Prezzo ↑</option>
                <option value="-prezzo">Prezzo ↓</option>
              </select>
              <button
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
                    {[regione !== "Tutte le regioni", tipo !== "Tutti", prezzoMin, prezzoMax, dataFine].filter(Boolean).length}
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
              display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr auto", gap:12, alignItems:"end",
              animation:"fadeUp 0.2s ease",
            }}>
              <div>
                <label style={{ display:"block", fontSize:11, fontWeight:600, color:"var(--ink-muted)", marginBottom:4, textTransform:"uppercase", letterSpacing:0.3 }}>
                  Tipologia
                </label>
                <select style={inputBase} value={tipo} onChange={e => setTipo(e.target.value)}>
                  {TIPOLOGIE.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display:"block", fontSize:11, fontWeight:600, color:"var(--ink-muted)", marginBottom:4, textTransform:"uppercase", letterSpacing:0.3 }}>
                  Prezzo min €
                </label>
                <input type="number" style={inputBase} placeholder="20.000" value={prezzoMin} onChange={e => setPrezzoMin(e.target.value)} />
              </div>
              <div>
                <label style={{ display:"block", fontSize:11, fontWeight:600, color:"var(--ink-muted)", marginBottom:4, textTransform:"uppercase", letterSpacing:0.3 }}>
                  Prezzo max €
                </label>
                <input type="number" style={inputBase} placeholder="200.000" value={prezzoMax} onChange={e => setPrezzoMax(e.target.value)} />
              </div>
              <div>
                <label style={{ display:"block", fontSize:11, fontWeight:600, color:"var(--ink-muted)", marginBottom:4, textTransform:"uppercase", letterSpacing:0.3 }}>
                  Asta entro il
                </label>
                <input type="date" style={inputBase} value={dataFine} onChange={e => setDataFine(e.target.value)} />
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
                <CardImmobile key={item.id} item={item} onClick={setSelected} index={i}
                  isWishlisted={true} onToggleWishlist={toggleWishlist} />
              ))
            : loading && items.length === 0
              ? Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} index={i} />)
              : items.map((item, i) => (
                  <CardImmobile key={item.id} item={item} onClick={setSelected} index={i}
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

      <DetailPage item={selected} onClose={() => setSelected(null)}
        isWishlisted={selected ? !!wishlist[selected.id] : false}
        onToggleWishlist={toggleWishlist}
        onItemUpdate={(updated) => {
          setSelected(updated);
          setItems(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i));
        }} />
    </div>
  );
}
