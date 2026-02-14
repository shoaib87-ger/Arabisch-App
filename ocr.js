/**
 * ocr.js — OCR-Pipeline (Gemini API + Tesseract.js Fallback)
 * Wort-Extraktion und Validierung für DE ↔ AR
 */

// ===== KONFIGURATION =====
const OCR_CONFIG = {
    geminiApiKey: 'AIzaSyDD3Eyb10Tuc2GSwZxF27UWnhu7TNAmvlM',
    useGemini: true,
    geminiModel: 'gemini-1.5-flash-latest',
    tesseractLangs: 'deu+ara',
};

// ===== TESSERACT WORKER POOL (Singleton) =====
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

    // Optimale Einstellungen für Vokabellisten
    await _tesseractWorker.setParameters({
        tessedit_pageseg_mode: '4',       // SINGLE_COLUMN
        preserve_interword_spaces: '1',
        // KEIN char_whitelist — bricht Arabisch!
    });

    console.log('✅ Tesseract Worker bereit');
    return _tesseractWorker;
}

async function terminateTesseractWorker() {
    if (_tesseractWorker) {
        await _tesseractWorker.terminate();
        _tesseractWorker = null;
        console.log('🧹 Tesseract Worker beendet');
    }
}

// ===== GEMINI OCR =====
const GeminiOCR = {
    async recognize(fileOrBlob, progressCallback) {
        progressCallback('🤖 Starte Gemini AI...', 20);

        // Zu Base64 konvertieren
        const base64 = await this._toBase64(fileOrBlob);
        const mimeType = fileOrBlob.type || 'image/png';

        progressCallback('📤 Sende an Gemini...', 40);

        const prompt = `Du bist ein OCR-Experte für Deutsch-Arabische Vokabellisten.

Analysiere dieses Bild und extrahiere ALLE Deutsch-Arabisch Wortpaare.

REGELN:
- Erkenne BEIDE Richtungen: Deutsch→Arabisch UND Arabisch→Deutsch
- Speichere IMMER als: {"de": "deutsches_wort", "ar": "arabisches_wort"}
- Arabisch MIT allen Tashkeel/Vokalzeichen beibehalten!
- Deutsch: Nomen groß, Verben klein
- Wenn ein Beispielsatz sichtbar ist, füge "ex" hinzu
- Ignoriere Seitenzahlen, Überschriften, Sonderzeichen

FORMAT — NUR ein JSON-Array, NICHTS anderes:
[
  {"de": "glauben", "ar": "آمَنَ بِاللّه", "ex": "ich glaube an Gott"},
  {"de": "nehmen", "ar": "أَخَذَ"}
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

                if (response.status === 429) {
                    throw new Error('Rate-Limit erreicht. Bitte warte 1 Minute.');
                }
                if (response.status === 403) {
                    throw new Error('API-Key ungültig oder deaktiviert.');
                }
                throw new Error(`Gemini API Fehler: ${response.status}`);
            }

            progressCallback('🧠 Gemini analysiert...', 70);

            const data = await response.json();

            // Safety check
            if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
                console.error('❌ Gemini: Leere Antwort', data);
                throw new Error('Gemini gab keine Ergebnisse zurück.');
            }

            const text = data.candidates[0].content.parts[0].text;
            console.log('📝 Gemini Response:', text.substring(0, 200));

            progressCallback('📋 Verarbeite Ergebnisse...', 90);

            // JSON extrahieren
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                console.error('❌ Kein JSON in Antwort:', text);
                throw new Error('Gemini konnte keine Wortpaare im Bild erkennen.');
            }

            const words = JSON.parse(jsonMatch[0]);

            // Validieren und bereinigen
            const validWords = words
                .filter(w => w && w.de && w.ar && w.de.trim().length >= 2)
                .map(w => ({
                    de: w.de.trim(),
                    ar: w.ar.trim(),
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

// ===== TESSERACT OCR (Fallback) =====
const TesseractOCR = {
    async recognize(fileOrBlob, progressCallback) {
        progressCallback('⚙️ Starte Tesseract...', 20);

        const worker = await getTesseractWorker();

        progressCallback('🔍 Erkenne Text...', 50);
        const { data: { text } } = await worker.recognize(fileOrBlob);

        console.log('📝 Tesseract Rohtext:', text.substring(0, 200));
        progressCallback('📋 Extrahiere Wörter...', 85);

        const words = WordExtractor.extract(text);
        return words;
    }
};

// ===== WORT-EXTRAKTION AUS ROHTEXT =====
const WordExtractor = {
    // Regex-Patterns
    ARABIC_PATTERN: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0610-\u061A\u064B-\u065F]+(?:\s[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0610-\u061A\u064B-\u065F]+)*/g,
    GERMAN_PATTERN: /[a-zäöüßA-ZÄÖÜ][a-zäöüß]+(?:\s(?:sich|auf|an|aus|ein|ab|zu|mit|vor|nach|über|unter|um|durch|ent|er|ver|zer|be|ge|miss)[a-zäöüß]*)?/g,

    /**
     * Extrahiere Deutsch-Arabisch Wortpaare aus Rohtext
     */
    extract(text) {
        console.log('🔍 Wort-Extraktion gestartet');

        // Text bereinigen
        const cleanedText = text
            .replace(/\|/g, ' ')
            .replace(/[→←⇒⇐=:;\/\\]/g, ' ')
            .replace(/\d+\./g, '')  // Nummerierungen entfernen
            .replace(/\s+/g, ' ')
            .trim();

        const lines = cleanedText.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 1);

        console.log(`📋 ${lines.length} Zeilen zu verarbeiten`);

        const detectedWords = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];

            // Reset patterns
            this.ARABIC_PATTERN.lastIndex = 0;
            this.GERMAN_PATTERN.lastIndex = 0;

            const arabicMatches = line.match(this.ARABIC_PATTERN);
            const germanMatches = line.match(this.GERMAN_PATTERN);

            // FALL 1: Beide Sprachen in einer Zeile
            if (germanMatches && arabicMatches) {
                // Alle deutschen Wörter und alle arabischen Wörter paaren
                const deWord = this._cleanGerman(germanMatches.join(' '));
                const arWord = arabicMatches.join(' ').trim();

                if (deWord.length >= 2 && arWord.length > 0) {
                    detectedWords.push({ de: deWord, ar: arWord, ex: '' });
                    console.log(`  ✅ ${deWord} ↔ ${arWord}`);
                }
                i++;
            }
            // FALL 2: Nur Deutsch → nächste Zeile prüfen
            else if (germanMatches && !arabicMatches) {
                const deWord = this._cleanGerman(germanMatches.join(' '));

                if (i + 1 < lines.length) {
                    const nextLine = lines[i + 1];
                    this.ARABIC_PATTERN.lastIndex = 0;
                    const nextArabic = nextLine.match(this.ARABIC_PATTERN);
                    const nextGerman = nextLine.match(this.GERMAN_PATTERN);

                    if (nextArabic && !nextGerman) {
                        const arWord = nextArabic.join(' ').trim();
                        if (deWord.length >= 2 && arWord.length > 0) {
                            detectedWords.push({ de: deWord, ar: arWord, ex: '' });
                            console.log(`  ✅ ${deWord} ↔ ${arWord} (2 Zeilen)`);
                        }
                        i += 2;
                        continue;
                    }
                }
                i++;
            }
            // FALL 3: Nur Arabisch → nächste Zeile prüfen
            else if (arabicMatches && !germanMatches) {
                const arWord = arabicMatches.join(' ').trim();

                if (i + 1 < lines.length) {
                    const nextLine = lines[i + 1];
                    this.GERMAN_PATTERN.lastIndex = 0;
                    const nextGerman = nextLine.match(this.GERMAN_PATTERN);
                    const nextArabic = nextLine.match(this.ARABIC_PATTERN);

                    if (nextGerman && !nextArabic) {
                        const deWord = this._cleanGerman(nextGerman.join(' '));
                        if (deWord.length >= 2 && arWord.length > 0) {
                            detectedWords.push({ de: deWord, ar: arWord, ex: '' });
                            console.log(`  ✅ ${deWord} ↔ ${arWord} (AR→DE, 2 Zeilen)`);
                        }
                        i += 2;
                        continue;
                    }
                }
                i++;
            }
            else {
                i++;
            }
        }

        // Duplikate entfernen
        const seen = new Set();
        const uniqueWords = detectedWords.filter(w => {
            const key = w.de.toLowerCase() + '|' + w.ar;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        console.log(`✅ ${uniqueWords.length} einzigartige Wortpaare extrahiert`);
        return uniqueWords;
    },

    _cleanGerman(word) {
        return word
            .trim()
            .replace(/[^a-zäöüßA-ZÄÖÜ\s\-]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 80);
    }
};

// ===== HAUPT-OCR-FUNKTION =====
async function performOCR(fileOrBlob, progressCallback) {
    if (OCR_CONFIG.useGemini) {
        try {
            return await GeminiOCR.recognize(fileOrBlob, progressCallback);
        } catch (error) {
            console.warn('⚠️ Gemini fehlgeschlagen, Fallback auf Tesseract:', error.message);
            progressCallback('⚠️ Gemini-Fehler, nutze Tesseract...', 30);
            return await TesseractOCR.recognize(fileOrBlob, progressCallback);
        }
    } else {
        return await TesseractOCR.recognize(fileOrBlob, progressCallback);
    }
}
