/**
 * text-scan.js — JS wrapper for the VisionOCR Capacitor plugin.
 * Provides scanText() which opens the native iOS photo picker,
 * runs Apple Vision OCR, and returns recognized text.
 *
 * Usage:
 *   const result = await TextScan.scan();            // photo library
 *   const result = await TextScan.scan('camera');     // camera
 *   // result = { text: string, blocks: [...], blockCount: number }
 */
const TextScan = (() => {
    'use strict';

    /**
     * Check if the native plugin is available (Capacitor iOS)
     */
    function isAvailable() {
        return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.VisionOCR);
    }

    /**
     * Open native photo picker (or camera), run OCR, return text.
     * @param {'photos'|'camera'} source - Image source (default: 'photos')
     * @returns {Promise<{text: string, blocks: Array, blockCount: number}>}
     */
    async function scan(source = 'photos') {
        if (!isAvailable()) {
            throw new Error('VisionOCR plugin not available (requires iOS native app)');
        }

        const plugin = window.Capacitor.Plugins.VisionOCR;
        const result = await plugin.scanText({ source });

        // Guard: ensure we have usable data
        if (!result || typeof result.text !== 'string') {
            throw new Error('OCR returned no result');
        }

        return {
            text: result.text,
            blocks: result.blocks || [],
            blockCount: result.blockCount || 0
        };
    }

    /**
     * OCR from a base64 image (existing method, no picker).
     * @param {string} imageBase64 - Base64-encoded image (with or without data URI prefix)
     * @param {string[]} languages - Recognition languages (default: ['ar', 'de', 'en'])
     * @returns {Promise<{text: string, blocks: Array, blockCount: number}>}
     */
    async function recognizeFromBase64(imageBase64, languages = ['ar', 'de', 'en']) {
        if (!isAvailable()) {
            throw new Error('VisionOCR plugin not available');
        }

        const plugin = window.Capacitor.Plugins.VisionOCR;
        return await plugin.recognizeText({ imageBase64, languages });
    }

    /**
     * Show scan result UI — editable text + create card button.
     * Called after a successful scan.
     */
    function showScanResult(result) {
        // Build modal
        let modal = document.getElementById('ocrResultModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'ocrResultModal';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        const blocksHtml = result.blocks.map((b, i) => `
            <label class="ocr-block-item">
                <input type="checkbox" class="ocr-block-check" data-idx="${i}" checked>
                <span class="ocr-block-text" dir="auto">${_escapeHtml(b.text)}</span>
                <span class="ocr-block-conf">${Math.round((b.confidence || 0) * 100)}%</span>
            </label>
        `).join('');

        modal.innerHTML = `
            <div class="modal-content" style="max-width:500px;">
                <h3>📷 Erkannter Text</h3>
                <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px;">
                    ${result.blockCount} Textblöcke erkannt. Wähle Texte aus und erstelle Karten.
                </p>
                <div class="ocr-blocks-list" style="max-height:300px;overflow-y:auto;margin-bottom:12px;">
                    ${blocksHtml || '<p style="color:#888;">Kein Text erkannt</p>'}
                </div>
                <div style="margin-bottom:12px;">
                    <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">Deutsche Übersetzung (optional):</label>
                    <input type="text" id="ocrBackText" class="form-input" placeholder="Übersetzung eingeben…"
                           style="width:100%;font-size:16px;padding:10px;">
                </div>
                <button class="btn btn-primary mb-sm" onclick="TextScan._createCardFromOCR()">
                    📝 Als Karte speichern
                </button>
                <button class="btn btn-secondary" onclick="TextScan._closeResult()">Schließen</button>
            </div>
        `;
        modal.classList.add('active');
    }

    /**
     * Create a card from selected OCR blocks.
     */
    function _createCardFromOCR() {
        const checks = document.querySelectorAll('.ocr-block-check:checked');
        const selectedTexts = [];
        checks.forEach(cb => {
            const text = cb.closest('.ocr-block-item')?.querySelector('.ocr-block-text')?.textContent;
            if (text) selectedTexts.push(text.trim());
        });

        if (selectedTexts.length === 0) {
            if (typeof showToast === 'function') showToast('⚠️ Kein Text ausgewählt', 'warning');
            return;
        }

        const front = selectedTexts.join('\n'); // Arabic text
        const back = document.getElementById('ocrBackText')?.value || '';

        // Use existing createCards path if available, otherwise add directly
        if (typeof AppState !== 'undefined' && AppState.cards) {
            // Find or create a default OCR deck
            let ocrCat = AppState.categories.find(c => c.name === 'OCR Scans');
            if (!ocrCat) {
                ocrCat = {
                    id: 'cat_ocr_' + Date.now(),
                    name: 'OCR Scans',
                    icon: '📷',
                    parentId: null,
                    order: AppState.categories.length
                };
                AppState.categories.push(ocrCat);
            }

            AppState.cards.push({
                front: front,
                back: back,
                frontLang: 'ar',
                backLang: 'de',
                ex: '',
                noteDe: '',
                noteAr: '',
                note: '',
                cat: ocrCat.id,
                score: 0,
                correctCount: 0,
                wrongCount: 0,
                lastSeen: null
            });

            if (typeof Storage !== 'undefined' && Storage.save) Storage.save();
            if (typeof renderCategories === 'function') renderCategories();
            if (typeof showToast === 'function') showToast('✅ Karte aus OCR erstellt!', 'success');
        }

        _closeResult();
    }

    function _closeResult() {
        const modal = document.getElementById('ocrResultModal');
        if (modal) modal.classList.remove('active');
    }

    function _escapeHtml(str) {
        if (typeof escapeHtml === 'function') return escapeHtml(str);
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return {
        isAvailable, scan, recognizeFromBase64,
        showScanResult, _createCardFromOCR, _closeResult
    };
})();
