/*  =======  POCASIMETEO CARD – RUČNÍ WINDROSE + AVG/MODE/VAR =======  */

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

const NON_GRAPH_SENSORS = ["srazky_den"];
const GRID_COLOR = "rgba(255,255,255,0.2)";

const WIND_DIR_LABELS = [
  "N","NNE","NE","ENE","E","ESE","SE","SSE",
  "S","SSW","SW","WSW","W","WNW","NW","NNW"
];

/* === UTILITIES === */
function safeCssVar(el, name, fallback) {
  try {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

function isLightTheme(el) {
  return safeCssVar(el, "--brightness", "0").trim() === "1";
}

function computeTheme(host) {
  const light = isLightTheme(host);
  const textColor = safeCssVar(host, "--primary-text-color", null) || (light ? "#000" : "#fff");
  const bgColor =
    safeCssVar(host, "--ha-card-background", "") ||
    safeCssVar(host, "--card-background-color", "") ||
    (light ? "#fff" : "#1c1c1c");
  return { textColor, bgColor };
}

function degToDirection(deg) {
  if (deg == null || isNaN(deg)) return "";
  return WIND_DIR_LABELS[Math.round(deg / 22.5) % 16];
}

function directionToIndex(deg) {
  return Math.round(deg / 22.5) % 16;
}

function buildWindRose(points) {
  const bins = new Array(16).fill(0);
  for (const p of points) {
    const deg = Number(p.y);
    if (!isNaN(deg)) bins[directionToIndex(deg)]++;
  }
  return bins;
}

function historyToPoints(raw) {
  return raw.map(p => ({
    x: Date.parse(p.last_changed),
    y: Number(p.state)
  })).filter(p => !isNaN(p.x) && !isNaN(p.y));
}

function computeMinMax(points) {
  const ys = points.map(p => p.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  return {
    min, max,
    minPoint: points.find(p => p.y === min),
    maxPoint: points.find(p => p.y === max)
  };
}

function computeChartGeometry(chartArea) {
  const cx = (chartArea.left + chartArea.right) / 2;
  const cy = (chartArea.top + chartArea.bottom) / 2;
  const aw = chartArea.right - chartArea.left;
  const ah = chartArea.bottom - chartArea.top;
  const R = Math.min(aw, ah) * 0.50;
  return { cx, cy, aw, ah, R };
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* === LINE CHART CONFIG === */
function createLineChartConfig(points, cleanName, color, textColor) {
  const { min, max, minPoint, maxPoint } = computeMinMax(points);
  const rgba = hexToRgba(color, 0.25);

  return {
    type:"line",
    data:{
      datasets:[
        {
          label:cleanName,
          data:points,
          borderColor:color,
          backgroundColor:rgba,
          tension:0.3,
          pointRadius:0,
          borderWidth:2
        },
        {
          label:`Min: ${min.toFixed(1)}`,
          data:[{x:minPoint.x,y:minPoint.y}],
          pointRadius:6,
          pointBackgroundColor:"red",
          showLine:false
        },
        {
          label:`Max: ${max.toFixed(1)}`,
          data:[{x:maxPoint.x,y:maxPoint.y}],
          pointRadius:6,
          pointBackgroundColor:"green",
          showLine:false
        }
      ]
    },
    options:{
      responsive:false,
      maintainAspectRatio:false,
      plugins:{ tooltip:{}, legend:{display:false} },
      scales:{
        x:{ type:"time", time:{unit:"hour"}, ticks:{color:textColor}, grid:{color:GRID_COLOR} },
        y:{ ticks:{color:textColor}, grid:{color:GRID_COLOR} }
      }
    }
  };
}

/* === RUČNÍ WINDROSE PLUGIN === */
function createWindRosePlugin(theme, bins, avg, mode, vari) {
  return {
    id:"windRoseManual",
    beforeInit(chart) {
      const canvas = chart.canvas;

      canvas.addEventListener("mousemove", (ev) => {
        const rect = canvas.getBoundingClientRect();
        chart.$mouse = {
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top
        };

        const { cx, cy, R } = computeChartGeometry(chart.chartArea);

        const dx = chart.$mouse.x - cx;
        const dy = chart.$mouse.y - cy;
        const dist = Math.sqrt(dx*dx + dy*dy);

        // mimo graf
        if (dist > R) {
          chart.$windHover = null;
          chart.draw();
          return;
        }

        // úhel kurzoru
        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
        angle += 90;
        if (angle < 0) angle += 360;

        // index sektoru
        const sectorIndex = Math.floor(angle / 22.5) % 16;

        chart.$windHover = {
          index: sectorIndex,
          value: bins[sectorIndex],
          angle
        };

        chart.draw();
      });

      canvas.addEventListener("mouseleave", () => {
        chart.$windHover = null;
        chart.draw();
      });
    },
    afterDraw(chart) {
      chart.$bins = bins;
      const { ctx, chartArea } = chart;
      const { cx, cy, R } = computeChartGeometry(chartArea);

      const maxBin = Math.max(...bins) || 1;
      const sectorAngle = 22.5 * Math.PI / 180;

      /* === 1) GRID KRUŽNICE === */
      ctx.save();
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;

      [0.15,0.30,0.45,0.60,0.75,0.90].forEach(f => {
        ctx.beginPath();
        ctx.arc(cx, cy, R*f, 0, Math.PI*2);
        ctx.stroke();
      });

      /* === 2) KŘÍŽ === */
      [0,90,180,270].forEach(deg => {
        const a = (deg - 90) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a)*R, cy + Math.sin(a)*R);
        ctx.stroke();
      });

      /* === 3) RUČNÍ VÝSEČE === */
      const sectorColor = COLOR_MAP["vitrsmer"] || "#3b82f6";

      for (let i=0; i<16; i++) {
        const binValue = bins[i];
        const radius = (binValue / maxBin) * (R * 0.90);

        // centrovaný úhel sektoru
        const midAngle = ((i * 22.5) - 90) * Math.PI / 180;
        const startAngle = midAngle - sectorAngle/2;
        const endAngle = midAngle + sectorAngle/2;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.closePath();

        // výplň
        ctx.fillStyle = hexToRgba(sectorColor, 0.85);
        ctx.fill();

        // obrys
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      /* === 4) POPISKY SMĚRŮ === */
      ctx.fillStyle = theme.textColor;
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const offsetText = R + 10;

      WIND_DIR_LABELS.forEach((label, i) => {
        const angle = ((i * 22.5) - 90) * Math.PI / 180;
        const x = cx + Math.cos(angle) * offsetText;
        const y = cy + Math.sin(angle) * offsetText;
        ctx.fillText(label, x, y);
      });

      /* === 5) AVG / MODE / VAR === */
      const offsetLine = R - 20;
      const offsetVar = R - 10;

      const avgAngle = (avg - 90) * Math.PI / 180;
      const modeAngle = (mode - 90) * Math.PI / 180;
      const startVar = (avg - vari - 90) * Math.PI / 180;
      const endVar = (avg + vari - 90 - 0) * Math.PI / 180;

      // VAR sektor
      ctx.fillStyle = "rgba(255,165,0,0.25)";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, offsetVar, startVar, endVar);
      ctx.closePath();
      ctx.fill();

      // AVG čára
      ctx.strokeStyle = "#ff0000";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(avgAngle)*offsetLine, cy + Math.sin(avgAngle)*offsetLine);
      ctx.stroke();

      // MODE čára
      ctx.strokeStyle = "#0000ff";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(modeAngle)*offsetLine, cy + Math.sin(modeAngle)*offsetLine);
      ctx.stroke();

      // === TOOLTIP ===
      if (chart.$windHover && chart.$mouse) {
        const { index, value } = chart.$windHover;
        const { x: mx, y: my } = chart.$mouse;

        const label = WIND_DIR_LABELS[index];
        const percent = ((value / maxBin) * 100).toFixed(1);
        const tooltipText = `${label}: ${value}× (${percent}%)`;

        ctx.save();

        // === Chart.js tooltip style ===
        ctx.font = "12px sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";

        const paddingX = 8;
        const paddingY = 6;

        const textWidth = ctx.measureText(tooltipText).width;
        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = 20; // Chart.js default tooltip height

        // Position near cursor
        let tx = mx + 10;
        let ty = my - boxHeight - 10;

        // Prevent overflow
        if (tx + boxWidth > chart.width) tx = chart.width - boxWidth - 4;
        if (ty < chart.chartArea.top) ty = my + 10;

        // Background
        ctx.fillStyle = theme.bgColor + "f0"; // Chart.js-like opacity
        ctx.strokeStyle = theme.textColor + "80";
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.roundRect(tx, ty, boxWidth, boxHeight, 4);
        ctx.fill();
        ctx.stroke();

        // Text
        ctx.fillStyle = theme.textColor;
        ctx.fillText(tooltipText, tx + paddingX, ty + boxHeight / 2);

        ctx.restore();
      }

      ctx.restore();
    }
  };
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
    this.config = {
      show_graphs: true,
      hide_sensors: [],
      ...config
    };
    this.attachShadow({ mode:"open" });
  }

  set hass(hass) {
    const entity = hass.states[this.config.entity];

    if (!this._initialized) {
      this._initialize();
      this._initialized = true;
    }

    if (!entity || !entity.attributes || !entity.attributes.sensors) {
      const card = this.shadowRoot.querySelector(".pm-card");
      if (card) {
        card.innerHTML = `
          <h2>PočasíMeteo</h2>
          <p style="opacity:0.7;">Backendová komponenta není dostupná (chybí data senzorů).</p>
        `;
      }
      return;
    }

    const refresh = entity.attributes.update_interval || 5;

    if (refresh * 60 * 1000 > Date.now() - this._lastRender) return;

    if (this._lastAttributes && JSON.stringify(this._lastAttributes) === JSON.stringify(entity.attributes)) return;

    this._lastAttributes = JSON.parse(JSON.stringify(entity.attributes));
    this._lastRender = Date.now();

    if (this._rendering) return;
    this._rendering = true;

    this._update(hass).finally(() => { this._rendering = false; });
  }
  
  _initialize() {
    this.shadowRoot.innerHTML = `
      <style>
        .pm-card {
          padding:0;
          color:var(--primary-text-color,#fff);
          display:flex;
          flex-direction:column;
          gap:0;
        }

        .pm-header-section {
          padding:16px;
          background:rgba(255,255,255,0.05);
          border-bottom:1px solid rgba(255,255,255,0.1);
          display:flex;
          flex-direction:column;
          gap:12px;
        }

        .pm-header-top {
          display:flex;
          justify-content:space-between;
          align-items:flex-start;
          font-size:20px;
          font-weight:600;
        }

        .pm-header-title {
          display:flex;
          flex-direction:column;
          gap:4px;
        }

        .pm-header-timestamp {
          opacity:0.7;
          font-size:14px;
        }

        .pm-header-bottom {
          display:flex;
          justify-content:space-between;
          align-items:flex-start;
          gap:16px;
        }

        .pm-header-main {
          font-size:48px;
          font-weight:300;
        }

        .pm-header-details {
          display:flex;
          flex-direction:column;
          gap:4px;
          font-size:16px;
          opacity:0.85;
        }

        .pm-primary-section {
          background:rgba(255,255,255,0.03);
          padding:16px;
          border-bottom:1px solid rgba(255,255,255,0.1);
        }

        .pm-secondary-section {
          background:rgba(255,255,255,0.05);
          padding:16px;
        }

        .pm-graphs {
          display:grid;
          grid-template-columns:repeat(auto-fill,minmax(260px,1fr));
          gap:16px;
          margin-top:8px;
        }

        .pm-graph-tile {
          background:var(--ha-card-background,#1c1c1c);
          border-radius:12px;
          padding:4px;
          box-shadow:var(--ha-card-box-shadow,0 2px 4px rgba(0,0,0,0.2));
          display:flex;
          flex-direction:column;
        }

        .pm-graph-title { font-size:1em; font-weight:600; margin-bottom:4px; }
        .pm-graph { width:100%; height:300px; }
        .pm-legend {
          margin-top:0px;
          display:flex;
          flex-wrap:wrap;
          justify-content:center;
          gap:8px;
          font-size:14px;
          opacity:0.8;
        }
        .pm-legend-item { display:flex; align-items:center; gap:4px; }
        .pm-legend-color { width:12px; height:12px; border-radius:2px; }
      </style>

      <ha-card class="pm-card">
        <div id="header-section" class="pm-header-section">
          <div class="pm-header-top">
            <div class="pm-header-title" id="header-title"></div>
            <div class="pm-header-timestamp" id="header-timestamp"></div>
          </div>
          <div class="pm-header-bottom">
            <div class="pm-header-main" id="header-main"></div>
            <div class="pm-header-details" id="header-details"></div>
          </div>
        </div>

        <div class="pm-primary-section">
          <div id="primary-graphs" class="pm-graphs"></div>
        </div>

        <div class="pm-secondary-section">
          <div id="secondary-graphs" class="pm-graphs"></div>
        </div>
      </ha-card>
    `;
  }

  async _update(hass) {
    const entity = hass.states[this.config.entity];
    if (!entity) return;

    const nowTs = Date.now();
    if (30000 > nowTs - this._lastFetch) return;
    this._lastFetch = nowTs;

    const d = entity.attributes;
    
    // NEPRŮSTŘELNÉ ŘEŠENÍ: Karta načte entity rovnou z hotových polí z weather.py
    const primarySensors = Array.isArray(d.primary_sensors) ? d.primary_sensors : [];
    const secondarySensors = Array.isArray(d.secondary_sensors) ? d.secondary_sensors : [];
    
    // Spojíme je do jednoho pole entit, které reálně v systému existují
    const sensorEntities = [];
    for (const entityId of [...primarySensors, ...secondarySensors]) {
      if (hass.states[entityId]) {
        if (!this.config.hide_sensors.includes(entityId.split("_").pop().toLowerCase())) {
          sensorEntities.push(entityId);
        }
      }
    }

    const orderedSensors = [...sensorEntities];

    const headerTitle = this.shadowRoot.getElementById("header-title");
    const headerTimestamp = this.shadowRoot.getElementById("header-timestamp");
    const headerMain = this.shadowRoot.getElementById("header-main");
    const headerDetails = this.shadowRoot.getElementById("header-details");
    const primaryGraphs = this.shadowRoot.getElementById("primary-graphs");
    const secondaryGraphs = this.shadowRoot.getElementById("secondary-graphs");

    headerTitle.innerHTML = `${d.lokalita_stanice || d.station_name || ""}`;
    headerTimestamp.innerHTML = `${d.timestamp || ""}`;
    headerMain.innerHTML = `Teplota venkovní: ${d.teplota_vnejsi_value ?? entity.attributes.temperature}°C`;

    headerDetails.innerHTML = `
      <div>Tlak: ${entity.attributes.pressure ?? ""} hPa</div>
      <div>Vlhkost: ${entity.attributes.humidity ?? ""}%</div>
      <div>Vítr: ${entity.attributes.wind_speed ?? ""} m/s (${degToDirection(Number(entity.attributes.wind_bearing))})</div>
      <div>Nárazy: ${entity.attributes.wind_gust_speed ?? ""} m/s</div>
      <div>Srážky dnes: ${d.srazky_den ?? 0} mm</div>
    `;

    primaryGraphs.innerHTML = "";
    secondaryGraphs.innerHTML = "";

    if (this.config.show_graphs === false) return;
    if (orderedSensors.length === 0) return;

    const token =
      hass.connection?.options?.accessToken ||
      hass.auth?.data?.access_token ||
      hass.connection?.options?.auth?.access_token ||
      null;

    if (!token) return;

    const since = new Date(Date.now() - 24*3600*1000).toISOString();

    const canvases = {};
    const history = {};

    // Smyčka pro generování dlaždic grafů
    for (const sensor of orderedSensors) {
      const s = hass.states[sensor];
      if (!s) continue;

      // NEPRŮSTŘELNÉ ŘEŠENÍ: Získáme vnitřní ID bezpečně z metadat integrace,
      // čímž zcela eliminujeme jakékoliv automatické prefixy oblasti (venku_gar632_)
      const meta = sensorsMeta.find(m => m.entity_id === sensor);
      const suffix = meta ? meta.id : sensor.split(".").pop().replace(/^[a-zA-Z0-9]+_/, "");

      const tile = document.createElement("div");
      tile.classList.add("pm-graph-tile");

      const unit = s.attributes.unit_of_measurement || "";
      const prettyName = s.attributes.friendly_name || suffix;

      const title = document.createElement("div");
      title.classList.add("pm-graph-title");
      title.textContent = prettyName + (unit ? " - " + unit : "");

      const canvas = document.createElement("canvas");
      canvas.classList.add("pm-graph");
      canvas.height = suffix === "vitr_smer" ? 300 : 220;

      const legend = document.createElement("div");
      legend.classList.add("pm-legend");

      tile.appendChild(title);
      tile.appendChild(canvas);
      tile.appendChild(legend);

      if (primarySensors.includes(sensor)) {
        primaryGraphs.appendChild(tile);
      } else {
        secondaryGraphs.appendChild(tile);
      }

      canvases[sensor] = { canvas, tile, prettyName, legend, suffix };
    }

    // --- Načtení historie z HA API ---
    await Promise.all(orderedSensors.map(async sensor => {
      if (NON_GRAPH_SENSORS.some(n => sensor.endsWith(n))) return;

      const url =
        `/api/history/period/${since}` +
        `?filter_entity_id=${sensor}` +
        `&minimal_response` +
        `&significant_changes_only=false`;

      try {
        const resp = await fetch(url, {
          method:"GET",
          headers:{
            "Authorization":`Bearer ${token}`,
            "Content-Type":"application/json",
            "Accept":"application/json"
          },
          credentials:"same-origin"
        });

        if (resp.ok) history[sensor] = await resp.json();
      } catch(e) {}
    }));

    const host = this.shadowRoot.host;
    const theme = computeTheme(host);

    /* === VYKRESLENÍ STANDARDNÍCH GRAFŮ === */
    for (const sensor of orderedSensors) {
      const item = canvases[sensor];
      if (!item || item.suffix === "vitr_smer") continue;
      if (!history[sensor] || !history[sensor] || !history[sensor].length) continue;

      const points = historyToPoints(history[sensor]);
      
      // Pojistka pro konstantní nulové srážky (vytvoří vodorovnou linku)
      if (points.length === 1) {
        points.push({ x: Date.now(), y: points[0].y });
      }
      
      if (points.length < 2) continue;

      const { canvas, tile, prettyName, legend, suffix } = item;
      const ctx = canvas.getContext("2d");

      if (this._charts[sensor]) this._charts[sensor].destroy();

      canvas.style.backgroundColor = theme.bgColor;
      tile.style.backgroundColor = theme.bgColor;

      const { min, max } = computeMinMax(points);
      
      const sState = hass.states[sensor];
      const color = sState ? (sState.attributes.graph_color || "#3b82f6") : "#3b82f6";

      this._charts[sensor] = new Chart(ctx, createLineChartConfig(points, prettyName, color, theme.textColor));

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

    /* === VYKRESLENÍ VĚTRNÉ RŮŽICE === */
    const windSensor = orderedSensors.find(s => s.endsWith("vitr_smer"));

    // OPRAVA: Doplněno bezpečné ověření dvourozměrného pole historie [0] z HA API
    if (windSensor && history[windSensor] && history[windSensor][0] && history[windSensor][0].length) {
      
      // OPRAVA: Do pomocné funkce předáme čisté pole stavů z indexu 0
      const points = historyToPoints(history[windSensor][0]);
      
      if (points.length >= 2) {
        const item = canvases[windSensor];
        const { canvas, tile, prettyName, legend } = item;
        const ctx = canvas.getContext("2d");

        if (this._charts[windSensor]) this._charts[windSensor].destroy();

        canvas.style.backgroundColor = theme.bgColor;
        tile.style.backgroundColor = theme.bgColor;

        const bins = buildWindRose(points);

        const wState = hass.states[windSensor];
        const currentAngle = wState ? Number(wState.state) : 0;

        // Pokud by aktuální stav nebyl číselný (např. při výpadku), spočítáme průměr z historie
        const avg = !isNaN(currentAngle) ? currentAngle : (points.reduce((a, b) => a + b.y, 0) / points.length);
        const mode = avg; 
        const vari = 0.0;

        const windRosePlugin = createWindRosePlugin(theme, bins, avg, mode, vari);

        this._charts[windSensor] = new Chart(ctx, {
          type:"polarArea",
          data:{ labels:[], datasets:[] },
          options:{
            responsive:false,
            maintainAspectRatio:false,
            layout:{ padding:{ top:20, bottom:20, left:10, right:10 }},
            scales:{ r:{ ticks:{display:false}, grid:{display:false}, beginAtZero:true }},
            plugins:{ tooltip:{}, legend:{display:false} }
          },
          plugins:[windRosePlugin]
        });

        legend.innerHTML = `
          <div class="pm-legend-item">
            <span class="pm-legend-color" style="background:#ff0000;"></span>
            <span>Avg: ${avg.toFixed(0)}°</span>
          </div>
          <div class="pm-legend-item">
            <span class="pm-legend-color" style="background:#0000ff;"></span>
            <span>Mode: ${mode.toFixed(0)}°</span>
          </div>
          <div class="pm-legend-item">
            <span class="pm-legend-color" style="background:rgba(255,165,0,0.8);"></span>
            <span>Var: ±${vari.toFixed(0)}°</span>
          </div>
        `;
      }
    }
  }

  _hexToRgba(hex, alpha) {
    return hexToRgba(hex, alpha);
  }

  getCardSize() {
    return 6;
  }
}

customElements.define("pocasimeteo-card", PocasiMeteoCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type:"pocasimeteo-card",
  name:"PočasíMeteo Card",
  description:"Automatické grafy pro PočasíMeteo.cz"
});
