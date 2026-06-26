/*  =======  POCASIMETEO CARD – FINÁLNÍ FUNKČNÍ VERZE  =======  */

import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Filler,
  Tooltip,
  Legend
} from "chart.js";

import "chartjs-adapter-date-fns";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Filler,
  Tooltip,
  Legend
);

const VALID_SENSORS = [
  "TeplotaVnejsi",
  "VlhkostVnejsi",
  "TlakRel",
  "Vitr",
  "VitrNarazy",
  "rainIntensity",
  "SlunZareni",
  "UVindex",
  "TeplotaVnitrni",
  "VlhkostVnitrni",
  "Co2",
  "Pm1",
  "Pm2",
  "Pm1v"
];

const NON_GRAPH_SENSORS = [
  "SrazkyDen",
  "VitrSmer"
];

const COLOR_MAP = {
  TeplotaVnejsi: "#ff5722",
  VlhkostVnejsi: "#2196f3",
  TlakRel: "#9c27b0",
  Vitr: "#4caf50",
  VitrNarazy: "#2e7d32",
  rainIntensity: "#03a9f4",
  SlunZareni: "#ff9800",
  UVindex: "#ffeb3b",
  TeplotaVnitrni: "#ff7043",
  VlhkostVnitrni: "#42a5f5",
  Co2: "#8d6e63",
  Pm1: "#7e57c2",
  Pm2: "#5e35b1",
  Pm1v: "#9575cd"
};

class PocasiMeteoCard extends HTMLElement {
  constructor() {
    super();
    this._initialized = false;
    this._rendering = false;
    this._charts = {};
    this._lastAttributes = null;
    this._lastRender = 0;
    this._updateInterval = null;
    this._lastFetch = 0;
  }

  setConfig(config) {
    if (!config.entity) throw new Error("entity is required");
    this.config = config;
    this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    const entity = hass.states[this.config.entity];

    if (!this._initialized) {
      this._initialize();
      this._initialized = true;
    }

    if (!entity || !entity.attributes || !("TeplotaVnejsi" in entity.attributes)) {
      const card = this.shadowRoot.querySelector(".pm-card");
      if (card) {
        card.innerHTML = `
          <h2>PočasíMeteo</h2>
          <p style="opacity:0.7;">
            Backendová komponenta <b>pocasimeteo</b> není dostupná.<br>
            Zkontroluj, zda je integrace nainstalovaná a aktivní.
          </p>
        `;
      }
      return;
    }

    if (!this._updateInterval) {
      const entryId = entity.attributes.config_entry_id;
      if (entryId) {
        hass.callApi("GET", `config/config_entries/entry/${entryId}`)
          .then(entry => {
            this._updateInterval = entry.data.update_interval || 60;
          })
          .catch(() => {
            this._updateInterval = 60;
          });
      } else {
        this._updateInterval = 60;
      }
    }

    const refresh = this._updateInterval || 60;

    if (Date.now() - this._lastRender < refresh * 1000) return;

    if (
      this._lastAttributes &&
      JSON.stringify(this._lastAttributes) === JSON.stringify(entity.attributes)
    ) {
      return;
    }

    this._lastAttributes = JSON.parse(JSON.stringify(entity.attributes));
    this._lastRender = Date.now();

    if (this._rendering) return;

    this._rendering = true;
    this._update(hass).finally(() => {
      this._rendering = false;
    });
  }

  _initialize() {
    this.shadowRoot.innerHTML = `
      <style>
        .pm-card { padding:16px; color:var(--primary-text-color); display:flex; flex-direction:column; gap:16px; }
        .pm-header { display:flex; justify-content:space-between; font-size:20px; font-weight:600; }
        .pm-condition { opacity:0.7; font-size:14px; }
        .pm-temp { font-size:64px; font-weight:300; }
        .pm-current { display:flex; flex-wrap:wrap; gap:16px; opacity:0.8; font-size:16px; }
        .pm-graphs { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:16px; margin-top:8px; }
        .pm-graph-tile { background:var(--ha-card-background,#fff); border-radius:12px; padding:12px; box-shadow:var(--ha-card-box-shadow,0 2px 4px rgba(0,0,0,0.2)); display:flex; flex-direction:column; }
        .pm-graph-title { font-size:1em; font-weight:600; margin-bottom:4px; }
        .pm-minmax { font-size:0.9em; opacity:0.7; margin-bottom:6px; }
        .pm-graph { width:100%; height:200px; }
      </style>

      <ha-card class="pm-card">
        <div id="header"></div>
        <div id="temp"></div>
        <div id="current"></div>
        <div id="graphs" class="pm-graphs"></div>
      </ha-card>
    `;
  }

  async _update(hass) {
    const entity = hass.states[this.config.entity];
    if (!entity) return;

    const nowTs = Date.now();
    if (nowTs - this._lastFetch < 30000) return;
    this._lastFetch = nowTs;

    const prefix = (entity.attributes.station_name || "")
      .toLowerCase()
      .replace(/\s+/g, "_");

    const sensorEntities = Object.keys(hass.states)
      .filter(e => e.startsWith("sensor." + prefix + "_"))
      .filter(e => VALID_SENSORS.includes(e.replace("sensor." + prefix + "_", "")));

    const header = this.shadowRoot.getElementById("header");
    const temp = this.shadowRoot.getElementById("temp");
    const current = this.shadowRoot.getElementById("current");
    const graphs = this.shadowRoot.getElementById("graphs");

    const d = entity.attributes;

    header.innerHTML = `
      <div class="pm-header">
        <div>${d.station_name}<br><span class="pm-condition">${d.condition || ""}</span></div>
        <div style="opacity:0.6;">${d.timestamp}</div>
      </div>
    `;

    temp.innerHTML = `<div class="pm-temp">${d.TeplotaVnejsi}°</div>`;

    current.innerHTML = `
      <div>Vlhkost: ${d.VlhkostVnejsi}%</div>
      <div>Tlak: ${d.TlakRel || ""} hPa</div>
      <div>Vítr: ${d.Vitr} m/s (${d.VitrSmer || ""})</div>
      <div>Srážky dnes: ${d.SrazkyDen || 0} mm</div>
      <div>Intenzita srážek: ${d.rainIntensity || 0} mm/5min</div>
    `;

    graphs.innerHTML = "";

    if (sensorEntities.length === 0) return;

    const token =
      hass.connection?.options?.accessToken ||
      hass.auth?.data?.access_token ||
      hass.connection?.options?.auth?.access_token ||
      null;

    if (!token) return;

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const canvases = {};
    for (const sensor of sensorEntities) {
      const suffix = sensor.replace("sensor." + prefix + "_", "");

      const tile = document.createElement("div");
      tile.classList.add("pm-graph-tile");

      const s = hass.states[sensor];
      const unit = s.attributes.unit_of_measurement || "";
      const name = (s.attributes.friendly_name || sensor) + (unit ? " - " + unit : "");

      const title = document.createElement("div");
      title.classList.add("pm-graph-title");
      title.textContent = name;

      const canvas = document.createElement("canvas");
      canvas.classList.add("pm-graph");
      canvas.height = 200;

      tile.appendChild(title);
      tile.appendChild(canvas);
      graphs.appendChild(tile);

      canvases[sensor] = { canvas, tile };
    }

    const history = {};

    await Promise.all(sensorEntities.map(async sensor => {
      const suffix = sensor.replace("sensor." + prefix + "_", "");
      if (NON_GRAPH_SENSORS.includes(suffix)) return;

      const url =
        `/api/history/period/${since}` +
        `?filter_entity_id=${sensor}` +
        `&minimal_response` +
        `&significant_changes_only=false`;

      try {
        const resp = await fetch(url, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          credentials: "same-origin"
        });

        if (resp.ok) {
          history[sensor] = await resp.json();
        }
      } catch (e) {}
    }));

    for (const sensor of sensorEntities) {
      const suffix = sensor.replace("sensor." + prefix + "_", "");
      if (NON_GRAPH_SENSORS.includes(suffix)) continue;

      if (!history[sensor] || !history[sensor][0] || !history[sensor][0].length) continue;

      const raw = history[sensor][0];
      const points = raw
        .map(p => ({
          x: Date.parse(p.last_changed),
          y: Number(p.state)
        }))
        .filter(p => !isNaN(p.x) && !isNaN(p.y));

      if (points.length < 2) continue;

      const s = hass.states[sensor];
      const unit = s.attributes.unit_of_measurement || "";
      const name = (s.attributes.friendly_name || sensor) + (unit ? " - " + unit : "");

      const min = Math.min(...points.map(p => p.y));
      const max = Math.max(...points.map(p => p.y));

      const minPoint = points.find(p => p.y === min);
      const maxPoint = points.find(p => p.y === max);

      const { canvas, tile } = canvases[sensor];
      const ctx = canvas.getContext("2d");

      if (this._charts[sensor]) this._charts[sensor].destroy();

      const color = COLOR_MAP[suffix] || "#3b82f6";
      const rgba = this._hexToRgba(color, 0.25);

      const mm = document.createElement("div");
      mm.classList.add("pm-minmax");
      mm.textContent = `Min: ${min.toFixed(1)} — Max: ${max.toFixed(1)}`;
      tile.appendChild(mm);

      /* === VARIANTA B: FORCE LAYOUT === */
      canvas.getBoundingClientRect();  // ← vynutí layout před inicializací grafu

      this._charts[sensor] = new Chart(ctx, {
        type: "line",
        data: {
          datasets: [
            {
              label: name,
              data: points,
              borderColor: color,
              backgroundColor: rgba,
              tension: 0.3,
              pointRadius: 0,
              borderWidth: 2,
              order: 1
            },
            {
              label: "Min",
              data: [{ x: minPoint.x, y: minPoint.y }],
              pointRadius: 6,
              pointBackgroundColor: "red",
              showLine: false,
              order: 99
            },
            {
              label: "Max",
              data: [{ x: maxPoint.x, y: maxPoint.y }],
              pointRadius: 6,
              pointBackgroundColor: "green",
              showLine: false,
              order: 99
            }
          ]
        },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          scales: {
            x: { type: "time", time: { unit: "hour" }, title: { display: false } },
            y: { title: { display: false } }
          }
        }
      });
    }
  }

  _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  getCardSize() { return 6; }
}

customElements.define("pocasimeteo-card", PocasiMeteoCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "pocasimeteo-card",
  name: "PočasíMeteo Card",
  description: "Automatické grafy pro PočasíMeteo.cz"
});
