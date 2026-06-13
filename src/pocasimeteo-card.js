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

    const style = `
      <style>
        .pm-card {
          padding: 16px;
          color: var(--primary-text-color);
        }
        .pm-header {
          display: flex;
          justify-content: space-between;
          font-size: 20px;
          font-weight: 600;
        }
        .pm-temp {
          font-size: 64px;
          font-weight: 300;
          margin-top: 12px;
        }
        .pm-sub {
          opacity: 0.7;
          font-size: 16px;
        }
        .pm-row {
          margin-top: 16px;
          font-size: 16px;
          opacity: 0.9;
        }
        .pm-section-title {
          margin-top: 24px;
          font-size: 18px;
          font-weight: 600;
        }
        .pm-webcam {
          width: 100%;
          border-radius: 8px;
          margin-top: 12px;
        }
      </style>
    `;

    this.innerHTML = `
      ${style}
      <ha-card class="pm-card">

        <div class="pm-header">
          <div>${d.station_name}</div>
          <div style="opacity:0.6;">${d.timestamp}</div>
        </div>

        ${d.webcam_url ? `<img class="pm-webcam" src="${d.webcam_url}">` : ""}

        <div class="pm-temp">${d.TeplotaVnejsi}°</div>
        <div class="pm-sub">min ${d.min_temp_24h}° · max ${d.max_temp_24h}°</div>

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
