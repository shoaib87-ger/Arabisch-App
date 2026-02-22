/**
 * srs-ui.js — SRS Review Session UI
 * Fullscreen overlay with card review flow, dashboard stats, and settings.
 */
const SrsUI = (() => {
    'use strict';

    let _fsrs = null;       // FSRS scheduler instance
    let _queue = [];         // current due cards
    let _currentCard = null; // card being reviewed
    let _isFlipped = false;
    let _deckFilter = null;
    let _sessionStats = { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 };

    // ── Initialization ──────────────────────────────────────────────
    async function _initScheduler() {
        const savedWeights = await SrsDB.getMeta('fsrs_weights');
        const savedRetention = await SrsDB.getMeta('requestRetention');
        const savedMaxIvl = await SrsDB.getMeta('maxIntervalDays');

        _fsrs = FSRS.create({
            weights: savedWeights || undefined,
            requestRetention: savedRetention || 0.9,
            maxIntervalDays: savedMaxIvl || 3650
        });

        // Save defaults if not yet stored
        if (!savedWeights) await SrsDB.setMeta('fsrs_weights', FSRS.DEFAULT_WEIGHTS);
        if (!savedRetention) await SrsDB.setMeta('requestRetention', 0.9);
        if (!savedMaxIvl) await SrsDB.setMeta('maxIntervalDays', 3650);
    }

    // ── Public: Open SRS Mode ───────────────────────────────────────
    async function open(deckFilter) {
        _deckFilter = deckFilter || null;
        _sessionStats = { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 };

        // Init DB + scheduler
        await SrsDB.init();
        await _initScheduler();

        // Sync cards from localStorage → IndexedDB
        await SrsAdapter.syncCards();

        // Build overlay
        _createOverlay();
        _showDashboard();
    }

    // ── Close SRS Mode ──────────────────────────────────────────────
    function close() {
        const overlay = document.getElementById('srsOverlay');
        if (overlay) overlay.remove();
        document.body.style.overflow = '';
        _queue = [];
        _currentCard = null;
        _isFlipped = false;
    }

    // ── Create Overlay Container ────────────────────────────────────
    function _createOverlay() {
        // Remove stale overlay
        const old = document.getElementById('srsOverlay');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'srsOverlay';
        overlay.className = 'srs-overlay';
        overlay.innerHTML = `
            <div class="srs-header">
                <button class="srs-back-btn" onclick="SrsUI.close()">‹ Zurück</button>
                <span class="srs-title">🧠 SRS Wiederholen</span>
                <button class="srs-settings-btn" onclick="SrsUI.toggleSettings()">⚙️</button>
            </div>
            <div class="srs-content" id="srsContent"></div>
            <div class="srs-settings-panel" id="srsSettings"></div>
        `;
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
    }

    // ── Dashboard ───────────────────────────────────────────────────
    async function _showDashboard() {
        const content = document.getElementById('srsContent');
        if (!content) return;

        const dueCards = await SrsDB.getDueCards(_deckFilter);
        const newCount = await SrsDB.countNew(_deckFilter);
        const allCards = await SrsDB.getAllCards();
        const totalCount = _deckFilter
            ? allCards.filter(c => c.deck === _deckFilter).length
            : allCards.length;
        const dueCount = dueCards.length;
        const reviewedToday = _sessionStats.reviewed;

        content.innerHTML = `
            <div class="srs-dashboard">
                <div class="srs-dashboard-icon">🧠</div>
                <h2 class="srs-dashboard-title">Spaced Repetition</h2>
                <p class="srs-dashboard-sub">Lerne Karten basierend auf wissenschaftlichem Spacing</p>

                <div class="srs-stats-grid">
                    <div class="srs-stat-card srs-stat-due">
                        <span class="srs-stat-number">${dueCount}</span>
                        <span class="srs-stat-label">Fällig</span>
                    </div>
                    <div class="srs-stat-card srs-stat-new">
                        <span class="srs-stat-number">${newCount}</span>
                        <span class="srs-stat-label">Neue</span>
                    </div>
                    <div class="srs-stat-card srs-stat-total">
                        <span class="srs-stat-number">${totalCount}</span>
                        <span class="srs-stat-label">Gesamt</span>
                    </div>
                </div>

                ${reviewedToday > 0 ? `
                    <div class="srs-session-info">
                        ✅ ${reviewedToday} Karten in dieser Sitzung gelernt
                    </div>
                ` : ''}

                ${dueCount > 0 ? `
                    <button class="srs-start-btn" onclick="SrsUI._startReview()">
                        ▶ ${dueCount} Karten wiederholen
                    </button>
                ` : `
                    <div class="srs-done-msg">
                        <span class="srs-done-icon">🎉</span>
                        <p>Alle Karten für heute gelernt!</p>
                        <p class="srs-done-hint">Komm später wieder für neue Wiederholungen.</p>
                    </div>
                `}

                <button class="srs-export-btn" onclick="SrsUI._showExportImport()">
                    📦 SRS Daten verwalten
                </button>
            </div>
        `;
    }

    // ── Start Review Session ────────────────────────────────────────
    async function _startReview() {
        _queue = await SrsDB.getDueCards(_deckFilter);
        // Sort: new cards first (state === 'new'), then by due ascending
        _queue.sort((a, b) => {
            if (a.state === 'new' && b.state !== 'new') return -1;
            if (a.state !== 'new' && b.state === 'new') return 1;
            return a.due - b.due;
        });

        _showNextCard();
    }

    // ── Show Next Card ──────────────────────────────────────────────
    function _showNextCard() {
        if (_queue.length === 0) {
            _showDashboard();
            return;
        }

        _currentCard = _queue.shift();
        _isFlipped = false;
        _renderCard();
    }

    // ── Render Card ─────────────────────────────────────────────────
    function _renderCard() {
        const content = document.getElementById('srsContent');
        if (!content || !_currentCard) return;

        const data = SrsAdapter.getDisplayData(_currentCard);
        const remaining = _queue.length + 1;
        const isAr = data.frontLang === 'ar';

        // Get the note for the current side
        const frontNote = data.frontLang === 'de' ? data.noteDe : data.noteAr;
        const backNote = data.frontLang === 'de' ? data.noteAr : data.noteDe;

        if (!_isFlipped) {
            // ── FRONT SIDE ──
            content.innerHTML = `
                <div class="srs-review-header">
                    <span class="srs-review-count">Noch ${remaining} Karte${remaining !== 1 ? 'n' : ''}</span>
                    <span class="srs-review-state">${_currentCard.state === 'new' ? '🆕 Neu' : '🔄 Wiederholung'}</span>
                </div>
                <div class="srs-card" onclick="SrsUI._flip()">
                    <div class="srs-card-text ${isAr ? 'ar' : ''}">${_renderFormatted(data.front)}</div>
                    ${frontNote ? `<div class="srs-card-note">${_escapeHtml(frontNote)}</div>` : ''}
                    <div class="srs-card-hint">Tippe um die Antwort zu sehen</div>
                </div>
            `;
        } else {
            // ── BACK SIDE (flipped) ──
            const backIsAr = (data.frontLang === 'de') ? true : false;
            content.innerHTML = `
                <div class="srs-review-header">
                    <span class="srs-review-count">Noch ${remaining} Karte${remaining !== 1 ? 'n' : ''}</span>
                    <span class="srs-review-state">${_currentCard.state === 'new' ? '🆕 Neu' : '🔄 Wiederholung'}</span>
                </div>
                <div class="srs-card srs-card-flipped">
                    <div class="srs-card-text srs-card-front-mini ${isAr ? 'ar' : ''}">${_renderFormatted(data.front)}</div>
                    <div class="srs-card-divider"></div>
                    <div class="srs-card-text srs-card-back ${backIsAr ? 'ar' : ''}">${_renderFormatted(data.back)}</div>
                    ${backNote ? `<div class="srs-card-note">${_escapeHtml(backNote)}</div>` : ''}
                    ${data.ex ? `<div class="srs-card-example">💡 ${_escapeHtml(data.ex)}</div>` : ''}
                </div>
                <div class="srs-rating-bar">
                    <button class="srs-rating-btn srs-rating-again" onclick="SrsUI._rate(0)">
                        <span class="srs-rating-label">Nochmal</span>
                        <span class="srs-rating-key">1</span>
                    </button>
                    <button class="srs-rating-btn srs-rating-hard" onclick="SrsUI._rate(1)">
                        <span class="srs-rating-label">Schwer</span>
                        <span class="srs-rating-key">2</span>
                    </button>
                    <button class="srs-rating-btn srs-rating-good" onclick="SrsUI._rate(2)">
                        <span class="srs-rating-label">Gut</span>
                        <span class="srs-rating-key">3</span>
                    </button>
                    <button class="srs-rating-btn srs-rating-easy" onclick="SrsUI._rate(3)">
                        <span class="srs-rating-label">Einfach</span>
                        <span class="srs-rating-key">4</span>
                    </button>
                </div>
            `;
        }
    }

    // ── Flip Card ───────────────────────────────────────────────────
    function _flip() {
        _isFlipped = true;
        _renderCard();
    }

    // ── Rate Card ───────────────────────────────────────────────────
    async function _rate(rating) {
        if (!_currentCard) return;

        // Compute elapsed days since last review
        const now = Date.now();
        const lastReviewed = _currentCard.lastReviewed || 0;
        const elapsedDays = lastReviewed > 0
            ? (now - lastReviewed) / (24 * 60 * 60 * 1000)
            : 0;

        // Schedule via FSRS
        const result = _fsrs.schedule(_currentCard, rating, elapsedDays);

        // Update card record
        _currentCard.stability = result.stability;
        _currentCard.difficulty = result.difficulty;
        _currentCard.due = result.due;
        _currentCard.reps = result.reps;
        _currentCard.lapses = result.lapses;
        _currentCard.state = result.state;
        _currentCard.lastReviewed = now;

        // Persist
        await SrsDB.putCard(_currentCard);

        // Log review
        await SrsDB.logReview({
            cardId: _currentCard.id,
            rating,
            elapsedDays,
            stability: result.stability,
            difficulty: result.difficulty,
            interval: result.interval,
            timestamp: now
        });

        // Update session stats
        _sessionStats.reviewed++;
        if (rating === 0) _sessionStats.again++;
        else if (rating === 1) _sessionStats.hard++;
        else if (rating === 2) _sessionStats.good++;
        else if (rating === 3) _sessionStats.easy++;

        // Haptic feedback if available
        try {
            if (window.Capacitor?.Plugins?.Haptics) {
                window.Capacitor.Plugins.Haptics.impact({ style: 'light' });
            }
        } catch (e) { /* ignore */ }

        // Next card
        _showNextCard();
    }

    // ── Settings Panel ──────────────────────────────────────────────
    async function toggleSettings() {
        const panel = document.getElementById('srsSettings');
        if (!panel) return;

        if (panel.classList.contains('active')) {
            panel.classList.remove('active');
            return;
        }

        const retention = (await SrsDB.getMeta('requestRetention')) || 0.9;
        const maxIvl = (await SrsDB.getMeta('maxIntervalDays')) || 3650;

        panel.innerHTML = `
            <div class="srs-settings-content">
                <div class="srs-settings-header">
                    <h4>⚙️ SRS Einstellungen</h4>
                    <button class="srs-settings-close" onclick="SrsUI.toggleSettings()">✕</button>
                </div>
                <div class="srs-setting-row">
                    <label>Ziel-Behaltensrate</label>
                    <div class="srs-setting-control">
                        <input type="range" id="srsRetention" min="80" max="95" value="${Math.round(retention * 100)}"
                               oninput="document.getElementById('srsRetentionVal').textContent = this.value + '%'">
                        <span id="srsRetentionVal">${Math.round(retention * 100)}%</span>
                    </div>
                </div>
                <div class="srs-setting-row">
                    <label>Max. Intervall (Tage)</label>
                    <input type="number" id="srsMaxIvl" value="${maxIvl}" min="30" max="36500" class="srs-setting-input">
                </div>
                <button class="srs-save-settings-btn" onclick="SrsUI._saveSettings()">💾 Speichern</button>
            </div>
        `;
        panel.classList.add('active');
    }

    async function _saveSettings() {
        const retention = parseInt(document.getElementById('srsRetention')?.value || '90') / 100;
        const maxIvl = parseInt(document.getElementById('srsMaxIvl')?.value || '3650');

        await SrsDB.setMeta('requestRetention', retention);
        await SrsDB.setMeta('maxIntervalDays', maxIvl);

        // Reinit scheduler with new params
        await _initScheduler();

        toggleSettings();
        if (typeof showToast === 'function') showToast('✅ Einstellungen gespeichert!', 'success');
    }

    // ── Export / Import ─────────────────────────────────────────────
    function _showExportImport() {
        const content = document.getElementById('srsContent');
        if (!content) return;

        content.innerHTML = `
            <div class="srs-dashboard">
                <h3>📦 SRS Daten verwalten</h3>
                <button class="srs-start-btn" onclick="SrsUI._exportData()">📤 SRS Daten exportieren</button>
                <button class="srs-start-btn srs-import-btn" onclick="document.getElementById('srsImportFile').click()">
                    📥 SRS Daten importieren
                </button>
                <input type="file" id="srsImportFile" accept=".json" style="display:none" onchange="SrsUI._importData(event)">
                <button class="srs-export-btn" onclick="SrsUI._showDashboard()">← Zurück</button>
            </div>
        `;
    }

    async function _exportData() {
        const data = await SrsDB.exportAll();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `srs-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        if (typeof showToast === 'function') showToast('✅ SRS Daten exportiert!', 'success');
    }

    async function _importData(event) {
        const file = event.target?.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            await SrsDB.importAll(data);
            if (typeof showToast === 'function') showToast(`✅ ${data.cards?.length || 0} Karten importiert!`, 'success');
            _showDashboard();
        } catch (e) {
            console.error('SRS Import error:', e);
            if (typeof showToast === 'function') showToast('❌ Import fehlgeschlagen: ' + e.message, 'error');
        }
        event.target.value = '';
    }

    // ── Keyboard shortcuts ──────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        const overlay = document.getElementById('srsOverlay');
        if (!overlay) return;

        if (!_isFlipped && (e.key === ' ' || e.key === 'Enter')) {
            e.preventDefault();
            _flip();
        } else if (_isFlipped) {
            if (e.key === '1') _rate(0);
            else if (e.key === '2') _rate(1);
            else if (e.key === '3') _rate(2);
            else if (e.key === '4') _rate(3);
        }
        if (e.key === 'Escape') close();
    });

    // ── Text helpers (use app.js functions if available) ─────────────
    function _renderFormatted(text) {
        if (typeof renderFormattedText === 'function') return renderFormattedText(text);
        return _escapeHtml(text);
    }

    function _escapeHtml(str) {
        if (typeof escapeHtml === 'function') return escapeHtml(str);
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Expose internals via underscore convention for onclick handlers
    return {
        open, close, toggleSettings,
        _startReview, _flip, _rate,
        _showDashboard, _showExportImport, _exportData, _importData,
        _saveSettings
    };
})();
