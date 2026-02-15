/**
 * quran-reader.js — Quran PDF Reader mit Buch-Effekt
 * Features: Canvas-Rendering, Swipe, Page-Flip, Resume, Preloading
 */

const QuranReader = {
    pdf: null,
    totalPages: 0,
    currentPage: 1,
    scale: 1.5,
    isOpen: false,
    isAnimating: false,
    isLoading: false,

    // Page cache (max 5 pages)
    pageCache: new Map(),
    maxCacheSize: 5,

    /**
     * Open the Quran reader
     */
    async open() {
        this.isOpen = true;
        const overlay = document.getElementById('quranOverlay');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Restore last page
        const saved = localStorage.getItem('quranPage');
        if (saved) this.currentPage = parseInt(saved) || 1;

        // Show loading
        this.showLoading('📖 Quran wird geladen...');

        try {
            if (!this.pdf) {
                // Decode embedded base64 PDF data (no fetch needed, works offline + file://)
                this.showLoading('📖 Quran wird dekodiert...');
                const binaryStr = atob(QURAN_PDF_BASE64);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) {
                    bytes[i] = binaryStr.charCodeAt(i);
                }
                const loadingTask = pdfjsLib.getDocument({ data: bytes });
                this.pdf = await loadingTask.promise;
                this.totalPages = this.pdf.numPages;
            }

            await this.renderPage(this.currentPage);
            this.setupSwipe();
        } catch (err) {
            console.error('❌ Quran Load Error:', err);
            this.showError('Fehler beim Laden des Quran');
        }
    },

    /**
     * Close the reader
     */
    close() {
        this.isOpen = false;
        const overlay = document.getElementById('quranOverlay');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    },

    /**
     * Render a specific page
     */
    async renderPage(pageNum) {
        if (pageNum < 1 || pageNum > this.totalPages) return;

        this.currentPage = pageNum;
        localStorage.setItem('quranPage', pageNum);
        this.updateNav();

        const container = document.getElementById('quranCanvasContainer');

        // Check cache first
        if (this.pageCache.has(pageNum)) {
            container.innerHTML = '';
            container.appendChild(this.pageCache.get(pageNum).cloneNode(true));
            this.hideLoading();
            this.preloadAdjacent(pageNum);
            return;
        }

        this.showLoading(`Seite ${pageNum}...`);

        try {
            const page = await this.pdf.getPage(pageNum);

            // Calculate scale to fit screen width (full width)
            const containerWidth = container.clientWidth || window.innerWidth;
            const viewport = page.getViewport({ scale: 1 });
            const dpr = window.devicePixelRatio || 1;
            const scale = (containerWidth / viewport.width) * dpr;
            const scaledViewport = page.getViewport({ scale });

            const canvas = document.createElement('canvas');
            canvas.className = 'quran-page-canvas';
            canvas.width = scaledViewport.width;
            canvas.height = scaledViewport.height;
            canvas.style.width = containerWidth + 'px';
            canvas.style.height = (scaledViewport.height / dpr) + 'px';

            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;

            // Store in cache
            this.addToCache(pageNum, canvas);

            // Display
            container.innerHTML = '';
            container.appendChild(canvas.cloneNode(true));

            // Copy the rendered content to the cloned canvas
            const displayCanvas = container.querySelector('canvas');
            const displayCtx = displayCanvas.getContext('2d');
            displayCtx.drawImage(canvas, 0, 0);

            this.hideLoading();

            // Preload adjacent pages
            this.preloadAdjacent(pageNum);

        } catch (err) {
            console.error('❌ Page Render Error:', err);
            this.hideLoading();
        }
    },

    /**
     * Cache management
     */
    addToCache(pageNum, canvas) {
        if (this.pageCache.size >= this.maxCacheSize) {
            // Remove furthest page from current
            let furthest = null;
            let maxDist = 0;
            for (const key of this.pageCache.keys()) {
                const dist = Math.abs(key - this.currentPage);
                if (dist > maxDist) {
                    maxDist = dist;
                    furthest = key;
                }
            }
            if (furthest !== null) this.pageCache.delete(furthest);
        }
        this.pageCache.set(pageNum, canvas);
    },

    /**
     * Preload adjacent pages
     */
    async preloadAdjacent(pageNum) {
        const toPreload = [pageNum + 1, pageNum - 1].filter(
            p => p >= 1 && p <= this.totalPages && !this.pageCache.has(p)
        );

        for (const p of toPreload) {
            try {
                const page = await this.pdf.getPage(p);
                const containerWidth = window.innerWidth;
                const viewport = page.getViewport({ scale: 1 });
                const dpr = window.devicePixelRatio || 1;
                const scale = (containerWidth / viewport.width) * dpr;
                const scaledViewport = page.getViewport({ scale });

                const canvas = document.createElement('canvas');
                canvas.width = scaledViewport.width;
                canvas.height = scaledViewport.height;

                const ctx = canvas.getContext('2d');
                await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
                this.addToCache(p, canvas);
            } catch (e) {
                // Silent fail for preloading
            }
        }
    },

    /**
     * Navigate to next/previous page with flip animation
     */
    flipNext() {
        if (this.isAnimating || this.currentPage >= this.totalPages) return;
        this.animateFlip('left', this.currentPage + 1);
    },

    flipPrev() {
        if (this.isAnimating || this.currentPage <= 1) return;
        this.animateFlip('right', this.currentPage - 1);
    },

    animateFlip(direction, targetPage) {
        this.isAnimating = true;
        const container = document.getElementById('quranCanvasContainer');
        const exitClass = direction === 'left' ? 'page-exit-left' : 'page-exit-right';

        container.classList.add(exitClass);

        setTimeout(async () => {
            container.classList.remove(exitClass);
            await this.renderPage(targetPage);

            const enterClass = direction === 'left' ? 'page-enter-right' : 'page-enter-left';
            container.classList.add(enterClass);

            setTimeout(() => {
                container.classList.remove(enterClass);
                this.isAnimating = false;
            }, 300);
        }, 250);
    },

    /**
     * Jump to specific page
     */
    goToPage(pageNum) {
        const p = Math.max(1, Math.min(this.totalPages, parseInt(pageNum) || 1));
        this.renderPage(p);
    },

    /**
     * Swipe gestures
     */
    setupSwipe() {
        const container = document.getElementById('quranCanvasContainer');
        if (!container || container._swipeSetup) return;
        container._swipeSetup = true;

        let startX = 0, startY = 0, isDragging = false;

        container.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isDragging = true;
        }, { passive: true });

        container.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            isDragging = false;
            const dx = e.changedTouches[0].clientX - startX;
            const dy = e.changedTouches[0].clientY - startY;

            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
                if (dx < 0) this.flipNext();
                else this.flipPrev();
            }
        }, { passive: true });
    },

    /**
     * Update navigation bar
     */
    updateNav() {
        const pageInfo = document.getElementById('quranPageInfo');
        const prevBtn = document.getElementById('quranPrevBtn');
        const nextBtn = document.getElementById('quranNextBtn');

        if (pageInfo) pageInfo.textContent = `Seite ${this.currentPage} / ${this.totalPages}`;
        if (prevBtn) prevBtn.disabled = this.currentPage <= 1;
        if (nextBtn) nextBtn.disabled = this.currentPage >= this.totalPages;
    },

    /**
     * Loading/error UI
     */
    showLoading(msg) {
        const el = document.getElementById('quranLoading');
        if (el) { el.textContent = msg; el.style.display = 'flex'; }
    },

    hideLoading() {
        const el = document.getElementById('quranLoading');
        if (el) el.style.display = 'none';
    },

    showError(msg) {
        const container = document.getElementById('quranCanvasContainer');
        container.innerHTML = `<div class="quran-error">${msg}</div>`;
        this.hideLoading();
    }
};
