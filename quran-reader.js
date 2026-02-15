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

    // Render generation counter — prevents race conditions
    renderGeneration: 0,
    currentRenderTask: null,

    /**
     * Clone a canvas WITH its pixel data (cloneNode does NOT copy pixels)
     */
    cloneCanvasWithPixels(srcCanvas) {
        const newCanvas = document.createElement('canvas');
        newCanvas.className = srcCanvas.className || 'quran-page-canvas';
        newCanvas.width = srcCanvas.width;
        newCanvas.height = srcCanvas.height;
        newCanvas.style.cssText = srcCanvas.style.cssText;
        const ctx = newCanvas.getContext('2d');
        ctx.drawImage(srcCanvas, 0, 0);
        return newCanvas;
    },

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
        // Cancel any in-flight render
        this.renderGeneration++;
        if (this.currentRenderTask) {
            try { this.currentRenderTask.cancel(); } catch (e) { /* ignore */ }
            this.currentRenderTask = null;
        }
        const overlay = document.getElementById('quranOverlay');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    },

    /**
     * Render a specific page (race-safe, with retry)
     */
    async renderPage(pageNum, _retryCount = 0) {
        if (pageNum < 1 || pageNum > this.totalPages) return;

        // Increment generation to invalidate any in-flight renders
        const myGeneration = ++this.renderGeneration;

        // Cancel previous render task if still running
        if (this.currentRenderTask) {
            try { this.currentRenderTask.cancel(); } catch (e) { /* ignore */ }
            this.currentRenderTask = null;
        }

        this.currentPage = pageNum;
        localStorage.setItem('quranPage', pageNum);
        this.updateNav();

        const container = document.getElementById('quranCanvasContainer');

        // Check cache first — display a pixel-copy of the cached canvas
        if (this.pageCache.has(pageNum)) {
            const cachedCanvas = this.pageCache.get(pageNum);
            const displayCanvas = this.cloneCanvasWithPixels(cachedCanvas);
            container.innerHTML = '';
            container.appendChild(displayCanvas);
            this.hideLoading();
            this.preloadAdjacent(pageNum);
            return;
        }

        this.showLoading(`Seite ${pageNum}...`);

        try {
            const page = await this.pdf.getPage(pageNum);

            // Abort if a newer render was requested
            if (myGeneration !== this.renderGeneration) return;

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
            const renderTask = page.render({ canvasContext: ctx, viewport: scaledViewport });
            this.currentRenderTask = renderTask;
            await renderTask.promise;
            this.currentRenderTask = null;

            // Abort if a newer render was requested while we were rendering
            if (myGeneration !== this.renderGeneration) return;

            // Store original rendered canvas in cache
            this.addToCache(pageNum, canvas);

            // Display a pixel-copy so cache stays intact
            const displayCanvas = this.cloneCanvasWithPixels(canvas);
            container.innerHTML = '';
            container.appendChild(displayCanvas);

            this.hideLoading();

            // Preload adjacent pages
            this.preloadAdjacent(pageNum);

        } catch (err) {
            // Ignore cancellation errors from stale renders
            if (err && err.name === 'RenderingCancelledException') return;
            if (myGeneration !== this.renderGeneration) return;

            console.error('❌ Page Render Error:', err);

            // Retry once on failure
            if (_retryCount < 1) {
                console.log(`🔄 Retry rendering page ${pageNum}...`);
                await this.renderPage(pageNum, _retryCount + 1);
                return;
            }

            this.hideLoading();
            this.showError(`Fehler beim Rendern von Seite ${pageNum}`);
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
