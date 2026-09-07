/*  =======  POCASIMETEO CARD – GENIÁLNÍ DYNAMICKÁ ARCHITEKTURA =======  */

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
} from 'chart.js';

import 'chartjs-adapter-date-fns';

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

// Konstanta pro mřížku grafů Chart.js
const GRID_COLOR = 'rgba(255,255,255,0.2)';

// Popisky pro 16 směrů větrné růžice
const WIND_DIR_LABELS = [
  'N','NNE','NE','ENE','E','ESE','SE','SSE',
  'S','SSW','SW','WSW','W','WNW','NW','NNW'
];

/**
 * Bezpečně vytáhne hodnotu CSS proměnné z Home Assistenta.
 */
function safeCssVar(el, name, fallback) {
  try {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

/**
 * Detekuje světlý/tmavý režim.
 */
function isLightTheme(el) {
  return safeCssVar(el, '--brightness', '0').trim() === '1';
}

/**
 * Výpočet barev motivu.
 */
function computeTheme(host) {
  const light = isLightTheme(host);
  const textColor = safeCssVar(host, '--primary-text-color', null) || (light ? '#000' : '#fff');
  const bgColor =
    safeCssVar(host, '--ha-card-background', '') ||
    safeCssVar(host, '--card-background-color', '') ||
    (light ? '#fff' : '#1c1c1c');
  return { textColor, bgColor };
}

/**
 * Převod stupňů na textovou zkratku směru větru.
 */
function degToDirection(deg) {
  if (deg == null || isNaN(deg)) return '';
  return WIND_DIR_LABELS[Math.round(deg / 22.5) % 16];
}

/**
 * Index sektoru větrné růžice.
 */
function directionToIndex(deg) {
  return Math.round(deg / 22.5) % 16;
}

/**
 * Sestaví histogram 16 sektorů větrné růžice.
 */
function buildWindRose(points) {
  const bins = new Array(16).fill(0);
  for (const p of points) {
    const deg = Number(p.y);
    if (!isNaN(deg)) bins[directionToIndex(deg)]++;
  }
  return bins;
}

/**
 * Transformace historie z Recorderu na body pro graf.
 */
function historyToPoints(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(p => {
    const rawTs = p.lc || p.lu || p.last_changed || p.last_updated;
    const rawState = p.s !== undefined ? p.s : p.state;

    if (!rawTs || rawState === undefined) return null;

    const ts = typeof rawTs === 'number' ? rawTs * 1000 : Date.parse(rawTs);
    const val = Number(rawState);

    if (isNaN(ts) || isNaN(val)) return null;

    return { x: ts, y: val };
  }).filter(p => p && !isNaN(p.x) && !isNaN(p.y));
}

/**
 * HEX → RGBA
 */
function hexToRgba(hex, alpha) {
  if (!hex || hex.length < 7) hex = '#3b82f6';
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Konfigurace čárového grafu Chart.js — sjednocená signatura (item, points, statsIntervalHours)
 */
function createLineChartConfig(item, points, statsIntervalHours) {
  const theme = item.theme || { textColor: '#fff' };
  const color = item.color || '#3b82f6';
  const isStepped = item.style === 'stepped';
  const textColor = theme.textColor;

  const endX = Date.now();
  const intervalMs = (statsIntervalHours || 24) * 3600 * 1000;
  const startX = endX - intervalMs;

  // MIN/MAX z backendu (sensor_stats) nebo fallback z historie
  let min = typeof item.min === 'number' ? item.min : null;
  let max = typeof item.max === 'number' ? item.max : null;

  if ((min === null || max === null) && points && points.length > 0) {
    const ys = points.map(p => p.y);
    min = min ?? Math.min(...ys);
    max = max ?? Math.max(...ys);
  }

  if (min === null || max === null) {
    min = 0;
    max = 1;
  }

  const padding = (max - min) * 0.05 || 1;
  let finalMin = min - padding;
  const finalMax = max + padding;

  if (!item.title.toLowerCase().includes('teplot') &&
      !item.title.toLowerCase().includes('temperature') &&
      finalMin < 0) {
    finalMin = 0;
  }

  let minPoint = null;
  let maxPoint = null;

  if (points && points.length > 0) {
    minPoint = points.reduce((acc, p) => (acc === null || Math.abs(p.y - min) < Math.abs(acc.y - min) ? p : acc), null);
    maxPoint = points.reduce((acc, p) => (acc === null || Math.abs(p.y - max) < Math.abs(acc.y - max) ? p : acc), null);
  }

  const rgba = hexToRgba(color, 0.25);

  return {
    type: 'line',
    data: {
      datasets: [
        {
          label: item.title,
          data: points,
          borderColor: color,
          backgroundColor: rgba,
          tension: isStepped ? 0 : 0.3,
          stepped: isStepped,
          pointRadius: 0,
          borderWidth: 2
        },
        {
          label: 'Min: ' + min.toFixed(1),
          data: minPoint ? [{ x: minPoint.x, y: minPoint.y }] : [],
          pointRadius: 6,
          pointBackgroundColor: 'red',
          showLine: false
        },
        {
          label: 'Max: ' + max.toFixed(1),
          data: maxPoint ? [{ x: maxPoint.x, y: maxPoint.y }] : [],
          pointRadius: 6,
          pointBackgroundColor: 'green',
          showLine: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 10,
      layout: { padding: { top: 8, bottom: 8, left: 6, right: 8 } },
      plugins: { 
        legend: { display: false },
        tooltip: {
          enabled: true,
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(28, 28, 28, 0.95)',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: 'rgba(255, 255, 255, 0.15)',
          borderWidth: 1,
          cornerRadius: 6,
          padding: 10,
          callbacks: {
            title: function(context) {
              if (context && context.length > 0 && context[0].parsed) {
                const parsedDate = new Date(context[0].parsed.x);
                return 'Čas: ' + parsedDate.toLocaleTimeString('cs-CZ');
              }
              return '';
            },
            label: function(context) {
              const labelText = context.dataset.label || '';
              const pointValue = context.parsed.y;
              
              if (labelText) {
                if (labelText.includes('Min') || labelText.includes('Max')) {
                  return labelText;
                }
                return 'Hodnota: ' + pointValue.toFixed(1);
              }
              return '';
            }
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          min: startX,
          max: endX,
          time: {
            displayFormats: {
              hour: 'HH:mm'
            }
          },
          ticks: { color: textColor },
          grid: { color: GRID_COLOR }
        },
        y: {
          min: finalMin,
          max: finalMax,
          ticks: { color: textColor},
          grid: { color: GRID_COLOR }
        }
      }
    }
  };
}

function computeChartGeometry(chartArea) {
  const cx = chartArea.left + chartArea.width / 2;
  const cy = chartArea.top + chartArea.height / 2;
  const R = Math.min(chartArea.width, chartArea.height) / 2;
  return { cx, cy, R };
}

/**
 * Plugin pro větrnou růžici — sjednocená signatura (item, points, statsIntervalHours)
 */
function createWindRosePlugin(item, points, statsIntervalHours) {
  const theme = item.theme || { textColor: '#fff' };

  const avg = Number(item.avg ?? 0);
  const mode = Number(item.mod ?? 0);
  const vari = Number(item.var ?? 0);

  const bins = buildWindRose(points);

  return {
    id: 'windRoseManual',

    beforeInit(chart) {
      const canvas = chart.canvas;

      canvas.addEventListener('mousemove', (ev) => {
        const rect = canvas.getBoundingClientRect();
        chart.$mouse = {
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top
        };

        const { cx, cy, R } = computeChartGeometry(chart.chartArea || chart);
        const dx = chart.$mouse.x - cx;
        const dy = chart.$mouse.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > R * 0.80) {
          chart.$windHover = null;
          chart.render();
          return;
        }

        let angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        if (angle < 0) angle += 360;

        const sectorIndex = Math.floor(angle / 22.5) % 16;
        chart.$windHover = {
          index: sectorIndex,
          value: bins[sectorIndex],
          angle
        };

        chart.render();
      });

      canvas.addEventListener('mouseleave', () => {
        chart.$windHover = null;
        chart.render();
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

      const activeRadius = R * 0.85;

      [0.2, 0.4, 0.6, 0.8, 1.0].forEach(f => {
        ctx.beginPath();
        ctx.arc(cx, cy, activeRadius * f, 0, Math.PI * 2);
        ctx.stroke();
      });

      const degAxes = [0, 45, 90, 135, 180, 225, 270, 315];
      degAxes.forEach(deg => {
        const a = (deg - 90) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * activeRadius, cy + Math.sin(a) * activeRadius);
        ctx.stroke();
      });

      const sectorColor = '#009688';

      for (let i = 0; i < 16; i++) {
        const binValue = bins[i];
        const radius = (binValue / maxBin) * activeRadius;
        const midAngle = ((i * 22.5) - 90) * Math.PI / 180;
        const startAngle = midAngle - sectorAngle / 2;
        const endAngle = midAngle + sectorAngle / 2;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = hexToRgba(sectorColor, 0.85);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      ctx.fillStyle = theme.textColor;
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const offsetText = activeRadius + 22;

      WIND_DIR_LABELS.forEach((label, i) => {
        const angle = ((i * 22.5) - 90) * Math.PI / 180;
        const x = cx + Math.cos(angle) * offsetText;
        const y = cy + Math.sin(angle) * offsetText;
        ctx.fillText(label, x, y);
      });

      const avgLineLen = activeRadius;
      const modeLineLen = activeRadius - 15;
      const offsetVar = activeRadius - 5;

      const avgAngle = (avg - 90) * Math.PI / 180;
      const modeAngle = (mode - 90) * Math.PI / 180;
      const startVar = (avg - vari - 90) * Math.PI / 180;
      const endVar = (avg + vari - 90) * Math.PI / 180;

      ctx.fillStyle = 'rgba(255,165,0,0.22)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, offsetVar, startVar, endVar);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(avgAngle) * avgLineLen, cy + Math.sin(avgAngle) * avgLineLen);
      ctx.stroke();

      ctx.strokeStyle = '#0000ff';
      ctx.lineWidth = 4.0;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(modeAngle) * modeLineLen, cy + Math.sin(modeAngle) * modeLineLen);
      ctx.stroke();

      if (chart.$windHover && chart.$mouse) {
        const { index, value } = chart.$windHover;
        const { x: mx, y: my } = chart.$mouse;

        const label = WIND_DIR_LABELS[index];
        const percent = ((value / maxBin) * 100).toFixed(1);
        const tooltipText = `${label}: ${value}× (${percent}%)`;

        ctx.save();
        ctx.font = '12px sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';

        const padX = 10;
        const padY = 10;
        const textWidth = ctx.measureText(tooltipText).width;
        const boxWidth = textWidth + padX * 2;
        const boxHeight = 16 + padY * 2;

        let tx = mx + 12;
        let ty = my - boxHeight - 12;

        if (tx + boxWidth > chart.width) tx = chart.width - boxWidth - 4;
        if (chart.chartArea && chart.chartArea.top > ty) {
          ty = my + 12;
        }

        ctx.shadowColor = 'rgba(0,0,0,0.15)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = 'rgba(28, 28, 28, 0.95)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;

        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(tx, ty, boxWidth, boxHeight, 6);
        } else {
          ctx.rect(tx, ty, boxWidth, boxHeight);
        }
        ctx.fill();
        ctx.stroke();

        ctx.shadowColor = 'transparent';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(tooltipText, tx + padX, ty + boxHeight / 2);

        ctx.restore();
      }

      ctx.restore();
    }
  };
}

/**
 * Třída reprezentující samotnou Home Assistant Lovelace kartu PočasíMeteo.
 */
class PocasiMeteoCard extends HTMLElement {
  constructor() {
    super();
    this._initialized = false;
    this._rendering = false;
    this._charts = {};
    this._lastApiTimestamp = null;
    this._lastFetch = 0;
    this._resizeObserver = null;
    this._currentHass = null;
    this._initialResizeDone = false;
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('entity is required');
    }
    this.config = { show_graphs: true, hide_sensors: [], graphs_per_row: 2, ...config };

    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
  }

  connectedCallback() {
    this._resizeObserver = new ResizeObserver(() => {
      if (!this._initialResizeDone) {
        this._initialResizeDone = true;
        if (this._currentHass) {
          const entity = this._currentHass.states[this.config.entity];
          if (entity?.attributes?.sensors) {
            this._updateCharts(this._currentHass, entity);
          }
        }
        return;
      }
      if (this._currentHass && this._initialized && !this._rendering) {
        const entity = this._currentHass.states[this.config.entity];
        if (entity?.attributes?.sensors) {
          this._rendering = true;
          setTimeout(() => {
            this._updateCharts(this._currentHass, entity).finally(() => {
              this._rendering = false;
            });
          }, 50);
        }
      }
    });
    this._resizeObserver.observe(this);
  }

  disconnectedCallback() {
    this._resizeObserver?.disconnect();
  }

  set hass(hass) {
    this._currentHass = hass;
    const entity = hass.states[this.config.entity];

    if (!this._initialized) {
      this._initialize();
      this._initialized = true;
    }

    if (!entity?.attributes?.sensors) {
      const card = this.shadowRoot.querySelector('.pm-card');
      if (card) {
        card.textContent = '';
        const h2 = document.createElement('h2');
        h2.textContent = 'PočasíMeteo';
        const p = document.createElement('p');
        p.style.opacity = '0.7';
        p.textContent = 'Backendová komponenta není dostupná (chybí data senzorů).';
        card.appendChild(h2);
        card.appendChild(p);
      }
      return;
    }

    this._updateVisualHeader(entity);

    // ARCHITEKTURA FRONTENDU: Reaktivní pojistka. Grafy překreslíme vždy, pokud se v systému 
    // změnila data historie, délka fronty, nebo dorazily čerstvé statistiky sensor_stats.
    const nowTs = Date.now();
    const currentApiTimestamp = entity.attributes.timestamp || '';
    const currentQueue = entity.attributes.history_queue_length || 0;
    const currentStatsStr = JSON.stringify(entity.attributes.sensor_stats || {});

    // Pevná časová pojistka pro ochranu před zacyklením CPU (maximálně 1 průchod za 10 vteřin při běžném kmitání myši)
    const timeDifference = nowTs - this._lastFetch;

    if (this._lastApiTimestamp === currentApiTimestamp && 
        this._lastQueueLength === currentQueue && 
        this._lastStatsStr === currentStatsStr && 
        timeDifference < 10000) {
      return;
    }

    if (this._rendering) return;
    this._rendering = true;

    // Uložíme si kompletní otisk stavu pro příští porovnání
    this._lastApiTimestamp = currentApiTimestamp;
    this._lastQueueLength = currentQueue;
    this._lastStatsStr = currentStatsStr;
    this._lastFetch = nowTs;

    setTimeout(() => {
      this._updateCharts(hass, entity).finally(() => {
        this._rendering = false;
      });
    }, 50);
  
  _initialize() {
    const style = document.createElement('style');
    let css = '.pm-card { padding:0; color:var(--primary-text-color,#fff); display:flex; flex-direction:column; gap:0; }';
    css +='.pm-header-section { padding:20px; background:linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%); border-bottom:1px solid rgba(255,255,255,0.12); display:flex; flex-direction:column; gap:14px; }';
    css +='.pm-header-bottom { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:20px; }';
    // ARCHITEKTURA FRONTENDU: Vnutíme horní lince flexbox a vycentrujeme lokalitu i čas do identické výšky
    css += '.pm-header-top { display:flex; justify-content:space-between; align-items:center; width:100%; }';
    css += '.pm-header-title { display:flex; flex-direction:column; gap:2px; }';
    css += '.pm-header-timestamp { opacity:0.7; font-size:13px; text-align:right; flex-grow:1; padding-right:12px; }';
    css += '.pm-header-bottom { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }';
    css += '.pm-header-main { font-size:48px; font-weight:300; }';
    css += '.pm-header-details { display:flex; flex-direction:column; gap:6px; font-size:15px; opacity:0.85; text-align:right; padding-right:12px; min-width:260px; white-space:nowrap; }';
    css += '.pm-primary-section { background:rgba(255,255,255,0.03); padding:16px; border-bottom:1px solid rgba(255,255,255,0.1); }';
    css += '.pm-secondary-section { background:rgba(255,255,255,0.05); padding:16px; }';
    
    // Zde je klíčová změna: flex-wrap: wrap a správný reset pro kontejnery grafů
    css += '.pm-graphs { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 8px; align-items: stretch; width: 100%; box-sizing: border-box; }';
    
    // Dlaždice dostane dynamický výpočet šířky, flex-grow pro vyplnění řádku a striktní min-width 200px
    css += '.pm-graph-tile { box-sizing: border-box; flex: 0 1 calc((100% - (var(--graphs-per-row) - 1) * 16px) / var(--graphs-per-row)); min-width: 200px; background: var(--ha-card-background,#1c1c1c); border-radius: 12px; padding: 8px; box-shadow: var(--ha-card-box-shadow,0 2px 4px rgba(0,0,0,0.2)); display: flex; flex-direction: column; overflow: hidden; }';
    
    css += '.pm-graph-title { font-size: 13px; font-weight: 600; margin-bottom: 4px; padding: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }';
    css += '.pm-graph { width:100%; height:180px; display:block; }'; // Zajištění, že canvas vyplní šířku dlaždice
    css += '.pm-legend { margin-top:0px; display:flex; flex-wrap:wrap; justify-content:center; gap:8px; font-size:14px; opacity:0.8; padding: 4px; }';
    css += '.pm-legend-item { display:flex; align-items:center; gap:4px; }';
    css += '.pm-legend-color { width:12px; height:12px; border-radius:2px; }';

    // Pokud se kvůli min-width 200px dlaždice zalomí a nevleze se jich vedle sebe požadovaný počet,
    // dovolíme jim na malých displejích vyplnit řádek, ale na velkých budou držet přesný sloupec.
    css += '@media (max-width: 480px) { .pm-graph-tile { flex-grow: 1; } }';

    style.textContent = css;

    const card = document.createElement('ha-card');
    card.classList.add('pm-card');

    const headerSec = document.createElement('div');
    headerSec.id = 'header-section';
    headerSec.classList.add('pm-header-section');

    const topDiv = document.createElement('div');
    topDiv.classList.add('pm-header-top');
    const titleDiv = document.createElement('div');
    titleDiv.id = 'header-title';
    titleDiv.classList.add('pm-header-title');
    const timeDiv = document.createElement('div');
    timeDiv.id = 'header-timestamp';
    timeDiv.classList.add('pm-header-timestamp');
    topDiv.appendChild(titleDiv);
    topDiv.appendChild(timeDiv);

    const bottomDiv = document.createElement('div');
    bottomDiv.classList.add('pm-header-bottom');
    const mainDiv = document.createElement('div');
    mainDiv.id = 'header-main';
    mainDiv.classList.add('pm-header-main');
    const detailsDiv = document.createElement('div');
    detailsDiv.id = 'header-details';
    detailsDiv.classList.add('pm-header-details');
    bottomDiv.appendChild(mainDiv);
    bottomDiv.appendChild(detailsDiv);

    headerSec.appendChild(topDiv);
    headerSec.appendChild(bottomDiv);

    const primarySec = document.createElement('div');
    primarySec.classList.add('pm-primary-section');
    const primaryGraphs = document.createElement('div');
    primaryGraphs.id = 'primary-graphs';
    primaryGraphs.classList.add('pm-graphs');
    primarySec.appendChild(primaryGraphs);

    const secondarySec = document.createElement('div');
    secondarySec.classList.add('pm-secondary-section');
    const secondaryGraphs = document.createElement('div');
    secondaryGraphs.id = 'secondary-graphs';
    secondaryGraphs.classList.add('pm-graphs');
    secondarySec.appendChild(secondaryGraphs);

    card.appendChild(headerSec);
    card.appendChild(primarySec);
    card.appendChild(secondarySec);

    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(card);
  }

  _updateVisualHeader(entity) {
    const d = entity.attributes;
    const headerTitle = this.shadowRoot.getElementById('header-title');
    const headerTimestamp = this.shadowRoot.getElementById('header-timestamp');
    const headerMain = this.shadowRoot.getElementById('header-main');
    const headerDetails = this.shadowRoot.getElementById('header-details');

    const conditionTranslations = {
      'sunny': 'Slunečno',
      'clear-night': 'Jasno',
      'cloudy': 'Oblačno',
      'fog': 'Mlha',
      'hail': 'Krupobití',
      'lightning': 'Bouřka',
      'lightning-rainy': 'Bouřka s deštěm',
      'partlycloudy': 'Polojasno',
      'pouring': 'Silný déšť',
      'rainy': 'Déšť',
      'snowy': 'Sněžení',
      'snowy-rainy': 'Sníh s deštěm',
      'windy': 'Větrno',
      'windy-variant': 'Silný vítr'
    };

    const stateText = conditionTranslations[entity.state] || entity.state; 
    const lokalita = d.lokalita_stanice || 'Meteostanice';
    const staniceKod = d.friendly_name ? ` ${d.friendly_name}` : '';

    // ARCHITEKTURA FRONTENDU: Spojíme lokalitu a kód stanice do záhlaví (např. "Hostivice GAR632 — Slunečno")
    headerTitle.textContent = `${lokalita}${staniceKod} — ${stateText}`;
    headerTimestamp.textContent = d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : '';
    
    const temp = entity.attributes.temperature !== undefined ? entity.attributes.temperature : '--';
    headerMain.textContent = `${temp} °C`;

    const pressure = entity.attributes.pressure !== undefined ? entity.attributes.pressure : '--';
    const humidity = entity.attributes.humidity !== undefined ? entity.attributes.humidity : '--';
    
    let windSpeed = '--';
    if (entity.attributes.wind_speed != null) {
      windSpeed = (parseFloat(entity.attributes.wind_speed) / 3.6).toFixed(1);
    }
    
    let windGust = '--';
    if (entity.attributes.wind_gust != null) {
      windGust = (parseFloat(entity.attributes.wind_gust) / 3.6).toFixed(1);
    }
    
    let windDirectionText = '';
    if (entity.attributes.wind_bearing != null) {
      windDirectionText = ` ${degToDirection(entity.attributes.wind_bearing)}`;
    }
    
    const kompletniVitrText = `${windSpeed} / ${windGust} m/s${windDirectionText}`;
    const srazkyDen = d.srazky_den !== undefined ? d.srazky_den : 0;

    headerDetails.textContent = '';
    const items = [
      `Tlak vzduchu: ${pressure} hPa`,
      `Vlhkost: ${humidity} %`,
      `Síla větru: ${kompletniVitrText}`,
      `Srážky dnes: ${srazkyDen} mm`
    ];

    items.forEach(text => {
      const div = document.createElement('div');
      div.textContent = text;
      headerDetails.appendChild(div);
    });
  }

async _updateCharts(hass, entity) {
  const d = entity.attributes;
  const sensorsMeta = Array.isArray(d.sensors) ? d.sensors : [];
  const statsObj = d.sensor_stats || {};

  const primaryGraphs = this.shadowRoot.getElementById('primary-graphs');
  const secondaryGraphs = this.shadowRoot.getElementById('secondary-graphs');

  primaryGraphs.innerHTML = '';
  secondaryGraphs.innerHTML = '';

  const graphsPerRow = Math.max(1, Number(this.config.graphs_per_row) || 2);
  primaryGraphs.style.setProperty('--graphs-per-row', graphsPerRow);
  secondaryGraphs.style.setProperty('--graphs-per-row', graphsPerRow);
  
  if (this.config.show_graphs === false || sensorsMeta.length === 0) return;

  const statsIntervalHours = typeof d.statistics_interval === 'number' ? d.statistics_interval : 24;
  const since = new Date(Date.now() - statsIntervalHours * 3600 * 1000).toISOString();

  const canvases = {};
  const items = {};
  const history = {};

  const host = this.shadowRoot.host || this;
  const theme = computeTheme(host);

  const targetSections = [
    { type: 'primary', container: primaryGraphs },
    { type: 'secondary', container: secondaryGraphs }
  ];

  // --- 1) Vytvoření dlaždic, canvasů a item objektů ---
  targetSections.forEach(section => {
    const filteredMeta = sensorsMeta.filter(s =>
      s.type === section.type &&
      s.visible !== false &&
      !this.config.hide_sensors.includes(s.id)
    );
    
    filteredMeta.forEach(s => {
      const sState = hass.states[s.entity_id];
      if (!sState) return;

      const tile = document.createElement('div');
      tile.classList.add('pm-graph-tile');
  
      const unit = sState.attributes.unit_of_measurement || '';
      const rawFriendlyName = sState.attributes.friendly_name || s.id;
      
      const stationTitle = entity.attributes.friendly_name || '';
      let cleanGraphName = rawFriendlyName;
      
      if (stationTitle && rawFriendlyName.indexOf(stationTitle) === 0) {
        cleanGraphName = rawFriendlyName.substring(stationTitle.length).trim();
      }

      if (cleanGraphName.length > 0) {
        cleanGraphName = cleanGraphName.charAt(0).toUpperCase() + cleanGraphName.slice(1);
      }

      const titleElement = document.createElement('div');
      titleElement.classList.add('pm-graph-title');
      titleElement.style.fontSize = '15px';
      titleElement.style.fontWeight = '500';
      titleElement.style.letterSpacing = '0.3px';
      titleElement.textContent = cleanGraphName + (unit ? ' (' + unit + ')' : '');

      const canvas = document.createElement('canvas');
      canvas.classList.add('pm-graph');

      const legend = document.createElement('div');
      legend.classList.add('pm-legend');

      tile.appendChild(titleElement);
      tile.appendChild(canvas);
      tile.appendChild(legend);

      section.container.appendChild(tile);

      canvases[s.id] = canvas;

      const stats = statsObj[s.id] || {};

      // --- item objekt pro tento graf ---
      items[s.id] = {
        entity_id: s.entity_id,
        type: s.type,
        title: cleanGraphName + (unit ? ' (' + unit + ')' : ''),
        color: s.graph_color || '#3b82f6',
        style: s.graph_style || 'smooth',
        timestamp: d.timestamp || Date.now(),
        min: stats.stats_min ?? null,
        max: stats.stats_max ?? null,
        avg: stats.stats_avg ?? null,
        mod: stats.stats_mode ?? null,
        var: stats.stats_var ?? null,
        theme: theme
      };
    });
  });

  // --- 2) Načtení historie z Recorderu pro všechny entity najednou ---
  const entityIds = Object.values(items).map(it => it.entity_id);

  if (entityIds.length > 0) {
    try {
      const rawHistory = await hass.callWS({
        type: 'history/history_during_period',
        start_time: since,
        end_time: new Date().toISOString(),
        entity_ids: entityIds,
        minimal_response: true,
      });

      entityIds.forEach((eid, idx) => {
        history[eid] = rawHistory[idx] || [];
      });
    } catch (e) {
      // Pokud historie selže, grafy se vykreslí jen s osami
    }
  }

  // --- 3) Vykreslení grafů pomocí item + points + statsIntervalHours ---
  Object.keys(items).forEach(id => {
    const item = items[id];
    const canvas = canvases[id];
    if (!canvas) return;

    const rawHist = history[item.entity_id] || [];
    const points = historyToPoints(rawHist); // bez sortování, jak chceš

    // Rozhodnutí, zda jde o windrose nebo line chart – logika zůstává stejná,
    // jen se mění signatura volání.
    const isWindDirection =
      item.type === 'primary' &&
      item.title.toLowerCase().includes('vítr směr');

    if (isWindDirection) {
      const cfg = {
        type: 'polarArea',
        data: { datasets: [{ data: buildWindRose(points) }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          }
        },
        plugins: [createWindRosePlugin(item, points, statsIntervalHours)]
      };
      new Chart(canvas.getContext('2d'), cfg);
    } else {
      const cfg = createLineChartConfig(item, points, statsIntervalHours);
      new Chart(canvas.getContext('2d'), cfg);
    }
  });
}

set hass(hass) {
  this._currentHass = hass;
  const entity = hass.states[this.config.entity];

  if (!this._initialized) {
    this._initialize();
    this._initialized = true;
  }

  if (!entity?.attributes?.sensors) {
    const card = this.shadowRoot.querySelector('.pm-card');
    if (card) {
      card.textContent = '';
      const h2 = document.createElement('h2');
      h2.textContent = 'PočasíMeteo';
      const p = document.createElement('p');
      p.style.opacity = '0.7';
      p.textContent = 'Backendová komponenta není dostupná (chybí data senzorů).';
      card.appendChild(h2);
      card.appendChild(p);
    }
    return;
  }

  this._updateVisualHeader(entity);

  // Reaktivní pojistka — překreslíme grafy jen při změně dat
  const nowTs = Date.now();
  const currentApiTimestamp = entity.attributes.timestamp || '';
  const currentQueue = entity.attributes.history_queue_length || 0;
  const currentStatsStr = JSON.stringify(entity.attributes.sensor_stats || {});
  const timeDifference = nowTs - this._lastFetch;

  if (this._lastApiTimestamp === currentApiTimestamp &&
      this._lastQueueLength === currentQueue &&
      this._lastStatsStr === currentStatsStr &&
      timeDifference < 10000) {
    return;
  }

  if (this._rendering) return;
  this._rendering = true;

  this._lastApiTimestamp = currentApiTimestamp;
  this._lastQueueLength = currentQueue;
  this._lastStatsStr = currentStatsStr;
  this._lastFetch = nowTs;

  setTimeout(() => {
    this._updateCharts(hass, entity).finally(() => {
      this._rendering = false;
    });
  }, 50);
}

}

customElements.define('pocasimeteo-card', PocasiMeteoCard);
