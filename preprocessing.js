/**
 * preprocessing.js — Bild-Vorverarbeitung für OCR
 * 
 * ZWEI PIPELINES:
 * 1. Gemini:    Original-Bild skaliert (Farbe erhalten! Keine Binarisierung!)
 * 2. Tesseract: Graustufen → Kontrast → Otsu-Thresholding (Binarisierung)
 *
 * WARUM? Otsu-Thresholding zerstört arabische Diakritika (Tashkeel):
 * Die feinen Punkte ً ٌ ٍ َ ُ ِ ّ ْ werden bei Binarisierung verschluckt.
 * Gemini als Vision-Modell braucht das Originalbild.
 */

const ImagePreprocessor = {
    // Höhere Auflösung = bessere Diakritika-Erkennung
    GEMINI_MAX: 2000,       // Gemini: skaliert nicht hoch, JPEG komprimiert
    TESSERACT_MAX: 2000,    // Tesseract: niedriger für Performance

    /**
     * Erstelle BEIDE Versionen: Original für Gemini + Preprocessed für Tesseract
     * @param {File|Blob} file
     * @returns {Promise<{originalBlob: Blob, processedBlob: Blob, thumbnail: string}>}
     */
    async process(file) {
        console.log('🔧 Preprocessing: Start (Dual-Pipeline)...');

        // 1. Lade Bild als ImageBitmap
        const img = await createImageBitmap(file);
        console.log(`📐 Original: ${img.width}×${img.height}`);

        // ===== PIPELINE A: Gemini (Farbe behalten, JPEG komprimiert) =====
        const originalBlob = await this._createScaledBlob(img, this.GEMINI_MAX, true);
        console.log(`🤖 Gemini-Bild: ${(originalBlob.size / 1024).toFixed(1)} KB (JPEG, ${this.GEMINI_MAX}px max)`);

        // ===== PIPELINE B: Tesseract (Graustufen + Thresholding) =====
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        const scale = Math.min(1, this.TESSERACT_MAX / img.width, this.TESSERACT_MAX / img.height);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Thumbnail VOR Thresholding (sonst ist Preview schwarz-weiß)
        const thumbnail = this._createThumbnail(canvas, 400);

        // Preprocessing für Tesseract
        this._toGrayscale(ctx, canvas.width, canvas.height);
        this._enhanceContrast(ctx, canvas.width, canvas.height, 1.4);
        this._applyOtsuThreshold(ctx, canvas.width, canvas.height);

        const processedBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        console.log(`⚙️ Tesseract-Bild: ${(processedBlob.size / 1024).toFixed(1)} KB (Binarisiert, ${canvas.width}×${canvas.height})`);

        // Cleanup
        canvas.width = 0;
        canvas.height = 0;
        img.close();

        console.log('✅ Preprocessing fertig (Dual-Pipeline)');
        return { originalBlob, processedBlob, thumbnail };
    },

    /**
     * Skaliere Bild ohne Preprocessing — für Gemini
     */
    async _createScaledBlob(img, maxSize, asJpeg = true) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const scale = Math.min(1, maxSize / img.width, maxSize / img.height);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // JPEG mit hoher Qualität für Gemini (kleiner als PNG, reicht aus)
        const blob = await new Promise(resolve =>
            canvas.toBlob(resolve, asJpeg ? 'image/jpeg' : 'image/png', 0.92)
        );

        canvas.width = 0;
        canvas.height = 0;
        return blob;
    },

    /**
     * Canvas vorverarbeiten (für PDF-Seiten die bereits als Canvas vorliegen)
     */
    processCanvas(canvas) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        this._toGrayscale(ctx, canvas.width, canvas.height);
        this._enhanceContrast(ctx, canvas.width, canvas.height, 1.4);
        this._applyOtsuThreshold(ctx, canvas.width, canvas.height);
        return canvas;
    },

    /**
     * Thumbnail erstellen
     */
    _createThumbnail(sourceCanvas, maxSize) {
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
    },

    /**
     * Graustufen-Konvertierung (Luminance)
     */
    _toGrayscale(ctx, width, height) {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            data[i] = data[i + 1] = data[i + 2] = gray;
        }
        ctx.putImageData(imageData, 0, 0);
    },

    /**
     * Kontrast-Verstärkung
     */
    _enhanceContrast(ctx, width, height, factor) {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const intercept = 128 * (1 - factor);
        for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.min(255, Math.max(0, data[i] * factor + intercept));
            data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * factor + intercept));
            data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * factor + intercept));
        }
        ctx.putImageData(imageData, 0, 0);
    },

    /**
     * Otsu-Thresholding — Automatische Binarisierung
     */
    _applyOtsuThreshold(ctx, width, height) {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Histogramm berechnen
        const histogram = new Array(256).fill(0);
        for (let i = 0; i < data.length; i += 4) {
            histogram[data[i]]++;
        }

        // Otsu-Schwellenwert finden
        const total = width * height;
        let sum = 0;
        for (let i = 0; i < 256; i++) sum += i * histogram[i];

        let sumB = 0, wB = 0, maxVar = 0, threshold = 128;

        for (let i = 0; i < 256; i++) {
            wB += histogram[i];
            if (wB === 0) continue;
            const wF = total - wB;
            if (wF === 0) break;
            sumB += i * histogram[i];
            const mB = sumB / wB;
            const mF = (sum - sumB) / wF;
            const variance = wB * wF * (mB - mF) * (mB - mF);
            if (variance > maxVar) {
                maxVar = variance;
                threshold = i;
            }
        }

        console.log(`📊 Otsu Threshold: ${threshold}`);

        // Binarisierung anwenden
        for (let i = 0; i < data.length; i += 4) {
            const val = data[i] > threshold ? 255 : 0;
            data[i] = data[i + 1] = data[i + 2] = val;
        }

        ctx.putImageData(imageData, 0, 0);
        return threshold;
    }
};
