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
  - aktuální údaje o tlaku, věru a srážkách
  - Sekce s grafy (teplota, vlhkost, tlak, vítr, srážky, sluneční záření, ...)
  - V každém grafu vyznačené Min, Max
  - V grafu pro směr větru vyznačené Average, Modus a Variance
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
Karta PočasíMeteo Card podporuje jeden povinný parametr a několik volitelných parametrů, které umožňují přizpůsobit zobrazení podle potřeby.

Karta se používá jako:

```yaml
type: custom:pocasimeteo-card
entity: weather.pocasimeteo
```

### Povinné parametry

| Parametr	| Typ	| Popis  |
| ---  | ---  | ---  |
| entity	| string	| Entita poskytovaná backendovou integrací PočasíMeteo (např. weather.pocasimeteo).  |

### Volitelné parametry

| Parametr	| Typ  | Výchozí hodnota  | Popis  |
| ---  | ---  | ---  | ---  |
| show_graphs  | boolean	| true	| Umožňuje vypnout vykreslování grafů. Pokud je false, karta zobrazí pouze aktuální hodnoty bez historických grafů.  |
| hide_sensors	| list(string)	| []	| Seznam suffixů senzorů, které se nemají zobrazovat. Hodnoty musí odpovídat názvům v VALID_SENSORS (např. ["pm1", "pm2"]).  |

### Příklad s volitelnými parametry
```yaml
type: custom:pocasimeteo-card
entity: weather.pocasimeteo
show_graphs: true
hide_sensors:
  - pm1
  - pm2
  - co2
```

### 📝 Poznámky
Hodnoty v hide_sensors musí přesně odpovídat suffixům senzorů, které karta získává z backendu (viz VALID_SENSORS v kódu).

Parametr show_graphs ovlivňuje pouze sekci grafů — aktuální hodnoty se zobrazují vždy.

## 🔧 Požadavky
Home Assistant 2025.12 nebo novější

Integrace PočasíMeteo (davidpik/pocasimeteo)

Webová meteostanice PočasíMeteo.cz s platným API klíčem

## 🧩 Jak karta funguje
Karta načítá data z entity: weather.<název_stanice>

A zobrazuje:

 - TeplotaVnejsi
 - VlhkostVnejsi
 - Vitr, VitrNarazy, VitrSmer
 - SrazkyDen
 - TlakRel
 - UVindex
 - SlunZareni
 - TeplotaVnitrni, VlhkostVnitrni
   
Ke každému senzoru komponenta počítá Min a Max za posledních 24 hodin, s výjimkou senzoru VitrSmer, ke kterému počítá Average, Modus a Variance.

## 🧹 Changelog
6.2.40
   První veřejná verze
   Moderní UI přizpůsobené Home Assistantu
   Podpora doplňkových čidel
   Sekce pro grafy
   Možnost vypnout nechtěné grafy
   HACS-ready balíček

## 🤝 Podpora
Pokud narazíte na problém, vytvořte issue:

https://github.com/DavidPik/pocasimeteo-card/issues (github.com in Bing)

## 📄 Licence
MIT License
© 2026 David Pikál
