class PocasiMeteoCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity) throw new Error("entity is required");
    this.config = config;
    this.attachShadow({ mode: "open" });
  }

  async set hass(hass) {
    const entity = hass.states[this.config.entity];
    if (!entity) return;

    const d = entity.attributes;
    const weatherId = this.config.entity.split(".")[1];

    // Najdeme všechny senzory patřící k weather entitě
    const sensorEntities = Object.keys(hass.states)
      .filter(e => e.startsWith("sensor." + weatherId))
      .filter(e => typeof hass.states[e].state === "string")
      .filter(e => !isNaN(parseFloat(hass.states[e].state)));

    // Načteme historii všech senzorů
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

    const history = {};
    for (const sensor of sensorEntities) {
      const url = `/api/history/period/${since}?filter_entity_id=${sensor}`;
      const resp = await fetch(url, { headers: { "Content-Type": "application/json" }});
      const json = await resp.json();
      history[sensor] = json[0] || [];
    }

    // Vytvoříme HTML
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
        .pm-graph {
          width: 100%;
          height: 200px;
        }
        @media (max-width: 480px) {
          .pm-temp { font-size: 48px; }
        }
      </style>

      <ha-card class="pm-card">
        <div class="pm-header">
          <div>
            ${d.station_name}<br>
            <span class="pm-condition">${d.condition || ""}</span>
          </div>
          <div style="opacity:0.6;">${d.timestamp}</div>
        </div>

        <div class="pm-temp">${d.TeplotaVnejsi}°</div>

        <div id="graphs"></div>
      </ha-card>
    `;

    // Vložíme grafy
    const graphContainer = this.shadowRoot.getElementById("graphs");

    for (const sensor of sensorEntities) {
      const s = hass.states[sensor];
      const unit = s.attributes.unit_of_measurement || "";
      const name = s.attributes.friendly_name || sensor;

      const canvas = document.createElement("canvas");
      canvas.classList.add("pm-graph");
      graphContainer.appendChild(canvas);

      const points = history[sensor].map(p => ({
        x: new Date(p.last_changed),
        y: parseFloat(p.state)
      }));

      const min = Math.min(...points.map(p => p.y));
      const max = Math.max(...points.map(p => p.y));

      new Chart(canvas.getContext("2d"), {
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
