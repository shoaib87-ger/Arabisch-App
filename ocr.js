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
    geminiApiKey: 'AIzaSyC49Z6P12bmiitamq0Y1npA5ieLbJ5DRM0',
    useGemini: true,
    // gemini-2.0-flash-lite hat höhere Free-Tier Limits!
    geminiModels: ['gemini-2.0-flash-lite', 'gemini-2.0-flash'],
    apiVersions: ['v1beta'],
    // Retry-Backoff bei Rate-Limit (Sekunden): 10s → 20s → 40s
    retryBackoffSec: 10,
    maxRetries: 3,
    tesseractLangs: 'deu+ara',
    rowTolerancePx: 30,
    // Minimum Confidence für Tesseract Bounding Boxes (0-100)
    minConfidence: 40,
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
    await _tesseractWorker.setParameters({
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1',
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
//  GEMINI OCR — Auto-Model-Discovery mit Fallback-Chain
// =========================================================================
const GeminiOCR = {
    _workingModel: null,  // Caches working model name
    _workingApiVersion: null,

    async recognize(fileOrBlob, progressCallback) {
        progressCallback('🤖 Starte Gemini AI...', 20);

        const base64 = await this._toBase64(fileOrBlob);
        const mimeType = fileOrBlob.type || 'image/png';
        console.log(`📦 Gemini Payload: ${(base64.length * 0.75 / 1024).toFixed(0)} KB, MIME: ${mimeType}`);

        progressCallback('📤 Sende an Gemini...', 40);

        const prompt = this._buildPrompt();

        // Wenn wir schon ein funktionierendes Modell kennen → direkt nutzen (mit Retry)
        if (this._workingModel) {
            console.log(`🤖 Nutze cached Modell: ${this._workingModel} (${this._workingApiVersion})`);
            return await this._callWithRetry(this._workingApiVersion, this._workingModel, base64, mimeType, prompt, progressCallback);
        }

        // Sonst: Alle Kombinationen durchprobieren
        const errors = [];
        for (const apiVersion of OCR_CONFIG.apiVersions) {
            for (const model of OCR_CONFIG.geminiModels) {
                try {
                    console.log(`🔄 Versuche: ${apiVersion}/${model}...`);
                    const result = await this._callWithRetry(apiVersion, model, base64, mimeType, prompt, progressCallback);
                    // Erfolg! Merke dir dieses Modell
                    this._workingModel = model;
                    this._workingApiVersion = apiVersion;
                    console.log(`✅ Funktionierendes Modell gefunden: ${apiVersion}/${model}`);
                    return result;
                } catch (error) {
                    console.warn(`  ❌ ${apiVersion}/${model}: ${error.message}`);
                    errors.push(`${model}: ${error.message}`);
                    if (error.message.includes('API-Key')) throw error;
                    // Bei Rate-Limit: nächstes Modell probieren (vielleicht hat ein anderes noch Quota)
                }
            }
        }

        throw new Error(`Alle Gemini-Modelle fehlgeschlagen:\n${errors.join('\n')}`);
    },

    /**
     * Retry mit Exponential Backoff bei 429 Rate-Limit
     * Wartet: 10s → 20s → 40s (konfigurierbar)
     */
    async _callWithRetry(apiVersion, model, base64, mimeType, prompt, progressCallback) {
        const maxRetries = OCR_CONFIG.maxRetries;
        let lastError;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await this._callGemini(apiVersion, model, base64, mimeType, prompt, progressCallback);
            } catch (error) {
                lastError = error;
                if (error.message.includes('Rate-Limit') && attempt < maxRetries - 1) {
                    const waitSec = OCR_CONFIG.retryBackoffSec * Math.pow(2, attempt);
                    console.log(`⏳ Rate-Limit! Warte ${waitSec}s... (Versuch ${attempt + 2}/${maxRetries})`);
                    // Countdown anzeigen
                    for (let s = waitSec; s > 0; s--) {
                        progressCallback(`⏳ Rate-Limit — noch ${s}s warten...`, 45 + attempt * 5);
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    progressCallback(`🔄 Retry ${attempt + 2}/${maxRetries}...`, 50 + attempt * 5);
                } else {
                    throw error;
                }
            }
        }
        throw lastError;
    },

    async _callGemini(apiVersion, model, base64, mimeType, prompt, progressCallback) {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${OCR_CONFIG.geminiApiKey}`,
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
            console.error(`❌ Gemini ${model} HTTP ${response.status}:`, errorText);
            if (response.status === 404) throw new Error(`Modell nicht gefunden`);
            if (response.status === 429) {
                // Logge den vollen Fehler für Debugging
                try {
                    const errObj = JSON.parse(errorText);
                    const detail = errObj?.error?.message || 'keine Details';
                    console.error(`🚫 Rate-Limit Details: ${detail}`);
                } catch (e) { }
                throw new Error('Rate-Limit erreicht. Bitte warte 1 Minute.');
            }
            if (response.status === 403) throw new Error('API-Key ungültig oder deaktiviert.');
            throw new Error(`HTTP ${response.status}`);
        }

        progressCallback('🧠 Gemini analysiert...', 70);
        const data = await response.json();

        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
            throw new Error('Leere Antwort von Gemini');
        }

        const text = data.candidates[0].content.parts[0].text;
        console.log('📝 Gemini Response:', text.substring(0, 500));

        progressCallback('📋 Verarbeite Ergebnisse...', 90);

        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            console.error('❌ Kein JSON in Antwort:', text);
            throw new Error('Gemini konnte keine Wortpaare erkennen.');
        }

        const words = JSON.parse(jsonMatch[0]);
        const validWords = words
            .filter(w => w && w.de && w.ar && w.de.trim().length >= 2)
            .map(w => ({
                de: w.de.trim().normalize('NFC'),
                ar: w.ar.trim().normalize('NFC'),
                ex: (w.ex || '').trim()
            }));

        console.log(`✅ Gemini (${model}): ${validWords.length} Wortpaare erkannt`);
        return validWords;
    },

    _buildPrompt() {
        return `Du bist ein Experte für arabische Linguistik, Grammatik (Nahw/Sarf) und OCR.

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
   Beispiel: أَكَلَهُ statt اكله  |  اِشْتَرَى statt اشترى
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
//
//  PIPELINE:
//  1. OCR → Word-Level Bounding Boxes
//  2. Garbage-Filter (Confidence + Character Validation)
//  3. Spalten-Erkennung via X-Gap-Clustering
//  4. Zeilen-Gruppierung via Y-Toleranz
//  5. RTL-aware Wort-Assemblierung (Arab = X absteigend, DE = X aufsteigend)
//  6. Qualitäts-Validation mit Auto-Korrektur
// =========================================================================
const TesseractOCR = {
    // Unicode-Ranges für arabische Zeichen (inkl. Tashkeel, Ligaturen)
    ARABIC_REGEX: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0610-\u061A\u064B-\u065F]/,
    // Gültige deutsche Zeichen
    GERMAN_REGEX: /[a-zäöüßA-ZÄÖÜ]/,
    // Reine Sonderzeichen / Müll
    GARBAGE_REGEX: /^[^a-zA-ZäöüßÄÖÜ\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+$/,

    async recognize(fileOrBlob, progressCallback) {
        progressCallback('⚙️ Starte Tesseract...', 20);
        const worker = await getTesseractWorker();

        progressCallback('🔍 Erkenne Text mit Positionsdaten...', 40);

        const result = await worker.recognize(fileOrBlob);
        const allWords = result.data.words;

        console.log(`📊 Tesseract Roh: ${allWords.length} Wörter erkannt`);

        if (!allWords || allWords.length === 0) {
            console.warn('⚠️ Keine Wörter erkannt');
            return [];
        }

        // ===== SCHRITT 1: Garbage-Filter =====
        const words = this._filterGarbage(allWords);

        if (words.length < 2) {
            console.warn('⚠️ Zu wenige valide Wörter nach Filter');
            return WordExtractor.extract(result.data.text);
        }

        progressCallback('📐 Analysiere Spalten-Layout...', 60);

        // Debug: Bounding Boxes
        this._logBoundingBoxes(words);

        // ===== SCHRITT 2: Spalten erkennen =====
        const columns = this._detectColumns(words);
        if (!columns) {
            console.warn('⚠️ Spalten-Erkennung fehlgeschlagen, Fallback auf Textmodus');
            progressCallback('📋 Extrahiere Wörter (Textmodus)...', 80);
            return WordExtractor.extract(result.data.text);
        }

        // ===== SCHRITT 3: Zeilen gruppieren =====
        progressCallback('🔗 Matche Wortpaare nach Position...', 75);
        const rows = this._groupIntoRows(words);

        // ===== SCHRITT 4: RTL-aware Wortpaare bilden =====
        progressCallback('📋 Erstelle Wortpaare (RTL-aware)...', 90);
        let pairs = this._buildPairsRTL(rows, columns);

        // ===== SCHRITT 5: Qualitäts-Validation =====
        pairs = this._validateQuality(pairs, rows, columns);

        console.log(`✅ Tesseract: ${pairs.length} Wortpaare via Layout-Analyse`);
        return pairs;
    },

    // -----------------------------------------------------------------
    //  GARBAGE FILTER: Confidence + Zeichenvalidierung
    // -----------------------------------------------------------------
    _filterGarbage(allWords) {
        const filtered = [];
        let discarded = 0;

        for (const w of allWords) {
            const text = w.text.trim();

            // Filter 1: Leerer Text
            if (!text || text.length === 0) {
                discarded++;
                continue;
            }

            // Filter 2: Zu niedrige Confidence
            if (w.confidence < OCR_CONFIG.minConfidence) {
                console.log(`  🗑️ Low-Conf (${w.confidence.toFixed(0)}%): "${text}"`);
                discarded++;
                continue;
            }

            // Filter 3: Reine Sonderzeichen/Zahlen (kein einziger Buchstabe)
            if (this.GARBAGE_REGEX.test(text)) {
                console.log(`  🗑️ Garbage: "${text}" (${w.confidence.toFixed(0)}%)`);
                discarded++;
                continue;
            }

            // Filter 4: Einzelne Zeichen (nur wenn kein Arabisch)
            if (text.length === 1 && !this.ARABIC_REGEX.test(text)) {
                console.log(`  🗑️ Single char: "${text}"`);
                discarded++;
                continue;
            }

            filtered.push(w);
        }

        console.log(`📊 Garbage-Filter: ${filtered.length} behalten, ${discarded} verworfen`);
        return filtered;
    },

    // -----------------------------------------------------------------
    //  DEBUG: Bounding Boxes visualisieren
    // -----------------------------------------------------------------
    _logBoundingBoxes(words) {
        console.log('📐 === BOUNDING BOX ANALYSE ===');
        words.forEach((w, i) => {
            const bbox = w.bbox;
            const isAr = this.ARABIC_REGEX.test(w.text) ? '🟢AR' : '🔵DE';
            console.log(
                `  [${i}] ${isAr} "${w.text}" ` +
                `x: ${bbox.x0}-${bbox.x1} (center: ${Math.round((bbox.x0 + bbox.x1) / 2)}) ` +
                `y: ${bbox.y0}-${bbox.y1} (center: ${Math.round((bbox.y0 + bbox.y1) / 2)}) ` +
                `conf: ${w.confidence.toFixed(1)}%`
            );
        });
    },

    // -----------------------------------------------------------------
    //  SPALTEN-ERKENNUNG via X-Gap Clustering
    // -----------------------------------------------------------------
    _detectColumns(words) {
        if (words.length < 2) return null;

        const xCenters = words.map(w => ({
            xCenter: (w.bbox.x0 + w.bbox.x1) / 2,
            word: w
        }));

        xCenters.sort((a, b) => a.xCenter - b.xCenter);

        // Finde den größten Gap
        let maxGap = 0;
        let splitX = 0;

        for (let i = 1; i < xCenters.length; i++) {
            const gap = xCenters[i].xCenter - xCenters[i - 1].xCenter;
            if (gap > maxGap) {
                maxGap = gap;
                splitX = (xCenters[i - 1].xCenter + xCenters[i].xCenter) / 2;
            }
        }

        // Gap muss signifikant sein (mind. 8% der Bildbreite)
        const imageWidth = Math.max(...words.map(w => w.bbox.x1));
        const minGap = imageWidth * 0.08;

        console.log(`📐 Spalten: maxGap=${maxGap.toFixed(0)}px, splitX=${splitX.toFixed(0)}px, imgWidth=${imageWidth}px`);

        if (maxGap < minGap) {
            console.warn('⚠️ Kein klarer Spaltenzwischenraum');
            return null;
        }

        // Bestimme Sprachzuordnung
        const leftWords = words.filter(w => (w.bbox.x0 + w.bbox.x1) / 2 < splitX);
        const rightWords = words.filter(w => (w.bbox.x0 + w.bbox.x1) / 2 >= splitX);

        const leftArabicCount = leftWords.filter(w => this.ARABIC_REGEX.test(w.text)).length;
        const rightArabicCount = rightWords.filter(w => this.ARABIC_REGEX.test(w.text)).length;

        const arabicSide = leftArabicCount >= rightArabicCount ? 'left' : 'right';
        const germanSide = arabicSide === 'left' ? 'right' : 'left';

        console.log(`📐 Spalten: AR=${arabicSide} (${Math.max(leftArabicCount, rightArabicCount)} arab. Wörter), DE=${germanSide}`);

        return { splitX, arabicSide, germanSide };
    },

    // -----------------------------------------------------------------
    //  ZEILEN-GRUPPIERUNG via Y-Position
    // -----------------------------------------------------------------
    _groupIntoRows(words) {
        const sorted = [...words].sort((a, b) => {
            const yA = (a.bbox.y0 + a.bbox.y1) / 2;
            const yB = (b.bbox.y0 + b.bbox.y1) / 2;
            return yA - yB;
        });

        // Dynamische Toleranz basierend auf Wort-Höhe
        const avgHeight = words.reduce((sum, w) => sum + (w.bbox.y1 - w.bbox.y0), 0) / words.length;
        const tolerance = Math.max(OCR_CONFIG.rowTolerancePx, avgHeight * 0.6);
        console.log(`📏 Row-Toleranz: ${tolerance.toFixed(0)}px (Ø Höhe: ${avgHeight.toFixed(0)}px)`);

        const rows = [];
        let currentRow = [sorted[0]];
        let currentRowY = (sorted[0].bbox.y0 + sorted[0].bbox.y1) / 2;

        for (let i = 1; i < sorted.length; i++) {
            const wordY = (sorted[i].bbox.y0 + sorted[i].bbox.y1) / 2;

            if (Math.abs(wordY - currentRowY) <= tolerance) {
                currentRow.push(sorted[i]);
            } else {
                rows.push(currentRow);
                currentRow = [sorted[i]];
                currentRowY = wordY;
            }
        }
        rows.push(currentRow);

        console.log(`📋 ${rows.length} Zeilen erkannt`);
        rows.forEach((row, i) => {
            const texts = row.map(w => `"${w.text}"`).join(', ');
            const avgY = row.reduce((s, w) => s + (w.bbox.y0 + w.bbox.y1) / 2, 0) / row.length;
            console.log(`  Zeile ${i + 1} (Y≈${avgY.toFixed(0)}): ${texts}`);
        });

        return rows;
    },

    // -----------------------------------------------------------------
    //  WORTPAARE BILDEN — RTL-AWARE
    //
    //  KERNLOGIK:
    //  - Arabische Spalte: Wörter nach X ABSTEIGEND sortieren (RTL!)
    //  - Deutsche Spalte: Wörter nach X AUFSTEIGEND sortieren (LTR)
    //  - Dann jeweils konkatenieren
    // -----------------------------------------------------------------
    _buildPairsRTL(rows, columns) {
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

            // ===== RTL-AWARE SORTIERUNG =====
            // Arabische Spalte: X ABSTEIGEND (rechts → links = Leserichtung)
            // Deutsche Spalte: X AUFSTEIGEND (links → rechts = Leserichtung)
            const arWords = columns.arabicSide === 'left' ? leftWords : rightWords;
            const deWords = columns.arabicSide === 'left' ? rightWords : leftWords;

            // Arabisch: RTL = von rechts nach links lesen
            arWords.sort((a, b) => b.bbox.x0 - a.bbox.x0);
            // Deutsch: LTR = von links nach rechts lesen
            deWords.sort((a, b) => a.bbox.x0 - b.bbox.x0);

            const arText = arWords.map(w => w.text).join(' ').trim();
            const deTextRaw = deWords.map(w => w.text).join(' ').trim();

            // Überspringe leere/unvollständige Zeilen
            if (!arText || !deTextRaw) {
                if (arText || deTextRaw) {
                    console.log(`  ⚠️ Unvollständig: AR="${arText}" DE="${deTextRaw}"`);
                }
                continue;
            }

            // Bereinige deutschen Text (entferne OCR-Artefakte)
            const deText = deTextRaw
                .replace(/[^a-zäöüßA-ZÄÖÜ\s\-\.]/g, '')
                .replace(/\s+/g, ' ')
                .trim();

            if (deText.length >= 2 && arText.length > 0) {
                pairs.push({ de: deText, ar: arText, ex: '' });
                console.log(`  ✅ Paar: "${deText}" ↔ "${arText}" [AR:RTL, DE:LTR]`);
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
    },

    // -----------------------------------------------------------------
    //  QUALITÄTS-VALIDATION
    //
    //  Prüft ob die Paare konsistent sind:
    //  - AR-Seite muss arabische Zeichen enthalten
    //  - DE-Seite darf KEINE arabischen Zeichen enthalten
    //  - Wenn >50% der Paare inkonsistent → Spalten tauschen
    // -----------------------------------------------------------------
    _validateQuality(pairs, rows, columns) {
        if (pairs.length === 0) return pairs;

        let correctCount = 0;
        let swappedCount = 0;

        for (const pair of pairs) {
            const arHasArabic = this.ARABIC_REGEX.test(pair.ar);
            const deHasArabic = this.ARABIC_REGEX.test(pair.de);
            const deHasGerman = this.GERMAN_REGEX.test(pair.de);

            if (arHasArabic && deHasGerman && !deHasArabic) {
                correctCount++;
            } else if (deHasArabic && !arHasArabic) {
                swappedCount++;
            }
        }

        console.log(`🔍 Qualitäts-Check: ${correctCount} korrekt, ${swappedCount} vertauscht von ${pairs.length}`);

        // Wenn mehr als die Hälfte vertauscht → gesamte Zuordnung umdrehen
        if (swappedCount > correctCount && swappedCount > pairs.length * 0.3) {
            console.log('🔄 Qualitäts-Korrektur: Spalten werden getauscht!');
            const swappedColumns = {
                splitX: columns.splitX,
                arabicSide: columns.germanSide,
                germanSide: columns.arabicSide
            };
            return this._buildPairsRTL(rows, swappedColumns);
        }

        // Einzelne vertauschte Paare korrigieren
        if (swappedCount > 0 && swappedCount <= correctCount) {
            console.log(`🔄 Korrigiere ${swappedCount} einzelne vertauschte Paare`);
            return pairs.map(pair => {
                const arHasArabic = this.ARABIC_REGEX.test(pair.ar);
                const deHasArabic = this.ARABIC_REGEX.test(pair.de);
                if (!arHasArabic && deHasArabic) {
                    return { de: pair.ar, ar: pair.de, ex: pair.ex };
                }
                return pair;
            });
        }

        return pairs;
    },

    // Hilfsfunktion: Prüfe ob Wort-Array arabische Zeichen enthält
    _hasArabic(words) {
        return words.some(w => this.ARABIC_REGEX.test(w.text));
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
//  NATIVE VISION OCR (iOS only — via Capacitor Plugin)
//
//  Uses Apple's Vision framework for on-device OCR.
//  Much better Arabic recognition than Tesseract, works offline.
//  Returns raw text blocks — we use WordExtractor to parse pairs.
// =========================================================================
const NativeVisionOCR = {
    isAvailable() {
        return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.VisionOCR);
    },

    async recognize(fileOrBlob, progressCallback) {
        if (!this.isAvailable()) throw new Error('Vision OCR not available');

        progressCallback('📱 Starte native iOS-Texterkennung...', 20);

        const base64 = await this._toBase64(fileOrBlob);
        progressCallback('🔍 Apple Vision analysiert...', 50);

        const result = await window.Capacitor.Plugins.VisionOCR.recognizeText({
            imageBase64: base64,
            languages: ['ar', 'de', 'en']
        });

        console.log(`📱 Vision OCR: ${result.blockCount} Textblöcke erkannt`);
        console.log(`📝 Vision Text:\n${result.text.substring(0, 500)}`);

        progressCallback('📋 Verarbeite Ergebnisse...', 80);

        if (!result.text || result.text.trim().length === 0) {
            throw new Error('Vision OCR: Kein Text erkannt');
        }

        // Use WordExtractor to build DE-AR pairs from recognized text
        const pairs = WordExtractor.extract(result.text);
        console.log(`✅ Vision OCR: ${pairs.length} Wortpaare extrahiert`);
        return pairs;
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
//  HAUPT-OCR-FUNKTION
//
//  TRIPLE-PIPELINE:
//  1. Gemini Vision API  (primary — cloud, best quality)
//  2. Native Vision OCR  (iOS only — offline, fast, great Arabic)
//  3. Tesseract.js       (web fallback — offline, slower)
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
            console.warn('⚠️ Gemini fehlgeschlagen:', error.message);

            // Fallback 1: Native Vision OCR (iOS only)
            if (NativeVisionOCR.isAvailable()) {
                try {
                    progressCallback('📱 Nutze native iOS-OCR...', 30);
                    return await NativeVisionOCR.recognize(originalBlob, progressCallback);
                } catch (visionError) {
                    console.warn('⚠️ Vision OCR fehlgeschlagen:', visionError.message);
                }
            }

            // Fallback 2: Tesseract
            progressCallback('⚠️ Nutze Tesseract...', 30);
            return await TesseractOCR.recognize(processedBlob, progressCallback);
        }
    } else {
        // Kein Gemini → Versuche Vision (iOS) oder Tesseract
        if (NativeVisionOCR.isAvailable()) {
            try {
                return await NativeVisionOCR.recognize(originalBlob, progressCallback);
            } catch (visionError) {
                console.warn('⚠️ Vision OCR fehlgeschlagen, Fallback auf Tesseract:', visionError.message);
            }
        }
        return await TesseractOCR.recognize(processedBlob, progressCallback);
    }
}
