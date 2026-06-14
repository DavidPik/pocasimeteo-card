class PocasiMeteoCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity) {
      throw new Error("entity is required");
    }
    this.config = config;
  }

  set hass(hass) {
    const entity = hass.states[this.config.entity];
    if (!entity) return;

    const d = entity.attributes;

    // Stav počasí – preferujeme náš pseudo-condition
    let condition = "";
    if (entity.state && entity.state !== "unknown") {
      condition = entity.state;
    } else if (d.condition) {
      condition = d.condition;
    }

    // MDI ikonky podle stavu
    const iconMap = {
      "sunny": "mdi:weather-sunny",
      "sunny & windy": "mdi:weather-windy-variant",
      "sunny & rainy": "mdi:weather-partly-rainy",

      "partlycloudy": "mdi:weather-partly-cloudy",
      "partlycloudy & windy": "mdi:weather-windy",
      "partlycloudy & rainy": "mdi:weather-partly-rainy",

      "cloudy": "mdi:weather-cloudy",
      "cloudy & windy": "mdi:weather-windy",
      "cloudy & rainy": "mdi:weather-rainy",

      "rainy": "mdi:weather-rainy",
      "rainy & windy": "mdi:weather-pouring",

      "night": "mdi:weather-night",
      "night & windy": "mdi:weather-night-partly-cloudy",
      "night & rainy": "mdi:weather-night-rainy",
    };

    const icon = iconMap[condition] || "mdi:weather-cloudy";

    const style = `
      <style>
        .pm-card {
          padding: 16px;
          color: var(--primary-text-color);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .pm-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 20px;
          font-weight: 600;
        }

        .pm-condition {
          opacity: 0.7;
          font-size: 14px;
          font-weight: 400;
        }

        .pm-icon {
          font-size: 48px;
          margin-top: 4px;
          display: flex;
          align-items: center;
        }

        .pm-temp {
          font-size: 64px;
          font-weight: 300;
          margin-top: 4px;
        }

        .pm-row {
          font-size: 16px;
          opacity: 0.9;
          line-height: 1.6;
        }

        .pm-section-title {
          margin-top: 12px;
          font-size: 18px;
          font-weight: 600;
        }

        .pm-webcam {
          width: 100%;
          border-radius: 8px;
          margin-top: 8px;
        }

        /* Responsivita */
        @media (max-width: 480px) {
          .pm-header {
            font-size: 16px;
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
          }
          .pm-temp {
            font-size: 48px;
          }
          .pm-icon {
            font-size: 40px;
          }
          .pm-row {
            font-size: 14px;
          }
        }
      </style>
    `;

    this.innerHTML = `
      ${style}
      <ha-card class="pm-card">

        <div class="pm-header">
          <div>
            ${d.station_name}<br>
            <span class="pm-condition">${condition}</span>
          </div>
          <div style="opacity:0.6;">${d.timestamp}</div>
        </div>

        <div class="pm-icon">
          <ha-icon icon="${icon}" style="--mdc-icon-size: 48px;"></ha-icon>
        </div>

        ${d.webcam_url ? `<img class="pm-webcam" src="${d.webcam_url}">` : ""}

        <div class="pm-temp">${d.TeplotaVnejsi}°</div>

        <div class="pm-row">
          vlhkost ${d.VlhkostVnejsi}% ·
          vítr ${d.Vitr}/${d.VitrNarazy} m/s ·
          srážky ${d.SrazkyDen} mm ·
          tlak ${d.TlakRel} hPa
        </div>

        <div class="pm-section-title">Doplňková čidla</div>
        <div class="pm-row">
          Teplota vnitřní: ${d.TeplotaVnitrni} °C<br>
          Vlhkost vnitřní: ${d.VlhkostVnitrni} %
        </div>

        <div class="pm-section-title">Grafy (připravujeme)</div>
        <div class="pm-row">
          Teplota, vlhkost, tlak, vítr, srážky, sluneční záření
        </div>

      </ha-card>
    `;
  }

  getCardSize() {
    return 4;
  }
}

customElements.define("pocasimeteo-card", PocasiMeteoCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "pocasimeteo-card",
  name: "PočasíMeteo Card",
  description: "Lovelace card for PočasíMeteo.cz weather data"
});
