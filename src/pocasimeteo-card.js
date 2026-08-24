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
 * Zajišťuje, že se pozadí grafů přizpůsobí kartám (např. v tmavém režimu tmavé pozadí).
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
 * Prochází časovou řadu bodů z historie a rozřazuje je do příslušných indexů (0-15).
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
 * (objekty se stavy last_changed/last_updated a state) na pole souřadnic [x, y] pro Chart.js.
 * Používá přímo surové body z Recorderu (bez bucketů).
 */
function historyToPoints(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(p => {
    // 1. WebSocket používá 'lu', staré REST 'last_changed'/'last_updated'
    const rawTs = p.lu || p.last_changed || p.last_updated;
    
    // 2. WebSocket používá 's', staré REST 'state'
    const rawState = p.s !== undefined ? p.s : p.state;

    if (!rawTs || rawState === undefined) return null;

    // 3. Pokud je timestamp číslo (sekundy), vynásobíme ho 1000 na milisekundy. 
    // Pokud je to ISO řetězec, Date.parse ho zpracuje standardně.
    const ts = typeof rawTs === 'number' ? rawTs * 1000 : Date.parse(rawTs);
    const val = Number(rawState);

    if (isNaN(ts) || isNaN(val)) return null;

    return {
      x: ts,
      y: val
    };
  }).filter(p => p && !isNaN(p.x) && !isNaN(p.y));
}

/**
 * Převod HEX barvy na RGBA formát s nastavitelnou průhledností pro výplně grafů.
 */
function hexToRgba(hex, alpha) {
  if (!hex || hex.length < 7) hex = '#3b82f6';
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

/**
 * ARCHITEKTURA FRONTENDU / NÁVAZNOST NA BACKEND: Vytvoří konfiguraci pro čárový graf Chart.js.
 * Min/max bere z atributů senzoru (spočíta backend), osa X se řídí intervalem ze weather entity.
 */
function createLineChartConfig(points, cleanName, color, textColor, sensorId, sensorStyle, lastUpdateTs, statsIntervalHours, sensorAttrs) {
  const rgba = hexToRgba(color, 0.25);

  const nameLower = cleanName.toLowerCase();
  const isDynamic = nameLower.includes('teplota') || nameLower.includes('tlak');
  const yMinAxis = isDynamic ? undefined : 0;
  const isStepped = sensorStyle === 'stepped';

  // Fixace osy X: konec je čas z API (nouzově aktuální čas v prohlížeči)
  const endX = lastUpdateTs && !isNaN(lastUpdateTs) ? lastUpdateTs : Date.now();
  const intervalMs = (statsIntervalHours && statsIntervalHours > 0 ? statsIntervalHours : 24) * 3600 * 1000;
  const startX = endX - intervalMs;

  // Min/max z atributů senzoru (backend – stats_min/stats_max)
  let min = 0;
  let max = 0;
  let minPoint = null;
  let maxPoint = null;

  if (sensorAttrs && typeof sensorAttrs.stats_min === 'number' && typeof sensorAttrs.stats_max === 'number') {
    min = sensorAttrs.stats_min;
    max = sensorAttrs.stats_max;

    if (points && points.length > 0) {
      minPoint = points.reduce((acc, p) => (p.y === min ? p : acc), null);
      maxPoint = points.reduce((acc, p) => (p.y === max ? p : acc), null);
    }
  }

  return {
    type: 'line',
    data: {
      datasets: [
        {
          label: cleanName,
          data: points,
          borderColor: color,
          backgroundColor: rgba,
          tension: isStepped ? 0 : 0.3,
          stepped: isStepped ? true : false,
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
      responsive: false,
      maintainAspectRatio: false,
      layout: { padding: { left: 6, right: 8, top: 6, bottom: 6 } },
      plugins: { tooltip: {}, legend: { display: false } },
      scales: {
        x: { 
          type: 'time', 
          time: { unit: 'hour' }, 
          min: startX,
          max: endX,
          ticks: { color: textColor }, 
          grid: { color: GRID_COLOR } 
        },
        y: {
          min: typeof sensorAttrs.stats_min === 'number' ? sensorAttrs.stats_min : yMinAxis,
          max: typeof sensorAttrs.stats_max === 'number' ? sensorAttrs.stats_max : undefined,
          ticks: { color: textColor },
          grid: { color: GRID_COLOR }
        }
      }
    }
  };
}

/**
 * ARCHITEKTURA FRONTENDU: Vlastní Canvas plugin pro detailní vykreslení větrné růžice.
 * Data pro avg/mode/var bere z atributů senzoru směru větru (backend).
 */
function createWindRosePlugin(theme, bins, avg, mode, vari) {
  return {
    id: 'windRoseManual',
    beforeInit(chart) {
      const canvas = chart.canvas;
      canvas.addEventListener('mousemove', (ev) => {
        const rect = canvas.getBoundingClientRect();
        chart.$mouse = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
        const { cx, cy, R } = computeChartGeometry(chart.chartArea);
        const dx = chart.$mouse.x - cx;
        const dy = chart.$mouse.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > R) {
          chart.$windHover = null;
          chart.draw();
          return;
        }

        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
        angle += 90;
        if (angle < 0) angle += 360;
        const sectorIndex = Math.floor(angle / 22.5) % 16;
        chart.$windHover = { index: sectorIndex, value: bins[sectorIndex], angle };
        chart.draw();
      });

      canvas.addEventListener('mouseleave', () => {
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
      
      // Vykreslení pomocných kružnic (mřížky)
      [0.15, 0.30, 0.45, 0.60, 0.75, 0.90].forEach(f => {
        ctx.beginPath();
        ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
        ctx.stroke();
      });

      // Vykreslení hlavních os (směrů) mřížky
      [0, 45, 90, 135, 180, 225, 270, 315].forEach(deg => {
        const a = (deg - 90) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.stroke();
      });

      // Vykreslení samotných datových sektorů (četnosti směrů větru)
      const sectorColor = '#009688';
      for (let i = 0; i < 16; i++) {
        const binValue = bins[i];
        const radius = (binValue / maxBin) * (R * 0.90);
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

      // Vykreslení popisků světových stran kolem růžice
      ctx.fillStyle = theme.textColor;
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const offsetText = R + 10;
      WIND_DIR_LABELS.forEach((label, i) => {
        const angle = ((i * 22.5) - 90) * Math.PI / 180;
        const x = cx + Math.cos(angle) * offsetText;
        const y = cy + Math.sin(angle) * offsetText;
        ctx.fillText(label, x, y);
      });

      const avgLineLen = R - 5;    
      const modeLineLen = R - 25;  
      const offsetVar = R - 10;    

      const avgAngle = (avg - 90) * Math.PI / 180;
      const modeAngle = (mode - 90) * Math.PI / 180;
      const startVar = (avg - vari - 90) * Math.PI / 180;
      const endVar = (avg + vari - 90) * Math.PI / 180;

      // ARCHITEKTURA FRONTENDU / NÁVAZNOST NA BACKEND: Vykreslení rozptylu (variance) větru.
      ctx.fillStyle = 'rgba(255,165,0,0.22)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, offsetVar, startVar, endVar);
      ctx.closePath();
      ctx.fill();

      // Vykreslení průměrného směru větru (červená čára)
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]); 
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(avgAngle) * avgLineLen, cy + Math.sin(avgAngle) * avgLineLen);
      ctx.stroke();

      // Vykreslení modu - převládajícího směru (modrá čára)
      ctx.strokeStyle = '#0000ff';
      ctx.lineWidth = 5.0;
      ctx.setLineDash([]); 
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(modeAngle) * modeLineLen, cy + Math.sin(modeAngle) * modeLineLen);
      ctx.stroke();

      // Ruční vykreslení tooltipu
      if (chart.$windHover && chart.$mouse) {
        const { index, value } = chart.$windHover;
        const { x: mx, y: my } = chart.$mouse;
        const label = WIND_DIR_LABELS[index];
        const percent = ((value / maxBin) * 100).toFixed(1);
        const tooltipText = label + ': ' + value + '× (' + percent + '%)';

        ctx.save();
        ctx.font = '12px sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const paddingX = 8;
        const textWidth = ctx.measureText(tooltipText).width;
        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = 20;
        let tx = mx + 10;
        let ty = my - boxHeight - 10;

        if (tx + boxWidth > chart.width) tx = chart.width - boxWidth - 4;
        if (chart.chartArea && chart.chartArea.top > ty) {
          ty = my + 10;
        }

        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = theme.bgColor + 'f0';
        ctx.strokeStyle = theme.textColor + '80';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(tx, ty, boxWidth, boxHeight, 4);
        } else {
          ctx.rect(tx, ty, boxWidth, boxHeight);
        }
        ctx.fill();
        ctx.stroke();

        ctx.shadowColor = 'transparent';
        ctx.fillStyle = theme.textColor;
        ctx.fillText(tooltipText, tx + paddingX, ty + boxHeight / 2);
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
    this._lastApiTimestamp = null; // ARCHITEKTURA FRONTENDU: Sleduje změnu dat z API
    this._lastFetch = 0;
    this._resizeObserver = null;
    this._currentHass = null;
    this._initialResizeDone = false;
  }

  /**
   * Inicializace konfigurace karty zadávané uživatelem v Lovelace dashboardu.
   */
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
    // Sledování změn velikosti kontejneru pro automatický responzivní přepočet rozměrů grafů
    this._resizeObserver = new ResizeObserver(() => {
      if (!this._initialResizeDone) {
        this._initialResizeDone = true;
        if (this._currentHass) {
          const entity = this._currentHass.states[this.config.entity];
          if (entity && entity.attributes && entity.attributes.sensors) {
            this._updateCharts(this._currentHass, entity);
          }
        }
        return;
      }
      // další resize eventy
      if (this._currentHass && this._initialized && !this._rendering) {
        const entity = this._currentHass.states[this.config.entity];
        if (entity && entity.attributes && entity.attributes.sensors) {
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
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
  }

  /**
   * Spouští se pokaždé, když Home Assistant změní stav jakékoliv entity v systému.
   */
  set hass(hass) {
    this._currentHass = hass;
    const entity = hass.states[this.config.entity];

    // Prvotní sestavení HTML struktury (Shadow DOM)
    if (!this._initialized) {
      this._initialize();
      this._initialized = true;
    }

    // Pokud backendová entita weather není dostupná, zobrazíme varování
    if (!entity || !entity.attributes || !entity.attributes.sensors) {
      const card = this.shadowRoot.querySelector('.pm-card');
      if (card) {
        card.innerHTML = '<h2>PočasíMeteo</h2><p style="opacity:0.7;">Backendová komponenta není dostupná (chybí data senzorů).</p>';
      }
      return;
    }

    // ARCHITEKTURA FRONTENDU / OPTIMALIZACE: Okamžitě aktualizujeme textové prvky v záhlaví,
    // aby karta reagovala ihned, ale náročné grafy/historii překreslíme jen při změně timestampu z API.
    this._updateVisualHeader(entity);

    const currentApiTimestamp = entity.attributes.timestamp;
    const nowTs = Date.now();
    const timeDifference = nowTs - this._lastFetch;

    // Pokud se nezměnil timestamp z API a zároveň od posledního načtení neuplynulo 5 minut (300 000 ms), přeskočíme to.
    if (this._lastApiTimestamp === currentApiTimestamp) {
      if (300000 > timeDifference) {
        return;
      }
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
  
  /**
   * Vykreslí základní HTML kostru a aplikuje CSS styly.
   * Struktura generované HTML stránky zůstala přesně zachována dle vašeho návrhu.
   */
  _initialize() {
    this.shadowRoot.innerHTML = `
      <style>
        .pm-card { padding:0; color:var(--primary-text-color,#fff); display:flex; flex-direction:column; gap:0; }
        .pm-header-section { padding:16px; background:rgba(255,255,255,0.05); border-bottom:1px solid rgba(255,255,255,0.1); display:flex; flex-direction:column; gap:12px; }
        .pm-header-top { display:flex; justify-content:space-between; align-items:flex-start; font-size:20px; font-weight:600; }
        .pm-header-title { display:flex; flex-direction:column; gap:4px; }
        .pm-header-timestamp { opacity:0.7; font-size:13px; text-align:right; flex-grow:1; padding-right:12px; }
        .pm-header-bottom { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
        .pm-header-main { font-size:48px; font-weight:300; }
        .pm-header-details { display:flex; flex-direction:column; gap:6px; font-size:15px; opacity:0.85; text-align:right; padding-right:12px; min-width:260px; white-space:nowrap; }
        .pm-primary-section { background:rgba(255,255,255,0.03); padding:16px; border-bottom:1px solid rgba(255,255,255,0.1); }
        .pm-secondary-section { background:rgba(255,255,255,0.05); padding:16px; }
        .pm-graphs { display:flex; flex-wrap:wrap; gap:16px; margin-top:8px; align-items:flex-start; }
        .pm-graph-tile { box-sizing:border-box; flex: 0 0 auto; background:var(--ha-card-background,#1c1c1c); border-radius:12px; padding:4px; box-shadow:var(--ha-card-box-shadow,0 2px 4px rgba(0,0,0,0.2)); display:flex; flex-direction:column; }
        .pm-graph-title { font-size:1em; font-weight:600; margin-bottom:4px; padding: 4px; }
        .pm-graph { width:100%; height:220px; }
        .pm-legend { margin-top:0px; display:flex; flex-wrap:wrap; justify-content:center; gap:8px; font-size:14px; opacity:0.8; padding: 4px; }
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

  /**
   * ARCHITEKTURA FRONTENDU: Bezpečně aktualizuje texty v záhlaví karty.
   */
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

    const rawState = entity.state;
    const stateText = conditionTranslations[rawState] || rawState; 
    const lokalita = d.lokalita_stanice || d.friendly_name || 'Meteostanice';

    headerTitle.textContent = lokalita + ' — ' + stateText;
    headerTimestamp.textContent = d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : '';
    
    const temp = entity.attributes.temperature !== undefined ? entity.attributes.temperature : '--';
    headerMain.textContent = temp + ' °C';

    const pressure = entity.attributes.pressure !== undefined ? entity.attributes.pressure : '--';
    const humidity = entity.attributes.humidity !== undefined ? entity.attributes.humidity : '--';
    
    const windSpeedRaw = entity.attributes.wind_speed;
    let windSpeed = '--';
    if (windSpeedRaw !== undefined && windSpeedRaw !== null) {
      windSpeed = (parseFloat(windSpeedRaw) / 3.6).toFixed(1);
    }
    
    const gustRaw = entity.attributes.wind_gust;
    let windGust = '--';
    if (gustRaw !== undefined && gustRaw !== null) {
      windGust = (parseFloat(gustRaw) / 3.6).toFixed(1);
    }
    
    const bearingRaw = entity.attributes.wind_bearing;
    let windDirectionText = '';
    if (bearingRaw !== undefined && bearingRaw !== null) {
      windDirectionText = ' ' + degToDirection(bearingRaw);
    }
    
    const kompletniVitrText = windSpeed + ' / ' + windGust + ' m/s' + windDirectionText;
    const srazkyDen = d.srazky_den !== undefined ? d.srazky_den : 0;

    headerDetails.innerHTML = 
      '<div>Tlak vzduchu: ' + pressure + ' hPa</div>' +
      '<div>Vlhkost: ' + humidity + ' %</div>' +
      '<div>Síla větru: ' + kompletniVitrText + '</div>' +
      '<div>Srážky dnes: ' + srazkyDen + ' mm</div>';
  }

  /**
   * ARCHITEKTURA FRONTENDU: Načte historii pro aktivní čidla a vykreslí grafy.
   * Historii bere jako syrové body z Recorderu, statistiky z atributů senzorů.
   */
  async _updateCharts(hass, entity) {
    const d = entity.attributes;
    const sensorsMeta = Array.isArray(d.sensors) ? d.sensors : [];

    const primaryGraphs = this.shadowRoot.getElementById('primary-graphs');
    const secondaryGraphs = this.shadowRoot.getElementById('secondary-graphs');

    primaryGraphs.innerHTML = '';
    secondaryGraphs.innerHTML = '';

    if (this.config.show_graphs === false || sensorsMeta.length === 0) return;

    const statsIntervalHours = typeof d.statistics_interval === 'number' ? d.statistics_interval : 24;
    const since = new Date(Date.now() - statsIntervalHours * 3600 * 1000).toISOString();
    const canvases = {};
    const history = {};

    const targetSections = [
      { type: 'primary', container: primaryGraphs },
      { type: 'secondary', container: secondaryGraphs }
    ];

    const containerWidth = this.getBoundingClientRect().width;
    const graphsPerRow = Number(this.config.graphs_per_row) || 2;
    const gap = 16;
    const tileWidthPx = Math.floor((containerWidth - (graphsPerRow - 1) * gap) / graphsPerRow);

    // 1. KROK: HTML skelet + canvas (beze změny)
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
        tile.style.width = `${tileWidthPx}px`;

        const unit = sState.attributes.unit_of_measurement || '';
        const prettyName = sState.attributes.friendly_name || s.id;

        const titleElement = document.createElement('div');
        titleElement.classList.add('pm-graph-title');
        titleElement.textContent = prettyName + (unit ? ' - ' + unit : '');

        const canvas = document.createElement('canvas');
        canvas.classList.add('pm-graph');

        const legend = document.createElement('div');
        legend.classList.add('pm-legend');

        tile.appendChild(titleElement);
        tile.appendChild(canvas);
        tile.appendChild(legend);

        section.container.appendChild(tile);

        let cssWidthPx = tileWidthPx - 8;
        let cssHeightPx = s.id === 'vitr_smer' ? tileWidthPx : Math.round(0.5 * tileWidthPx);

        canvas.style.display = 'block';
        canvas.style.width = Math.round(cssWidthPx) + 'px';
        canvas.style.height = Math.round(cssHeightPx) + 'px';

        const ctx = canvas.getContext('2d');
        if (typeof ctx.resetTransform === 'function') ctx.resetTransform(); else ctx.setTransform(1,0,0,1,0,0);

        const _dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(cssWidthPx * _dpr);
        canvas.height = Math.round(cssHeightPx * _dpr);
        ctx.scale(_dpr, _dpr);

        canvases[s.entity_id] = { canvas, tile, prettyName, legend, id: s.id };
      }
    }

    // 2. KROK: syrová historie z Recorderu přes WebSocket API
    const activeEntityIds = Object.keys(canvases);

    await Promise.all(activeEntityIds.map(async entityId => {
      try {
        // Použití nativního WebSocket příkazu 'history/stream' nebo 'history/history_during_period'
        const resp = await hass.callWS({
          type: "history/history_during_period",
          start_time: since,
          end_time: new Date().toISOString(),
          entity_ids: [entityId],
          minimal_response: false,
          significant_changes_only: false,
          no_attributes: true
        });

        // WebSocket vrací objekt, kde klíčem je entity_id a hodnotou pole stavů
        history[entityId] = resp && resp[entityId] ? resp[entityId] : [];

      } catch (e) {
        console.error("WebSocket history error for", entityId, e);
        history[entityId] = [];
      }
    }));

    const host = this.shadowRoot.host;
    const theme = computeTheme(host);

    // 3. KROK: vykreslení grafů
    for (const entityId of activeEntityIds) {
      const item = canvases[entityId];
      if (!item) continue;

      const sState = hass.states[entityId];
      if (!sState) continue;

      const sensorAttrs = sState.attributes || {};
      const sensorStyle = sensorAttrs.graph_style || 'smooth';
      const sensorColor = sensorAttrs.graph_color || '#3b82f6';
      const apiLastTs = sensorAttrs.timestamp ? Date.parse(sensorAttrs.timestamp) : Date.now();

      // fallback: bez historie – dva body
      if (!history[entityId] || !history[entityId].length) {
        const val = Number(sState.state);
        if (isNaN(val)) continue;

        const now = Date.now();
        const points = [
          { x: now - 60000, y: val },
          { x: now, y: val }
        ];

        if (this._charts[entityId]) this._charts[entityId].destroy();
        this._charts[entityId] = new Chart(
          item.canvas.getContext('2d'),
          createLineChartConfig(points, item.prettyName, sensorColor, theme.textColor, item.id, sensorStyle, apiLastTs, statsIntervalHours, sensorAttrs)
        );
        continue;
      }
      
      const points = historyToPoints(history[entityId]);
      if (points.length === 1) {
        points.push({ x: Date.now(), y: points[0].y });
      }
      
      if (points.length > 1) {
        const { canvas, tile, prettyName, legend, id } = item;

        if (this._charts[entityId]) this._charts[entityId].destroy();
        canvas.style.backgroundColor = theme.bgColor;
        tile.style.backgroundColor = theme.bgColor;

        if (id === 'vitr_smer') {
          const bins = points.length > 0 ? buildWindRose(points) : new Array(16).fill(0);
          const avg = typeof sensorAttrs.vitr_smer_avg === 'number' ? sensorAttrs.vitr_smer_avg : 0;
          const mode = typeof sensorAttrs.vitr_smer_mode === 'number' ? sensorAttrs.vitr_smer_mode : 0;
          const vari = typeof sensorAttrs.vitr_smer_var === 'number' ? sensorAttrs.vitr_smer_var : 0;

          if (this._charts[entityId]) this._charts[entityId].destroy();
          canvas.style.backgroundColor = theme.bgColor;
          tile.style.backgroundColor = theme.bgColor;
          
          this._charts[entityId] = new Chart(canvas.getContext('2d'), {
            type: 'polarArea',
            data: {
              labels: WIND_DIR_LABELS,
              datasets: [{
                data: bins,
                backgroundColor: hexToRgba('#009688', 0.85),
                borderColor: '#004d40',
                borderWidth: 1
              }]
            },
            options: {
              responsive: false,
              maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { enabled: false } },
              scales: {
                r: {
                  ticks: { display: false },
                  grid: { color: GRID_COLOR }
                }
              }
            },
            plugins: [createWindRosePlugin(theme, bins, avg, mode, vari)]
          });

          legend.innerHTML = `
            <div class="pm-legend-item">
              <span class="pm-legend-color" style="background:#ff0000;"></span>
              <span>Průměrný směr větru</span>
            </div>
            <div class="pm-legend-item">
              <span class="pm-legend-color" style="background:#0000ff;"></span>
              <span>Převládající směr (mod)</span>
            </div>
            <div class="pm-legend-item">
              <span class="pm-legend-color" style="background:#ffa500;"></span>
              <span>Rozptyl (variance)</span>
            </div>
          `;

          continue;
        } else {
          this._charts[entityId] = new Chart(
            canvas.getContext('2d'),
            createLineChartConfig(points, prettyName, sensorColor, theme.textColor, id, sensorStyle, apiLastTs, statsIntervalHours, sensorAttrs)
          );
          legend.innerHTML = '';
        }
      }
    }
  }
}

customElements.define('pocasimeteo-card', PocasiMeteoCard);
