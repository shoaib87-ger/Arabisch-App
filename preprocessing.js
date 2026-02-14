/**
 * preprocessing.js — Bild-Vorverarbeitung für OCR
 * Graustufen, Otsu-Thresholding, Skalierung, Kontrast
 */

const ImagePreprocessor = {
    MAX_WIDTH: 2000,
    MAX_HEIGHT: 2000,

    /**
     * Vollständige Preprocessing-Pipeline
     * @param {File|Blob} file - Eingabe-Bild
     * @returns {Promise<{blob: Blob, thumbnail: string}>} - Verarbeitetes Bild + Thumbnail
     */
    async process(file) {
        console.log('🔧 Preprocessing: Start...');

        // 1. Lade Bild als ImageBitmap (speichereffizient)
        const img = await createImageBitmap(file);
        console.log(`📐 Original: ${img.width}×${img.height}`);

        // 2. Canvas erstellen und skalieren
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        const scale = Math.min(1, this.MAX_WIDTH / img.width, this.MAX_HEIGHT / img.height);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        console.log(`📐 Skaliert: ${canvas.width}×${canvas.height} (Faktor: ${scale.toFixed(2)})`);

        // 3. Zeichne skaliertes Bild
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        img.close(); // ImageBitmap freigeben

        // 4. Thumbnail für Preview erstellen (max 400px)
        const thumbnail = this._createThumbnail(canvas, 400);

        // 5. Graustufen-Konvertierung
        this._toGrayscale(ctx, canvas.width, canvas.height);
        console.log('🎨 Graustufen angewendet');

        // 6. Kontrast erhöhen (vor Thresholding)
        this._enhanceContrast(ctx, canvas.width, canvas.height, 1.5);
        console.log('🔆 Kontrast verstärkt');

        // 7. Otsu-Thresholding (Binarisierung)
        this._applyOtsuThreshold(ctx, canvas.width, canvas.height);
        console.log('⬛⬜ Otsu-Thresholding angewendet');

        // 8. Exportiere als PNG Blob
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        console.log(`📦 Output: ${(blob.size / 1024).toFixed(1)} KB`);

        // 9. Canvas freigeben
        canvas.width = 0;
        canvas.height = 0;

        console.log('✅ Preprocessing fertig');
        return { blob, thumbnail };
    },

    /**
     * Canvas vorverarbeiten (für PDF-Seiten die bereits als Canvas vorliegen)
     */
    processCanvas(canvas) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        this._toGrayscale(ctx, canvas.width, canvas.height);
        this._enhanceContrast(ctx, canvas.width, canvas.height, 1.5);
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
