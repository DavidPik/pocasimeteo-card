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

// Barvy sladěné s grafy na stránce Meteostanice Hostivice
const COLOR_MAP = {
  teplota_vnejsi: "#ff5722",
  vlhkost_vnejsi: "#2196f3",
  tlak_rel: "#9c27b0",
  tlak: "#9c27b0",
  vitr: "#4caf50",
  vitr_naraz: "#2e7d32",
  srazky: "#03a9f4",
  srazky_den: "#0288d1",
  uv: "#ffeb3b"
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
    this._lastFetch = 0; // minimální interval pro načtení dat z backendu
  }

  setConfig(config) {
    if (!config.entity) throw new Error("entity is required");
    this.config = config;
    this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    if (!this._initialized) {
      this._initialize();
      this._initialized = true;
    }

    const entity = hass.states[this.config.entity];
    if (!entity) return;

    // Load update_interval once
    if (!this._updateInterval) {
      const entryId = entity.attributes.config_entry_id;
      if (entryId) {
        hass.callApi("GET", `config/config_entries/entry/${entryId}`)
          .then(entry => {
            this._updateInterval = entry.data.update_interval || 60;
            console.log("Loaded update_interval:", this._updateInterval);
          })
          .catch(() => {
            this._updateInterval = 60;
            console.warn("Failed to load update_interval, using 60s");
          });
      } else {
        this._updateInterval = 60;
      }
      return; // wait for interval
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
        .pm-card {
          padding: 16px;
          color: var(--primary-text-color);
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .pm-header {
          display: flex;
          justify-content: space-between;
          font-size: 20px;
          font-weight: 600;
        }

        .pm-condition {
          opacity: 0.7;
          font-size: 14px;
        }

        .pm-temp {
          font-size: 64px;
          font-weight: 300;
        }

        .pm-current {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          opacity: 0.8;
          font-size: 16px;
        }

        /* Grafy jako samostatné dlaždice s reflow */
        .pm-graphs {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 16px;
          margin-top: 8px;
        }

        .pm-graph-tile {
          background: var(--ha-card-background, #fff);
          border-radius: 12px;
          padding: 12px;
          box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,0.2));
          display: flex;
          flex-direction: column;
        }

        .pm-graph-title {
          font-size: 1em;
          font-weight: 600;
          margin-bottom: 8px;
        }

        .pm-graph {
          width: 100%;
          height: 200px;
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

    // Minimální interval 30 s pro načtení nových dat z backendu
    const nowTs = Date.now();
    if (nowTs - this._lastFetch < 30000) {
      console.log(
        "Skipping backend fetch, last fetch",
        ((nowTs - this._lastFetch) / 1000).toFixed(1),
        "s ago"
      );
      return;
    }
    this._lastFetch = nowTs;

    // Získáme prefix senzorů z atributu station_name
    const weatherEntity = hass.states[this.config.entity];
    const prefix = (weatherEntity?.attributes?.station_name || "")
      .toLowerCase()
      .replace(/\s+/g, "_");

    console.log("Detected prefix:", prefix);

    // Najdeme všechny senzory s tímto prefixem, které mají číselnou hodnotu
    const sensorEntities = Object.keys(hass.states)
      .filter(e => e.startsWith("sensor." + prefix + "_"))
      .filter(e => {
        const st = hass.states[e].state;
        return st !== "unknown" &&
               st !== "unavailable" &&
               st !== null &&
               st !== undefined &&
               !isNaN(Number(st));
      });

    console.log("Detected sensors:", sensorEntities);

    const header = this.shadowRoot.getElementById("header");
    const temp = this.shadowRoot.getElementById("temp");
    const current = this.shadowRoot.getElementById("current");
    const graphs = this.shadowRoot.getElementById("graphs");

    const d = entity.attributes;
    
    header.innerHTML = `
      <div class="pm-header">
        <div>
          ${d.station_name}<br>
          <span class="pm-condition">${d.condition || ""}</span>
        </div>
        <div style="opacity:0.6;">${d.timestamp}</div>
      </div>
    `;

    temp.innerHTML = `<div class="pm-temp">${d.TeplotaVnejsi}°</div>`;

    current.innerHTML = `
      <div>Vlhkost: ${d.VlhkostVnejsi}%</div>
      <div>Tlak: ${d.TlakRel || d.Tlak || ""} hPa</div>
      <div>Vítr: ${d.Vitr} m/s (${d.SmerVetra || ""})</div>
      <div>Srážky: ${d.SrazkyDen || d.Srazky || 0} mm</div>
    `;

    graphs.innerHTML = "";

    if (sensorEntities.length === 0) {
      console.warn("No sensors found");
      return;
    }

    // Robust token handling
    const token =
      hass.connection?.options?.accessToken ||
      hass.auth?.data?.access_token ||
      hass.connection?.options?.auth?.access_token ||
      null;

    console.log("Token:", token ? "OK" : "MISSING");

    if (!token) {
      console.warn("Token not ready, skipping update");
      return;
    }

    const now = new Date();
    const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

    const canvases = {};
    for (const sensor of sensorEntities) {
      const tile = document.createElement("div");
      tile.classList.add("pm-graph-tile");

      const s = hass.states[sensor];
      const name = s.attributes.friendly_name || sensor;

      const title = document.createElement("div");
      title.classList.add("pm-graph-title");
      title.textContent = name;

      const canvas = document.createElement("canvas");
      canvas.classList.add("pm-graph");

      // bitmapová výška
      canvas.height = 200;

      // CSS výška a šířka
      canvas.style.setProperty("height", "200px");
      canvas.style.setProperty("width", "100%");

      tile.appendChild(title);
      tile.appendChild(canvas);
      graphs.appendChild(tile);

      canvases[sensor] = canvas;
    }

    const history = {};

    await Promise.all(sensorEntities.map(async sensor => {
      const url =
        `/api/history/period/${since}` +
        `?filter_entity_id=${sensor}` +
        `&minimal_response` +
        `&significant_changes_only=false`;

      console.log("History URL:", url);

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

        console.log("History status for", sensor, resp.status);

        if (resp.ok) {
          history[sensor] = await resp.json();
          console.log("History data for", sensor, history[sensor]);
        } else {
          console.warn("History fetch failed", sensor, resp.status);
        }
      } catch (e) {
        console.error("Fetch error", sensor, e);
      }
    }));

    for (const sensor of sensorEntities) {
      if (
        !history[sensor] ||
        !history[sensor][0] ||
        !Array.isArray(history[sensor][0]) ||
        history[sensor][0].length === 0
      ) {
        console.warn("Sensor has no history, skipping:", sensor);
        continue;
      }

      const raw = history[sensor][0];

      const points = [];

      for (const p of raw) {
        const ts = Date.parse(p.last_changed);
        const rawVal = p.state;

        // ignorujeme nečíselné hodnoty
        if (
          rawVal === null ||
          rawVal === undefined ||
          rawVal === "" ||
          rawVal === "unknown" ||
          rawVal === "unavailable" ||
          rawVal === "None" ||
          rawVal === "nan"
        ) {
          console.warn("Skipping non-numeric state:", rawVal);
          continue;
        }

        const val = Number(rawVal);
        if (isNaN(val)) {
          console.warn("Skipping NaN value:", rawVal);
          continue;
        }

        if (isNaN(ts)) {
          console.warn("Skipping invalid timestamp:", p.last_changed);
          continue;
        }

        points.push({ x: ts, y: val });
      }

      console.log("Points for", sensor, points.length);

      if (points.length < 2) {
        console.warn("Not enough points for", sensor);
        continue;
      }

      const s = hass.states[sensor];
      const unit = s.attributes.unit_of_measurement || "";
      const name = s.attributes.friendly_name || sensor;

      const min = Math.min(...points.map(p => p.y));
      const max = Math.max(...points.map(p => p.y));

      const canvas = canvases[sensor];
      const ctx = canvas.getContext("2d");

      if (this._charts[sensor]) {
        this._charts[sensor].destroy();
      }

      // Barva podle typu senzoru (sladěná s webem)
      const color = this._getColorForSensor(sensor, prefix);

      console.log("Drawing chart for", sensor, "with color", color);

      this._charts[sensor] = new Chart(ctx, {
        type: "line",
        data: {
          datasets: [
            {
              label: name,
              data: points,
              borderColor: color,
              backgroundColor: color + "33",
              tension: 0.3,
              pointRadius: 0
            },
            {
              label: "Min",
              data: [{ x: points.find(p => p.y === min).x, y: min }],
              pointRadius: 6,
              pointBackgroundColor: "red",
              showLine: false
            },
            {
              label: "Max",
              data: [{ x: points.find(p => p.y === max).x, y: max }],
              pointRadius: 6,
              pointBackgroundColor: "green",
              showLine: false
            }
          ]
        },       
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              type: "time",
              time: { unit: "hour" },
              adapters: { date: {} },
              title: { display: true, text: "Čas" }
            },
            y: {
              title: { display: true, text: unit }
            }
          }
        }
      });
 
      // Donutíme Chart.js přepočítat layout po vytvoření grafu
      setTimeout(() => {
        if (this._charts[sensor]) {
          this._charts[sensor].resize();
        }
      }, 0);
    }
  }

  _getColorForSensor(sensorId, prefix) {
    const base = "sensor." + prefix + "_";
    let key = sensorId.startsWith(base) ? sensorId.slice(base.length) : sensorId;
    key = key.toLowerCase();
    return COLOR_MAP[key] || "#3b82f6";
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
