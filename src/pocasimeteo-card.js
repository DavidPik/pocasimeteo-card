/*  =======  POCASIMETEO CARD – DYNAMICKÁ ARCHITEKTURA (REFACTOR) =======  */

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
const WIND_DIR_LABELS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

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
 * (získaná z Recorderu přes WebSocket) na pole souřadnic [x, y] pro Chart.js.
 */
function historyToPoints(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(p => {
    const rawTs = p.lc || p.lu || p.last_changed || p.last_updated;
    const rawState = p.s !== undefined ? p.s : p.state;

    if (!rawTs || rawState === undefined) return null;

    // Robustní převod času, který bezpečně zvládne ISO formáty s časovou zónou z HA Recorderu
    let ts = NaN;
    if (typeof rawTs === 'number') {
      ts = rawTs > 1e12 ? rawTs : rawTs * 1000;
    } else if (rawTs) {
      const parsedDate = new Date(rawTs);
      ts = parsedDate.getTime();
    }
    
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
 * ARCHITEKTURA FRONTENDU: Vypočítá střed a poloměr pro kruhový graf větrné růžice.
 */
function computeChartGeometry(chartArea) {
  const cx = chartArea.left + chartArea.width / 2;
  const cy = chartArea.top + chartArea.height / 2;
  const R = Math.min(chartArea.width, chartArea.height) / 2;
  return { cx, cy, R };
}

/**
 * Třída reprezentující samotnou Home Assistant Lovelace kartu PočasíMeteo.
 * Nová architektura: shadowRoot vzniká vždy v konstruktoru, logika grafů zůstává zachována.
 */
class PocasiMeteoCard extends HTMLElement {
  constructor() {
    super();
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
    this._initialized = false;
    this._rendering = false;
    this._charts = {};
    this._lastApiTimestamp = null;
    this._lastFetch = 0;
    this._resizeObserver = null;
    this._currentHass = null;
    this._initialResizeDone = false;

    this._headerTitle = null;
    this._headerTimestamp = null;
    this._headerMain = null;
    this._headerDetails = null;
  }

  /**
   * Uložení konfigurace Lovelace panelu.
   * Tato metoda se může, ale nemusí volat — panel /pocasi-meteo/0 ji typicky nevolá.
   */
  setConfig(config) {
    this.config = {
      entity: config.entity || null,
      graphs_per_row: config.graphs_per_row || 2,
      hide_sensors: Array.isArray(config.hide_sensors) ? config.hide_sensors : [],
      show_graphs: config.show_graphs !== false
    };
  }

  /**
   * Aktivace ResizeObserveru — grafy se přizpůsobují velikosti panelu.
   */
  connectedCallback() {
    this._resizeObserver = new ResizeObserver(() => {
      if (!this._initialized) return;

      if (this._currentHass && !this._rendering) {
        const entityId = this.config?.entity;
        const entity = entityId ? this._currentHass.states[entityId] : null;

        if (entity) {
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

  /**
   * Zobrazení chyby v panelu (např. entita není dostupná).
   */
  _renderError(msg) {
    if (!this.shadowRoot) return;

    this.shadowRoot.innerHTML = `
      <style>
        .pm-error {
          padding: 20px;
          font-size: 18px;
          color: var(--primary-text-color, #fff);
        }
      </style>
      <div class="pm-error">${msg}</div>
    `;
  }

  /**
   * Hlavní řídicí metoda — volá se při každé změně stavu HA.
   * Zde probíhá přesně tebou požadované pořadí kroků.
   */
  set hass(hass) {
    this._currentHass = hass;

    // 1) Načíst konfiguraci panelu
    if (!this.config || !this.config.entity) {
      this._renderError("Konfigurace panelu není kompletní.");
      return;
    }

    // 2) Načíst entitu weather
    const entity = hass.states[this.config.entity];
    if (!entity) {
      this._renderError("Entita není dostupná!");
      return;
    }

    // 3) Pokud ještě není inicializováno → vytvořit záhlaví + skeleton grafů
    if (!this._initialized) {
      this._initializeHeaderSkeleton();
      this._initializeGraphsSkeleton();
      this._initialized = true;
    }

    // 4) Naplnit záhlaví daty
    this._updateVisualHeader(entity);

    // 5) Záhlaví je nyní viditelné

    // 6) Vykreslení grafů se stavovým zámkem proti zacyklení
    if (this._fetchingHistory) {
      return;
    }

    if (!this._rendering) {
      this._rendering = true;
      this._fetchingHistory = true; // Uzamkneme kartu pro asynchronní operaci Recorderu

      setTimeout(() => {
        this._updateCharts(hass, entity).finally(() => {
          this._rendering = false;
          this._fetchingHistory = false; // Zámek uvolníme až po kompletním dokončení renderu Chart.js
        });
      }, 50);
    }
  } // <-- Konec metody set hass(hass)

  /**
   * Vytvoří strukturu záhlaví (bez dat).
   * Záhlaví se naplní až v _updateVisualHeader().
   */
  _initializeHeaderSkeleton() {
    const style = document.createElement('style');
    let css = `
      .pm-card {
        padding: 0;
        color: var(--primary-text-color,#fff);
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .pm-header-section {
        padding: 20px;
        background: linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%);
        border-bottom: 1px solid rgba(255,255,255,0.12);
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .pm-header-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
      }
      .pm-header-title {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .pm-header-timestamp {
        opacity: 0.7;
        font-size: 13px;
        text-align: right;
        flex-grow: 1;
        padding-right: 12px;
      }
      .pm-header-bottom {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
      }
      .pm-header-main {
        font-size: 48px;
        font-weight: 300;
      }
      .pm-header-details {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 15px;
        opacity: 0.85;
        text-align: right;
        padding-right: 12px;
        min-width: 260px;
        white-space: nowrap;
      }

      .pm-primary-section {
        background: rgba(255,255,255,0.03);
        padding: 16px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      .pm-secondary-section {
        background: rgba(255,255,255,0.05);
        padding: 16px;
      }

      .pm-graphs {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        margin-top: 8px;
        align-items: flex-start;
        width: 100%;
        box-sizing: border-box;
      }

      .pm-graph-tile {
        box-sizing: border-box;
        flex: 0 1 calc((100% - (var(--graphs-per-row) - 1) * 16px) / var(--graphs-per-row));
        min-width: 200px;
        background: var(--ha-card-background,#1c1c1c);
        border-radius: 12px;
        padding: 8px;
        box-shadow: var(--ha-card-box-shadow,0 2px 4px rgba(0,0,0,0.2));
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .pm-graph-title {
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 4px;
        padding: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: center;
      }

      .pm-graph {
        width: 100%;
        height: 180px;
        display: block;
      }

      .pm-legend {
        margin-top: 0px;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        font-size: 14px;
        opacity: 0.8;
        padding: 4px;
      }

      .pm-legend-item {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .pm-legend-color {
        width: 12px;
        height: 12px;
        border-radius: 2px;
      }

      @media (max-width: 480px) {
        .pm-graph-tile {
          flex-grow: 1;
        }
      }
    `;

    style.textContent = css;

    const card = document.createElement('ha-card');
    card.classList.add('pm-card');

    const headerSec = document.createElement('div');
    headerSec.classList.add('pm-header-section');

    const topDiv = document.createElement('div');
    topDiv.classList.add('pm-header-top');

    this._headerTitle = document.createElement('div');
    this._headerTitle.classList.add('pm-header-title');

    this._headerTimestamp = document.createElement('div');
    this._headerTimestamp.classList.add('pm-header-timestamp');

    topDiv.appendChild(this._headerTitle);
    topDiv.appendChild(this._headerTimestamp);

    const bottomDiv = document.createElement('div');
    bottomDiv.classList.add('pm-header-bottom');

    this._headerMain = document.createElement('div');
    this._headerMain.classList.add('pm-header-main');

    this._headerDetails = document.createElement('div');
    this._headerDetails.classList.add('pm-header-details');

    bottomDiv.appendChild(this._headerMain);
    bottomDiv.appendChild(this._headerDetails);

    headerSec.appendChild(topDiv);
    headerSec.appendChild(bottomDiv);

    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(card);
    card.appendChild(headerSec);
  }

  /**
   * Vytvoří prázdné kontejnery pro grafy.
   * Ty se později naplní v _updateCharts().
   */
  _initializeGraphsSkeleton() {
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

    // --- KLÍČOVÁ OPRAVA: Sekce vložíme do karty HNED TEĎ, aby měly správný kontext ---
    const card = this.shadowRoot.querySelector('.pm-card');
    if (card) {
      card.appendChild(primarySec);
      card.appendChild(secondarySec);
    }

    this._activeCanvases = {};

    const sensorDefinitions = [
      { id: 'teplota_vnejsi', type: 'primary' },
      { id: 'vlhkost_vnejsi', type: 'primary' },
      { id: 'tlak_relativni', type: 'primary' },
      { id: 'srazky_intenzita', type: 'primary' },
      { id: 'vitr_rychlost', type: 'primary' },
      { id: 'vitr_narazy', type: 'primary' },
      { id: 'vitr_smer', type: 'primary' },
      { id: 'slunecni_zareni', type: 'primary' },
      { id: 'uv_index', type: 'primary' },
      { id: 'teplota_vnitrni', type: 'secondary' },
      { id: 'vlhkost_vnitrni', type: 'secondary' }
    ];

    sensorDefinitions.forEach(s => {
      const targetContainer = s.type === 'primary' ? primaryGraphs : secondaryGraphs;

      const tile = document.createElement('div');
      tile.className = 'pm-graph-tile';
      tile.id = `tile-${s.id}`;

      const titleElement = document.createElement('div');
      titleElement.className = 'pm-graph-title';
      titleElement.id = `title-${s.id}`;
      titleElement.textContent = s.id.replace('_', ' ').toUpperCase();

      const canvas = document.createElement('canvas');
      canvas.className = 'pm-graph';
      canvas.id = `pm-graph-${s.id}`;
      canvas.style.width = '100%';
      canvas.style.height = '100%';

      const chartWrapper = document.createElement('div');
      chartWrapper.style.position = 'relative';
      chartWrapper.style.width = '100%';
      chartWrapper.style.height = s.id === 'vitr_smer' ? '260px' : '180px';

      chartWrapper.appendChild(canvas);
      tile.appendChild(titleElement);
      tile.appendChild(chartWrapper);

      const legendPlaceholder = document.createElement('div');
      legendPlaceholder.className = 'pm-stats-placeholder';
      legendPlaceholder.style.minHeight = '22px';
      tile.appendChild(legendPlaceholder);

      targetContainer.appendChild(tile);

      this._activeCanvases[s.id] = {
        canvas,
        tile,
        titleElement,
        legendPlaceholder,
        id: s.id
      };
    });
  }

  /**
   * Naplní záhlaví daty z entity weather.
   * Logika je zachována přesně jako v původní kartě.
   */
  _updateVisualHeader(entity) {
    if (!this._headerTitle || !this._headerTimestamp || !this._headerMain || !this._headerDetails) {
      return;
    }

    const d = entity.attributes;

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

    this._headerTitle.textContent = `${lokalita}${staniceKod} — ${stateText}`;
    this._headerTimestamp.textContent = d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : '';

    const temp = d.temperature !== undefined ? d.temperature : '--';
    this._headerMain.textContent = `${temp} °C`;

    const pressure = d.pressure !== undefined ? d.pressure : '--';
    const humidity = d.humidity !== undefined ? d.humidity : '--';

    let windSpeed = '--';
    if (d.wind_speed != null) {
      windSpeed = (parseFloat(d.wind_speed) / 3.6).toFixed(1);
    }

    let windGust = '--';
    if (d.wind_gust != null) {
      windGust = (parseFloat(d.wind_gust) / 3.6).toFixed(1);
    }

    let windDirectionText = '';
    if (d.wind_bearing != null) {
      windDirectionText = ` ${degToDirection(d.wind_bearing)}`;
    }

    const kompletniVitrText = `${windSpeed} / ${windGust} m/s${windDirectionText}`;
    const srazkyDen = d.srazky_den !== undefined ? d.srazky_den : 0;

    this._headerDetails.textContent = '';
    const items = [
      `Tlak vzduchu: ${pressure} hPa`,
      `Vlhkost: ${humidity} %`,
      `Síla větru: ${kompletniVitrText}`,
      `Srážky dnes: ${srazkyDen} mm`
    ];

    items.forEach(text => {
      const div = document.createElement('div');
      div.textContent = text;
      this._headerDetails.appendChild(div);
    });
  }

  /**
   * Hlavní metoda pro vykreslení grafů.
   * Logika je zachována, jen je bezpečnější a stabilnější.
   */
  async _updateCharts(hass, entity) {
    const d = entity.attributes;
    const sensorsMeta = Array.isArray(d.sensors) ? d.sensors : [];
    const statsObj = d.sensor_stats || {};

    const primaryGraphs = this.shadowRoot.getElementById('primary-graphs');
    const secondaryGraphs = this.shadowRoot.getElementById('secondary-graphs');

    if (!primaryGraphs || !secondaryGraphs) return;
    if (this.config.show_graphs === false) return;

    if (sensorsMeta.length === 0) {
      this._lastApiTimestamp = null; // Vynutíme pročištění otisku pro další okamžitý průchod
      return;
    }

    const graphsPerRow = Math.max(1, Number(this.config.graphs_per_row) || 2);
    const statsIntervalHours = typeof d.statistics_interval === 'number' ? d.statistics_interval : 24;
    const since = new Date(Date.now() - statsIntervalHours * 3600 * 1000).toISOString();

    const activeCanvases = {};
    const rawHistoryData = {};

    // --- KROK 1: ASYNCHRONNÍ STAŽENÍ HISTORIE NA POZADÍ (BEZ MAZÁNÍ HTML) ---
    const historyPromises = sensorsMeta.map(async s => {
      const sState = hass.states[s.entity_id];

      console.log("DIAGNOSTIKA METEO STANICE:", s.id, "Going to try read data from HA"); //##
      
      if (!sState) return;

      try {
        const history = await hass.callWS({
          type: "history/list",
          start_time: since,
          end_time: new Date().toISOString(),
          entity_id: [s.entity_id],
          minimal_response: false,
          no_attributes: false
        });

        console.log("DIAGNOSTIKA METEO STANICE:", s.id, "Syrová data z HA:", history); //##

        if (history && history.length > 0) {
          rawHistoryData[s.id] = Array.isArray(history[0]) ? history[0] : history;
        } else {
          rawHistoryData[s.id] = [];
        }
      } catch (err) {
        rawHistoryData[s.id] = [];
      }
    });

    console.log("DIAGNOSTIKA METEO STANICE:", s.id, "Going to transform data from HA"); //##
    
    await Promise.all(historyPromises);

    // --- KROK 2: DATOVÁ TRANSFORMACE DO PAMĚTI (Bod d) ---
    const pointsMap = {};
    sensorsMeta.forEach(s => {
      const raw = rawHistoryData[s.id] || [];
      let pts = historyToPoints(raw);

      if (pts.length === 0) {
        const sState = hass.states[s.entity_id];
        let fallbackVal = sState ? Number(sState.state) : NaN;
        if (isNaN(fallbackVal)) {
          if (s.id === 'teplota_vnejsi') fallbackVal = Number(d.temperature);
          else if (s.id === 'vlhkost_vnejsi') fallbackVal = Number(d.humidity);
          else if (s.id === 'tlak_relativni') fallbackVal = Number(d.pressure);
          else if (s.id === 'vitr_rychlost') fallbackVal = Number(d.wind_speed);
          else if (s.id === 'vitr_smer') fallbackVal = Number(d.wind_bearing);
        }
        if (!isNaN(fallbackVal)) {
          const now = Date.now();
          pts.push({ x: now - 60000, y: fallbackVal }, { x: now, y: fallbackVal });
        }
      } else if (pts.length === 1) {
        pts.push({ x: Date.now(), y: pts[0].y });
      }
      pointsMap[s.id] = pts;
    });

    // --- KROK 3: NASTAVENÍ MŘÍŽKY GRAFŮ BEZ MAZÁNÍ HTML ---
    primaryGraphs.style.setProperty('--graphs-per-row', graphsPerRow);
    secondaryGraphs.style.setProperty('--graphs-per-row', graphsPerRow);

    const theme = computeTheme(this);

    // --- KROK 4: PASIVNÍ PLŇENÍ GEOMETRIE A VYKRESLENÍ GRAFŮ Z PAMĚTI ---
    sensorsMeta.forEach(s => {
      const domItem = this._activeCanvases[s.id];
      if (!domItem) return;

      const sState = hass.states[s.entity_id];
      
      // Pokud uživatel skryl senzor v konfiguraci, dlaždici zneviditelníme bez destrukce DOMu
      const isVisible = s.visible !== false && (!Array.isArray(this.config.hide_sensors) || !this.config.hide_sensors.includes(s.id));
      domItem.tile.style.display = isVisible ? 'flex' : 'none';
      if (!isVisible || !sState) return;

      // Aktualizace textu nadpisu s jednotkou reálně z HA stavu
      const unit = sState.attributes.unit_of_measurement || '';
      const rawFriendlyName = sState.attributes.friendly_name || s.id;
      const stationTitle = entity.attributes.friendly_name || '';
      let cleanGraphName = rawFriendlyName.indexOf(stationTitle) === 0 
        ? rawFriendlyName.substring(stationTitle.length).trim() 
        : rawFriendlyName;

      if (cleanGraphName.length > 0) {
        cleanGraphName = cleanGraphName.charAt(0).toUpperCase() + cleanGraphName.slice(1);
      }
      domItem.titleElement.textContent = cleanGraphName + (unit ? ` (${unit})` : '');

      // Nastavení rozlišení plátna podle aktuálního okna
      const dpr = window.devicePixelRatio || 1;
      const canvas = domItem.canvas;
      const chartWrapper = canvas.parentElement;
      if (chartWrapper) {
        canvas.width = Math.floor((chartWrapper.clientWidth || 300) * dpr);
        canvas.height = Math.floor((chartWrapper.clientHeight || 180) * dpr);
      }

      // Vlastní vykreslení
      const points = pointsMap[s.id] || [];
      const currentStats = statsObj[s.id] || statsObj[s.entity_id] || {};

      const gt = (s.graph_type || '').toLowerCase();
      const isWindRose = gt === 'wind_rose' || gt === 'windrose' || s.id === 'vitr_smer';

      if (isWindRose) {
        this._renderWindRose(canvas, points, theme, currentStats, domItem.legendPlaceholder);
      } else {
        this._renderLineChart(canvas, points, cleanGraphName, theme, currentStats, statsIntervalHours, domItem.legendPlaceholder);
      }
    });
  }

  /**
   * Vytvoří konfiguraci pro čárový graf Chart.js.
   * Logika je zachována z původní verze.
   */
  _createLineChartConfig(points, cleanName, theme, s, statsIntervalHours) {
    const color = s.graph_color || '#3b82f6';
    const isStepped = s.graph_style === 'stepped';
    const textColor = theme.textColor;

    const endX = Date.now();
    const intervalMs = (statsIntervalHours || 24) * 3600 * 1000;
    const startX = endX - intervalMs;

    const min = typeof s.stats_min === 'number' ? s.stats_min : 0;
    const max = typeof s.stats_max === 'number' ? s.stats_max : (min + 1);

    const padding = (max - min) * 0.05 || 1;
    let finalMin = min - padding;
    const finalMax = max + padding;

    if (!cleanName.toLowerCase().includes('teplot') &&
        !cleanName.toLowerCase().includes('temperature') &&
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
            label: cleanName,
            data: [points],
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

  /**
   * Vytvoří DOM element legendy se statistikami (barevné políčko + zkratka + hodnota).
   * Použitelné pro lineární grafy i windrose (pokud s obsahuje stats_*).
   */
  _createStatsLegend(s, color, isWindRose = false, opts = { showDash: true }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'pm-stats-legend';
    wrapper.style.display = 'flex';
    wrapper.style.flexWrap = 'wrap';
    wrapper.style.justifyContent = 'center';
    wrapper.style.gap = '10px';
    wrapper.style.marginTop = '8px';
    wrapper.style.fontSize = '13px';
    wrapper.style.opacity = '0.9';

    const makeItem = (label, value, col) => {
      // pokud hodnota neexistuje a nechceme dash, vrátíme null (nepřidá se)
      if ((value === undefined || value === null) && !opts.showDash) return null;

      const item = document.createElement('div');
      item.className = 'pm-legend-item';
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.gap = '6px';

      const sw = document.createElement('span');
      sw.className = 'pm-legend-color';
      sw.style.width = '12px';
      sw.style.height = '12px';
      sw.style.display = 'inline-block';
      sw.style.borderRadius = '2px';
      sw.style.background = col || color || '#3b82f6';

      const txt = document.createElement('span');
      // pokud hodnota chybí a showDash=true, zobrazíme pomlčku
      txt.textContent = `${label}: ${value != null ? Number(value).toFixed(1) : (opts.showDash ? '-' : '')}`;
      txt.style.opacity = '0.95';

      item.appendChild(sw);
      item.appendChild(txt);
      return item;
    };

    if (isWindRose) {
      // AVG / MODE / VAR (pokud existují)
      const avgItem = makeItem('Avg', s.stats_avg, '#ff0000');
      const modeItem = makeItem('Modus', s.stats_mode, '#0000ff');
      const varItem = makeItem('Var', s.stats_var, 'rgba(255,165,0,0.85)');
      [avgItem, modeItem, varItem].forEach(it => { if (it) wrapper.appendChild(it); });
    } else {
      // Min / Avg / Max pro lineární grafy
      const minItem = makeItem('Min', s.stats_min, 'red');
      const maxItem = makeItem('Max', s.stats_max, 'green');
      [minItem, maxItem].forEach(it => { if (it) wrapper.appendChild(it); });
    }

    return wrapper;
  }

  /**
   * Vykreslí čárový graf do daného canvasu.
   */
  _renderLineChart(canvas, points, cleanName, theme, s, statsIntervalHours, legendPlaceholder) {
    const cfg = this._createLineChartConfig(points, cleanName, theme, s, statsIntervalHours);

    if (this._charts[canvas.id]) {
      try { this._charts[canvas.id].destroy(); } catch(e){ console.warn('destroy chart failed', e); }
      delete this._charts[canvas.id];
    }

    const chart = new Chart(canvas.getContext('2d'), cfg);
    this._charts[canvas.id] = chart;

    // doplnit legendu statistik: pro lineární grafy chceme jen Min/Max
    if (legendPlaceholder) {
      legendPlaceholder.innerHTML = '';
      const color = s.graph_color || '#3b82f6';
      // showDash: true => chybějící hodnoty zobrazíme jako '-'
      const legendEl = this._createStatsLegend(s, color, false, { showDash: true });
      legendPlaceholder.appendChild(legendEl);
    }
  }
  
  /**
   * Plugin pro větrnou růžici — zachována původní logika.
   */
  _createWindRosePlugin(theme, points, sensorAttrs) {
    const avg = typeof sensorAttrs.stats_avg === 'number' ? sensorAttrs.stats_avg : 0;
    const mode = typeof sensorAttrs.stats_mode === 'number' ? sensorAttrs.stats_mode : 0;
    const vari = typeof sensorAttrs.stats_var === 'number' ? sensorAttrs.stats_var : 0;
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

        // bezpečnost: chartArea nemusí být dostupné při prvním volání
        if (!chart.chartArea) return;
        
        const { ctx, chartArea } = chart;
        const { cx, cy, R } = computeChartGeometry(chartArea);
        const maxBin = Math.max(...bins) || 1;
        const sectorAngle = 22.5 * Math.PI / 180;

        ctx.save();
        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1;

        const activeRadius = R * 0.85;

        // Kružnice mřížky
        [0.2, 0.4, 0.6, 0.8, 1.0].forEach(f => {
          ctx.beginPath();
          ctx.arc(cx, cy, activeRadius * f, 0, Math.PI * 2);
          ctx.stroke();
        });

        // Hlavní osy
        const degAxes = Array.from({ length: 8 }, (_, i) => i * 45);
        degAxes.forEach(deg => {
          const a = (deg - 90) * Math.PI / 180;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * activeRadius, cy + Math.sin(a) * activeRadius);
          ctx.stroke();
        });

        // Sektory růžice
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

        // Popisky světových stran
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

        // AVG / MODE / VAR
        const avgLineLen = activeRadius;
        const modeLineLen = activeRadius - 15;
        const offsetVar = activeRadius - 5;

        const avgAngle = (avg - 90) * Math.PI / 180;
        const modeAngle = (mode - 90) * Math.PI / 180;
        const startVar = (avg - vari - 90) * Math.PI / 180;
        const endVar = (avg + vari - 90) * Math.PI / 180;

        // Variance
        ctx.fillStyle = 'rgba(255,165,0,0.22)';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, offsetVar, startVar, endVar);
        ctx.closePath();
        ctx.fill();

        // AVG
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(avgAngle) * avgLineLen, cy + Math.sin(avgAngle) * avgLineLen);
        ctx.stroke();

        // MODE
        ctx.strokeStyle = '#0000ff';
        ctx.lineWidth = 4.0;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(modeAngle) * modeLineLen, cy + Math.sin(modeAngle) * modeLineLen);
        ctx.stroke();

        // Tooltip
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
   * Vykreslí větrnou růžici do canvasu pomocí Chart.js pluginu.
   * Po vykreslení doplní legendu statistik do legendPlaceholder.
   */
  _renderWindRose(canvas, points, theme, s, legendPlaceholder) {
  // bezpečné ID pro indexaci chartů
  const cid = canvas.id || `pm-graph-${Math.random().toString(36).slice(2,9)}`;

  // zničit starou instanci, pokud existuje
  if (this._charts && this._charts[cid]) {
    try {
      this._charts[cid].destroy();
    } catch (e) {
      console.warn('destroy windrose failed', cid, e);
    }
    delete this._charts[cid];
  }

  // zajistit, že canvas má kontext
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) {
    console.error('WindRose: canvas context not available', canvas);
    return;
  }

  // Konfigurace Chartu: typ je formální, skutečná kresba proběhne v pluginu
  const cfg = {
    type: 'polarArea',
    data: { datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { r: { display: false } }
    },
    plugins: [ this._createWindRosePlugin(theme, points, s) ]
  };

  // Inicializace Chartu
  let chart;
  try {
    chart = new Chart(ctx, cfg);
    // uložit chart pod canvas id
    if (!this._charts) this._charts = {};
    this._charts[cid] = chart;
  } catch (e) {
    console.error('WindRose Chart init failed for', cid, e);
    return;
  }

  // Doplňování legendy statistik do placeholderu (AVG / MODE / VAR)
  if (legendPlaceholder) {
    try {
      legendPlaceholder.innerHTML = '';
      const color = (s && s.graph_color) ? s.graph_color : '#009688';
      // Vytvoříme legendu; _createStatsLegend vrací element, který zobrazuje '-' pro chybějící hodnoty
      const legendEl = this._createStatsLegend(s || {}, color, true, { showDash: true });
      legendPlaceholder.appendChild(legendEl);
    } catch (e) {
      console.warn('Failed to append windrose legend', e);
    }
  }
}
}

customElements.define('pocasimeteo-card', PocasiMeteoCard);
  
