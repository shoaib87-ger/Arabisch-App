# 📱 iOS App bauen — Schritt-für-Schritt Anleitung

> Diese Anleitung ist für Anfänger. Folge jeden Schritt der Reihe nach.
> Du brauchst einen Mac mit macOS 14+ (Sonoma oder neuer).

---

## Phase 1: Mac vorbereiten (einmalig)

### Schritt 1: Xcode installieren

1. Öffne den **App Store** auf deinem Mac
2. Suche nach **"Xcode"**
3. Klicke auf **"Laden"** (ca. 12 GB Download — dauert!)
4. Warte bis die Installation fertig ist
5. **Öffne Xcode einmal** → es installiert zusätzliche Komponenten → "Install" klicken
6. Akzeptiere die Lizenzvereinbarung

> ⚠️ Das dauert beim ersten Mal 30-60 Minuten. Mach dir einen Tee ☕

---

### Schritt 2: Node.js installieren

1. Öffne **Safari** und gehe zu: https://nodejs.org
2. Klicke auf den großen grünen Button **"LTS"** (die linke Version)
3. Lade die `.pkg` Datei herunter
4. Doppelklicke auf die heruntergeladene Datei
5. Folge dem Installer (immer "Weiter" klicken)
6. **Prüfen ob es geklappt hat:**
   - Öffne das **Terminal** (Spotlight: ⌘+Leertaste → "Terminal" tippen → Enter)
   - Tippe ein und drücke Enter:
     ```
     node -v
     ```
   - Es sollte sowas wie `v24.13.1` anzeigen ✅

---

### Schritt 3: Apple Developer Account (für App Store)

> Wenn du die App nur im Simulator testen willst, brauchst du KEIN Developer Account.
> Für echtes iPhone oder App Store brauchst du einen.

1. Gehe zu https://developer.apple.com
2. Melde dich mit deiner Apple ID an
3. Für den App Store: Developer Program beitreten (99€/Jahr)
4. Für nur Simulator-Test: Kostenlos, deine normale Apple ID reicht

---

## Phase 2: Projekt auf den Mac kopieren

### Schritt 4: Den ganzen Ordner kopieren

1. Auf deinem **Windows PC**:
   - Gehe zu: `C:\Users\Home\.gemini\antigravity\scratch\Iphone APP\Arabisch-APP`
   - Kopiere den **gesamten Ordner `Arabisch-APP`** auf einen USB-Stick
   - (Oder nutze Google Drive, iCloud, AirDrop, etc.)

2. Auf deinem **Mac**:
   - Kopiere den Ordner nach: `~/Desktop/Arabisch-APP`
   - (Also auf den Schreibtisch)

---

## Phase 3: App bauen

### Schritt 5: Terminal öffnen

1. Drücke **⌘ + Leertaste** (Spotlight)
2. Tippe **"Terminal"**
3. Drücke **Enter**

Ein schwarzes/weißes Fenster öffnet sich — das ist das Terminal.

---

### Schritt 6: In den App-Ordner navigieren

Tippe diesen Befehl ein und drücke Enter:

```
cd ~/Desktop/Arabisch-APP/app
```

> 💡 Tipp: Du kannst den Ordner auch aus dem Finder ins Terminal ziehen, dann wird der Pfad automatisch eingefügt.

---

### Schritt 7: Abhängigkeiten installieren (einmalig)

Tippe ein und drücke Enter:

```
npm install
```

Du siehst viel Text scrollen — das ist normal.
Warte bis es fertig ist (ca. 30 Sekunden).

Es sollte am Ende so aussehen:
```
added XX packages in Xs
```

✅ Fertig!

---

### Schritt 8: Web-Dateien in die App kopieren

Tippe ein und drücke Enter:

```
npm run copy
```

Es sollte anzeigen:
```
✅ Copied 32 files: /web → /app/www
```

---

### Schritt 9: iOS Projekt synchronisieren

Tippe ein und drücke Enter:

```
npm run sync
```

Warte bis es fertig ist. Es werden einige Zeilen mit ✔ angezeigt.

---

### Schritt 10: Xcode öffnen

Tippe ein und drücke Enter:

```
npm run open
```

**Xcode öffnet sich automatisch** mit deinem iOS-Projekt! 🎉

---

## Phase 4: In Xcode testen und bauen

### Schritt 11: Simulator auswählen

1. Oben links in Xcode siehst du: **"App"** und daneben ein Gerät
2. Klicke auf das Gerät (z.B. "Any iOS Device")
3. Wähle **"iPhone 15"** oder **"iPhone 16"** aus der Liste

---

### Schritt 12: App starten (Simulator)

1. Drücke **⌘ + R** (oder den ▶️ Play-Button oben links)
2. Xcode kompiliert die App (erste Mal dauert 1-2 Minuten)
3. Der **iPhone Simulator** öffnet sich
4. Deine App startet! 📱

> Wenn ein Fehler kommt: Lies die rote Fehlermeldung. Meistens hilft:
> - **Product → Clean Build Folder** (⇧⌘K)
> - Dann nochmal ⌘+R

---

### Schritt 13: Auf echtem iPhone testen (optional)

1. Verbinde dein iPhone per **USB-Kabel** mit dem Mac
2. Entsperre dein iPhone und tippe "Vertrauen"
3. In Xcode: Wähle oben dein iPhone als Ziel (statt Simulator)
4. Du musst in Xcode dein **Apple Developer Team** einstellen:
   - Klicke links auf **"App"** (blaues Icon)
   - Tab **"Signing & Capabilities"**
   - Bei **Team**: Wähle deine Apple ID aus
   - Bei **Bundle Identifier**: Lass `com.drshoaib.arabischapp`
5. Drücke **⌘ + R**
6. Beim ersten Mal auf dem iPhone:
   - Gehe auf dem iPhone zu **Einstellungen → Allgemein → VPN & Geräteverwaltung**
   - Tippe auf dein Entwicklerprofil → **"Vertrauen"**
7. Starte die App nochmal

---

## Phase 5: App Store (wenn du so weit bist)

> Das ist der komplizierteste Teil. Mach erst Phase 1-4 fertig!

### Schritt 14: App Store Vorbereitung

1. Gehe zu https://appstoreconnect.apple.com
2. Erstelle eine **neue App**:
   - Name: "Dr. Shoaibs Lern-App"
   - Bundle ID: `com.drshoaib.arabischapp`
   - Sprache: Deutsch
3. In Xcode:
   - **Product → Archive**
   - Im Organizer: **"Distribute App"** klicken
   - Folge den Anweisungen

---

## ❓ Häufige Probleme

### "Command not found: node"
→ Node.js wurde nicht richtig installiert. Nochmal Schritt 2 machen.

### "No such file or directory"
→ Du bist im falschen Ordner. Überprüfe mit `pwd` wo du bist.

### Xcode zeigt rote Fehler
→ Versuche: **Product → Clean Build Folder** (⇧⌘K), dann nochmal ⌘+R

### "Code Signing" Fehler
→ Du musst ein Team auswählen (Schritt 13, Punkt 4).

---

## 🔄 Nach Änderungen am Code

Wenn du Dateien in `/web` änderst, musst du diese Befehle im Terminal ausführen:

```
cd ~/Desktop/Arabisch-APP/app
npm run build
```

Dann in Xcode: **⌘ + R** um neu zu starten.

---

## 📋 Kurzübersicht (Spickzettel)

```
cd ~/Desktop/Arabisch-APP/app
npm install          ← einmalig
npm run build        ← nach jeder Code-Änderung
npm run open         ← öffnet Xcode
                     ← dann ⌘+R in Xcode
```
