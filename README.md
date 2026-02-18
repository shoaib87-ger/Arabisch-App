# Dr. Shoaibs Lern-App

Deutsch-Arabisch Lernkarten App mit OCR, Quiz, Quran-Reader und Qibla-Finder.

## Projektstruktur

```
/web        → Komplette PWA (statische Dateien, Quelle)
/app        → Capacitor iOS Wrapper
  /ios      → Xcode Projekt
  /www      → Kopie von /web (generiert, nicht editieren!)
/tools      → Build-Scripts
```

---

## Web lokal starten (Entwicklung)

```bash
cd web
python -m http.server 3000
# oder: npx -y serve . -l 3000
```

Öffne http://localhost:3000

---

## iOS App bauen

### Voraussetzungen
- **Node.js** (LTS) + npm
- **Xcode** 15+ (nur auf macOS)
- Apple Developer Account (für App Store)

### Workflow

```bash
# 1. Abhängigkeiten installieren (einmalig)
cd app
npm install

# 2. Web-Dateien kopieren → /app/www
npm run copy
# (oder: node ../tools/copy-web-to-app.js)

# 3. iOS Projekt synchronisieren
npm run sync
# (oder: npx cap sync ios)

# 4. Xcode öffnen
npm run open
# (oder: npx cap open ios)

# 5. In Xcode: Build & Run (⌘+R)
```

### Kurzform (alles in einem)

```bash
cd app
npm run build    # copy + sync
npm run open     # Xcode öffnen
```

### Nach Änderungen in /web

> **Wichtig:** Nach jeder Änderung in `/web` muss copy+sync ausgeführt werden, damit die iOS App die aktualisierten Dateien erhält.

```bash
cd app
npm run build    # copy + sync
# dann in Xcode: ⌘+R
```

---

## Offline-Fähigkeit

- **Browser (PWA):** Service Worker cached alle Assets für Offline-Nutzung
- **iOS App:** Alle Dateien sind in die App eingebettet — SW wird automatisch deaktiviert
- **Quran PDF:** 3 Split-PDFs (~50MB gesamt), direkt in der App enthalten

---

## iOS Permissions

| Feature | Permission | Beschreibung |
|---------|-----------|--------------|
| OCR | Kamera | Texterkennung aus Lehrbuchseiten |
| Import | Fotos | Import von Lehrbuchseiten |
| Qibla | Standort | Berechnung der Qibla-Richtung |
| Qibla | Kompass | Qibla-Richtungsanzeige |
