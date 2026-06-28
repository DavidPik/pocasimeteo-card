/*  =======  POCASIMETEO CARD – VERZE S WINDROSE + AVG/MODE/VAR =======  */

import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Filler,
  Tooltip,
  Legend,
  PolarAreaController,
  ArcElement,
  RadialLinearScale
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
  Legend,
  PolarAreaController,
  ArcElement,
  RadialLinearScale
);

/* === VALID_SENSORS v lowercase === */
const VALID_SENSORS = [
  "teplotavnejsi",
  "vlhkostvnejsi",
  "tlakrel",
  "vitr",
  "vitrnarazy",
  "rainintensity",
  "slunzareni",
  "uvindex",
  "teplotavnitrni",
  "vlhkostvnitrni",
  "co2",
  "pm1",
  "pm2",
  "pm1v",
  "vitrsmer"
];

const NON_GRAPH_SENSORS = [
  "srazkyden"
];

/* === COLOR_MAP musí být OBJEKT, nikoli pole === */
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
  Pm1v: "#9575cd",
  VitrSmer: "#3b82f6"
};

/* === BARVA GRIDU === */
const GRID_COLOR = "rgba(255,255,255,0.2)";

/* === WINDROSE LABELS === */
const WIND_DIR_LABELS = [
  "N","NNE","NE","ENE","E","ESE","SE","SSE",
  "S","SSW","SW","WSW","W","WNW","NW","NNW"
];

/* === FUNKCE: bezpečné čtení CSS proměnných s fallbackem === */
function safeCssVar(el, name, fallback) {
  try {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/* === FUNKCE: detekce světlého/tmavého tématu === */
function isLightTheme(el) {
  const b = safeCssVar(el, "--brightness", "0");
  return b.trim() === "1";
}

/* === FUNKCE: převod stupňů na světovou stranu === */
function degToDirection(deg) {
  if (deg == null || isNaN(deg)) return "";
  const dirs = WIND_DIR_LABELS;
  const idx = Math.round(deg / 22.5) % 16;
  return dirs[idx];
}

/* === FUNKCE: index směru === */
function directionToIndex(deg) {
  return Math.round(deg / 22.5) % 16;
}

/* === FUNKCE: vytvoření histogramu pro WindRose === */
function buildWindRose(points) {
  const bins = new Array(16).fill(0);
  for (const p of points) {
    const deg = Number(p.y);
    if (isNaN(deg)) continue;
    const idx = directionToIndex(deg);
    bins[idx]++;
  }
  return bins;
}

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
        .pm-card { padding:16px; color:var(--primary-text-color,#fff); display:flex; flex-direction:column; gap:16px; }
        .pm-header { display:flex; justify-content:space-between; font-size:20px; font-weight:600; }
        .pm-condition { opacity:0.7; font-size:14px; }
        .pm-temp { font-size:64px; font-weight:300; }
        .pm-current { display:flex; flex-wrap:wrap; gap:16px; opacity:0.8; font-size:16px; }
        .pm-graphs { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:16px; margin-top:8px; }
        .pm-graph-tile { 
          background:var(--ha-card-background,#1c1c1c); 
          border-radius:12px; 
          padding:4px; 
          box-shadow:var(--ha-card-box-shadow,0 2px 4px rgba(0,0,0,0.2)); 
          display:flex; 
          flex-direction:column; 
        }
        .pm-graph-title { font-size:1em; font-weight:600; margin-bottom:4px; color:var(--primary-text-color,#fff); }
        .pm-graph { width:100%; height:300px; }
        .pm-legend {
          margin-top:2px;
          display:flex;
          flex-wrap:wrap;
          justify-content:center;
          gap:8px;
          font-size:14px;
          opacity:0.8;
        }
        .pm-legend-item {
          display:flex;
          align-items:center;
          gap:4px;
        }
        .pm-legend-color {
          width:12px;
          height:12px;
          border-radius:2px;
        }
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
      .filter(e => {
        const suffix = e.replace("sensor." + prefix + "_", "").toLowerCase();
        return VALID_SENSORS.includes(suffix);
      });

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
      <div>Vítr: ${d.Vitr} m/s (${degToDirection(Number(d.VitrSmer))})</div>
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

    // nejdřív vitrsmer, potom všechny další senzory
    const orderedSensors = [
      ...sensorEntities.filter(s => s.replace("sensor." + prefix + "_", "").toLowerCase() === "vitrsmer"),
      ...sensorEntities.filter(s => s.replace("sensor." + prefix + "_", "").toLowerCase() !== "vitrsmer")
    ];

    const canvases = {};
    for (const sensor of orderedSensors) {
      const suffix = sensor.replace("sensor." + prefix + "_", "");

      const tile = document.createElement("div");
      tile.classList.add("pm-graph-tile");

      const s = hass.states[sensor];
      const unit = s.attributes.unit_of_measurement || "";

      const rawName = s.attributes.friendly_name || sensor;
      const cleanName = rawName.replace(/^[A-Za-z0-9_]+\s+/, "");

      const title = document.createElement("div");
      title.classList.add("pm-graph-title");
      title.textContent = cleanName + (unit ? " - " + unit : "");

      const canvas = document.createElement("canvas");
      canvas.classList.add("pm-graph");
      canvas.height = suffix === "vitrsmer" ? 300 : 220;

      const legend = document.createElement("div");
      legend.classList.add("pm-legend");

      tile.appendChild(title);
      tile.appendChild(canvas);
      tile.appendChild(legend);
      graphs.appendChild(tile);

      canvases[sensor] = { canvas, tile, cleanName, legend };
    }

    const history = {};

    await Promise.all(orderedSensors.map(async sensor => {
      const suffix = sensor.replace("sensor." + prefix + "_", "").toLowerCase();
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

    // standardní grafy (bez vitrsmer)
    for (const sensor of orderedSensors) {
      const suffix = sensor.replace("sensor." + prefix + "_", "").toLowerCase();
      if (suffix === "vitrsmer") continue;
      if (!history[sensor] || !history[sensor][0] || !history[sensor][0].length) continue;

      const raw = history[sensor][0];
      const points = raw
        .map(p => ({
          x: Date.parse(p.last_changed),
          y: Number(p.state)
        }))
        .filter(p => !isNaN(p.x) && !isNaN(p.y));

      if (points.length < 2) continue;

      const { canvas, tile, cleanName, legend } = canvases[sensor];
      const ctx = canvas.getContext("2d");

      if (this._charts[sensor]) this._charts[sensor].destroy();

      const host = this.shadowRoot.host;

      const textColor =
        safeCssVar(host, "--primary-text-color", null) ||
        (isLightTheme(host) ? "#000000" : "#ffffff");

      const bgColor =
        safeCssVar(host, "--ha-card-background", "") ||
        safeCssVar(host, "--card-background-color", "") ||
        (isLightTheme(host) ? "#ffffff" : "#1c1c1c");

      canvas.style.backgroundColor = bgColor;
      tile.style.backgroundColor = bgColor;

      const min = Math.min(...points.map(p => p.y));
      const max = Math.max(...points.map(p => p.y));

      const minPoint = points.find(p => p.y === min);
      const maxPoint = points.find(p => p.y === max);

      const color = COLOR_MAP[suffix] || "#3b82f6";
      const rgba = this._hexToRgba(color, 0.25);

      this._charts[sensor] = new Chart(ctx, {
        type: "line",
        data: {
          datasets: [
            {
              label: cleanName,
              data: points,
              borderColor: color,
              backgroundColor: rgba,
              tension: 0.3,
              pointRadius: 0,
              borderWidth: 2,
              order: 1
            },
            {
              label: `Min: ${min.toFixed(1)}`,
              data: [{ x: minPoint.x, y: minPoint.y }],
              pointRadius: 6,
              pointBackgroundColor: "red",
              showLine: false,
              order: 99
            },
            {
              label: `Max: ${max.toFixed(1)}`,
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
          plugins: {
            tooltip: {},
            legend: { display: false }
          },
          scales: {
            x: { type: "time", time: { unit: "hour" }, ticks: { color: textColor }, grid: { color: GRID_COLOR } },
            y: { ticks: { color: textColor }, grid: { color: GRID_COLOR } }
          }
        }
      });

      legend.innerHTML = `
        <div class="pm-legend-item">
          <span class="pm-legend-color" style="background:red;"></span>
          <span>Min: ${min.toFixed(1)}</span>
        </div>
        <div class="pm-legend-item">
          <span class="pm-legend-color" style="background:green;"></span>
          <span>Max: ${max.toFixed(1)}</span>
        </div>
      `;
    }
    
    // WindRose jako prvni dlaždice
    const windSensor = orderedSensors.find(
      s => s.replace("sensor." + prefix + "_", "").toLowerCase() === "vitrsmer"
    );

    if (windSensor && history[windSensor] && history[windSensor][0] && history[windSensor][0].length) {
      const raw = history[windSensor][0];
      const points = raw
        .map(p => ({
          x: Date.parse(p.last_changed),
          y: Number(p.state)
        }))
        .filter(p => !isNaN(p.x) && !isNaN(p.y));

      if (points.length >= 2) {
        const { canvas, tile, cleanName, legend } = canvases[windSensor];
        const ctx = canvas.getContext("2d");

        if (this._charts[windSensor]) this._charts[windSensor].destroy();

        const host = this.shadowRoot.host;

        const textColor =
          safeCssVar(host, "--primary-text-color", null) ||
          (isLightTheme(host) ? "#000000" : "#ffffff");

        const bgColor =
          safeCssVar(host, "--ha-card-background", "") ||
          safeCssVar(host, "--card-background-color", "") ||
          (isLightTheme(host) ? "#ffffff" : "#1c1c1c");

        canvas.style.backgroundColor = bgColor;
        tile.style.backgroundColor = bgColor;

        const bins = buildWindRose(points);

        const avg = Number(entity.attributes.VitrSmer_avg || 0);
        const mode = Number(entity.attributes.VitrSmer_mode || 0);
        const vari = Number(entity.attributes.VitrSmer_var || 0);

        const baseColor = "#4caf50";
        const backgroundColors = bins.map(() => baseColor);

        /* === PLUGIN: GRID KRUŽNICE === */
        const windRoseGridPlugin = {
          id: "windRoseGrid",
          afterDraw(chart) {
            const { ctx, chartArea } = chart;

            const cx = (chartArea.left + chartArea.right) / 2;
            const cy = (chartArea.top + chartArea.bottom) / 2;

            const aw = chartArea.right - chartArea.left;
            const ah = chartArea.bottom - chartArea.top;

            const R = Math.min(aw, ah) * 0.50;

            const gridRadii = [R * 0.15, R * 0.30, R * 0.45, R * 0.60, R * 0.75, R * 0.90];

            ctx.save();
            ctx.strokeStyle = GRID_COLOR;
            ctx.lineWidth = 1;

            gridRadii.forEach(r => {
              ctx.beginPath();
              ctx.arc(cx, cy, r, 0, Math.PI * 2);
              ctx.stroke();
            });

            const directions = [
              0,    // East
              90,   // South
              180,  // West
              270   // North
            ];

            directions.forEach(deg => {
              const angle = (deg - 90) * Math.PI / 180;
              const x = cx + Math.cos(angle) * R;
              const y = cy + Math.sin(angle) * R;

              ctx.beginPath();
              ctx.moveTo(cx, cy);
              ctx.lineTo(x, y);
              ctx.stroke();
            });

            ctx.restore();
          }
        };

        /* === PLUGIN: POPISKY SMĚRŮ === */
        const windRoseLabelsPlugin = {
          id: "windRoseLabels",
          afterDraw(chart) {
            const { ctx, chartArea } = chart;

            const cx = (chartArea.left + chartArea.right) / 2;
            const cy = (chartArea.top + chartArea.bottom) / 2;

            const aw = chartArea.right - chartArea.left;
            const ah = chartArea.bottom - chartArea.top;

            const R = Math.min(aw, ah) * 0.50;

            const offsetText = R + 10;

            ctx.save();
            ctx.fillStyle = textColor;
            ctx.font = "14px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            WIND_DIR_LABELS.forEach((label, i) => {
              const angle = (i * 22.5 - 90) * Math.PI / 180;
              const x = cx + Math.cos(angle) * offsetText;
              const y = cy + Math.sin(angle) * offsetText;
              ctx.fillText(label, x, y);
            });

            ctx.restore();
          }
        };

        /* === PLUGIN: AVG / MODE / VAR === */
        const windRoseVectorsPlugin = {
          id: "windRoseVectors",
          afterDraw(chart) {
            const { ctx, chartArea } = chart;

            const cx = (chartArea.left + chartArea.right) / 2;
            const cy = (chartArea.top + chartArea.bottom) / 2;

            const aw = chartArea.right - chartArea.left;
            const ah = chartArea.bottom - chartArea.top;

            const R = Math.min(aw, ah) * 0.50;

            const offsetLine = R - 20;
            const offsetVar = R - 10;

            const startAngle = (avg - vari - 90) * Math.PI / 180;
            const endAngle = (avg + vari - 90) * Math.PI / 180;

            /* VAR sektor */
            ctx.save();
            ctx.fillStyle = "rgba(255,165,0,0.25)";
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, offsetVar, startAngle, endAngle);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            /* AVG čára */
            const avgAngle = (avg - 90) * Math.PI / 180;
            ctx.save();
            ctx.strokeStyle = "#ff0000";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(avgAngle) * offsetLine, cy + Math.sin(avgAngle) * offsetLine);
            ctx.stroke();
            ctx.restore();

            /* MODE čára */
            const modeAngle = (mode - 90) * Math.PI / 180;
            ctx.save();
            ctx.strokeStyle = "#0000ff";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(modeAngle) * offsetLine, cy + Math.sin(modeAngle) * offsetLine);
            ctx.stroke();
            ctx.restore();
          }
        };

        /* === VYKRESLENÍ WINDROSE === */
        this._charts[windSensor] = new Chart(ctx, {
          type: "polarArea",
          data: {
            labels: WIND_DIR_LABELS,
            datasets: [{
              label: cleanName,
              data: bins,
              backgroundColor: backgroundColors,
              borderWidth: 1
            }]
          },
          options: {
            responsive: false,
            maintainAspectRatio: false,
            startAngle: -11.25 * Math.PI /180,
            layout: {
              padding: {
                top: 40,
                bottom: 40,
                left: 10,
                right: 10
              }
            },
            scales: {
              r: {
                ticks: { display: false },
                grid: { display: false },   // vypnutí defaultního gridu
                beginAtZero: true
              }
            },
            plugins: {
              tooltip: {},
              legend: {
                display: false,
                labels: { generateLabels: () => [] }
              }
            }
          },
          plugins: [
            windRoseGridPlugin,
            windRoseLabelsPlugin,
            windRoseVectorsPlugin
          ]
        });

        legend.innerHTML = `
          <div class="pm-legend-item">
            <span class="pm-legend-color" style="background:#ff0000;"></span>
            <span>Avg: ${avg.toFixed(1)}°</span>
          </div>
          <div class="pm-legend-item">
            <span class="pm-legend-color" style="background:#0000ff;"></span>
            <span>Mode: ${mode.toFixed(1)}°</span>
          </div>
          <div class="pm-legend-item">
            <span class="pm-legend-color" style="background:rgba(255,165,0,0.8);"></span>
            <span>Var: ±${vari.toFixed(1)}°</span>
          </div>
        `;
      }
    }
  }  

  _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  getCardSize() { 
    return 6; 
  }
}

customElements.define("pocasimeteo-card", PocasiMeteoCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "pocasimeteo-card",
  name: "PočasíMeteo Card",
  description: "Automatické grafy pro PočasíMeteo.cz"
});
