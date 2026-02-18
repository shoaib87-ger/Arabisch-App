/**
 * ebook-readers.js — Individual reader implementations
 * EpubViewer  — epub.js based, Books-feeling with pagination
 * PdfViewer   — pdf.js based, page-by-page canvas rendering
 * TextViewer  — Paginated plain text with font-size control
 * HtmlViewer  — DOMPurify sanitized HTML with scroll + progress
 */

/* ===================================================================
 * EPUB VIEWER — Real Books feeling with epub.js
 * =================================================================*/
const EpubViewer = {
    book: null,
    rendition: null,
    bookId: null,
    locationsReady: false,
    totalLocations: 0,

    async open(blob, bookId, lastLocation) {
        this.bookId = bookId;
        const content = document.getElementById('ebookContent');
        content.innerHTML = '<div id="epubArea" style="width:100%;height:100%;"></div>';

        const arrayBuffer = await blob.arrayBuffer();
        this.book = ePub(arrayBuffer);

        this.rendition = this.book.renderTo('epubArea', {
            width: '100%',
            height: '100%',
            spread: 'none',
            flow: 'paginated',
            manager: 'continuous'
        });

        // Apply current theme
        this._applyTheme();

        // Display at last location or start
        if (lastLocation) {
            await this.rendition.display(lastLocation);
        } else {
            await this.rendition.display();
        }

        // Save location on page change
        this.rendition.on('relocated', (location) => {
            const cfi = location.start.cfi;
            EbookDB.updateLocation(this.bookId, cfi);
            this._updateProgress(location);
        });

        // Swipe/touch for page turn
        this.rendition.on('keyup', this._handleKey.bind(this));

        // Update page info
        EbookUI._updateTitle(this.book.packaging?.metadata?.title || '');

        // Generate locations for page-based navigation (async, may take a moment)
        this.locationsReady = false;
        this.totalLocations = 0;
        EbookUI._setGoToLoading(true);
        this.book.locations.generate(1024).then(() => {
            this.locationsReady = true;
            this.totalLocations = this.book.locations.total || 0;
            EbookUI._setGoToLoading(false);
            console.log(`📍 EPUB locations generated: ${this.totalLocations}`);
        }).catch(err => {
            console.warn('EPUB locations generation failed:', err);
            EbookUI._setGoToLoading(false);
        });
    },

    _applyTheme() {
        if (!this.rendition) return;
        const theme = EbookUI.currentTheme;
        const fontSize = EbookUI.currentFontSize;

        const themes = {
            light: { body: { color: '#1a1a1a', background: '#ffffff' } },
            dark: { body: { color: '#e0e0e0', background: '#1a1a1a' } },
            sepia: { body: { color: '#433422', background: '#f9f1e3' } }
        };

        this.rendition.themes.default({
            body: {
                ...themes[theme]?.body,
                'font-size': fontSize + 'px !important',
                'line-height': '1.7',
                'font-family': "'Amiri', 'Noto Naskh Arabic', 'Inter', sans-serif"
            },
            'p, div, span, li': {
                'font-size': fontSize + 'px !important'
            }
        });
    },

    _updateProgress(location) {
        if (this.locationsReady && this.totalLocations > 0) {
            const current = location?.start?.location || 0;
            EbookUI._setProgress(current + 1, this.totalLocations);
        } else {
            const pct = location?.start?.percentage;
            if (typeof pct === 'number') {
                EbookUI._setProgress(Math.round(pct * 100) + '%', '');
            }
        }
    },

    _handleKey(e) {
        if (e.key === 'ArrowRight') this.next();
        if (e.key === 'ArrowLeft') this.prev();
    },

    next() {
        if (this.rendition) this.rendition.next();
    },

    prev() {
        if (this.rendition) this.rendition.prev();
    },

    async getTOC() {
        if (!this.book) return [];
        const nav = await this.book.loaded.navigation;
        return nav.toc.map(ch => ({
            label: ch.label.trim(),
            href: ch.href
        }));
    },

    async goToChapter(href) {
        if (this.rendition) await this.rendition.display(href);
    },

    async goToPage(num) {
        if (!this.rendition || !this.locationsReady) return;
        const idx = Math.max(0, Math.min(num - 1, this.totalLocations - 1));
        const cfi = this.book.locations.cfiFromLocation(idx);
        if (cfi) {
            await this.rendition.display(cfi);
        }
    },

    updateFontSize(size) {
        this._applyTheme();
    },

    updateTheme() {
        this._applyTheme();
    },

    destroy() {
        if (this.book) {
            try { this.book.destroy(); } catch (e) { }
        }
        this.book = null;
        this.rendition = null;
        this.bookId = null;
        this.locationsReady = false;
        this.totalLocations = 0;
    }
};

/* ===================================================================
 * PDF VIEWER — Page-by-page canvas rendering (like Quran reader)
 * =================================================================*/
const PdfViewer = {
    pdf: null,
    currentPage: 1,
    totalPages: 0,
    bookId: null,
    _rendering: false,
    _isAnimating: false,
    _pageCache: new Map(),

    async open(blob, bookId, lastLocation) {
        this.bookId = bookId;
        this._pageCache.clear();
        this._isAnimating = false;
        const content = document.getElementById('ebookContent');
        content.innerHTML = `
            <div class="ebook-pdf-container" id="pdfContainer">
                <canvas id="ebookPdfCanvas"></canvas>
            </div>
        `;

        const arrayBuffer = await blob.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        this.pdf = await loadingTask.promise;
        this.totalPages = this.pdf.numPages;
        this.currentPage = lastLocation ? parseInt(lastLocation) : 1;
        if (this.currentPage > this.totalPages) this.currentPage = 1;

        await this._renderPage(this.currentPage);
        this._setupSwipe();
        EbookUI._setProgress(this.currentPage, this.totalPages);
    },

    async _renderPage(num) {
        if (this._rendering || !this.pdf) return;
        this._rendering = true;

        try {
            const page = await this.pdf.getPage(num);
            const canvas = document.getElementById('ebookPdfCanvas');
            if (!canvas) { this._rendering = false; return; }
            const ctx = canvas.getContext('2d');
            const container = document.getElementById('pdfContainer');

            // Scale to fit width (with optional zoom)
            const containerWidth = container.clientWidth;
            const viewport = page.getViewport({ scale: 1 });
            const baseScale = containerWidth / viewport.width;
            const scale = baseScale * (this._zoomScale || 1);
            const scaledVp = page.getViewport({ scale });

            canvas.width = scaledVp.width;
            canvas.height = scaledVp.height;

            await page.render({ canvasContext: ctx, viewport: scaledVp }).promise;

            this.currentPage = num;
            EbookDB.updateLocation(this.bookId, String(num));
            EbookUI._setProgress(num, this.totalPages);

            // Preload adjacent pages
            this._preload(num - 1);
            this._preload(num + 1);
        } catch (e) {
            console.error('PDF render error:', e);
        }
        this._rendering = false;
    },

    async _preload(num) {
        if (num < 1 || num > this.totalPages || this._pageCache.has(num)) return;
        try {
            const page = await this.pdf.getPage(num);
            this._pageCache.set(num, page);
        } catch (e) { /* ignore */ }
    },

    _setupSwipe() {
        const container = document.getElementById('pdfContainer');
        if (!container || container._swipeSetup) return;
        container._swipeSetup = true;
        let startX = 0, startY = 0, swiping = false;

        container.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            swiping = true;
        }, { passive: true });

        container.addEventListener('touchend', (e) => {
            if (!swiping) return;
            swiping = false;
            const dx = e.changedTouches[0].clientX - startX;
            const dy = e.changedTouches[0].clientY - startY;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
                if (dx < 0) this.next();
                else this.prev();
            }
        }, { passive: true });
    },

    /** Animate page flip like Quran reader */
    _animateFlip(direction, targetPage) {
        this._isAnimating = true;
        const container = document.getElementById('pdfContainer');
        if (!container) { this._isAnimating = false; return; }
        const exitClass = direction === 'left' ? 'page-exit-left' : 'page-exit-right';

        container.classList.add(exitClass);
        setTimeout(async () => {
            container.classList.remove(exitClass);
            await this._renderPage(targetPage);
            const enterClass = direction === 'left' ? 'page-enter-right' : 'page-enter-left';
            container.classList.add(enterClass);
            setTimeout(() => {
                container.classList.remove(enterClass);
                this._isAnimating = false;
            }, 300);
        }, 250);
    },

    next() {
        if (this._isAnimating || this.currentPage >= this.totalPages) return;
        this._animateFlip('left', this.currentPage + 1);
    },

    prev() {
        if (this._isAnimating || this.currentPage <= 1) return;
        this._animateFlip('right', this.currentPage - 1);
    },

    async getTOC() { return []; },
    async goToChapter() { },

    goToPage(num) {
        if (num >= 1 && num <= this.totalPages) {
            this._animateFlip(num > this.currentPage ? 'left' : 'right', num);
        }
    },

    updateFontSize(size) {
        // Use font-size as zoom level for PDF: 12→0.8x  18→1.0x  32→1.5x
        this._zoomScale = 0.8 + (size - 12) * (0.7 / 20);
        this._renderPage(this.currentPage);
    },

    updateTheme() {
        const container = document.getElementById('pdfContainer');
        const canvas = document.getElementById('ebookPdfCanvas');
        if (!container) return;
        const theme = EbookUI.currentTheme;

        // Container background
        container.style.background = theme === 'dark' ? '#1a1a1a' : theme === 'sepia' ? '#f9f1e3' : '#ffffff';

        // CSS filter on canvas for dark/sepia
        if (canvas) {
            if (theme === 'dark') {
                canvas.style.filter = 'invert(0.88) hue-rotate(180deg)';
            } else if (theme === 'sepia') {
                canvas.style.filter = 'sepia(0.35) contrast(0.95)';
            } else {
                canvas.style.filter = 'none';
            }
        }
    },

    destroy() {
        if (this.pdf) {
            try { this.pdf.destroy(); } catch (e) { }
        }
        this.pdf = null;
        this._pageCache.clear();
        this.bookId = null;
        this._rendering = false;
        this._isAnimating = false;
    }
};

/* ===================================================================
 * TEXT VIEWER — Paginated plain-text reader with font-size control
 * =================================================================*/
const TextViewer = {
    pages: [],
    currentPage: 0,
    bookId: null,
    _isAnimating: false,
    CHARS_PER_PAGE: 2000,

    async open(blob, bookId, lastLocation) {
        this.bookId = bookId;
        this._isAnimating = false;
        const text = await blob.text();
        const isRtl = EbookDetect.isRTL(text);

        // Split into pages at paragraph boundaries
        this.pages = this._paginate(text);
        this.currentPage = lastLocation ? parseInt(lastLocation) : 0;
        if (this.currentPage >= this.pages.length) this.currentPage = 0;

        const content = document.getElementById('ebookContent');
        content.innerHTML = `
            <div class="ebook-text-container" id="textContainer"
                 dir="${isRtl ? 'rtl' : 'ltr'}"
                 style="font-family: ${isRtl ? "'Amiri', 'Noto Naskh Arabic', serif" : "'Inter', sans-serif"};">
                <div class="ebook-text-page" id="textPage"></div>
            </div>
        `;

        this._renderPage();
        this._setupSwipe();
        EbookUI._setProgress(this.currentPage + 1, this.pages.length);
    },

    _paginate(text) {
        const pages = [];
        const paragraphs = text.split(/\n\n+/);
        let current = '';

        for (const para of paragraphs) {
            const trimmed = para.trim();
            if (!trimmed) continue;

            if (current.length + trimmed.length > this.CHARS_PER_PAGE && current.length > 0) {
                pages.push(current);
                current = trimmed;
            } else {
                current += (current ? '\n\n' : '') + trimmed;
            }
        }
        if (current) pages.push(current);
        if (pages.length === 0) pages.push(text || '(Leere Datei)');
        return pages;
    },

    _renderPage() {
        const el = document.getElementById('textPage');
        if (!el) return;
        const raw = this.pages[this.currentPage] || '';
        // Sanitize even plain text (escape HTML)
        const safe = typeof DOMPurify !== 'undefined'
            ? DOMPurify.sanitize(raw.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
            : raw.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        el.innerHTML = safe.replace(/\n/g, '<br>');
        el.style.fontSize = EbookUI.currentFontSize + 'px';

        // Scroll to top
        const container = document.getElementById('textContainer');
        if (container) container.scrollTop = 0;

        EbookDB.updateLocation(this.bookId, String(this.currentPage));
        EbookUI._setProgress(this.currentPage + 1, this.pages.length);
    },

    _setupSwipe() {
        const container = document.getElementById('textContainer');
        if (!container || container._swipeSetup) return;
        container._swipeSetup = true;
        let startX = 0, startY = 0, swiping = false;

        container.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            swiping = true;
        }, { passive: true });

        container.addEventListener('touchend', (e) => {
            if (!swiping) return;
            swiping = false;
            const dx = e.changedTouches[0].clientX - startX;
            const dy = e.changedTouches[0].clientY - startY;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
                if (dx < 0) this.next();
                else this.prev();
            }
        }, { passive: true });
    },

    /** Animate page flip like Quran reader */
    _animateFlip(direction) {
        this._isAnimating = true;
        const container = document.getElementById('textContainer');
        if (!container) { this._isAnimating = false; return; }
        const exitClass = direction === 'left' ? 'page-exit-left' : 'page-exit-right';

        container.classList.add(exitClass);
        setTimeout(() => {
            container.classList.remove(exitClass);
            if (direction === 'left') this.currentPage++;
            else this.currentPage--;
            this._renderPage();
            const enterClass = direction === 'left' ? 'page-enter-right' : 'page-enter-left';
            container.classList.add(enterClass);
            setTimeout(() => {
                container.classList.remove(enterClass);
                this._isAnimating = false;
            }, 300);
        }, 250);
    },

    next() {
        if (this._isAnimating || this.currentPage >= this.pages.length - 1) return;
        this._animateFlip('left');
    },

    prev() {
        if (this._isAnimating || this.currentPage <= 0) return;
        this._animateFlip('right');
    },

    async getTOC() { return []; },
    async goToChapter() { },

    goToPage(num) {
        const idx = num - 1;
        if (idx >= 0 && idx < this.pages.length) {
            this._isAnimating = true;
            this.currentPage = idx;
            this._renderPage();
            this._isAnimating = false;
        }
    },

    updateFontSize(size) {
        const el = document.getElementById('textPage');
        if (el) el.style.fontSize = size + 'px';
    },

    updateTheme() {
        const container = document.getElementById('textContainer');
        if (!container) return;
        const theme = EbookUI.currentTheme;
        const themes = {
            light: { color: '#1a1a1a', background: '#ffffff' },
            dark: { color: '#e0e0e0', background: '#1a1a1a' },
            sepia: { color: '#433422', background: '#f9f1e3' }
        };
        const t = themes[theme] || themes.light;
        container.style.color = t.color;
        container.style.background = t.background;
    },

    destroy() {
        this.pages = [];
        this.currentPage = 0;
        this.bookId = null;
        this._isAnimating = false;
    }
};

/* ===================================================================
 * HTML VIEWER — DOMPurify sanitized HTML with scroll + progress
 * =================================================================*/
const HtmlViewer = {
    bookId: null,
    _scrollHandler: null,

    async open(blob, bookId, lastLocation) {
        this.bookId = bookId;
        const rawHtml = await blob.text();
        const isRtl = EbookDetect.isRTL(rawHtml.replace(/<[^>]*>/g, '')); // Check text-only

        // Sanitize: strip scripts, iframes, forms
        const clean = typeof DOMPurify !== 'undefined'
            ? DOMPurify.sanitize(rawHtml, {
                ALLOWED_TAGS: ['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                    'br', 'hr', 'strong', 'em', 'b', 'i', 'u', 'a', 'ul', 'ol', 'li',
                    'table', 'tr', 'td', 'th', 'thead', 'tbody', 'blockquote', 'pre', 'code',
                    'img', 'figure', 'figcaption', 'section', 'article', 'header', 'footer',
                    'nav', 'main', 'aside', 'details', 'summary', 'sup', 'sub', 'mark'],
                ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'dir', 'lang',
                    'style', 'colspan', 'rowspan', 'target', 'rel'],
                FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input',
                    'textarea', 'select', 'button'],
            })
            : rawHtml.replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');

        const content = document.getElementById('ebookContent');
        content.innerHTML = `
            <div class="ebook-html-container" id="htmlContainer"
                 dir="${isRtl ? 'rtl' : 'ltr'}"
                 style="font-family: ${isRtl ? "'Amiri', 'Noto Naskh Arabic', serif" : "'Inter', sans-serif"};">
                <div class="ebook-html-page" id="htmlPage">${clean}</div>
            </div>
            <div class="ebook-progress-bar">
                <div class="ebook-progress-fill" id="htmlProgressFill"></div>
            </div>
        `;

        // Apply font size
        const page = document.getElementById('htmlPage');
        if (page) page.style.fontSize = EbookUI.currentFontSize + 'px';

        // Restore scroll position
        const container = document.getElementById('htmlContainer');
        if (container && lastLocation) {
            requestAnimationFrame(() => {
                container.scrollTop = parseInt(lastLocation) || 0;
            });
        }

        // Track scroll for progress + resume
        if (container) {
            this._scrollHandler = () => {
                const { scrollTop, scrollHeight, clientHeight } = container;
                const progress = scrollHeight > clientHeight
                    ? Math.round((scrollTop / (scrollHeight - clientHeight)) * 100)
                    : 100;
                const fill = document.getElementById('htmlProgressFill');
                if (fill) fill.style.width = progress + '%';
                EbookUI._setProgress(progress + '%', '');
                // Throttled save
                clearTimeout(this._saveTimer);
                this._saveTimer = setTimeout(() => {
                    EbookDB.updateLocation(this.bookId, String(container.scrollTop));
                }, 500);
            };
            container.addEventListener('scroll', this._scrollHandler, { passive: true });
        }
    },

    next() {
        const c = document.getElementById('htmlContainer');
        if (c) c.scrollBy({ top: c.clientHeight * 0.85, behavior: 'smooth' });
    },

    prev() {
        const c = document.getElementById('htmlContainer');
        if (c) c.scrollBy({ top: -c.clientHeight * 0.85, behavior: 'smooth' });
    },

    async getTOC() { return []; },
    async goToChapter() { },

    updateFontSize(size) {
        const page = document.getElementById('htmlPage');
        if (page) page.style.fontSize = size + 'px';
    },

    updateTheme() {
        const container = document.getElementById('htmlContainer');
        if (!container) return;
        const theme = EbookUI.currentTheme;
        const themes = {
            light: { color: '#1a1a1a', background: '#ffffff' },
            dark: { color: '#e0e0e0', background: '#1a1a1a' },
            sepia: { color: '#433422', background: '#f9f1e3' }
        };
        const t = themes[theme] || themes.light;
        container.style.color = t.color;
        container.style.background = t.background;
    },

    destroy() {
        const c = document.getElementById('htmlContainer');
        if (c && this._scrollHandler) {
            c.removeEventListener('scroll', this._scrollHandler);
        }
        this._scrollHandler = null;
        this.bookId = null;
    }
};
