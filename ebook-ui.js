/**
 * ebook-ui.js — Main Ebook Reader controller
 * Library view, reader shell, settings, upload handling
 */
const EbookUI = {
    // State
    isOpen: false,
    activeReader: null,  // 'epub' | 'pdf' | 'text' | 'html'
    activeViewer: null,  // Reference to viewer object
    currentBookId: null,
    currentTheme: 'light',
    currentFontSize: 18,
    _uiVisible: true,

    // Apple Books icon SVG (inline)
    BOOKS_ICON: `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" class="ebook-books-icon">
        <defs>
            <linearGradient id="booksGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#1a5e3a"/>
                <stop offset="100%" style="stop-color:#0d3b24"/>
            </linearGradient>
        </defs>
        <rect width="120" height="120" rx="26" fill="url(#booksGrad)"/>
        <g transform="translate(20,25)" fill="white">
            <path d="M10,0 C10,0 10,55 10,60 C10,65 15,70 20,70 L35,70 C35,70 35,15 35,10 C35,5 30,0 25,0 Z" opacity="0.9"/>
            <path d="M40,0 C40,0 40,55 40,60 C40,65 35,70 30,70 L50,70 C55,70 60,65 60,60 L60,10 C60,5 55,0 50,0 Z" opacity="0.8"/>
            <path d="M65,5 C65,5 65,55 65,60 C65,65 60,70 55,70 L70,70 C75,70 80,65 80,60 L80,15 C80,10 75,5 70,5 Z" opacity="0.7"/>
        </g>
    </svg>`,

    /** Open the Ebook Reader (library view) */
    async open() {
        await EbookDB.init();
        const overlay = document.getElementById('ebookOverlay');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        this.isOpen = true;

        // Load saved preferences
        this.currentTheme = localStorage.getItem('ebookTheme') || 'light';
        this.currentFontSize = parseInt(localStorage.getItem('ebookFontSize')) || 18;

        this._showLibrary();
    },

    /** Close the entire ebook reader */
    close() {
        if (this.activeViewer) {
            this.activeViewer.destroy();
            this.activeViewer = null;
            this.activeReader = null;
        }
        const overlay = document.getElementById('ebookOverlay');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        this.isOpen = false;
        this.currentBookId = null;
    },

    /** Go back: if reading → library, if library → close */
    back() {
        if (this.activeViewer) {
            this.activeViewer.destroy();
            this.activeViewer = null;
            this.activeReader = null;
            this.currentBookId = null;
            this._showLibrary();
        } else {
            this.close();
        }
    },

    /* ====================================
     * LIBRARY VIEW
     * ==================================*/
    async _showLibrary() {
        const header = document.getElementById('ebookHeader');
        const footer = document.getElementById('ebookFooter');
        const content = document.getElementById('ebookContent');
        const settings = document.getElementById('ebookSettings');

        // Reset UI
        this._uiVisible = true;
        header.classList.remove('hidden');
        footer.classList.add('hidden');
        if (settings) settings.classList.remove('active');

        header.innerHTML = `
            <button class="ebook-back-btn" onclick="EbookUI.close()">‹ Zurück</button>
            <span class="ebook-title">📚 Meine Bücher</span>
            <div style="width:40px;"></div>
        `;

        const books = await EbookDB.list();

        let libraryHtml = `
            <div class="ebook-library">
                <button class="ebook-upload-btn" onclick="EbookUI.triggerUpload()">
                    <span class="ebook-upload-icon">+</span>
                    <span>Datei hochladen</span>
                    <span class="ebook-upload-formats">EPUB · PDF · TXT · HTML</span>
                </button>
                <input type="file" id="ebookFileInput" accept="${EbookDetect.acceptString}"
                       onchange="EbookUI.handleFileSelect(event)" style="display:none;">
        `;

        if (books.length === 0) {
            libraryHtml += `
                <div class="ebook-empty">
                    ${this.BOOKS_ICON}
                    <p>Noch keine Bücher</p>
                    <p class="ebook-empty-hint">Lade EPUB, PDF, TXT oder HTML Dateien hoch</p>
                </div>
            `;
        } else {
            libraryHtml += '<div class="ebook-grid">';
            for (const book of books) {
                const fmtInfo = EbookDetect.FORMATS[book.format] || {};
                const resumeHint = book.lastLocation ? '📖 Fortsetzen' : '';
                libraryHtml += `
                    <div class="ebook-card" onclick="EbookUI.openBook('${book.id}')">
                        <div class="ebook-card-cover">
                            <span class="ebook-card-icon">📕</span>
                        </div>
                        <div class="ebook-card-info">
                            <span class="ebook-card-title">${this._escapeHtml(book.name)}</span>
                            <span class="ebook-card-badge" style="background:${fmtInfo.color || '#666'}">${fmtInfo.label || '?'}</span>
                            ${resumeHint ? `<span class="ebook-card-resume">${resumeHint}</span>` : ''}
                        </div>
                        <button class="ebook-card-delete" onclick="event.stopPropagation(); EbookUI.deleteBook('${book.id}')" title="Löschen">🗑️</button>
                    </div>
                `;
            }
            libraryHtml += '</div>';
        }

        libraryHtml += '</div>';
        content.innerHTML = libraryHtml;
        content.className = 'ebook-content';
    },

    /** Trigger file picker */
    triggerUpload() {
        document.getElementById('ebookFileInput').click();
    },

    /** Handle file selection */
    async handleFileSelect(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        event.target.value = ''; // Reset for re-upload

        const detected = EbookDetect.detect(file.name);
        if (!detected) {
            alert('Unbekanntes Dateiformat. Bitte EPUB, PDF, TXT oder HTML verwenden.');
            return;
        }

        // Unsupported format (MOBI/AZW)
        if (!EbookDetect.isSupported(detected.format)) {
            const content = document.getElementById('ebookContent');
            content.innerHTML = EbookDetect.getDRMMessage(detected.format);
            return;
        }

        // Save to IndexedDB
        const id = 'book_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        const bookObj = {
            id,
            name: file.name.replace(/\.[^.]+$/, ''), // Strip extension
            format: detected.format,
            blob: file,
            lastLocation: null,
            addedAt: Date.now()
        };

        try {
            await EbookDB.save(bookObj);
            await this.openBook(id);
        } catch (e) {
            console.error('Save error:', e);
            alert('Fehler beim Speichern: ' + e.message);
        }
    },

    /** Open a book by ID */
    async openBook(id) {
        const book = await EbookDB.get(id);
        if (!book) {
            alert('Buch nicht gefunden.');
            return;
        }

        this.currentBookId = id;
        const content = document.getElementById('ebookContent');
        content.innerHTML = '<div class="ebook-loading">📖 Wird geladen...</div>';
        content.className = 'ebook-content ebook-reader-active';

        // Setup reader shell
        this._setupReaderShell(book);

        // Determine viewer
        const viewers = {
            epub: EpubViewer,
            pdf: PdfViewer,
            text: TextViewer,
            html: HtmlViewer
        };
        const reader = EbookDetect.FORMATS[book.format]?.reader;
        this.activeReader = reader;
        this.activeViewer = viewers[reader];

        if (!this.activeViewer) {
            content.innerHTML = '<div class="ebook-loading">❌ Kein Viewer für dieses Format</div>';
            return;
        }

        try {
            await this.activeViewer.open(book.blob, id, book.lastLocation);
            this._applyThemeToShell();
        } catch (e) {
            console.error('Reader error:', e);
            content.innerHTML = `<div class="ebook-loading">❌ Fehler: ${e.message}</div>`;
        }
    },

    /** Delete a book */
    async deleteBook(id) {
        if (!confirm('Buch wirklich löschen?')) return;
        await EbookDB.delete(id);
        this._showLibrary();
    },

    /* ====================================
     * READER SHELL — Books-like UI
     * ==================================*/
    _setupReaderShell(book) {
        const header = document.getElementById('ebookHeader');
        const footer = document.getElementById('ebookFooter');

        // Header
        header.innerHTML = `
            <button class="ebook-back-btn" onclick="EbookUI.back()">‹ Zurück</button>
            <span class="ebook-title" id="ebookBookTitle">${this._escapeHtml(book.name)}</span>
            <button class="ebook-settings-btn" onclick="EbookUI.toggleSettings()">⚙️</button>
        `;

        // Footer with nav + progress
        footer.innerHTML = `
            <button class="ebook-nav-btn" onclick="EbookUI.prev()">‹</button>
            <span class="ebook-progress" id="ebookProgress">—</span>
            <button class="ebook-nav-btn" onclick="EbookUI.next()">›</button>
        `;
        footer.classList.remove('hidden');

        // Settings panel
        this._renderSettings();

        // Tap center toggles UI
        const content = document.getElementById('ebookContent');
        content.onclick = (e) => {
            // Only toggle if tapping in the center third
            const rect = content.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const third = rect.width / 3;
            if (x > third && x < third * 2) {
                this._toggleUI();
            }
        };

        // Universal swipe handler — works for ALL reader types
        if (!content._swipeSetup) {
            content._swipeSetup = true;
            let startX = 0, startY = 0, swiping = false;
            content.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                swiping = true;
            }, { passive: true });
            content.addEventListener('touchend', (e) => {
                if (!swiping) return;
                swiping = false;
                const dx = e.changedTouches[0].clientX - startX;
                const dy = e.changedTouches[0].clientY - startY;
                if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
                    if (dx < 0) this.next();
                    else this.prev();
                }
            }, { passive: true });
        }
    },

    _renderSettings() {
        let panel = document.getElementById('ebookSettings');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'ebookSettings';
            panel.className = 'ebook-settings-panel';
            document.getElementById('ebookOverlay').appendChild(panel);
        }

        panel.innerHTML = `
            <div class="ebook-settings-content">
                <h4>Einstellungen</h4>
                <div class="ebook-setting-row">
                    <label>Schriftgröße</label>
                    <div class="ebook-font-controls">
                        <button onclick="EbookUI.changeFontSize(-2)">A-</button>
                        <span id="ebookFontSizeLabel">${this.currentFontSize}px</span>
                        <button onclick="EbookUI.changeFontSize(2)">A+</button>
                    </div>
                </div>
                <div class="ebook-setting-row">
                    <label>Theme</label>
                    <div class="ebook-theme-btns">
                        <button class="ebook-theme-btn ${this.currentTheme === 'light' ? 'active' : ''}"
                                onclick="EbookUI.setTheme('light')"
                                style="background:#fff;color:#1a1a1a;border:1px solid #ccc;">☀️ Hell</button>
                        <button class="ebook-theme-btn ${this.currentTheme === 'sepia' ? 'active' : ''}"
                                onclick="EbookUI.setTheme('sepia')"
                                style="background:#f9f1e3;color:#433422;">📜 Sepia</button>
                        <button class="ebook-theme-btn ${this.currentTheme === 'dark' ? 'active' : ''}"
                                onclick="EbookUI.setTheme('dark')"
                                style="background:#1a1a1a;color:#e0e0e0;">🌙 Dunkel</button>
                    </div>
                </div>
            </div>
        `;
        panel.classList.remove('active');
    },

    toggleSettings() {
        const panel = document.getElementById('ebookSettings');
        if (panel) panel.classList.toggle('active');
    },

    changeFontSize(delta) {
        this.currentFontSize = Math.max(12, Math.min(32, this.currentFontSize + delta));
        localStorage.setItem('ebookFontSize', this.currentFontSize);
        const label = document.getElementById('ebookFontSizeLabel');
        if (label) label.textContent = this.currentFontSize + 'px';
        if (this.activeViewer) this.activeViewer.updateFontSize(this.currentFontSize);
    },

    setTheme(theme) {
        this.currentTheme = theme;
        localStorage.setItem('ebookTheme', theme);
        this._applyThemeToShell();
        if (this.activeViewer) this.activeViewer.updateTheme();
        this._renderSettings();
    },

    _applyThemeToShell() {
        const overlay = document.getElementById('ebookOverlay');
        overlay.setAttribute('data-theme', this.currentTheme);
    },

    _toggleUI() {
        this._uiVisible = !this._uiVisible;
        // Header (back button) always stays visible
        const footer = document.getElementById('ebookFooter');
        footer.classList.toggle('hidden', !this._uiVisible);
    },

    /* ====================================
     * NAVIGATION HELPERS
     * ==================================*/
    next() {
        if (this.activeViewer) this.activeViewer.next();
    },

    prev() {
        if (this.activeViewer) this.activeViewer.prev();
    },

    _setProgress(current, total) {
        const el = document.getElementById('ebookProgress');
        if (!el) return;
        if (typeof total === 'string' || total === '') {
            el.textContent = String(current);
        } else {
            el.textContent = `${current} / ${total}`;
        }
    },

    _updateTitle(title) {
        const el = document.getElementById('ebookBookTitle');
        if (el && title) el.textContent = title;
    },

    /* ====================================
     * UTILITIES
     * ==================================*/
    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};
