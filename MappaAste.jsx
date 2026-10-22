// Mappa dei lotti filtrati (Leaflet + OpenStreetMap).
// I punti arrivano compatti da GET /api/immobili/mappa (stessi filtri della
// lista); il renderer canvas regge senza problemi decine di migliaia di marker.
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Codici giudizio dal backend: 1 interessante, 0 da valutare, -1 rischioso.
const GIUDIZI = {
  "1":  { label: "Interessante", color: "#2d7a4f" },
  "0":  { label: "Da valutare",  color: "#3b5b8c" },
  "-1": { label: "Rischioso",    color: "#b52020" },
};

const euro = n => "€ " + Math.round(n).toLocaleString("it-IT");

export default function MappaAste({ apiBase, query, onOpen }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const [stato, setStato] = useState({ loading: true, total: 0, punti: 0, error: null });

  // Mappa creata una sola volta; distrutta allo smontaggio.
  useEffect(() => {
    const map = L.map(divRef.current, { preferCanvas: true, center: [42.3, 12.6], zoom: 6 });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Punti ricaricati a ogni cambio dei filtri.
  useEffect(() => {
    const ctrl = new AbortController();
    setStato(s => ({ ...s, loading: true, error: null }));
    fetch(`${apiBase}/immobili/mappa?${query}`, { signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error(`Errore API: ${r.status}`); return r.json(); })
      .then(d => {
        const map = mapRef.current, layer = layerRef.current;
        if (!map) return;
        layer.clearLayers();
        const renderer = L.canvas({ padding: 0.5 });
        const coords = [];
        for (const [id, lat, lng, prezzo, g] of d.punti) {
          const giudizio = GIUDIZI[String(g)] || GIUDIZI["0"];
          L.circleMarker([lat, lng], {
            renderer, radius: 5, weight: 1, color: "#fff",
            fillColor: giudizio.color, fillOpacity: 0.85,
          })
            .bindTooltip(`${prezzo > 0 ? euro(prezzo) : "Prezzo N/D"} · ${giudizio.label}`)
            .on("click", () => onOpenRef.current(id))
            .addTo(layer);
          coords.push([lat, lng]);
        }
        if (coords.length) map.fitBounds(coords, { padding: [24, 24], maxZoom: 13 });
        setStato({ loading: false, total: d.total, punti: d.punti.length, error: null });
      })
      .catch(e => {
        if (e.name !== "AbortError") setStato(s => ({ ...s, loading: false, error: e.message }));
      });
    return () => ctrl.abort();
  }, [apiBase, query]);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={divRef}
        role="region" aria-label="Mappa degli immobili"
        style={{
          height: "70vh", minHeight: 420, borderRadius: "var(--radius)",
          border: "1px solid var(--border)", overflow: "hidden", zIndex: 0,
        }}
      />
      <div style={{
        position: "absolute", left: 12, bottom: 12, zIndex: 400,
        background: "rgba(255,255,255,0.95)", borderRadius: 8, padding: "8px 10px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)", fontSize: 11, color: "#333",
        display: "flex", flexDirection: "column", gap: 4,
      }}>
        {Object.values(GIUDIZI).map(g => (
          <span key={g.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: g.color }} />
            {g.label}
          </span>
        ))}
        <span style={{ marginTop: 2, color: "#666" }}>
          {stato.loading ? "Caricamento…"
            : stato.error ? stato.error
            : `${stato.punti.toLocaleString("it-IT")} su ${stato.total.toLocaleString("it-IT")} con posizione`}
        </span>
      </div>
    </div>
  );
}
