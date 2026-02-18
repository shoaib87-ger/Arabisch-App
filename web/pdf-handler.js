/**
 * pdf-handler.js — PDF-Verarbeitung mit Text-Layer-Extraktion
 * Nutzt pdf.js Text-Layer als erste Option, OCR nur als Fallback
 */

const PdfHandler = {
    /**
     * PDF verarbeiten — intelligent mit Text-Layer first
     * @param {File} file - PDF-Datei
     * @param {Function} progressCallback - (status, percent) => void
     * @param {Function} ocrFunction - OCR-Funktion für gescannte Seiten
     * @returns {Promise<{words: Array, thumbnail: string}>}
     */
    async process(file, progressCallback, ocrFunction) {
        console.log('📄 PDF-Verarbeitung gestartet');

        let pdf = null;
        let thumbnail = null;
        const allWords = [];

        try {
            progressCallback('📄 Lade PDF...', 5);

            // ArrayBuffer laden
            const arrayBuffer = await file.arrayBuffer();
            pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

            const numPages = pdf.numPages;
            console.log(`📄 PDF geladen: ${numPages} Seiten`);

            for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                const pageProgress = 10 + ((pageNum - 1) / numPages) * 80;
                progressCallback(`📄 Seite ${pageNum}/${numPages}...`, pageProgress);

                const page = await pdf.getPage(pageNum);

                // === STRATEGIE 1: Text-Layer extrahieren (schnell!) ===
                const textContent = await page.getTextContent();
                const pageText = textContent.items
                    .map(item => item.str)
                    .join(' ')
                    .trim();

                if (pageText.length > 30) {
                    // PDF hat eingebetteten Text!
                    console.log(`📝 Seite ${pageNum}: Text-Layer gefunden (${pageText.length} Zeichen)`);
                    progressCallback(`📝 Seite ${pageNum}: Text erkannt!`, pageProgress + 5);

                    const words = WordExtractor.extract(pageText);
                    allWords.push(...words);

                    // Thumbnail von erster Seite
                    if (pageNum === 1) {
                        thumbnail = await this._renderPageThumbnail(page, 400);
                    }

                } else {
                    // === STRATEGIE 2: Gescanntes PDF → Canvas → OCR ===
                    console.log(`🔍 Seite ${pageNum}: Kein Text-Layer, starte OCR`);
                    progressCallback(`🔍 Seite ${pageNum}: OCR läuft...`, pageProgress + 5);

                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    const scale = 2.0; // Gute Qualität für OCR
                    const viewport = page.getViewport({ scale });
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;

                    await page.render({ canvasContext: ctx, viewport }).promise;

                    // Thumbnail von erster Seite
                    if (pageNum === 1) {
                        thumbnail = this._canvasToThumbnail(canvas, 400);
                    }

                    // Preprocessing
                    ImagePreprocessor.processCanvas(canvas);

                    // OCR ausführen
                    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                    const words = await ocrFunction(blob);
                    allWords.push(...words);

                    // ⚠️ KRITISCH: Canvas freigeben!
                    canvas.width = 0;
                    canvas.height = 0;
                }

                // Seite freigeben
                page.cleanup();
                console.log(`✅ Seite ${pageNum} verarbeitet`);
            }

            progressCallback('✅ PDF vollständig verarbeitet!', 95);
            return { words: allWords, thumbnail };

        } catch (error) {
            console.error('❌ PDF-Fehler:', error);
            throw error;
        } finally {
            // PDF-Dokument freigeben
            if (pdf) {
                pdf.destroy();
                console.log('🧹 PDF-Dokument freigegeben');
            }
        }
    },

    /**
     * Seite als Thumbnail rendern
     */
    async _renderPageThumbnail(page, maxSize) {
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(1, maxSize / viewport.width, maxSize / viewport.height);
        const thumbViewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = thumbViewport.width;
        canvas.height = thumbViewport.height;
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport: thumbViewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        canvas.width = 0;
        canvas.height = 0;
        return dataUrl;
    },

    /**
     * Canvas in Thumbnail konvertieren
     */
    _canvasToThumbnail(sourceCanvas, maxSize) {
        const thumbCanvas = document.createElement('canvas');
        const scale = Math.min(1, maxSize / sourceCanvas.width, maxSize / sourceCanvas.height);
        thumbCanvas.width = Math.round(sourceCanvas.width * scale);
        thumbCanvas.height = Math.round(sourceCanvas.height * scale);
        const ctx = thumbCanvas.getContext('2d');
        ctx.drawImage(sourceCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
        const dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.7);
        thumbCanvas.width = 0;
        thumbCanvas.height = 0;
        return dataUrl;
    }
};
