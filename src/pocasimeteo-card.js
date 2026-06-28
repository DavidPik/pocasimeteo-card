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

/* === VALID_SENSORS === */
const VALID_SENSORS = [
  "teplotavnejsi",
  "vlhkostvnejsi",
  "tlakrel","vitr",
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

const NON_GRAPH_SENSORS = ["srazkyden"];

/* === NÁZVY === */
const TITLE_MAP = {
  teplotavnejsi: "Teplota vnější",
  teplotavnitrni: "Teplota vnitřní",
  vlhkostvnejsi: "Vlhkost vnější",
  vlhkostvnitrni: "Vlhkost vnitřní",
  tlakrel: "Tlak relativní",
  vitr: "Vítr",
  vitrnarazy: "Nárazy větru",
  vitrsmer: "Směr větru",
  rainintensity: "Intenzita srážek",
  slunzareni: "Sluneční záření",
  uvindex: "UV index",
  co2: "CO₂",
  pm1: "PM1",
  pm2: "PM2",
  pm1v: "PM1 varianta"
};

/* === BARVY === */
const COLOR_MAP = {
  /* === Teplota === */
  teplotavnejsi: "#ff6b3d",   // jasná oranžová (venkovní)
  teplotavnitrni: "#ffa86b",  // světlejší oranžová (vnitřní)
  /* === Vlhkost === */
  vlhkostvnejsi: "#1e88e5",   // sytá modrá (venkovní)
  vlhkostvnitrni: "#64b5f6",  // světlejší modrá (vnitřní)
  /* === Tlak === */
  tlakrel: "#8e24aa",         // fialová
  /* === Vítr === */
  vitr: "#43a047",            // základní zelená
  vitrnarazy: "#2e7d32",      // tmavší zelená (nárazy)
  vitrsmer: "#009688",        // tyrkysová (směr) – odlišná od vlhkosti
  /* === Srážky === */
  rainintensity: "#0288d1",   // modrá s nádechem do aqua
  /* === Slunce === */
  slunzareni: "#ffb300",      // jasná žlutá/oranžová
  /* === UV === */
  uvindex: "#fdd835",         // žlutá
  /* === CO₂ === */
  co2: "#6d4c41",             // hnědá
  /* === Prach === */
  pm1: "#7e57c2",             // světlejší fialová
  pm2: "#5e35b1",             // tmavší fialová
  pm1v: "#9575cd"             // pastelová fialová
};

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
function createWindRosePlugin(textColor, bins, avg, mode, vari) {
  return {
    id:"windRoseManual",
    afterDraw(chart) {
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
      ctx.fillStyle = textColor;
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
      const endVar = (avg + vari - 90) * Math.PI / 180;

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
    this.config = config {
      show_graphs: true,
      hide_sensors: []
    };
    this.attachShadow({ mode:"open" });
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
          <p style="opacity:0.7;">Backendová komponenta není dostupná.</p>
        `;
      }
      return;
    }

    if (!this._updateInterval) {
      const entryId = entity.attributes.config_entry_id;
      if (entryId) {
        hass.callApi("GET", `config/config_entries/entry/${entryId}`)
          .then(entry => this._updateInterval = entry.data.update_interval || 60)
          .catch(() => this._updateInterval = 60);
      } else this._updateInterval = 60;
    }

    const refresh = this._updateInterval || 60;

    if (Date.now() - this._lastRender < refresh*1000) return;

    if (this._lastAttributes &&
        JSON.stringify(this._lastAttributes) === JSON.stringify(entity.attributes)) return;

    this._lastAttributes = JSON.parse(JSON.stringify(entity.attributes));
    this._lastRender = Date.now();

    if (this._rendering) return;
    this._rendering = true;

    this._update(hass).finally(() => this._rendering = false);
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
      .toLowerCase().replace(/\s+/g,"_");

    const sensorEntities = Object.keys(hass.states)
      .filter(e => e.startsWith("sensor."+prefix+"_"))
      .filter(e => {
          const suffix = e.replace("sensor."+prefix+"_","").toLowerCase();
          return VALID_SENSORS.includes(suffix)
              && !this.config.hide_sensors.includes(suffix);
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
    if (this.config.show_graphs === false) {
      return;   // grafy se nevykreslí
    }

    if (sensorEntities.length === 0) return;

    const token =
      hass.connection?.options?.accessToken ||
      hass.auth?.data?.access_token ||
      hass.connection?.options?.auth?.access_token ||
      null;

    if (!token) return;

    const since = new Date(Date.now() - 24*3600*1000).toISOString();

    const orderedSensors = [
      ...sensorEntities.filter(s => s.endsWith("vitrsmer")),
      ...sensorEntities.filter(s => !s.endsWith("vitrsmer"))
    ];

    const canvases = {};
    for (const sensor of orderedSensors) {
      const suffix = sensor.replace("sensor."+prefix+"_","");

      const tile = document.createElement("div");
      tile.classList.add("pm-graph-tile");

      const s = hass.states[sensor];
      const unit = s.attributes.unit_of_measurement || "";
      const suffixLower = suffix.toLowerCase();
      const prettyName = TITLE_MAP[suffixLower] || suffix;

      const title = document.createElement("div");
      title.classList.add("pm-graph-title");
      title.textContent = prettyName + (unit ? " - " + unit : "");

      const canvas = document.createElement("canvas");
      canvas.classList.add("pm-graph");
      canvas.height = suffix === "vitrsmer" ? 300 : 220;

      const legend = document.createElement("div");
      legend.classList.add("pm-legend");

      tile.appendChild(title);
      tile.appendChild(canvas);
      tile.appendChild(legend);
      graphs.appendChild(tile);

      canvases[sensor] = { canvas, tile, prettyName, legend };
    }

    const history = {};

    await Promise.all(orderedSensors.map(async sensor => {
      const suffix = sensor.replace("sensor."+prefix+"_","").toLowerCase();
      if (NON_GRAPH_SENSORS.includes(suffix)) return;

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

    /* === STANDARDNÍ GRAFY === */
    for (const sensor of orderedSensors) {
      const suffix = sensor.replace("sensor."+prefix+"_","").toLowerCase();
      if (suffix === "vitrsmer") continue;
      if (!history[sensor] || !history[sensor][0] || !history[sensor][0].length) continue;

      const points = historyToPoints(history[sensor][0]);
      if (points.length < 2) continue;

      const { canvas, tile, prettyName, legend } = canvases[sensor];
      const ctx = canvas.getContext("2d");

      if (this._charts[sensor]) this._charts[sensor].destroy();

      canvas.style.backgroundColor = theme.bgColor;
      tile.style.backgroundColor = theme.bgColor;

      const { min, max } = computeMinMax(points);
      const color = COLOR_MAP[suffix] || "#3b82f6";

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

    /* === WINDROSE === */
    const windSensor = orderedSensors.find(s => s.endsWith("vitrsmer"));

    if (windSensor && history[windSensor] && history[windSensor][0] && history[windSensor][0].length) {
      const points = historyToPoints(history[windSensor][0]);
      if (points.length >= 2) {
        const { canvas, tile, prettyName, legend } = canvases[windSensor];
        const ctx = canvas.getContext("2d");

        if (this._charts[windSensor]) this._charts[windSensor].destroy();

        canvas.style.backgroundColor = theme.bgColor;
        tile.style.backgroundColor = theme.bgColor;

        const bins = buildWindRose(points);

        const avg = Number(entity.attributes.VitrSmer_avg || 0);
        const mode = Number(entity.attributes.VitrSmer_mode || 0);
        const vari = Number(entity.attributes.VitrSmer_var || 0);

        const windRosePlugin = createWindRosePlugin(theme.textColor, bins, avg, mode, vari);

        /* === PolarArea jako prázdný kontejner === */
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
