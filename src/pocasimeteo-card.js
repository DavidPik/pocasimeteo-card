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

class PocasiMeteoCard extends HTMLElement {
  constructor() {
    super();
    this._initialized = false;
    this._rendering = false;
    this._charts = {};
    this._lastAttributes = null;
    this._lastRender = 0;
    this._updateInterval = null;
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

    // 1) Load update_interval from config entry (only once)
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

    // 2) Throttling
    if (Date.now() - this._lastRender < refresh * 1000) return;

    // 3) Detect data change
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

        .pm-graphs {
          display: grid;
          gap: 16px;
        }

        @media (min-width: 900px) {
          .pm-graphs {
            grid-template-columns: repeat(2, 1fr);
          }
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

    const d = entity.attributes;
    const weatherId = this.config.entity.split(".")[1];

    const sensorEntities = Object.keys(hass.states)
      .filter(e => e.startsWith("sensor." + weatherId + "_"))
      .filter(e => {
        const st = hass.states[e].state;
        return st !== "unknown" && st !== "unavailable" && !isNaN(parseFloat(st));
      });

    const header = this.shadowRoot.getElementById("header");
    const temp = this.shadowRoot.getElementById("temp");
    const current = this.shadowRoot.getElementById("current");
    const graphs = this.shadowRoot.getElementById("graphs");

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

    if (sensorEntities.length === 0) return;

    // Correct token for HA 2024.6+
    const token =
      hass.connection?.options?.auth?.access_token ||
      hass.auth?.data?.access_token ||
      null;

    const now = new Date();
    const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

    const canvases = {};
    for (const sensor of sensorEntities) {
      const canvas = document.createElement("canvas");
      canvas.classList.add("pm-graph");
      canvas.height = 200;
      graphs.appendChild(canvas);
      canvases[sensor] = canvas;
    }

    const history = {};

    await Promise.all(sensorEntities.map(async sensor => {
      const url =
        `/api/history/period/${since}` +
        `?filter_entity_id=${sensor}` +
        `&minimal_response` +
        `&significant_changes_only=false`;

      try {
        const resp = await fetch(url, {
          method: "GET",
          headers: {
            "Authorization": token ? `Bearer ${token}` : "",
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          credentials: "same-origin"
        });

        if (resp.ok) {
          history[sensor] = await resp.json();
        }
      } catch {}
    }));

    for (const sensor of sensorEntities) {
      const raw = history[sensor]?.[0] || [];

      const points = raw
        .map(p => ({
          x: p.last_changed ? new Date(p.last_changed) : new Date(),
          y: parseFloat(p.state)
        }))
        .filter(p => !isNaN(p.y));

      if (points.length < 2) continue;

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

      this._charts[sensor] = new Chart(ctx, {
        type: "line",
        data: {
          datasets: [
            {
              label: name,
              data: points,
              borderColor: "#3b82f6",
              backgroundColor: "rgba(59,130,246,0.2)",
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
    }
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
