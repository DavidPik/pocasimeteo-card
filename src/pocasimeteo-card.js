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
 * Umožňuje kartě dynamicky přebírat barvy aktuálně nastaveného schématu.
 */
function safeCssVar(el, name, fallback) {
  try {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

/**
 * Detekuje, zda uživatel používá světlý nebo tmavý režim Lovelace rozhraní.
 */
function isLightTheme(el) {
  return safeCssVar(el, '--brightness', '0').trim() === '1';
}

/**
 * ARCHITEKTURA FRONTENDU: Vypočítá barvy textu a pozadí na základě HA témat.
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
 * Převod stupňů (0-360) na textovou zkratku směru větru.
 */
function degToDirection(deg) {
  if (deg == null || isNaN(deg)) return '';
  return WIND_DIR_LABELS[Math.round(deg / 22.5) % 16];
}

/**
 * Pomocná matematická funkce pro určení indexu (0-15) sektoru větrné růžice.
 */
function directionToIndex(deg) {
  return Math.round(deg / 22.5) % 16;
}

/**
 * ARCHITEKTURA FRONTENDU: Sestaví pole hodnot pro 16 sektorů větrné růžice.
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
 * ARCHITEKTURA FRONTENDU / NÁVAZNOST NA BACKEND: Transformuje syrová data z HA API historie
 * na pole souřadnic [x, y] pro Chart.js.
 */
function historyToPoints(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(p => {
    const rawTs = p.lu || p.last_changed || p.last_updated;
    const rawState = p.s !== undefined ? p.s : p.state;

    if (!rawTs || rawState === undefined) return null;

    const ts = typeof rawTs === 'number' ? rawTs * 1000 : Date.parse(rawTs);
    const val = Number(rawState);

    if (isNaN(ts) || isNaN(val)) return null;

    return { x: ts, y: val };
  }).filter(p => p && !isNaN(p.x) && !isNaN(p.y));
}

/**
 * Převod HEX barvy na RGBA formát s nastavitelnou průhledností pro výplně grafů.
 */
function hexToRgba(hex, alpha) {
  if (!hex || hex.length < 7) hex = '#3b82f6';
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * ARCHITEKTURA FRONTENDU / NÁVAZNOST NA BACKEND: Vytvoří konfiguraci pro čárový graf Chart.js.
 */
function createLineChartConfig(points, prettyName, theme, sensorAttrs, statsIntervalHours) {
  const color = sensorAttrs.graph_color || '#3b82f6';
  const isStepped = sensorAttrs.graph_style === 'stepped';
  const textColor = theme.textColor;

  const lastUpdateTs = sensorAttrs.timestamp ? Date.parse(sensorAttrs.timestamp) : Date.now();
  const endX = Date.now();
  const intervalMs = (statsIntervalHours || 24) * 3600 * 1000;
  const startX = endX - intervalMs;

  const min = typeof sensorAttrs.stats_min === 'number' ? sensorAttrs.stats_min : 0;
  const max = typeof sensorAttrs.stats_max === 'number' ? sensorAttrs.stats_max : (min + 1);

  // Vytvoříme bezpečné hranice osy Y přímo z hodnot z backendu s mírným přesahem (např. 5 %),
  // aby křivka nikdy neškrtala o horní nebo spodní okraj grafu
  const padding = (max - min) * 0.05 || 1;
  let finalMin = min - padding;
  const finalMax = max + padding;

  // Bezpečné ošetření: Žádný graf s výjimkou teploty nesmí na ose Y začínat v záporných hodnotách
  if (!prettyName.toLowerCase().includes('teplot') && !prettyName.toLowerCase().includes('temperature') && finalMin < 0) {
    finalMin = 0;
  }

  // Hledání bodů min/max v poli upravíme tak, aby našlo bod, který je hodnotě z backendu NEJBLÍŽE,
  // místo rigidního porovnávání na setiny, které kvůli zaokrouhlování v DB selhává:
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
          label: prettyName,
          data: points,
          borderColor: color,
          backgroundColor: rgba,
          tension: isStepped ? 0 : 0.3,
          stepped: isStepped,
          pointRadius: 0,
          borderWidth: 2
        },
        {
          label: `Min: ${min.toFixed(1)}`,
          data: minPoint ? [{ x: minPoint.x, y: minPoint.y }] : [],
          pointRadius: 6,
          pointBackgroundColor: 'red',
          showLine: false
        },
        {
          label: `Max: ${max.toFixed(1)}`,
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
            // Přepne formát času v nadpisu tooltipu na srozumitelný český formát HH:MM:SS
            title: function(context) {
              if (context && context.length > 0 && context[0].parsed) {
                const parsedDate = new Date(context[0].parsed.x);
                return 'Čas: ' + parsedDate.toLocaleTimeString('cs-CZ');
              }
              return '';
            },
            // Zpřehlední výpis hodnoty pod časem
            label: function(context) {
              const labelText = context.dataset.label || '';
              const pointValue = context.parsed.y;
              
              if (labelText) {
                // Pokud jde o tečku Minima/Maxima, vrátíme popisek tak, jak je
                if (labelText.includes('Min') || labelText.includes('Max')) {
                  return labelText;
                }
                // Pro standardní průběhovou čáru vypíšeme: "Aktuální hodnota: X"
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

/**
 * ARCHITEKTURA FRONTENDU: Vypočítá střed a poloměr pro kruhový graf větrné růžice.
 */
function computeChartGeometry(chartArea) {
  const cx = chartArea.left + chartArea.width / 2;
  const cy = chartArea.top + chartArea.height / 2;
  const R = Math.min(chartArea.width, chartArea.height) / 2;
  return { cx, cy, R };
}

/**
 * ARCHITEKTURA FRONTENDU: Vlastní Canvas plugin pro detailní vykreslení větrné růžice.
 */

function createWindRosePlugin(theme, points, sensorAttrs) {
  const avg = typeof sensorAttrs.vitr_smer_avg === 'number' ? sensorAttrs.vitr_smer_avg : 0;
  const mode = typeof sensorAttrs.vitr_smer_mode === 'number' ? sensorAttrs.vitr_smer_mode : 0;
  const vari = typeof sensorAttrs.vitr_smer_var === 'number' ? sensorAttrs.vitr_smer_var : 0;
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

      // --- Kružnice mřížky ---
      [0.2, 0.4, 0.6, 0.8, 1.0].forEach(f => {
        ctx.beginPath();
        ctx.arc(cx, cy, activeRadius * f, 0, Math.PI * 2);
        ctx.stroke();
      });

      // --- Hlavní osy ---
      const degAxes = [0, 45, 90, 135, 180, 225, 270, 315];
      degAxes.forEach(deg => {
        const a = (deg - 90) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * activeRadius, cy + Math.sin(a) * activeRadius);
        ctx.stroke();
      });

      // --- Sektory větrné růžice ---
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

      // --- Popisky světových stran ---
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

      // --- Výpočet úhlů pro průměr / mod / varianci ---
      const avgLineLen = activeRadius;
      const modeLineLen = activeRadius - 15;
      const offsetVar = activeRadius - 5;

      const avgAngle = (avg - 90) * Math.PI / 180;
      const modeAngle = (mode - 90) * Math.PI / 180;
      const startVar = (avg - vari - 90) * Math.PI / 180;
      const endVar = (avg + vari - 90) * Math.PI / 180;

      // --- Variance (Rozptyl) ---
      ctx.fillStyle = 'rgba(255,165,0,0.22)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, offsetVar, startVar, endVar);
      ctx.closePath();
      ctx.fill();

      // --- AVG (Průměrný směr) ---
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(avgAngle) * avgLineLen, cy + Math.sin(avgAngle) * avgLineLen);
      ctx.stroke();

      // --- MODE (Převládající směr) ---
      ctx.strokeStyle = '#0000ff';
      ctx.lineWidth = 4.0;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(modeAngle) * modeLineLen, cy + Math.sin(modeAngle) * modeLineLen);
      ctx.stroke();

      // --- Interaktivní Sjednocený Tooltip ---
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

        // Sjednocené vnitřní odsazení a rozměry boxu (padding: 10px)
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

        // Vizuální styl: Tmavé zaoblené moderní okno z LineChart grafů
        ctx.shadowColor = 'rgba(0,0,0,0.15)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = 'rgba(28, 28, 28, 0.95)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;

        // Kreslení zaobleného obdélníku s poloměrem 6px (shodně s cornerRadius)
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(tx, ty, boxWidth, boxHeight, 6);
        } else {
          ctx.rect(tx, ty, boxWidth, boxHeight);
        }
        ctx.fill();
        ctx.stroke();

        // Vykreslení čistě bílého textu
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

    const currentApiTimestamp = entity.attributes.timestamp;
    const nowTs = Date.now();
    const timeDifference = nowTs - this._lastFetch;

    if (this._lastApiTimestamp === currentApiTimestamp && timeDifference < 300000) {
      return;
    }

    if (this._rendering) return;
    this._rendering = true;

    this._lastApiTimestamp = currentApiTimestamp;
    this._lastFetch = nowTs;

    setTimeout(() => {
      this._updateCharts(hass, entity).finally(() => {
        this._rendering = false;
      });
    }, 50);
  }
  
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
    const lokalita = d.lokalita_stanice || d.friendly_name || 'Meteostanice';

    headerTitle.textContent = `${lokalita} — ${stateText}`;
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
    const history = {};

    const targetSections = [
      { type: 'primary', container: primaryGraphs },
      { type: 'secondary', container: secondaryGraphs }
    ];

    for (const section of targetSections) {
      const filteredMeta = sensorsMeta.filter(s =>
        s.type === section.type &&
        s.visible !== false &&
        !this.config.hide_sensors.includes(s.id)
      );
      
      filteredMeta.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      
      for (const s of filteredMeta) {
        const sState = hass.states[s.entity_id];
        if (!sState) continue;

        const tile = document.createElement('div');
        tile.classList.add('pm-graph-tile');
  
        const unit = sState.attributes.unit_of_measurement || '';
        const rawFriendlyName = sState.attributes.friendly_name || s.id;
        
        // Odřízneme název stanice (friendly_name z configu) z popisku grafu,
        // aby nadpis nebyl zbytečně dlouhý a duplicitní (např. "GAR632 Teplota venkovní" -> "Teplota venkovní")
        const stationTitle = (entity.attributes.friendly_name || '').theme || '';
        let cleanGraphName = rawFriendlyName;
        if (stationTitle && rawFriendlyName.includes(stationTitle)) {
          cleanGraphName = rawFriendlyName.replace(stationTitle, '').trim();
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

        const chartWrapper = document.createElement('div');
        chartWrapper.style.position = 'relative';
        chartWrapper.style.width = '100%';
        
        if (s.id === 'vitr_smer') {
          // Větrné růžici nastavíme čtvercový rozměr a vycentrujeme ji v dlaždici
          chartWrapper.style.height = '260px';
          chartWrapper.style.display = 'flex';
          chartWrapper.style.justifyContent = 'center';
          chartWrapper.style.alignItems = 'center';
        } else {
          chartWrapper.style.height = '180px';
        }

        chartWrapper.appendChild(canvas);

        tile.appendChild(titleElement);
        tile.appendChild(chartWrapper); // Vložíme obal místo samotného canvasu
        tile.appendChild(legend);

        section.container.appendChild(tile);

        canvases[s.entity_id] = { canvas, tile, prettyName: cleanGraphName, legend, id: s.id };
      }
    }

    // 2. KROK: ULTRA RYCHLÝ HROMADNÝ WEBSOCKET DOTAZ (Snižuje čekání z 10s na < 0.5s)
    const activeEntityIds = Object.keys(canvases);

    if (activeEntityIds.length > 0) {
      try {
        // Pošleme jedno hromadné pole entit přes WebSocket, HA jádro je zpracuje naráz
        const resp = await hass.callWS({
          type: "history/history_during_period",
          start_time: since,
          end_time: new Date().toISOString(),
          entity_ids: activeEntityIds,
          minimal_response: false,
          significant_changes_only: false,
          no_attributes: true
        });

        // Odpověď z WS obsahuje objekt, kde klíče jsou entity_id a hodnotami pole stavů.
        // Projdeme seznam našich aktivních čidel a bezpečně jim přiřadíme stažená data.
        for (let i = 0; i < activeEntityIds.length; i++) {
          const entityId = activeEntityIds[i];
          if (resp && resp[entityId]) {
            history[entityId] = resp[entityId];
          } else {
            history[entityId] = [];
          }
        }
      } catch (e) {
        console.error("Hromadný WebSocket history dotaz selhal:", e);
        // Fallback: V případě neočekávané chyby inicializujeme prázdná pole, aby karta nespadla
        for (let i = 0; i < activeEntityIds.length; i++) {
          history[activeEntityIds[i]] = [];
        }
      }
    }

    const theme = computeTheme(this.shadowRoot.host);

    for (const entityId of activeEntityIds) {
      const item = canvases[entityId];
      if (!item) continue;

      const sState = hass.states[entityId];
      if (!sState) continue;

      const sensorAttrs = sState.attributes || {};
      const points = historyToPoints(history[entityId]);

      if (points.length === 0) {
        const val = Number(sState.state);
        if (isNaN(val)) continue;
        const now = Date.now();
        points.push({ x: now - 60000, y: val }, { x: now, y: val });
      } else if (points.length === 1) {
        points.push({ x: Date.now(), y: points[0].y });
      }
      
      if (points.length > 1) {
        const { canvas, tile, prettyName, legend, id } = item;

        if (this._charts[entityId]) {
          this._charts[entityId].destroy();
        }
        
        tile.style.backgroundColor = theme.bgColor;
        
        // ÚPLNÝ RESET PLÁTNA: Najdeme obal, smažeme starý canvas a vložíme zcela nový,
        // čímž stoprocentně eliminujeme jakékoliv zdvojení měřítka (DPR 2x) z paměti prohlížeče.
        const currentWrapper = canvas.parentNode;
        currentWrapper.innerHTML = '';
        
        const newCanvas = document.createElement('canvas');
        newCanvas.classList.add('pm-graph');
        newCanvas.style.backgroundColor = theme.bgColor;
        currentWrapper.appendChild(newCanvas);
        
        // Aktualizujeme referenci pro novou instanci Chart.js
        const activeCanvas = newCanvas;

        if (id === 'vitr_smer') {
          this._charts[entityId] = new Chart(activeCanvas.getContext('2d'), {
            type: 'polarArea',
            data: {
              labels: WIND_DIR_LABELS,
              datasets: [{
                data: points.length > 0 ? buildWindRose(points) : new Array(16).fill(0),
                backgroundColor: 'transparent',
                borderColor: 'transparent',
                borderWidth: 1
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false, // Změňte na false, aby vyplnil wrapper
              layout: {
                padding: {
                  top: 10,
                  bottom: 10,
                  left: 10,
                  right: 10
                }
              },
              plugins: { 
                legend: { display: false }, 
                tooltip: { enabled: false } 
              },
              scales: {
                r: {
                  display: false
                }
              }
            },
            plugins: [ createWindRosePlugin(theme, points, sensorAttrs) ]
          });

          legend.textContent = '';

          const avgVal = typeof sensorAttrs.vitr_smer_avg === 'number' ? sensorAttrs.vitr_smer_avg : 0;
          const modeVal = typeof sensorAttrs.vitr_smer_mode === 'number' ? sensorAttrs.vitr_smer_mode : 0;
          const varVal = typeof sensorAttrs.vitr_smer_var === 'number' ? sensorAttrs.vitr_smer_var : 0;

          const labelsData = [
            { color: '#ff0000', text: `Průměr: ${avgVal.toFixed(0)}° (${degToDirection(avgVal)})` },
            { color: '#0000ff', text: `Mod: ${modeVal.toFixed(0)}° (${degToDirection(modeVal)})` },
            { color: '#ffa500', text: `Rozptyl: ±${varVal.toFixed(0)}°` }
          ];

          labelsData.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.classList.add('pm-legend-item');
            const colorSpan = document.createElement('span');
            colorSpan.classList.add('pm-legend-color');
            colorSpan.style.background = item.color;
            const textSpan = document.createElement('span');
            textSpan.textContent = item.text;
            itemDiv.appendChild(colorSpan);
            itemDiv.appendChild(textSpan);
            legend.appendChild(itemDiv);
          });
        } else {
          const minVal = typeof sensorAttrs.stats_min === 'number' ? sensorAttrs.stats_min : 0;
          const maxVal = typeof sensorAttrs.stats_max === 'number' ? sensorAttrs.stats_max : 0;
          
          this._charts[entityId] = new Chart(
            activeCanvas.getContext('2d'),
            createLineChartConfig(points, prettyName, theme, sensorAttrs, statsIntervalHours)
          );
          
          legend.textContent = '';
          const lineLabels = [
            { color: 'red', text: `Min: ${minVal.toFixed(1)}` },
            { color: 'green', text: `Max: ${maxVal.toFixed(1)}` }
          ];

          lineLabels.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.classList.add('pm-legend-item');
            const colorSpan = document.createElement('span');
            colorSpan.classList.add('pm-legend-color');
            colorSpan.style.background = item.color;
            const textSpan = document.createElement('span');
            textSpan.textContent = item.text;
            itemDiv.appendChild(colorSpan);
            itemDiv.appendChild(textSpan);
            legend.appendChild(itemDiv);
          });
        }
      }
    }
  }
}

customElements.define('pocasimeteo-card', PocasiMeteoCard);
