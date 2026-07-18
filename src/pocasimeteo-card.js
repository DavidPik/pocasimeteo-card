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
  teplotavnejsi: "#ff6b3d",
  teplotavnitrni: "#ffa86b",
  vlhkostvnejsi: "#1e88e5",
  vlhkostvnitrni: "#64b5f6",
  tlakrel: "#8e24aa",
  vitr: "#43a047",
  vitrnarazy: "#2e7d32",
  vitrsmer: "#009688",
  rainintensity: "#0288d1",
  slunzareni: "#ffb300",
  uvindex: "#fdd835",
  co2: "#6d4c41",
  pm1: "#7e57c2",
  pm2: "#5e35b1",
  pm1v: "#9575cd"
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

/* === WINDROSE PLUGIN === */
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

        if (dist > R) {
          chart.$windHover = null;
          chart.draw();
          return;
        }

        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
        angle += 90;
        if (angle < 0) angle += 360;

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

      ctx.save();
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;

      [0.15,0.30,0.45,0.60,0.75,0.90].forEach(f => {
        ctx.beginPath();
        ctx.arc(cx, cy, R*f, 0, Math.PI*2);
        ctx.stroke();
      });

      [0,90,180,270].forEach(deg => {
        const a = (deg - 90) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a)*R, cy + Math.sin(a)*R);
        ctx.stroke();
      });

      const sectorColor = COLOR_MAP["vitrsmer"] || "#3b82f6";

      for (let i=0; i<16; i++) {
        const binValue = bins[i];
        const radius = (binValue / maxBin) * (R * 0.90);

        const midAngle = ((i * 22.5) - 90) * Math.PI / 180;
        const startAngle = midAngle - sectorAngle/2;
        const endAngle = midAngle + sectorAngle/2;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.closePath();

        ctx.fillStyle = hexToRgba(sectorColor, 0.85);
        ctx.fill();

        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

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

      const offsetLine = R - 20;
      const offsetVar = R - 10;

      const avgAngle = (avg - 90) * Math.PI / 180;
      const modeAngle = (mode - 90) * Math.PI / 180;
      const startVar = (avg - vari - 90) * Math.PI / 180;
      const endVar = (avg + vari - 90) * Math.PI / 180;

      ctx.fillStyle = "rgba(255,165,0,0.25)";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, offsetVar, startVar, endVar);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "#ff0000";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(avgAngle)*offsetLine, cy + Math.sin(avgAngle)*offsetLine);
      ctx.stroke();

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
