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
  pvp:             { label:"PVP — Min. Giustizia",  color:"#0c1b33", url:"https://pvp.giustizia.it/pvp/" },
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

function AnalisiPanel({ analisi }) {
  if (!analisi) return null;

  const c = analisi.caratteristiche || {};

  const rischioPossesso = analisi.titolo_opponibile
    ? { label: "RISCHIO ALTO — Titolo opponibile", bg: "#fef2f2", border: "#f5c6c6", color: "var(--red)", icon: "dangerous" }
    : analisi.occupato
      ? { label: "Occupato — Titolo non opponibile", bg: "#fffbeb", border: "#f3dfa0", color: "#a07800", icon: "warning_amber" }
      : { label: "Libero", bg: "#e8f5ee", border: "#c2dece", color: "#1a5e36", icon: "check_circle" };

  const sectionStyle = {
    background: "var(--cream)", borderRadius: 8, padding: "14px 16px",
    border: "1px solid var(--border)", marginBottom: 12,
  };
  const sectionTitle = (icon, text) => (
    <div style={{
      display: "flex", alignItems: "center", gap: 6, marginBottom: 10,
      fontSize: 11, fontWeight: 700, color: "var(--ink-muted)",
      textTransform: "uppercase", letterSpacing: 0.4,
    }}>
      <Icon name={icon} size={14} color="var(--ink-muted)" /> {text}
    </div>
  );

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

  return (
    <div style={{ animation: "fadeUp 0.3s ease" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 14,
        fontSize: 13, fontWeight: 700, color: "var(--navy)",
        textTransform: "uppercase", letterSpacing: 0.4,
      }}>
        <Icon name="analytics" size={18} color="var(--terra)" />
        Analisi Perizia
      </div>

      {/* ── Scheda Tecnica ── */}
      {scheda.length > 0 && (
        <div style={sectionStyle}>
          {sectionTitle("fact_check", "Scheda Tecnica")}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            gap: 0, borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)",
          }}>
            {scheda.map((d, i) => (
              <div key={d.label} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 12px", background: "var(--white)",
                borderBottom: i < scheda.length - 2 ? "1px solid var(--border)" : "none",
                borderRight: i % 2 === 0 ? "1px solid var(--border)" : "none",
              }}>
                <Icon name={d.icon} size={16} color="var(--terra)" />
                <div>
                  <div style={{ fontSize: 10, color: "var(--ink-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>
                    {d.label}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
                    {d.value}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Extra features badges */}
          {extras.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {extras.map((b, i) => (
                <span key={i} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "4px 10px", borderRadius: 16,
                  background: "var(--green-bg)", color: "var(--green)",
                  fontSize: 11, fontWeight: 600,
                }}>
                  <Icon name={b.icon} size={13} color="var(--green)" /> {b.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Indirizzo e Catasto ── */}
      {(analisi.indirizzo_estratto || analisi.lotto_identificazione) && (
        <div style={sectionStyle}>
          {sectionTitle("location_on", "Indirizzo e Catasto")}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {analisi.indirizzo_estratto && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink)" }}>
                <Icon name="pin_drop" size={14} color="var(--ink-muted)" /> {analisi.indirizzo_estratto}
              </div>
            )}
            {analisi.lotto_identificazione && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-muted)" }}>
                <Icon name="tag" size={14} color="var(--ink-muted)" /> Catasto: {analisi.lotto_identificazione}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Stato di Possesso ── */}
      <div style={sectionStyle}>
        {sectionTitle("meeting_room", "Stato di Possesso")}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 12px", borderRadius: 6,
          background: rischioPossesso.bg,
          border: `1px solid ${rischioPossesso.border}`,
          marginBottom: analisi.dettagli_possesso ? 10 : 0,
        }}>
          <Icon name={rischioPossesso.icon} size={18} color={rischioPossesso.color} />
          <span style={{ fontSize: 13, fontWeight: 700, color: rischioPossesso.color }}>
            {rischioPossesso.label}
          </span>
        </div>
        {analisi.dettagli_possesso && (
          <div style={{ fontSize: 12, color: "var(--ink-light)", lineHeight: 1.5 }}>
            {analisi.dettagli_possesso}
          </div>
        )}
      </div>

      {/* ── Conformita Edilizia ── */}
      <div style={sectionStyle}>
        {sectionTitle("architecture", "Conformita Edilizia")}
        {analisi.abusi_edilizi && analisi.abusi_edilizi.length > 0 ? (
          <div style={{ borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 70px 90px",
              background: "var(--navy)", color: "#fff",
              fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
            }}>
              <div style={{ padding: "6px 10px" }}>Abuso</div>
              <div style={{ padding: "6px 10px", textAlign: "center" }}>Sanabile</div>
              <div style={{ padding: "6px 10px", textAlign: "right" }}>Costo</div>
            </div>
            {analisi.abusi_edilizi.map((a, i) => (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "1fr 70px 90px",
                borderBottom: i < analisi.abusi_edilizi.length - 1 ? "1px solid var(--border)" : "none",
                background: a.sanabile ? "#f0fdf4" : "#fef2f2",
                fontSize: 12,
              }}>
                <div style={{ padding: "8px 10px", color: "var(--ink)" }}>{a.descrizione}</div>
                <div style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700, color: a.sanabile ? "#1a5e36" : "var(--red)" }}>
                  {a.sanabile ? "Si" : "No"}
                </div>
                <div style={{ padding: "8px 10px", textAlign: "right", color: "var(--ink-light)" }}>
                  {a.costo_stima ? `€ ${fmt(a.costo_stima)}` : "—"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 12px", borderRadius: 6,
            background: "#e8f5ee", border: "1px solid #c2dece",
            fontSize: 12, fontWeight: 600, color: "#1a5e36",
          }}>
            <Icon name="check_circle" size={16} color="#1a5e36" />
            Nessun abuso edilizio rilevato
          </div>
        )}
        {analisi.conformita_note && (
          <div style={{ fontSize: 12, color: "var(--ink-light)", marginTop: 10, lineHeight: 1.5 }}>
            {analisi.conformita_note}
          </div>
        )}
      </div>

      {/* ── Stima Economica ── */}
      <div style={{
        ...sectionStyle,
        background: analisi.prezzo_mercato != null
          ? (analisi.roi_stimato > 0 ? "#f0fdf4" : analisi.roi_stimato < 0 ? "#fef2f2" : "var(--cream)")
          : "var(--cream)",
        border: analisi.prezzo_mercato != null
          ? (analisi.roi_stimato > 0 ? "1px solid #c2dece" : analisi.roi_stimato < 0 ? "1px solid #f5c6c6" : "1px solid var(--border)")
          : "1px solid var(--border)",
      }}>
        {sectionTitle("trending_up", "Stima Economica")}

        {analisi.prezzo_mercato != null ? (
          <div style={{ fontSize: 13 }}>
            {[
              { label: "Valore di mercato (da perizia)", value: analisi.prezzo_mercato, sign: "+" },
              { label: "Offerta minima", value: analisi.offerta_minima, sign: "−" },
              { label: "Costi sanatoria", value: analisi.costi_sanatoria, sign: "−" },
              { label: "Spese condominiali", value: analisi.spese_condominiali, sign: "−" },
            ].map((r, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "5px 0",
                borderBottom: i < 3 ? "1px solid rgba(0,0,0,0.06)" : "none",
                color: r.value != null ? "var(--ink)" : "var(--ink-muted)",
              }}>
                <span>{r.label}</span>
                <span style={{ fontWeight: 600, fontFamily: "var(--font-display)" }}>
                  {r.value != null ? `${r.sign} € ${fmt(r.value)}` : "N/D"}
                </span>
              </div>
            ))}
            <div style={{
              borderTop: "2px solid var(--border)", marginTop: 8, paddingTop: 8,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>ROI Stimato (perizia)</span>
              <span style={{
                fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 20,
                color: analisi.roi_stimato > 0 ? "#1a5e36" : analisi.roi_stimato < 0 ? "var(--red)" : "var(--ink)",
              }}>
                {analisi.roi_stimato != null ? `${analisi.roi_stimato > 0 ? "+" : ""}€ ${fmt(Math.abs(analisi.roi_stimato))}` : "N/D"}
              </span>
            </div>
            {/* Fonte del valore di mercato */}
            {analisi.fonte_prezzo_mercato && (
              <div style={{
                marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(0,0,0,0.06)",
                fontSize: 11, color: "var(--ink-muted)", lineHeight: 1.5, fontStyle: "italic",
              }}>
                <Icon name="format_quote" size={13} color="var(--ink-muted)" style={{ verticalAlign: "text-bottom", marginRight: 3 }} />
                {analisi.fonte_prezzo_mercato}
              </div>
            )}
          </div>
        ) : (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            padding: "10px 12px", borderRadius: 6,
            background: "#fffbeb", border: "1px solid #f3dfa0",
            fontSize: 12, color: "#8a6d00", lineHeight: 1.5,
          }}>
            <Icon name="info" size={16} color="#a07800" style={{ marginTop: 1, flexShrink: 0 }} />
            <div>
              <strong>Valore di mercato non disponibile.</strong> La perizia non contiene una stima esplicita del valore di mercato dell'immobile. Il calcolo del ROI non puo' essere effettuato.
              {(analisi.costi_sanatoria > 0 || analisi.spese_condominiali > 0) && (
                <div style={{ marginTop: 6 }}>
                  Costi rilevati dalla perizia:
                  {analisi.costi_sanatoria > 0 && <> sanatoria € {fmt(analisi.costi_sanatoria)}</>}
                  {analisi.costi_sanatoria > 0 && analisi.spese_condominiali > 0 && <>,</>}
                  {analisi.spese_condominiali > 0 && <> spese condominiali € {fmt(analisi.spese_condominiali)}</>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Quotazioni OMI ufficiali ── */}
        {analisi.quotazioni_omi && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "2px solid var(--border)" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6, marginBottom: 10,
              fontSize: 11, fontWeight: 700, color: "var(--ink-muted)",
              textTransform: "uppercase", letterSpacing: 0.4,
            }}>
              <Icon name="account_balance" size={14} color="var(--ink-muted)" />
              Quotazioni OMI — Agenzia delle Entrate
            </div>

            {/* Range €/m² */}
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              {[
                { label: "Min €/m²", value: analisi.quotazioni_omi.cotazione_min_mq },
                { label: "Max €/m²", value: analisi.quotazioni_omi.cotazione_max_mq },
              ].map((r, i) => (
                <div key={i} style={{
                  flex: 1, minWidth: 100, padding: "10px 12px", borderRadius: 6,
                  background: "var(--white)", border: "1px solid var(--border)", textAlign: "center",
                }}>
                  <div style={{
                    fontSize: 10, color: "var(--ink-muted)", fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4,
                  }}>{r.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--ink)" }}>
                    € {fmt(r.value)}
                  </div>
                </div>
              ))}
            </div>

            {/* Valore totale — solo se superficie nota */}
            {analisi.quotazioni_omi.valore_medio != null ? (
              <>
                <div style={{ fontSize: 12, color: "var(--ink-muted)", marginBottom: 6 }}>
                  Valore stimato totale (media €/m² × superficie):
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", fontSize: 12 }}>
                  {[
                    { label: "Minimo",  value: analisi.quotazioni_omi.valore_min },
                    { label: "Massimo", value: analisi.quotazioni_omi.valore_max },
                    { label: "Medio",   value: analisi.quotazioni_omi.valore_medio, highlight: true },
                  ].map((r, i) => (
                    <div key={i} style={{
                      flex: 1, minWidth: 80, padding: "8px 10px", borderRadius: 6, textAlign: "center",
                      background: r.highlight ? "#f0f7ff" : "var(--white)",
                      border:     r.highlight ? "1px solid #b3d4f5" : "1px solid var(--border)",
                    }}>
                      <div style={{
                        fontSize: 10, color: "var(--ink-muted)", fontWeight: 600,
                        textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3,
                      }}>{r.label}</div>
                      <div style={{
                        fontWeight: 700, fontFamily: "var(--font-display)",
                        color: r.highlight ? "#1a4a7a" : "var(--ink)",
                      }}>
                        € {fmt(r.value)}
                      </div>
                    </div>
                  ))}
                </div>

                {/* ROI basato su OMI */}
                {analisi.roi_omi != null && (
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 12px", borderRadius: 6,
                    background: analisi.roi_omi > 0 ? "#e8f5ee" : "#fef2f2",
                    border:     analisi.roi_omi > 0 ? "1px solid #c2dece" : "1px solid #f5c6c6",
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>
                      ROI Stimato (OMI)
                    </span>
                    <span style={{
                      fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16,
                      color: analisi.roi_omi > 0 ? "#1a5e36" : "var(--red)",
                    }}>
                      {analisi.roi_omi > 0 ? "+" : ""}€ {fmt(Math.abs(analisi.roi_omi))}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 11, color: "var(--ink-muted)", fontStyle: "italic", marginTop: 4 }}>
                Superficie non disponibile — impossibile calcolare il valore totale stimato.
              </div>
            )}

            {/* Attribution */}
            <div style={{ marginTop: 10, fontSize: 10, color: "var(--ink-muted)", display: "flex", gap: 12, flexWrap: "wrap" }}>
              {analisi.quotazioni_omi.semestre && (
                <span>
                  <Icon name="calendar_today" size={11} color="var(--ink-muted)" style={{ verticalAlign: "middle", marginRight: 2 }} />
                  {analisi.quotazioni_omi.semestre}
                </span>
              )}
              {analisi.quotazioni_omi.n_zone > 1 && (
                <span>
                  <Icon name="map" size={11} color="var(--ink-muted)" style={{ verticalAlign: "middle", marginRight: 2 }} />
                  Media su {analisi.quotazioni_omi.n_zone} zone
                </span>
              )}
              <span style={{ fontStyle: "italic" }}>{analisi.quotazioni_omi.fonte}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Footer: PDF + meta ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 8, flexWrap: "wrap",
      }}>
        {analisi.fonte_pdf_url && (
          <a
            href={analisi.fonte_pdf_url} target="_blank" rel="noopener noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              fontSize: 12, fontWeight: 600, color: "var(--navy)",
              textDecoration: "none", padding: "6px 12px",
              background: "var(--cream)", borderRadius: 6,
              border: "1px solid var(--border)", transition: "background 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "var(--cream-dark)"}
            onMouseLeave={e => e.currentTarget.style.background = "var(--cream)"}
          >
            <Icon name="picture_as_pdf" size={16} color="var(--red)" />
            Apri perizia PDF
          </a>
        )}
        <div style={{ fontSize: 10, color: "var(--ink-muted)" }}>
          Analizzato il {analisi.analizzato_il ? new Date(analisi.analizzato_il).toLocaleString("it-IT") : "N/D"}
          {analisi.pagine_analizzate && <> &middot; {analisi.pagine_analizzate} pagine</>}
        </div>
      </div>
    </div>
  );
}

function DetailPage({ item, onClose, isWishlisted, onToggleWishlist }) {
  const [analisi, setAnalisi] = useState(null);
  const [analisiLoading, setAnalisiLoading] = useState(false);
  const [analisiError, setAnalisiError] = useState(null);
  const [documenti, setDocumenti] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const prevItemId = useRef(null);

  // Reset stato e carica analisi cached quando cambia immobile
  useEffect(() => {
    if (item?.id !== prevItemId.current) {
      setAnalisi(null);
      setAnalisiError(null);
      setAnalisiLoading(false);
      setDocumenti(null);
      setDocLoading(false);
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
          {item.url_annuncio && (
            <a
              href={item.url_annuncio} target="_blank" rel="noopener noreferrer"
              style={{
                display:"flex", alignItems:"center", gap:5,
                padding:"7px 14px", borderRadius:6,
                background:"rgba(255,255,255,0.1)", color:"#fff",
                fontSize:12, fontWeight:600, textDecoration:"none",
                transition:"background 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,0.18)"}
              onMouseLeave={e => e.currentTarget.style.background="rgba(255,255,255,0.1)"}
            >
              <Icon name="open_in_new" size={15} color="#fff" /> Annuncio ufficiale
            </a>
          )}
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

      <div style={{ maxWidth:900, margin:"0 auto", padding:"0 24px 60px" }}>

        {/* ── Hero image ── */}
        <div style={{ borderRadius:"0 0 14px 14px", overflow:"hidden", marginBottom:28, boxShadow:"0 4px 20px rgba(0,0,0,0.1)" }}>
          <PropertyImage src={proxyImg(item.immagine)} tipo={item.tipo} height={320} urlAnnuncio={!item.immagine ? item.url_annuncio : null} />
        </div>

        {/* ── Header: titolo + location ── */}
        <div style={{ marginBottom:24 }}>
          {(item.comune || item.provincia || item.indirizzo) && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`}
              target="_blank" rel="noopener noreferrer"
              style={{ display:"inline-flex", alignItems:"center", gap:5, color:"var(--ink-muted)", fontSize:13, textDecoration:"none", marginBottom:8 }}
              onMouseEnter={e => e.currentTarget.style.color="var(--navy)"}
              onMouseLeave={e => e.currentTarget.style.color="var(--ink-muted)"}
            >
              <Icon name="location_on" size={16} color="currentColor" /> {location}
            </a>
          )}
          <h1 style={{
            fontFamily:"var(--font-display)", fontSize:26, fontWeight:700,
            color:"var(--navy)", lineHeight:1.35, margin:0,
          }}>
            {item.titolo}
          </h1>
        </div>

        {/* ── Layout a due colonne ── */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 340px", gap:28, alignItems:"start" }}>

          {/* ── Colonna sinistra: contenuto ── */}
          <div>
            {/* Descrizione immobile dall'analisi */}
            {analisi?.descrizione_immobile && (
              <div style={{
                background:"var(--white)", borderRadius:12, padding:"22px 24px", marginBottom:20,
                border:"1px solid var(--border)",
              }}>
                <div style={{
                  display:"flex", alignItems:"center", gap:7, marginBottom:14,
                  fontSize:13, fontWeight:700, color:"var(--navy)", textTransform:"uppercase", letterSpacing:0.4,
                }}>
                  <Icon name="description" size={18} color="var(--terra)" /> Descrizione dell'immobile
                </div>
                <div style={{
                  fontSize:14, color:"var(--ink)", lineHeight:1.75,
                  whiteSpace:"pre-line",
                }}>
                  {analisi.descrizione_immobile}
                </div>

                {/* Feature badges */}
                {badges.length > 0 && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:16, paddingTop:14, borderTop:"1px solid var(--border)" }}>
                    {badges.map((b, i) => (
                      <span key={i} style={{
                        display:"inline-flex", alignItems:"center", gap:4,
                        padding:"5px 12px", borderRadius:20,
                        background:"var(--green-bg)", color:"var(--green)",
                        fontSize:12, fontWeight:600,
                      }}>
                        <Icon name={b.icon} size={14} color="var(--green)" /> {b.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Titolo originale (se non c'e' ancora analisi) */}
            {!analisi?.descrizione_immobile && (
              <div style={{
                background:"var(--white)", borderRadius:12, padding:"22px 24px", marginBottom:20,
                border:"1px solid var(--border)",
              }}>
                <div style={{
                  display:"flex", alignItems:"center", gap:7, marginBottom:14,
                  fontSize:13, fontWeight:700, color:"var(--navy)", textTransform:"uppercase", letterSpacing:0.4,
                }}>
                  <Icon name="info" size={18} color="var(--terra)" /> Descrizione dal portale
                </div>
                <div style={{ fontSize:14, color:"var(--ink)", lineHeight:1.7 }}>
                  {item.titolo}
                </div>
                <div style={{
                  marginTop:14, paddingTop:14, borderTop:"1px solid var(--border)",
                  fontSize:12, color:"var(--ink-muted)", fontStyle:"italic",
                }}>
                  Avvia l'analisi della perizia per ottenere una descrizione dettagliata dell'immobile.
                </div>
              </div>
            )}

            {/* Caratteristiche griglia */}
            <div style={{
              background:"var(--white)", borderRadius:12, padding:"22px 24px", marginBottom:20,
              border:"1px solid var(--border)",
            }}>
              <div style={{
                display:"flex", alignItems:"center", gap:7, marginBottom:14,
                fontSize:13, fontWeight:700, color:"var(--navy)", textTransform:"uppercase", letterSpacing:0.4,
              }}>
                <Icon name="list_alt" size={18} color="var(--terra)" /> Caratteristiche
              </div>
              <div style={{
                display:"grid", gridTemplateColumns:"1fr 1fr 1fr",
                gap:1, borderRadius:8, overflow:"hidden", border:"1px solid var(--border)",
              }}>
                {chars.map((d, i) => (
                  <div key={d.label} style={{
                    background:"var(--cream)", padding:"12px 14px",
                    borderBottom: i < chars.length - 3 ? "1px solid var(--border)" : "none",
                    borderRight: (i + 1) % 3 !== 0 ? "1px solid var(--border)" : "none",
                  }}>
                    <div style={{
                      display:"flex", alignItems:"center", gap:4,
                      fontSize:10, color:"var(--ink-muted)", fontWeight:600,
                      textTransform:"uppercase", letterSpacing:0.4, marginBottom:3,
                    }}>
                      <Icon name={d.icon} size={12} color="var(--ink-muted)" /> {d.label}
                    </div>
                    <div style={{ fontSize:14, fontWeight:600, color:"var(--ink)" }}>{d.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Analisi perizia (pannello completo) */}
            {analisi && (
              <div style={{
                background:"var(--white)", borderRadius:12, padding:"22px 24px", marginBottom:20,
                border:"1px solid var(--border)",
              }}>
                <AnalisiPanel analisi={analisi} />
              </div>
            )}

            {/* Errore analisi */}
            {analisiError && (
              <div style={{
                display:"flex", alignItems:"flex-start", gap:8,
                padding:"14px 16px", borderRadius:10, marginBottom:20,
                background:"#fef2f2", border:"1px solid #f5c6c6",
                color:"var(--red)", fontSize:13,
              }}>
                <Icon name="error_outline" size={18} color="var(--red)" style={{ marginTop:1, flexShrink:0 }} />
                <div>{analisiError}</div>
              </div>
            )}
          </div>

          {/* ── Colonna destra: sidebar sticky ── */}
          <div style={{ position:"sticky", top:70 }}>
            {/* Blocco prezzo */}
            <div style={{
              background:"var(--white)", borderRadius:12, padding:"20px 22px", marginBottom:16,
              border:"1px solid var(--border)", boxShadow:"0 2px 10px rgba(0,0,0,0.04)",
            }}>
              <div style={{ fontSize:11, color:"var(--ink-muted)", fontWeight:500, textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>
                Prezzo base d'asta
              </div>
              <div style={{
                fontFamily:"var(--font-display)", fontWeight:700,
                fontSize:32, color:"var(--navy)", letterSpacing:-0.5, lineHeight:1, marginBottom:8,
              }}>
                {item.prezzo > 0 ? <>€ {fmt(item.prezzo)}</> : "N/D"}
              </div>
              {item.offerta_minima > 0 && (
                <div style={{
                  display:"flex", alignItems:"center", gap:5,
                  fontSize:14, color:"var(--green)", fontWeight:600,
                }}>
                  <Icon name="south" size={16} color="var(--green)" />
                  Offerta minima € {fmt(item.offerta_minima)}
                </div>
              )}

              {/* Data asta */}
              {item.data_asta && (
                <div style={{
                  display:"flex", alignItems:"center", gap:6, marginTop:14,
                  paddingTop:14, borderTop:"1px solid var(--border)",
                  fontSize:14, color:"var(--ink)", fontWeight:500,
                }}>
                  <Icon name="event" size={18} color="var(--terra)" />
                  <span>
                    {fmtDate(item.data_asta)}
                    {days !== null && (
                      <span style={{
                        marginLeft:8, background: days <= 7 ? "#fef2f2" : "var(--terra-light)",
                        color: days <= 7 ? "var(--red)" : "var(--terra)",
                        borderRadius:4, padding:"2px 8px", fontSize:11, fontWeight:700,
                      }}>
                        {days === 0 ? "Oggi" : days === 1 ? "Domani" : `tra ${days}g`}
                      </span>
                    )}
                  </span>
                </div>
              )}

              {/* ROI badge — solo se basato su valore perizia reale */}
              {analisi?.roi_stimato != null && analisi?.prezzo_mercato != null && (
                <div style={{
                  marginTop:14, paddingTop:14, borderTop:"1px solid var(--border)",
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                }}>
                  <span style={{ fontSize:12, color:"var(--ink-muted)", fontWeight:600, textTransform:"uppercase", letterSpacing:0.3 }}>
                    ROI Stimato
                  </span>
                  <span style={{
                    fontFamily:"var(--font-display)", fontWeight:700, fontSize:18,
                    color: analisi.roi_stimato > 0 ? "#1a5e36" : analisi.roi_stimato < 0 ? "var(--red)" : "var(--ink)",
                  }}>
                    {analisi.roi_stimato > 0 ? "+" : ""}€ {fmt(Math.abs(analisi.roi_stimato))}
                  </span>
                </div>
              )}
            </div>

            {/* Link annuncio ufficiale */}
            {item.url_annuncio && (
              <a
                href={item.url_annuncio} target="_blank" rel="noopener noreferrer"
                style={{
                  display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                  background:"var(--navy)", color:"#fff", borderRadius:10,
                  padding:"13px 20px", marginBottom:16, textDecoration:"none",
                  fontWeight:600, fontSize:14, fontFamily:"var(--font-body)",
                  transition:"background 0.15s",
                  boxShadow:"0 2px 10px rgba(12,27,51,0.15)",
                }}
                onMouseEnter={e => e.currentTarget.style.background="var(--navy-soft)"}
                onMouseLeave={e => e.currentTarget.style.background="var(--navy)"}
              >
                <Icon name="open_in_new" size={17} color="#fff" /> Vedi annuncio ufficiale
              </a>
            )}

            {/* Azioni */}
            <div style={{
              background:"var(--white)", borderRadius:12, padding:"16px 18px", marginBottom:16,
              border:"1px solid var(--border)",
              display:"flex", flexDirection:"column", gap:10,
            }}>
              <div style={{ display:"flex", gap:8 }}>
                <button
                  onClick={handleAnalisi}
                  disabled={analisiLoading || !!analisi}
                  style={{
                    display:"flex", alignItems:"center", justifyContent:"center", gap:7,
                    background: analisi ? "var(--green)" : "var(--terra)",
                    color:"#fff", borderRadius:8,
                    padding:"12px 20px", border:"none", flex:1,
                    fontWeight:600, fontSize:14,
                    cursor: analisiLoading || analisi ? "default" : "pointer",
                    opacity: analisi ? 0.85 : 1,
                    transition:"background 0.15s",
                    fontFamily:"var(--font-body)",
                  }}
                >
                  <Icon
                    name={analisi ? "check_circle" : analisiLoading ? "sync" : "analytics"}
                    size={18} color="#fff"
                    style={analisiLoading ? { animation:"spin 1s linear infinite" } : {}}
                  />
                  {analisi ? "Analisi completata" : analisiLoading ? "Analisi in corso..." : "Analizza perizia"}
                </button>
                {analisi && !analisiLoading && (
                  <button
                    onClick={handleRianalizza}
                    title="Rianalizza da zero"
                    style={{
                      display:"flex", alignItems:"center", justifyContent:"center",
                      background:"var(--white)", color:"var(--ink-muted)",
                      border:"1px solid var(--border)", borderRadius:8,
                      padding:"12px 14px", cursor:"pointer",
                      fontFamily:"var(--font-body)",
                    }}
                  >
                    <Icon name="refresh" size={18} color="var(--ink-muted)" />
                  </button>
                )}
              </div>

              <button
                onClick={handleDocumenti}
                disabled={docLoading || !!documenti}
                style={{
                  display:"flex", alignItems:"center", justifyContent:"center", gap:7,
                  background: "var(--cream)",
                  color:"var(--ink)", borderRadius:8,
                  padding:"11px 18px", border:"1px solid var(--border)", width:"100%",
                  fontWeight:600, fontSize:13,
                  cursor: docLoading || documenti ? "default" : "pointer",
                  fontFamily:"var(--font-body)",
                  transition:"background 0.15s",
                }}
              >
                <Icon
                  name={docLoading ? "sync" : "folder_open"}
                  size={16} color="var(--ink-muted)"
                  style={docLoading ? { animation:"spin 1s linear infinite" } : {}}
                />
                {docLoading ? "Caricamento..." : documenti?.documenti?.length ? `${documenti.documenti.length} documenti` : "Documenti allegati"}
              </button>
            </div>

            {/* Lista documenti */}
            {documenti && documenti.documenti.length > 0 && (
              <div style={{
                background:"var(--white)", borderRadius:12, padding:"14px 16px", marginBottom:16,
                border:"1px solid var(--border)",
                display:"flex", flexDirection:"column", gap:6,
              }}>
                {documenti.documenti.map((doc, i) => (
                  <a
                    key={i} href={doc.url}
                    target="_blank" rel="noopener noreferrer"
                    style={{
                      display:"flex", alignItems:"center", gap:8,
                      padding:"10px 12px", borderRadius:8,
                      background:"var(--cream)", border:"1px solid var(--border)",
                      textDecoration:"none", fontSize:12, color:"var(--ink)",
                      transition:"background 0.15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background="var(--cream-dark)"}
                    onMouseLeave={e => e.currentTarget.style.background="var(--cream)"}
                  >
                    <Icon name="picture_as_pdf" size={18} color="var(--red)" />
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:600, fontSize:13 }}>{doc.titolo}</div>
                      <div style={{ fontSize:10, color:"var(--ink-muted)", textTransform:"uppercase" }}>{doc.tipo}</div>
                    </div>
                    <Icon name="download" size={14} color="var(--ink-muted)" />
                  </a>
                ))}
              </div>
            )}

            {documenti && documenti.documenti.length === 0 && (
              <div style={{
                background:"var(--white)", borderRadius:12, padding:"14px 16px", marginBottom:16,
                border:"1px solid var(--border)",
                fontSize:12, color:"var(--ink-muted)", fontStyle:"italic", textAlign:"center",
              }}>
                Nessun documento trovato per questo lotto.
              </div>
            )}

            {/* Fonte */}
            <div style={{
              background:"var(--white)", borderRadius:12, padding:"14px 16px",
              border:"1px solid var(--border)",
              display:"flex", alignItems:"center", gap:8,
              fontSize:12, color:"var(--ink-muted)",
            }}>
              <span>Fonte:</span>
              <FonteBadge fonte={item.fonte} />
            </div>
          </div>
        </div>
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
                    fontSize:21, fontWeight:700, letterSpacing:-0.3,
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
        onToggleWishlist={toggleWishlist} />
    </div>
  );
}
