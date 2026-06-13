# 🎨 PočasíMeteo Card

[![hacs_badge](https://img.shields.io/badge/HACS-Default-orange.svg)](https://github.com/hacs/integration)
[![GitHub release](https://img.shields.io/github/release/davidpik/pocasimeteo-card.svg)](https://github.com/davidpik/pocasimeteo-card/releases)

Pokročilá Lovelace custom card pro zobrazení senzorů z meteostanice [PočasíMeteo integrace](https://github.com/davidpik/pocasimeteo).

---
# PočasíMeteo Card
Moderní Lovelace karta pro Home Assistant, která zobrazuje data z meteostanic služby **PočasíMeteo.cz**.  
Karta automaticky využívá data z integrace **davidpik/pocasimeteo** a přizpůsobuje se aktivnímu skinu Home Assistanta (light/dark, themes).

![preview](https://raw.githubusercontent.com/DavidPik/pocasimeteo-card/master/media/preview.png)

---

## ✨ Funkce

- Moderní UI přizpůsobené Home Assistantu  
- Automatické načítání dat z integrace `pocasimeteo`  
- Zobrazení:
  - aktuální venkovní teploty (dominantní údaj)
  - min/max teploty za posledních 24 hodin
  - vlhkosti, větru, nárazů, srážek, tlaku
  - UV indexu a slunečního záření
  - doplňkových čidel (teplota/vlhkost vnitřní)
  - webkamery stanice (pokud je dostupná)
- Připravené sekce pro grafy (teplota, vlhkost, tlak, vítr, srážky, sluneční záření)
- Responzivní design pro mobil i desktop
- HACS-ready balíček

---

## 📦 Instalace

### 🔹 Instalace přes HACS (doporučeno)

1. Otevřete **HACS → Frontend**
2. Klikněte na **Custom repositories**
3. Přidejte URL repozitáře: https://github.com/DavidPik/pocasimeteo-card
4. Vyberte kategorii **Lovelace**
5. Nainstalujte kartu **PočasíMeteo Card**
6. Restartujte Home Assistant

### 🔹 Ruční instalace

1. Stáhněte soubor: dist/pocasimeteo-card.js
2. Nahrajte jej do: /config/www/pocasimeteo-card/
   **Nastavení → Panely → Zdroje → Přidat zdroj**
4. Přidejte do Lovelace resources: /local/pocasimeteo-card/pocasimeteo-card.js
5. Restartujte Home Assistant

---

## ⚙️ Konfigurace karty

Karta se používá jako:

```yaml
type: custom:pocasimeteo-card
entity: weather.pocasimeteo
```

## Volitelné parametry

| Parametr | Popis |
| --- | --- |
| ``entity`` | Weather entita z integrace PočasíMeteo (povinné) |
| ``show_webcam`` | Zobrazit webkameru (true/false) |
| ``show_internal_sensors`` | Zobrazit vnitřní čidla |
| ``show_graphs`` | Zobrazit sekci grafů (zatím placeholder) |

## Příklad
```yaml
type: custom:pocasimeteo-card
entity: weather.pocasimeteo
show_webcam: true
show_internal_sensors: true
show_graphs: false
```

## 🔧 Požadavky
Home Assistant 2025.12 nebo novější

Integrace PočasíMeteo (davidpik/pocasimeteo)

Webová meteostanice PočasíMeteo.cz s platným API klíčem

## 🧩 Jak karta funguje
Karta načítá data z entity: weather.<název_stanice>

A zobrazuje:

   TeplotaVnejsi
   VlhkostVnejsi
   Vitr, VitrNarazy, VitrSmer
   SrazkyDen
   TlakRel
   UVindex
   SlunZareni
   TeplotaVnitrni, VlhkostVnitrni
   webcam_url
   min_temp_24h, max_temp_24h

## 🧹 Changelog
1.0.0
   První veřejná verze
   Moderní UI přizpůsobené Home Assistantu
   Podpora webkamery
   Podpora doplňkových čidel
   Sekce pro grafy
   HACS-ready balíček

## 🤝 Podpora
Pokud narazíte na problém, vytvořte issue:

https://github.com/DavidPik/pocasimeteo-card/issues (github.com in Bing)

## 📄 Licence
MIT License
© 2026 David Pikál
