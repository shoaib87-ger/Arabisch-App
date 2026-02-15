/**
 * ebook-detect.js — Format detection and routing for ebook files
 */
const EbookDetect = {
    /** Supported formats with their readers */
    FORMATS: {
        epub: { ext: ['.epub'], label: 'EPUB', color: '#4CAF50', reader: 'epub' },
        pdf: { ext: ['.pdf'], label: 'PDF', color: '#F44336', reader: 'pdf' },
        txt: { ext: ['.txt'], label: 'TXT', color: '#2196F3', reader: 'text' },
        html: { ext: ['.html', '.htm'], label: 'HTML', color: '#FF9800', reader: 'html' },
        mobi: { ext: ['.mobi'], label: 'MOBI', color: '#9E9E9E', reader: null },
        azw: { ext: ['.azw', '.azw3'], label: 'AZW', color: '#9E9E9E', reader: null },
        kf8: { ext: ['.kf8', '.kfx'], label: 'KF8', color: '#9E9E9E', reader: null },
    },

    /** Accepted file extensions for the input */
    get acceptString() {
        return Object.values(this.FORMATS)
            .flatMap(f => f.ext)
            .join(',');
    },

    /**
     * Detect format from filename
     * @param {string} filename
     * @returns {{ format: string, info: object } | null}
     */
    detect(filename) {
        const name = filename.toLowerCase().trim();
        for (const [format, info] of Object.entries(this.FORMATS)) {
            for (const ext of info.ext) {
                if (name.endsWith(ext)) {
                    return { format, info };
                }
            }
        }
        return null;
    },

    /**
     * Check if format is supported (has a reader)
     * @param {string} format
     * @returns {boolean}
     */
    isSupported(format) {
        const info = this.FORMATS[format];
        return info && info.reader !== null;
    },

    /**
     * Check if text is predominantly Arabic/RTL
     * @param {string} text
     * @returns {boolean}
     */
    isRTL(text) {
        if (!text) return false;
        // Count Arabic/Hebrew/Persian characters
        const rtlChars = (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF]/g) || []).length;
        const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
        return rtlChars > latinChars;
    },

    /**
     * Get DRM warning message for unsupported formats
     * @param {string} format
     * @returns {string}
     */
    getDRMMessage(format) {
        const label = this.FORMATS[format]?.label || format.toUpperCase();
        return `
            <div class="ebook-drm-msg">
                <div class="ebook-drm-icon">🔒</div>
                <h3>${label}-Format nicht unterstützt</h3>
                <p>Dateien im ${label}-Format sind meist durch DRM (Digital Rights Management) geschützt
                   und können in Web-Apps nicht zuverlässig angezeigt werden.</p>
                <div class="ebook-drm-alt">
                    <strong>Alternativen:</strong>
                    <ul>
                        <li>📗 EPUB — bestes Format für Ebooks</li>
                        <li>📄 PDF — universell kompatibel</li>
                        <li>📝 TXT / HTML — für einfache Texte</li>
                    </ul>
                </div>
                <p class="ebook-drm-hint">💡 Tipp: Nutze <a href="https://calibre-ebook.com" target="_blank" rel="noopener">Calibre</a>
                   um E-Books in EPUB umzuwandeln (nur ohne DRM möglich).</p>
            </div>
        `;
    }
};
