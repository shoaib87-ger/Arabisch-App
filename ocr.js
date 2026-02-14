/**
 * ocr.js — OCR-Pipeline mit 2-Spalten Layout-Analyse
 * 
 * ARCHITEKTUR:
 * 1. Gemini Vision API (primary) — versteht Layout nativ
 * 2. Tesseract.js + Bounding-Box Analyse (fallback) — spaltenbasierte Extraktion
 * 
 * KERNPROBLEM (gelöst):
 * Tesseract gibt bei 2-Spalten-Layout (AR links | DE rechts) den Text
 * zeilenweise gemischt zurück. Einfaches "Zeile splitten" schlägt fehl weil:
 * - RTL + LTR Text wird in falscher Reihenfolge zusammengeführt
 * - Tesseract merged manchmal Spalten zu einer Zeile
 * - Manchmal wird Spalte 1 komplett vor Spalte 2 gelesen
 * 
 * LÖSUNG:
 * Word-Level Bounding Boxes → X-Clustering → Y-Matching
 */

// ===== KONFIGURATION =====
const OCR_CONFIG = {
    geminiApiKey: 'AIzaSyDD3Eyb10Tuc2GSwZxF27UWnhu7TNAmvlM',
    useGemini: true,
    geminiModel: 'gemini-2.0-flash',
    tesseractLangs: 'deu+ara',
    // Toleranz für Y-Matching (Pixel) — Wörter in gleicher "Zeile"
    rowTolerancePx: 30,
};

// ===== TESSERACT WORKER (Singleton) =====
let _tesseractWorker = null;

async function getTesseractWorker() {
    if (_tesseractWorker) return _tesseractWorker;

    console.log('⚙️ Erstelle Tesseract Worker (Singleton)...');
    _tesseractWorker = await Tesseract.createWorker(OCR_CONFIG.tesseractLangs, 1, {
        logger: m => {
            if (m.status === 'recognizing text') {
                console.log(`🔍 Tesseract: ${Math.round(m.progress * 100)}%`);
            }
        },
        cacheMethod: 'write',
    });

    // PSM 6 = "Assume a single uniform block of text"
    // Besser als PSM 4 (single column) für Tabellen-Layouts,
    // weil PSM 6 die Zeilen-Reihenfolge besser beibehält.
    // Die Spalten-Trennung machen wir selbst via Bounding Boxes.
    await _tesseractWorker.setParameters({
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1',
        // KEIN char_whitelist — bricht Arabisch-Ligaturen!
    });

    console.log('✅ Tesseract Worker bereit (PSM 6)');
    return _tesseractWorker;
}

async function terminateTesseractWorker() {
    if (_tesseractWorker) {
        await _tesseractWorker.terminate();
        _tesseractWorker = null;
        console.log('🧹 Tesseract Worker beendet');
    }
}

// =========================================================================
//  GEMINI OCR (Primary — versteht Layout nativ)
// =========================================================================
const GeminiOCR = {
    async recognize(fileOrBlob, progressCallback) {
        progressCallback('🤖 Starte Gemini AI...', 20);

        const base64 = await this._toBase64(fileOrBlob);
        const mimeType = fileOrBlob.type || 'image/png';

        progressCallback('📤 Sende an Gemini...', 40);

        // Prompt für 2-Spalten Vokabellisten — BEIDE Richtungen + VOLLE TASHKĪL
        const prompt = `Du bist ein Experte für arabische Linguistik, Grammatik (Nahw/Sarf) und OCR.

BILD-LAYOUT:
Das Bild zeigt eine Vokabelliste mit 2 Spalten (Arabisch + Deutsch).
Layout kann sein: AR links | DE rechts ODER DE links | AR rechts.
Erkenne automatisch welche Spalte welche Sprache ist.

AUFGABE — 2 SCHRITTE:

SCHRITT 1: Lies den arabischen Text GENAU so wie er im Bild steht.
SCHRITT 2: Ergänze VOLLSTÄNDIGE Tashkīlāt (Vokalisierung) nach arabischer Grammatik:
- Fatha (فَتْحَة) auf jeden relevanten Buchstaben
- Damma (ضَمَّة) auf jeden relevanten Buchstaben
- Kasra (كَسْرَة) auf jeden relevanten Buchstaben
- Sukun (سُكُون) auf JEDEN konsonantischen Buchstaben ohne Vokal
- Shadda (شَدَّة) bei Gemination
- Tanwīn (تَنْوِين) bei unbestimmten Nomen im Satzende

REGELN:
1. Arabisch: VOLL VOKALISIERT ausgeben — JEDER Buchstabe bekommt sein Zeichen
   Beispiel: أَكَلَ ه statt اكله  |  اِشْتَرَى statt اشترى
2. Wenn im Bild bereits Tashkeel steht: übernehmen UND fehlende ergänzen
3. Pronomen-Suffixe (ه، ها، هم) gehören zum Wort und werden MIT vokalisiert
4. Deutsch: Verb + Ergänzung zusammen (z.B. "geben jm. etwas", "kaufen etwas")
5. Deutsch: Verben klein, Nomen groß
6. Trennlinien, Rahmen, Seitenzahlen ignorieren
7. IMMER Deutsch in "de" und Arabisch in "ar"!

FORMAT — NUR ein JSON-Array, KEIN anderer Text:
[
  {"de": "glauben an Allah", "ar": "آمَنَ بِاللّهِ"},
  {"de": "nehmen etwas", "ar": "أَخَذَهُ"},
  {"de": "geben jm. etwas", "ar": "أَعْطَاهُ"},
  {"de": "antworten jm.", "ar": "أَجَابَهُ"},
  {"de": "essen etwas", "ar": "أَكَلَهُ"},
  {"de": "kaufen etwas", "ar": "اِشْتَرَاهُ"},
  {"de": "aufwachen", "ar": "اِسْتَيْقَظَ"}
]`;

        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${OCR_CONFIG.geminiModel}:generateContent?key=${OCR_CONFIG.geminiApiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: prompt },
                                { inline_data: { mime_type: mimeType, data: base64 } }
                            ]
                        }],
                        generationConfig: {
                            temperature: 0.1,
                            maxOutputTokens: 4096
                        }
                    })
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Gemini API Error:', response.status, errorText);
                if (response.status === 429) throw new Error('Rate-Limit erreicht. Bitte warte 1 Minute.');
                if (response.status === 403) throw new Error('API-Key ungültig oder deaktiviert.');
                throw new Error(`Gemini API Fehler: ${response.status}`);
            }

            progressCallback('🧠 Gemini analysiert...', 70);
            const data = await response.json();

            if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
                console.error('❌ Gemini: Leere Antwort', data);
                throw new Error('Gemini gab keine Ergebnisse zurück.');
            }

            const text = data.candidates[0].content.parts[0].text;
            console.log('📝 Gemini Response:', text.substring(0, 400));

            progressCallback('📋 Verarbeite Ergebnisse...', 90);

            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                console.error('❌ Kein JSON in Antwort:', text);
                throw new Error('Gemini konnte keine Wortpaare erkennen.');
            }

            const words = JSON.parse(jsonMatch[0]);

            // Validieren, bereinigen und Unicode normalisieren (NFC)
            const validWords = words
                .filter(w => w && w.de && w.ar && w.de.trim().length >= 2)
                .map(w => ({
                    de: w.de.trim().normalize('NFC'),
                    ar: w.ar.trim().normalize('NFC'),  // NFC = korrekte Komposition von Tashkeel
                    ex: (w.ex || '').trim()
                }));

            console.log(`✅ Gemini: ${validWords.length} Wortpaare erkannt`);
            return validWords;

        } catch (error) {
            console.error('❌ Gemini OCR Error:', error);
            throw error;
        }
    },

    _toBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
};

// =========================================================================
//  TESSERACT OCR MIT BOUNDING-BOX LAYOUT-ANALYSE (Fallback)
// =========================================================================
const TesseractOCR = {
    async recognize(fileOrBlob, progressCallback) {
        progressCallback('⚙️ Starte Tesseract...', 20);
        const worker = await getTesseractWorker();

        progressCallback('🔍 Erkenne Text mit Positionsdaten...', 40);

        // ===== SCHRITT 1: Word-Level Daten holen (NICHT nur Text!) =====
        const result = await worker.recognize(fileOrBlob);
        const words = result.data.words;  // Array mit Bounding Boxes!

        console.log(`📊 Tesseract: ${words.length} Wörter mit Bounding Boxes erkannt`);

        if (!words || words.length === 0) {
            console.warn('⚠️ Keine Wörter erkannt');
            return [];
        }

        progressCallback('📐 Analysiere Spalten-Layout...', 60);

        // ===== SCHRITT 2: Bounding Boxes loggen =====
        this._logBoundingBoxes(words);

        // ===== SCHRITT 3: Spalten erkennen via X-Clustering =====
        const columns = this._detectColumns(words);
        if (!columns) {
            console.warn('⚠️ Spalten-Erkennung fehlgeschlagen, Fallback auf Textmodus');
            progressCallback('📋 Extrahiere Wörter (Textmodus)...', 80);
            return WordExtractor.extract(result.data.text);
        }

        progressCallback('🔗 Matche Wortpaare nach Position...', 75);

        // ===== SCHRITT 4: Wörter in Zeilen gruppieren =====
        const rows = this._groupIntoRows(words, columns);

        // ===== SCHRITT 5: Wortpaare bilden =====
        progressCallback('📋 Erstelle Wortpaare...', 90);
        const pairs = this._buildPairs(rows, columns);

        console.log(`✅ Tesseract: ${pairs.length} Wortpaare via Layout-Analyse`);
        return pairs;
    },

    /**
     * Debug: Bounding Boxes visualisieren
     */
    _logBoundingBoxes(words) {
        console.log('📐 === BOUNDING BOX ANALYSE ===');
        words.forEach((w, i) => {
            const bbox = w.bbox;
            console.log(
                `  [${i}] "${w.text}" ` +
                `x: ${bbox.x0}-${bbox.x1} (center: ${Math.round((bbox.x0 + bbox.x1) / 2)}) ` +
                `y: ${bbox.y0}-${bbox.y1} (center: ${Math.round((bbox.y0 + bbox.y1) / 2)}) ` +
                `conf: ${w.confidence.toFixed(1)}%`
            );
        });
    },

    /**
     * SCHRITT 3: Spalten erkennen via X-Koordinaten Clustering
     * 
     * Algorithmus:
     * 1. Berechne X-Mittelpunkte aller Wörter
     * 2. Sortiere nach X
     * 3. Finde den größten "Gap" in der X-Verteilung → das ist die Spaltengrenze
     * 4. Alles links = Spalte A (Arabisch), rechts = Spalte B (Deutsch)
     */
    _detectColumns(words) {
        if (words.length < 2) return null;

        // X-Mittelpunkte sammeln
        const xCenters = words.map(w => ({
            xCenter: (w.bbox.x0 + w.bbox.x1) / 2,
            width: w.bbox.x1 - w.bbox.x0,
            word: w
        }));

        // Sortiere nach X-Position
        xCenters.sort((a, b) => a.xCenter - b.xCenter);

        // Finde den größten Gap zwischen aufeinanderfolgenden X-Werten
        let maxGap = 0;
        let gapIndex = -1;
        let splitX = 0;

        for (let i = 1; i < xCenters.length; i++) {
            const gap = xCenters[i].xCenter - xCenters[i - 1].xCenter;
            if (gap > maxGap) {
                maxGap = gap;
                gapIndex = i;
                splitX = (xCenters[i - 1].xCenter + xCenters[i].xCenter) / 2;
            }
        }

        // Gap muss signifikant sein (mind. 15% der Bildbreite)
        const imageWidth = Math.max(...words.map(w => w.bbox.x1));
        const minGap = imageWidth * 0.08;

        console.log(`📐 Spalten-Analyse: maxGap=${maxGap.toFixed(0)}px, splitX=${splitX.toFixed(0)}px, imageWidth=${imageWidth}px, minGap=${minGap.toFixed(0)}px`);

        if (maxGap < minGap) {
            console.warn('⚠️ Kein klarer Spaltenzwischenraum erkannt');
            return null;
        }

        // Bestimme welche Spalte Arabisch und welche Deutsch ist
        const leftWords = words.filter(w => (w.bbox.x0 + w.bbox.x1) / 2 < splitX);
        const rightWords = words.filter(w => (w.bbox.x0 + w.bbox.x1) / 2 >= splitX);

        // Prüfe welche Seite Arabisch enthält
        const leftHasArabic = this._hasArabic(leftWords);
        const rightHasArabic = this._hasArabic(rightWords);

        let arabicSide, germanSide;
        if (leftHasArabic && !rightHasArabic) {
            arabicSide = 'left';
            germanSide = 'right';
        } else if (rightHasArabic && !leftHasArabic) {
            arabicSide = 'right';
            germanSide = 'left';
        } else {
            // Beide Seiten haben Arabisch oder keine → Heuristik: links = Arabisch
            arabicSide = 'left';
            germanSide = 'right';
        }

        console.log(`📐 Spalten erkannt: Arabisch=${arabicSide}, Deutsch=${germanSide}, Split bei X=${splitX.toFixed(0)}px`);

        return { splitX, arabicSide, germanSide };
    },

    /**
     * Prüfe ob Wort-Array arabische Zeichen enthält
     */
    _hasArabic(words) {
        const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
        return words.some(w => arabicRegex.test(w.text));
    },

    /**
     * SCHRITT 4: Wörter in Zeilen gruppieren via Y-Position
     * 
     * Algorithmus:
     * 1. Sortiere alle Wörter nach Y-Mittelpunkt
     * 2. Gruppiere Wörter die innerhalb von TOLERANCE_PX liegen
     * 3. Jede Gruppe = eine "Zeile" im Layout
     */
    _groupIntoRows(words, columns) {
        // Sortiere nach Y-Position
        const sorted = [...words].sort((a, b) => {
            const yA = (a.bbox.y0 + a.bbox.y1) / 2;
            const yB = (b.bbox.y0 + b.bbox.y1) / 2;
            return yA - yB;
        });

        // Dynamische Toleranz: basierend auf durchschnittlicher Wort-Höhe
        const avgHeight = words.reduce((sum, w) => sum + (w.bbox.y1 - w.bbox.y0), 0) / words.length;
        const tolerance = Math.max(OCR_CONFIG.rowTolerancePx, avgHeight * 0.6);
        console.log(`📏 Row-Toleranz: ${tolerance.toFixed(0)}px (Ø Wort-Höhe: ${avgHeight.toFixed(0)}px)`);

        const rows = [];
        let currentRow = [sorted[0]];
        let currentRowY = (sorted[0].bbox.y0 + sorted[0].bbox.y1) / 2;

        for (let i = 1; i < sorted.length; i++) {
            const wordY = (sorted[i].bbox.y0 + sorted[i].bbox.y1) / 2;

            if (Math.abs(wordY - currentRowY) <= tolerance) {
                // Gleiche Zeile
                currentRow.push(sorted[i]);
            } else {
                // Neue Zeile
                rows.push(currentRow);
                currentRow = [sorted[i]];
                currentRowY = wordY;
            }
        }
        rows.push(currentRow); // Letzte Zeile

        console.log(`📋 ${rows.length} Zeilen erkannt`);
        rows.forEach((row, i) => {
            const texts = row.map(w => `"${w.text}"`).join(', ');
            const avgY = row.reduce((s, w) => s + (w.bbox.y0 + w.bbox.y1) / 2, 0) / row.length;
            console.log(`  Zeile ${i + 1} (Y≈${avgY.toFixed(0)}): ${texts}`);
        });

        return rows;
    },

    /**
     * SCHRITT 5: Wortpaare bilden
     * 
     * Für jede Zeile:
     * 1. Trenne Wörter in linke/rechte Spalte (anhand splitX)
     * 2. Konkateniere alle Wörter pro Spalte
     * 3. Weise Arabisch/Deutsch zu
     * 4. Erstelle Wortpaar
     */
    _buildPairs(rows, columns) {
        const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
        const pairs = [];

        for (const row of rows) {
            // Trenne in linke und rechte Spalte
            const leftWords = [];
            const rightWords = [];

            for (const word of row) {
                const xCenter = (word.bbox.x0 + word.bbox.x1) / 2;
                if (xCenter < columns.splitX) {
                    leftWords.push(word);
                } else {
                    rightWords.push(word);
                }
            }

            // Sortiere innerhalb jeder Spalte nach X-Position
            // Links (Arabisch RTL): Sortierung ist egal für Konkatenierung,
            // Tesseract gibt RTL-Text bereits in Leserichtung aus
            leftWords.sort((a, b) => a.bbox.x0 - b.bbox.x0);
            rightWords.sort((a, b) => a.bbox.x0 - b.bbox.x0);

            const leftText = leftWords.map(w => w.text).join(' ').trim();
            const rightText = rightWords.map(w => w.text).join(' ').trim();

            // Überspringe leere Zeilen
            if (!leftText && !rightText) continue;
            if (!leftText || !rightText) {
                console.log(`  ⚠️ Unvollständige Zeile: links="${leftText}" rechts="${rightText}"`);
                continue;
            }

            // Weise AR/DE zu basierend auf erkanntem Layout
            let arText, deText;
            if (columns.arabicSide === 'left') {
                arText = leftText;
                deText = rightText;
            } else {
                arText = rightText;
                deText = leftText;
            }

            // Zusätzliche Validierung: prüfe ob die Zuweisung stimmt
            const arHasArabic = arabicRegex.test(arText);
            const deHasArabic = arabicRegex.test(deText);

            if (!arHasArabic && deHasArabic) {
                // Spalten vertauscht → korrigieren
                console.log(`  🔄 Spalten-Swap: "${arText}" ↔ "${deText}"`);
                [arText, deText] = [deText, arText];
            }

            // Bereinige Deutsch
            deText = deText
                .replace(/[^a-zäöüßA-ZÄÖÜ\s\-\.]/g, '')
                .replace(/\s+/g, ' ')
                .trim();

            if (deText.length >= 2 && arText.length > 0) {
                pairs.push({ de: deText, ar: arText, ex: '' });
                console.log(`  ✅ Paar: "${deText}" ↔ "${arText}"`);
            }
        }

        // Duplikate entfernen
        const seen = new Set();
        return pairs.filter(p => {
            const key = p.de.toLowerCase() + '|' + p.ar;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
};

// =========================================================================
//  WORT-EXTRAKTION AUS ROHTEXT (Fallback wenn keine Bounding Boxes)
// =========================================================================
const WordExtractor = {
    ARABIC_PATTERN: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0610-\u061A\u064B-\u065F]+(?:\s[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0610-\u061A\u064B-\u065F]+)*/g,
    GERMAN_PATTERN: /[a-zäöüßA-ZÄÖÜ][a-zäöüß]+(?:\s(?:sich|auf|an|aus|ein|ab|zu|mit|vor|nach|über|unter|um|durch|jm|etwas)[a-zäöüß.]*)?/g,

    extract(text) {
        console.log('🔍 Wort-Extraktion (Textmodus-Fallback)');

        const cleanedText = text
            .replace(/\|/g, ' ')
            .replace(/[→←⇒⇐=:;\/\\]/g, ' ')
            .replace(/\d+\./g, '')
            .replace(/\s+/g, ' ')
            .trim();

        const lines = cleanedText.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 1);

        const detectedWords = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];
            this.ARABIC_PATTERN.lastIndex = 0;
            this.GERMAN_PATTERN.lastIndex = 0;

            const arabicMatches = line.match(this.ARABIC_PATTERN);
            const germanMatches = line.match(this.GERMAN_PATTERN);

            if (germanMatches && arabicMatches) {
                const deWord = germanMatches.join(' ').trim();
                const arWord = arabicMatches.join(' ').trim();
                if (deWord.length >= 2 && arWord.length > 0) {
                    detectedWords.push({ de: deWord, ar: arWord, ex: '' });
                }
                i++;
            } else if (germanMatches && !arabicMatches && i + 1 < lines.length) {
                const nextArabic = lines[i + 1].match(this.ARABIC_PATTERN);
                if (nextArabic) {
                    detectedWords.push({ de: germanMatches.join(' ').trim(), ar: nextArabic.join(' ').trim(), ex: '' });
                    i += 2; continue;
                }
                i++;
            } else if (arabicMatches && !germanMatches && i + 1 < lines.length) {
                this.GERMAN_PATTERN.lastIndex = 0;
                const nextGerman = lines[i + 1].match(this.GERMAN_PATTERN);
                if (nextGerman) {
                    detectedWords.push({ de: nextGerman.join(' ').trim(), ar: arabicMatches.join(' ').trim(), ex: '' });
                    i += 2; continue;
                }
                i++;
            } else {
                i++;
            }
        }

        // Duplikate entfernen
        const seen = new Set();
        return detectedWords.filter(w => {
            const key = w.de.toLowerCase() + '|' + w.ar;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
};

// =========================================================================
//  HAUPT-OCR-FUNKTION
//
//  DUAL-PIPELINE:
//  - originalBlob: Farbbild → Gemini (versteht Farben/Layout nativ)
//  - processedBlob: Binarisiert → Tesseract (braucht hohen Kontrast)
//  - Wenn nur ein Blob übergeben wird (z.B. aus PDF), wird er für beides verwendet
// =========================================================================
async function performOCR(originalBlob, processedBlobOrCallback, progressCallback) {
    // Kompatibilität: performOCR(blob, callback) — z.B. aus PDF-Handler
    let processedBlob;
    if (typeof processedBlobOrCallback === 'function') {
        progressCallback = processedBlobOrCallback;
        processedBlob = originalBlob; // Gleicher Blob für beide
    } else {
        processedBlob = processedBlobOrCallback;
    }

    if (OCR_CONFIG.useGemini) {
        try {
            // Gemini bekommt das ORIGINAL-Farbbild (kein Thresholding!)
            return await GeminiOCR.recognize(originalBlob, progressCallback);
        } catch (error) {
            console.warn('⚠️ Gemini fehlgeschlagen, Fallback auf Tesseract:', error.message);
            progressCallback('⚠️ Gemini-Fehler, nutze Tesseract...', 30);
            // Tesseract bekommt das PREPROCESSED Bild (Graustufen + Binarisiert)
            return await TesseractOCR.recognize(processedBlob, progressCallback);
        }
    } else {
        // Nur Tesseract → preprocessed Bild verwenden
        return await TesseractOCR.recognize(processedBlob, progressCallback);
    }
}
