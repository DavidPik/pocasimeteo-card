/*  =======  POCASIMETEO CARD – BEZPEČNÝ PRODUKČNÍ KÓD (ČÁST 1) =======  */

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

const NON_GRAPH_SENSORS = ['srazky_den'];
const GRID_COLOR = 'rgba(255,255,255,0.2)';

const WIND_DIR_LABELS = [
  'N','NNE','NE','ENE','E','ESE','SE','SSE',
  'S','SSW','SW','WSW','W','WNW','NW','NNW'
];

function safeCssVar(el, name, fallback) {
  try {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

function isLightTheme(el) {
  return safeCssVar(el, '--brightness', '0').trim() === '1';
}

function computeTheme(host) {
  const light = isLightTheme(host);
  const textColor = safeCssVar(host, '--primary-text-color', null) || (light ? '#000' : '#fff');
  const bgColor =
    safeCssVar(host, '--ha-card-background', '') ||
    safeCssVar(host, '--card-background-color', '') ||
    (light ? '#fff' : '#1c1c1c');
  return { textColor, bgColor };
}

function degToDirection(deg) {
  if (deg == null || isNaN(deg)) return '';
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
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function createLineChartConfig(points, cleanName, color, textColor) {
  const { min, max, minPoint, maxPoint } = computeMinMax(points);
  const rgba = hexToRgba(color, 0.25);

  return {
    type:'line',
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
          label:'Min: ' + min.toFixed(1),
          data:[{x:minPoint.x,y:minPoint.y}],
          pointRadius:6,
          pointBackgroundColor:'red',
          showLine:false
        },
        {
          label:'Max: ' + max.toFixed(1),
          data:[{x:maxPoint.x,y:maxPoint.y}],
          pointRadius:6,
          pointBackgroundColor:'green',
          showLine:false
        }
      ]
    },
    options:{
      responsive:false,
      maintainAspectRatio:false,
      plugins:{ tooltip:{}, legend:{display:false} },
      scales:{
        x:{ type:'time', time:{unit:'hour'}, ticks:{color:textColor}, grid:{color:GRID_COLOR} },
        y:{ ticks:{color:textColor}, grid:{color:GRID_COLOR} }
      }
    }
  };
}

function createWindRosePlugin(theme, bins, avg, mode, vari) {
  return {
    id:'windRoseManual',
    beforeInit(chart) {
      const canvas = chart.canvas;
      canvas.addEventListener('mousemove', (ev) => {
        const rect = canvas.getBoundingClientRect();
        chart.$mouse = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
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
      [0.15,0.30,0.45,0.60,0.75,0.90].forEach(f => {
        ctx.beginPath();
        ctx.arc(cx, cy, R*f, 0, Math.PI*2);
        ctx.stroke();
      });

      [0, 45, 90, 135, 180, 225, 270, 315].forEach(deg => {
        const a = (deg - 90) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a)*R, cy + Math.sin(a)*R);
        ctx.stroke();
      });

      const sectorColor = '#009688';
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
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

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

      const offsetLine = R - 20;
      const offsetVar = R - 10;
      const avgAngle = (avg - 90) * Math.PI / 180;
      const modeAngle = (mode - 90) * Math.PI / 180;
      const startVar = (avg - vari - 90) * Math.PI / 180;
      const endVar = (avg + vari - 90) * Math.PI / 180;

      ctx.fillStyle = 'rgba(255,165,0,0.25)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, offsetVar, startVar, endVar);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(avgAngle)*offsetLine, cy + Math.sin(avgAngle)*offsetLine);
      ctx.stroke();

      ctx.strokeStyle = '#0000ff';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(modeAngle)*offsetLine, cy + Math.sin(modeAngle)*offsetLine);
      ctx.stroke();

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
        if (ty PočasíMeteo</h2><p style="opacity:0.7;">Backendová komponenta není dostupná (chybí data senzorů).</p>';
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
    this.shadowRoot.innerHTML = '<style>' +
        '.pm-card { padding:0; color:var(--primary-text-color,#fff); display:flex; flex-direction:column; gap:0; }' +
        '.pm-header-section { padding:16px; background:rgba(255,255,255,0.05); border-bottom:1px solid rgba(255,255,255,0.1); display:flex; flex-direction:column; gap:12px; }' +
        '.pm-header-top { display:flex; justify-content:space-between; align-items:flex-start; font-size:20px; font-weight:600; }' +
        '.pm-header-title { display:flex; flex-direction:column; gap:4px; }' +
        '.pm-header-timestamp { opacity:0.7; font-size:14px; }' +
        '.pm-header-bottom { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }' +
        '.pm-header-main { font-size:48px; font-weight:300; }' +
        '.pm-header-details { display:flex; flex-direction:column; gap:4px; font-size:16px; opacity:0.85; }' +
        '.pm-primary-section { background:rgba(255,255,255,0.03); padding:16px; border-bottom:1px solid rgba(255,255,255,0.1); }' +
        '.pm-secondary-section { background:rgba(255,255,255,0.05); padding:16px; }' +
        '.pm-graphs { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:16px; margin-top:8px; }' +
        '.pm-graph-tile { background:var(--ha-card-background,#1c1c1c); border-radius:12px; padding:4px; box-shadow:var(--ha-card-box-shadow,0 2px 4px rgba(0,0,0,0.2)); display:flex; flex-direction:column; }' +
        '.pm-graph-title { font-size:1em; font-weight:600; margin-bottom:4px; padding: 4px; }' +
        '.pm-graph { width:100%; height:220px; }' +
        '.pm-legend { margin-top:0px; display:flex; flex-wrap:wrap; justify-content:center; gap:8px; font-size:14px; opacity:0.8; padding: 4px; }' +
        '.pm-legend-item { display:flex; align-items:center; gap:4px; }' +
        '.pm-legend-color { width:12px; height:12px; border-radius:2px; }' +
      '</style>' +
      '<ha-card class="pm-card">' +
        '<div id="header-section" class="pm-header-section">' +
          '<div class="pm-header-top">' +
            '<div class="pm-header-title" id="header-title"></div>' +
            '<div class="pm-header-timestamp" id="header-timestamp"></div>' +
          '</div>' +
          '<div class="pm-header-bottom">' +
            '<div class="pm-header-main" id="header-main"></div>' +
            '<div class="pm-header-details" id="header-details"></div>' +
          '</div>' +
        '</div>' +
        '<div class="pm-primary-section">' +
          '<div id="primary-graphs" class="pm-graphs"></div>' +
        '</div>' +
        '<div class="pm-secondary-section">' +
          '<div id="secondary-graphs" class="pm-graphs"></div>' +
        '</div>' +
      '</ha-card>';
  }

  async _update(hass) {
    const entity = hass.states[this.config.entity];
    if (!entity) return;

    const nowTs = Date.now();
    if (30000 > nowTs - this._lastFetch) return;
    this._lastFetch = nowTs;

    const d = entity.attributes;
    const sensorsMeta = Array.isArray(d.sensors) ? d.sensors : [];

    const headerTitle = this.shadowRoot.getElementById('header-title');
    const headerTimestamp = this.shadowRoot.getElementById('header-timestamp');
    const headerMain = this.shadowRoot.getElementById('header-main');
    const headerDetails = this.shadowRoot.getElementById('header-details');
    const primaryGraphs = this.shadowRoot.getElementById('primary-graphs');
    const secondaryGraphs = this.shadowRoot.getElementById('secondary-graphs');

    headerTitle.innerHTML = d.lokalita_stanice || d.station_name || '';
    headerTimestamp.innerHTML = d.timestamp || '';
    headerMain.innerHTML = 'Teplota venkovní: ' + (d.teplota_vnejsi_value ?? entity.attributes.temperature) + '°C';

    headerDetails.innerHTML = '<div>Tlak: ' + (entity.attributes.pressure ?? '') + ' hPa</div>' +
      '<div>Vlhkost: ' + (entity.attributes.humidity ?? '') + '%</div>' +
      '<div>Vítr: ' + (entity.attributes.wind_speed ?? '') + ' m/s (' + degToDirection(Number(entity.attributes.wind_bearing)) + ')</div>' +
      '<div>Nárazy: ' + (entity.attributes.wind_gust_speed ?? '') + ' m/s</div>' +
      '<div>Srážky dnes: ' + (d.srazky_den ?? 0) + ' mm</div>';

    primaryGraphs.innerHTML = '';
    secondaryGraphs.innerHTML = '';

    if (this.config.show_graphs === false) return;
    if (sensorsMeta.length === 0) return;

    const token = hass.connection?.options?.accessToken || hass.auth?.data?.access_token || null;
    if (!token) return;

    const since = new Date(Date.now() - 24*3600*1000).toISOString();
    const canvases = {};
    const history = {};

    const targetSections = [
      { type: 'primary', container: primaryGraphs },
      { type: 'secondary', container: secondaryGraphs }
    ];

    for (const section of targetSections) {
      const filteredMeta = sensorsMeta.filter(s => s.type === section.type);
      
      for (const s of filteredMeta) {
        const sState = hass.states[s.entity_id];
        if (!sState || this.config.hide_sensors.includes(s.id)) continue;

        const tile = document.createElement('div');
        tile.classList.add('pm-graph-tile');

        const unit = sState.attributes.unit_of_measurement || '';
        const prettyName = sState.attributes.friendly_name || s.id;

        const title = document.createElement('div');
        title.classList.add('pm-graph-title');
        title.textContent = prettyName + (unit ? ' - ' + unit : '');

        const canvas = document.createElement('canvas');
        canvas.classList.add('pm-graph');
        canvas.height = s.id === 'vitr_smer' ? 300 : 220;

        const legend = document.createElement('div');
        legend.classList.add('pm-legend');

        tile.appendChild(title);
        tile.appendChild(canvas);
        tile.appendChild(legend);

        section.container.appendChild(tile);

        canvases[s.entity_id] = { canvas, tile, prettyName, legend, id: s.id };
      }
    }

    const activeEntityIds = Object.keys(canvases);
    await Promise.all(activeEntityIds.map(async entityId => {
      const item = canvases[entityId];
      if (NON_GRAPH_SENSORS.includes(item.id)) return;

      const url = '/api/history/period/' + since + '?filter_entity_id=' + entityId + '&minimal_response&significant_changes_only=false';
      try {
        const resp = await fetch(url, {
          method:'GET',
          headers:{ 'Authorization':'Bearer ' + token, 'Content-Type':'application/json' },
          credentials:'same-origin'
        });
        if (resp.ok) history[entityId] = await resp.json();
      } catch(e) {}
    }));

    const host = this.shadowRoot.host;
    const theme = computeTheme(host);

    for (const entityId of activeEntityIds) {
      const item = canvases[entityId];
      if (!item) continue;

      if (!history[entityId] || !history[entityId][0] || !history[entityId][0].length) continue;
      const points = historyToPoints(history[entityId][0]);

      if (points.length === 1) {
        points.push({ x: Date.now(), y: points[0].y });
      }
      if (points.length  a + b.y, 0) / points.length);
        const mode = avg;
        const vari = 0.0;

        const windRosePlugin = createWindRosePlugin(theme, bins, avg, mode, vari);

        this._charts[entityId] = new Chart(ctx, {
          type:'polarArea',
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

        legend.innerHTML = '<div class="pm-legend-item"><span class="pm-legend-color" style="background:#ff0000;"></span><span>Avg: ' + avg.toFixed(0) + '°</span></div>' +
          '<div class="pm-legend-item"><span class="pm-legend-color" style="background:#0000ff;"></span><span>Mode: ' + mode.toFixed(0) + '°</span></div>' +
          '<div class="pm-legend-item"><span class="pm-legend-color" style="background:rgba(255,165,0,0.8);"></span><span>Var: ±' + vari.toFixed(0) + '°</span></div>';
      } else {
        const { min, max } = computeMinMax(points);
        const sState = hass.states[entityId];
        const color = sState ? (sState.attributes.graph_color || '#3b82f6') : '#3b82f6';

        this._charts[entityId] = new Chart(ctx, createLineChartConfig(points, prettyName, color, theme.textColor));

        legend.innerHTML = '<div class="pm-legend-item"><span class="pm-legend-color" style="background:red;"></span><span>Min: ' + min.toFixed(1) + '</span></div>' +
          '<div class="pm-legend-item"><span class="pm-legend-color" style="background:green;"></span><span>Max: ' + max.toFixed(1) + '</span></div>';
      }
    }
  }

  _hexToRgba(hex, alpha) { return hexToRgba(hex, alpha); }
  getCardSize() { return 6; }
}

customElements.define('pocasimeteo-card', PocasiMeteoCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type:'pocasimeteo-card',
  name:'PočasíMeteo Card',
  description:'Automatické grafy pro PočasíMeteo.cz'
});
