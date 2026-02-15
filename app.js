/**
 * app.js — Hauptlogik: State, UI, Kapitel, Karteikarten, Lernmodus-Auswahl
 * Integriert Quiz-Engine und Statistik-Modul
 */

// ===== STATE =====
const AppState = {
    categories: [],
    cards: [],
    pending: [],
    currentCat: null,
    currentCards: [],
    currentIdx: 0,
    flipped: false,
    editingCatId: null,
    selectedIcon: null,
    isProcessing: false,
    previewURL: null,
    // Swipe state
    touchStartX: 0,
    touchStartY: 0,
    touchCurrentX: 0,
    isSwiping: false,
};

const ICONS = ['📝', '🏃', '🏠', '🍕', '✈️', '🏥', '💼', '🎓', '⚽', '🎵', '📚', '🌍', '🎨', '🔧', '💊', '🎯', '🚗', '📱', '💡', '🎪'];

// ===== STORAGE =====
const Storage = {
    load() {
        try {
            AppState.categories = JSON.parse(localStorage.getItem('cats')) || [
                { id: 'verben', name: 'Verben', icon: '🏃' },
                { id: 'nomen', name: 'Nomen', icon: '📝' },
                { id: 'alltag', name: 'Alltag', icon: '🏠' },
            ];
            AppState.cards = JSON.parse(localStorage.getItem('cards')) || [];

            const savedPending = sessionStorage.getItem('pending');
            if (savedPending) {
                AppState.pending = JSON.parse(savedPending);
            }

            console.log(`📊 Geladen: ${AppState.categories.length} Kapitel, ${AppState.cards.length} Karten, ${AppState.pending.length} Pending`);
        } catch (e) {
            console.error('❌ Storage Load Error:', e);
        }
    },

    save() {
        try {
            localStorage.setItem('cats', JSON.stringify(AppState.categories));
            localStorage.setItem('cards', JSON.stringify(AppState.cards));
        } catch (e) {
            console.error('❌ Storage Save Error:', e);
            if (e.name === 'QuotaExceededError') {
                showToast('⚠️ Speicher voll! Lösche alte Kapitel.', 'warning');
            }
        }
    },

    savePending() {
        try {
            sessionStorage.setItem('pending', JSON.stringify(AppState.pending));
        } catch (e) {
            console.warn('⚠️ SessionStorage Error:', e);
        }
    },

    clearPending() {
        AppState.pending = [];
        sessionStorage.removeItem('pending');
    }
};

// ===== TOAST =====
let toastTimeout = null;
function showToast(message, type = 'info', duration = 2800) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }

    if (type === 'info') {
        if (message.startsWith('✅') || message.startsWith('🎉')) type = 'success';
        else if (message.startsWith('⚠️')) type = 'warning';
        else if (message.startsWith('❌')) type = 'error';
    }

    toast.innerHTML = `
        <span>${message}</span>
        <div class="toast-progress" style="animation-duration: ${duration}ms;"></div>
    `;

    toast.className = 'toast';
    if (toastTimeout) clearTimeout(toastTimeout);

    requestAnimationFrame(() => {
        toast.classList.add('visible', `toast-${type}`);
        toastTimeout = setTimeout(() => {
            toast.classList.remove('visible');
        }, duration);
    });
}

// ===== TAB NAVIGATION =====
function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));

    const tabEl = document.querySelector(`[data-tab="${tabName}"]`);
    const contentEl = document.getElementById(tabName);
    if (tabEl) tabEl.classList.add('active');
    if (contentEl) contentEl.classList.add('active');

    if (tabName === 'categories') renderCategories();
    if (tabName === 'stats') Stats.render(AppState.categories, AppState.cards);
    if (tabName === 'learn') {
        // If no category selected, show empty state
        if (!AppState.currentCat) {
            const learnArea = document.getElementById('learnArea');
            learnArea.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🎯</div>
                    <p>Wähle ein Kapitel<br>und starte eine Lernsession!</p>
                </div>
            `;
        }
    }
}

// ===== KAPITEL MANAGEMENT =====
function renderCategories() {
    const grid = document.getElementById('categoryGrid');
    const sel = document.getElementById('targetCat');

    grid.innerHTML = AppState.categories.map(cat => {
        const count = AppState.cards.filter(c => c.cat === cat.id).length;
        const prog = Stats.getChapterProgress(cat.id, AppState.cards);
        const circumference = 2 * Math.PI * 14;
        const offset = circumference - (prog.pct / 100) * circumference;

        return `
            <div class="category-card" onclick="selectCat('${cat.id}')">
                <div class="category-actions" onclick="event.stopPropagation()">
                    <button class="icon-btn" onclick="exportCSV('${cat.id}')" aria-label="Exportieren" title="CSV Export">📤</button>
                    <button class="icon-btn" onclick="editCategory('${cat.id}')" aria-label="Bearbeiten">✏️</button>
                    <button class="icon-btn delete" onclick="deleteCategory('${cat.id}')" aria-label="Löschen">🗑️</button>
                </div>
                <div class="category-icon">${cat.icon}</div>
                <div class="category-name">${escapeHtml(cat.name)}</div>
                <div class="category-count">${count} Karten</div>
                ${count > 0 ? `
                    <div class="category-progress">
                        <svg class="progress-ring" viewBox="0 0 36 36">
                            <circle class="progress-ring-bg" cx="18" cy="18" r="14" />
                            <circle class="progress-ring-fill" cx="18" cy="18" r="14"
                                stroke-dasharray="${circumference}"
                                stroke-dashoffset="${offset}" />
                        </svg>
                        <div class="category-progress-text">${prog.pct}%</div>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');

    if (sel) {
        sel.innerHTML = AppState.categories.map(c =>
            `<option value="${c.id}">${c.icon} ${c.name}</option>`
        ).join('');
    }

    // Also update CSV import chapter selector
    renderCSVCatSelect();
}

function openNewCatModal() {
    document.getElementById('newCatName').value = '';
    AppState.selectedIcon = ICONS[0];
    renderIconPicker('newCatIconPicker', ICONS[0], 'selectNewCatIcon');
    document.getElementById('newCatModal').classList.add('active');
}

function selectNewCatIcon(icon) {
    AppState.selectedIcon = icon;
    highlightIcon('newCatIconPicker', icon);
}

function saveNewCat() {
    const name = document.getElementById('newCatName').value.trim();
    if (!name) {
        showToast('⚠️ Bitte einen Namen eingeben!', 'warning');
        return;
    }

    const newCat = {
        id: 'cat_' + Date.now(),
        name: name,
        icon: AppState.selectedIcon || ICONS[0]
    };

    AppState.categories.push(newCat);
    Storage.save();
    renderCategories();
    closeModal('newCatModal');
    showToast(`✅ "${name}" erstellt!`, 'success');
}

function editCategory(catId) {
    const cat = AppState.categories.find(c => c.id === catId);
    if (!cat) return;
    AppState.editingCatId = catId;
    AppState.selectedIcon = cat.icon;
    document.getElementById('editName').value = cat.name;
    renderIconPicker('editIconPicker', cat.icon, 'selectEditIcon');
    document.getElementById('editModal').classList.add('active');
}

function selectEditIcon(icon) {
    AppState.selectedIcon = icon;
    highlightIcon('editIconPicker', icon);
}

function saveEdit() {
    const cat = AppState.categories.find(c => c.id === AppState.editingCatId);
    if (!cat) return;
    const newName = document.getElementById('editName').value.trim();
    if (!newName) {
        showToast('⚠️ Bitte Namen eingeben!', 'warning');
        return;
    }
    cat.name = newName;
    cat.icon = AppState.selectedIcon;
    Storage.save();
    renderCategories();
    closeModal('editModal');
    AppState.editingCatId = null;
    showToast('✅ Aktualisiert!', 'success');
}

function deleteCategory(catId) {
    const cat = AppState.categories.find(c => c.id === catId);
    if (!cat) return;
    const cardCount = AppState.cards.filter(c => c.cat === catId).length;
    const msg = cardCount > 0
        ? `⚠️ "${cat.name}" enthält ${cardCount} Karten!\n\nWirklich löschen?`
        : `"${cat.name}" löschen?`;
    if (!confirm(msg)) return;
    AppState.categories = AppState.categories.filter(c => c.id !== catId);
    AppState.cards = AppState.cards.filter(c => c.cat !== catId);
    Storage.save();
    renderCategories();
    showToast(`🗑️ "${cat.name}" gelöscht`, 'info');
}

// ===== KAPITEL AUSWÄHLEN → LERNMODUS =====
function selectCat(id) {
    AppState.currentCat = id;
    AppState.currentCards = AppState.cards.filter(c => c.cat === id);
    AppState.currentIdx = 0;
    AppState.flipped = false;

    if (AppState.currentCards.length === 0) {
        showToast('📭 Keine Karten in diesem Kapitel', 'info');
        return;
    }

    // Switch to learn tab and show mode selection
    switchTab('learn');
    showLearnModes();
}

// ===== LERNMODUS AUSWAHL =====
function showLearnModes() {
    const cat = AppState.categories.find(c => c.id === AppState.currentCat);
    if (!cat) return;

    const cardCount = AppState.currentCards.length;
    const prog = Stats.getChapterProgress(cat.id, AppState.cards);
    const hasEnoughForQuiz = cardCount >= 4; // Need 4+ for good distractors

    const learnArea = document.getElementById('learnArea');
    learnArea.innerHTML = `
        <div class="learn-chapter-header">
            <button class="back-btn" onclick="switchTab('categories')">←</button>
            <h3>${cat.icon} ${escapeHtml(cat.name)}</h3>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">
            ${cardCount} Karten · ${prog.pct}% gemeistert
        </p>

        <div class="learn-mode-grid">
            <div class="learn-mode-card" onclick="startFlashcards()">
                <div class="learn-mode-icon">🃏</div>
                <div class="learn-mode-info">
                    <h4>Karteikarten</h4>
                    <p>Klassisch: Karte umdrehen und lernen</p>
                </div>
            </div>

            <div class="learn-mode-card ${!hasEnoughForQuiz ? 'disabled' : ''}"
                 onclick="${hasEnoughForQuiz ? "startQuiz('de-ar')" : ''}">
                <div class="learn-mode-icon">📝</div>
                <div class="learn-mode-info">
                    <h4>Quiz: Deutsch → Arabisch</h4>
                    <p>${hasEnoughForQuiz ? 'Multiple Choice mit 4 Antworten' : '⚠️ Min. 4 Karten nötig'}</p>
                </div>
            </div>

            <div class="learn-mode-card ${!hasEnoughForQuiz ? 'disabled' : ''}"
                 onclick="${hasEnoughForQuiz ? "startQuiz('ar-de')" : ''}">
                <div class="learn-mode-icon">🔤</div>
                <div class="learn-mode-info">
                    <h4>Quiz: Arabisch → Deutsch</h4>
                    <p>${hasEnoughForQuiz ? 'Arabisches Wort erkennen' : '⚠️ Min. 4 Karten nötig'}</p>
                </div>
            </div>
        </div>
    `;
}

function startFlashcards() {
    AppState.currentIdx = 0;
    AppState.flipped = false;
    showCard();
}

function startQuiz(direction) {
    QuizEngine.start(AppState.currentCat, direction);
}

// ===== ICON PICKER =====
function renderIconPicker(containerId, selectedIcon, onClickFn) {
    const picker = document.getElementById(containerId);
    picker.innerHTML = ICONS.map(icon => `
        <div class="icon-option ${icon === selectedIcon ? 'selected' : ''}"
             onclick="${onClickFn}('${icon}')"
             data-icon="${icon}">
            ${icon}
        </div>
    `).join('');
}

function highlightIcon(containerId, selectedIcon) {
    document.querySelectorAll(`#${containerId} .icon-option`).forEach(el => {
        el.classList.toggle('selected', el.dataset.icon === selectedIcon);
    });
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// ===== UPLOAD & OCR =====
function openCamera() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png';
    input.capture = 'environment';
    input.onchange = () => handleUpload(input);
    input.click();
}

function triggerFileUpload() {
    document.getElementById('fileInput').click();
}

async function handleUpload(input) {
    if (!input.files || !input.files[0]) return;
    if (AppState.isProcessing) {
        showToast('⏳ Bitte warten, OCR läuft noch...', 'warning');
        return;
    }

    const file = input.files[0];

    if (AppState.pending.length > 0) {
        if (!confirm(`${AppState.pending.length} Wörter bereits in der Liste.\n\nÜberschreiben?\n\nOK = Löschen\nAbbrechen = Behalten`)) {
            input.value = '';
            return;
        }
        Storage.clearPending();
        renderPending();
    }

    AppState.isProcessing = true;

    try {
        if (file.type === 'application/pdf') {
            await processPdf(file);
        } else if (file.type.startsWith('image/')) {
            await processImage(file);
        } else {
            showToast('❌ Format nicht unterstützt (JPG, PNG, PDF)', 'error');
        }
    } catch (error) {
        console.error('❌ Upload Error:', error);
        updateProgress('❌ Fehler: ' + error.message, 100, 'danger');
        showToast('❌ ' + error.message, 'error');
    } finally {
        AppState.isProcessing = false;
        input.value = '';
    }
}

async function processImage(file) {
    showProgress();
    updateProgress('🔧 Bild wird optimiert...', 10);
    const { originalBlob, processedBlob, thumbnail } = await ImagePreprocessor.process(file);
    showPreview(thumbnail);
    const words = await performOCR(originalBlob, processedBlob, (status, pct) => updateProgress(status, pct));
    handleOCRResults(words);
}

async function processPdf(file) {
    showProgress();
    const { words, thumbnail } = await PdfHandler.process(
        file,
        (status, pct) => updateProgress(status, pct),
        async (blob) => await performOCR(blob, () => { })
    );
    if (thumbnail) showPreview(thumbnail);
    handleOCRResults(words);
}

function handleOCRResults(words) {
    if (!words || words.length === 0) {
        updateProgress('⚠️ Keine Wortpaare erkannt', 100, 'warning');
        showToast('⚠️ Keine Wortpaare erkannt.', 'warning');
        hideProgressDelayed();
        return;
    }

    AppState.pending = AppState.pending.concat(words);
    Storage.savePending();
    renderPending();
    updateProgress(`✅ ${words.length} Wortpaare erkannt!`, 100, 'success');
    showToast(`✅ ${words.length} Wortpaare erkannt!`, 'success');
    hideProgressDelayed();
}

// ===== PROGRESS UI =====
function showProgress() {
    document.getElementById('progressContainer').classList.add('visible');
}

function updateProgress(status, percent, type = 'normal') {
    const statusEl = document.getElementById('progressStatus');
    const barEl = document.getElementById('progressBar');
    if (statusEl) statusEl.textContent = status;
    if (barEl) {
        barEl.style.width = percent + '%';
        if (type === 'success') barEl.style.background = 'var(--success)';
        else if (type === 'warning') barEl.style.background = 'var(--warning)';
        else if (type === 'danger') barEl.style.background = 'var(--danger)';
        else barEl.style.background = 'var(--gradient-gold)';
    }
}

function hideProgressDelayed() {
    setTimeout(() => {
        document.getElementById('progressContainer').classList.remove('visible');
        updateProgress('', 0);
    }, 3000);
}

function showPreview(src) {
    const container = document.getElementById('imagePreview');
    const img = document.getElementById('previewImg');
    if (img) img.src = src;
    if (container) container.classList.add('visible');
}

function hidePreview() {
    const container = document.getElementById('imagePreview');
    const img = document.getElementById('previewImg');
    if (container) container.classList.remove('visible');
    if (img) img.src = '';
}

// ===== MANUAL ADD =====
function addWord() {
    const de = document.getElementById('germanWord').value.trim();
    const ar = document.getElementById('arabicWord').value.trim();
    const ex = document.getElementById('exampleText').value.trim();
    if (!de || !ar) {
        showToast('⚠️ Deutsch + Arabisch ausfüllen!', 'warning');
        return;
    }
    AppState.pending.push({ de, ar, ex });
    Storage.savePending();
    document.getElementById('germanWord').value = '';
    document.getElementById('arabicWord').value = '';
    document.getElementById('exampleText').value = '';
    renderPending();
    showToast('➕ Wort hinzugefügt', 'success');
}

function removeWord(i) {
    AppState.pending.splice(i, 1);
    Storage.savePending();
    renderPending();
}

function renderPending() {
    const container = document.getElementById('pendingContainer');
    const list = document.getElementById('pendingList');
    const count = document.getElementById('pendingCount');

    if (AppState.pending.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    count.textContent = AppState.pending.length;
    list.innerHTML = AppState.pending.map((w, i) => `
        <div class="pending-word">
            <div class="pending-word-text">
                <strong>${escapeHtml(w.de)}</strong> → <strong class="ar">${escapeHtml(w.ar)}</strong>
                ${w.ex ? `<div class="example">💡 ${escapeHtml(w.ex)}</div>` : ''}
            </div>
            <button class="remove-btn" onclick="removeWord(${i})" aria-label="Entfernen">×</button>
        </div>
    `).join('');
}

// ===== CARD CREATION =====
function createCards() {
    const catId = document.getElementById('targetCat').value;
    const dir = document.querySelector('input[name="dir"]:checked').value;

    if (!catId) { showToast('⚠️ Kapitel wählen!', 'warning'); return; }
    if (AppState.pending.length === 0) { showToast('⚠️ Keine Wörter vorhanden!', 'warning'); return; }

    let created = 0;
    AppState.pending.forEach(w => {
        if (dir === 'both' || dir === 'de-ar') {
            AppState.cards.push({
                front: w.de, back: w.ar,
                frontLang: 'de', backLang: 'ar',
                ex: w.ex, cat: catId,
                score: 0, correctCount: 0, wrongCount: 0, lastSeen: null
            });
            created++;
        }
        if (dir === 'both' || dir === 'ar-de') {
            AppState.cards.push({
                front: w.ar, back: w.de,
                frontLang: 'ar', backLang: 'de',
                ex: w.ex, cat: catId,
                score: 0, correctCount: 0, wrongCount: 0, lastSeen: null
            });
            created++;
        }
    });

    Storage.save();
    fullReset();

    const cat = AppState.categories.find(c => c.id === catId);
    showToast(`✅ ${created} Karten erstellt in "${cat.name}"!`, 'success');
    renderCategories();
}

function fullReset() {
    Storage.clearPending();
    if (AppState.previewURL) {
        URL.revokeObjectURL(AppState.previewURL);
        AppState.previewURL = null;
    }
    AppState.isProcessing = false;
    const input = document.getElementById('fileInput');
    if (input) input.value = '';
    hidePreview();
    hideProgressDelayed();
    renderPending();
}

// ===== FLASHCARD LEARNING =====
function showCard() {
    const card = AppState.currentCards[AppState.currentIdx];
    const cat = AppState.categories.find(c => c.id === AppState.currentCat);
    if (!card || !cat) return;

    // Track flashcard activity
    Stats.trackActivity('flashcard');
    Stats.checkGoalMet();

    document.getElementById('learnArea').innerHTML = `
        <div class="learn-chapter-header">
            <button class="back-btn" onclick="showLearnModes()">←</button>
            <h3>${cat.icon} ${escapeHtml(cat.name)} — Karteikarten</h3>
        </div>
        <div class="flashcard-container" id="flashcardContainer">
            <div class="flashcard ${AppState.flipped ? 'flipped' : ''}" id="flashcardEl" onclick="flipCard()">
                <div class="flashcard-face flashcard-front">
                    <div class="flashcard-number">${AppState.currentIdx + 1}/${AppState.currentCards.length}</div>
                    <div class="flashcard-text ${card.frontLang === 'ar' ? 'ar' : ''}">${escapeHtml(card.front)}</div>
                    <div class="flashcard-hint">👆 Tap zum Umdrehen · ← → Wischen</div>
                </div>
                <div class="flashcard-face flashcard-back">
                    <div class="flashcard-number">${AppState.currentIdx + 1}/${AppState.currentCards.length}</div>
                    <div class="flashcard-text ${card.backLang === 'ar' ? 'ar' : ''}">${escapeHtml(card.back)}</div>
                    ${card.ex ? `<div class="flashcard-example">💡 ${escapeHtml(card.ex)}</div>` : ''}
                    <div class="flashcard-hint">👆 Tap zum Zurückdrehen</div>
                </div>
            </div>
        </div>
        <div class="card-controls">
            <button class="btn btn-secondary" onclick="prevCard()" ${AppState.currentIdx === 0 ? 'disabled' : ''}>← Zurück</button>
            <button class="btn btn-primary" onclick="nextCard()">Weiter →</button>
        </div>
    `;

    setupSwipeListeners();
}

function flipCard() {
    AppState.flipped = !AppState.flipped;
    const el = document.getElementById('flashcardEl');
    if (el) el.classList.toggle('flipped', AppState.flipped);
}

function nextCard() {
    if (AppState.currentIdx < AppState.currentCards.length - 1) {
        const el = document.getElementById('flashcardEl');
        if (el) {
            el.classList.add('swipe-left');
            setTimeout(() => {
                AppState.currentIdx++;
                AppState.flipped = false;
                showCard();
            }, 300);
        } else {
            AppState.currentIdx++;
            AppState.flipped = false;
            showCard();
        }
    } else {
        showToast('🎉 Alle Karten durch!', 'success');
    }
}

function prevCard() {
    if (AppState.currentIdx > 0) {
        const el = document.getElementById('flashcardEl');
        if (el) {
            el.classList.add('swipe-right');
            setTimeout(() => {
                AppState.currentIdx--;
                AppState.flipped = false;
                showCard();
            }, 300);
        } else {
            AppState.currentIdx--;
            AppState.flipped = false;
            showCard();
        }
    }
}

// ===== SWIPE GESTURES =====
function setupSwipeListeners() {
    const container = document.getElementById('flashcardContainer');
    if (!container) return;

    let startX = 0;
    let startY = 0;
    let isDragging = false;

    container.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isDragging = true;
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;

        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 15) {
            const el = document.getElementById('flashcardEl');
            if (el && !AppState.flipped) {
                const rotation = dx * 0.05;
                el.style.transition = 'none';
                el.style.transform = `translateX(${dx}px) rotateZ(${rotation}deg)`;
                el.style.opacity = Math.max(0.5, 1 - Math.abs(dx) / 400);
            }
        }
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        isDragging = false;

        const endX = e.changedTouches[0].clientX;
        const dx = endX - startX;
        const el = document.getElementById('flashcardEl');

        if (el) {
            el.style.transition = '';
            el.style.opacity = '';
        }

        const swipeThreshold = 80;

        if (dx < -swipeThreshold) {
            nextCard();
        } else if (dx > swipeThreshold) {
            prevCard();
        } else {
            if (el) {
                el.style.transform = AppState.flipped ? 'rotateY(180deg)' : '';
            }
        }
    }, { passive: true });
}

// ===== DRAG & DROP =====
function setupDragDrop() {
    const hero = document.getElementById('uploadHero');
    if (!hero) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
        hero.addEventListener(event, (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    hero.addEventListener('dragenter', () => hero.classList.add('drag-over'));
    hero.addEventListener('dragover', () => hero.classList.add('drag-over'));
    hero.addEventListener('dragleave', () => hero.classList.remove('drag-over'));

    hero.addEventListener('drop', (e) => {
        hero.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            const fakeInput = { files: files, value: files[0].name };
            handleUpload(fakeInput);
        }
    });
}

// ===== CSV IMPORT / EXPORT =====

/**
 * Populate the CSV import chapter selector
 */
function renderCSVCatSelect() {
    const sel = document.getElementById('csvTargetCat');
    if (sel) {
        sel.innerHTML = AppState.categories.map(c =>
            `<option value="${c.id}">${c.icon} ${c.name}</option>`
        ).join('');
    }
}

/**
 * Check if a string contains Arabic characters
 */
function isArabic(str) {
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(str);
}

/**
 * Import CSV — auto-detects column order (DE;AR or AR;DE)
 * Creates only DE→AR cards
 */
function importCSV(input) {
    if (!input.files || !input.files[0]) return;

    const catId = document.getElementById('csvTargetCat').value;
    if (!catId) {
        showToast('⚠️ Bitte zuerst ein Kapitel wählen!', 'warning');
        input.value = '';
        return;
    }

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = function (e) {
        const text = e.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim());

        if (lines.length < 2) {
            showToast('⚠️ CSV leer oder nur Überschrift', 'warning');
            input.value = '';
            return;
        }

        const dataLines = lines.slice(1);
        let imported = 0;
        let skipped = 0;

        dataLines.forEach(line => {
            const sep = line.includes(';') ? ';' : '\t';
            const parts = line.split(sep).map(s => s.trim());

            let col1 = parts[0] || '';
            let col2 = parts[1] || '';
            const ex = parts[2] || '';

            if (!col1 || !col2) { skipped++; return; }

            // Auto-detect: if col1 is Arabic, swap so de=col2, ar=col1
            let de, ar;
            if (isArabic(col1)) {
                ar = col1;
                de = col2;
            } else {
                de = col1;
                ar = col2;
            }

            // Create only DE → AR card
            AppState.cards.push({
                front: de, back: ar,
                frontLang: 'de', backLang: 'ar',
                ex, cat: catId,
                score: 0, correctCount: 0, wrongCount: 0, lastSeen: null
            });
            imported++;
        });

        Storage.save();
        renderCategories();
        input.value = '';

        const cat = AppState.categories.find(c => c.id === catId);
        const catName = cat ? cat.name : '';

        if (imported > 0) {
            showToast(`✅ ${imported} Karten importiert in "${catName}"!`, 'success');
        }
        if (skipped > 0) {
            showToast(`⚠️ ${skipped} Zeilen übersprungen`, 'warning');
        }
    };

    reader.readAsText(file, 'UTF-8');
}

/**
 * Export cards of a chapter as CSV download
 */
function exportCSV(catId) {
    event.stopPropagation(); // Don't trigger selectCat

    const cat = AppState.categories.find(c => c.id === catId);
    if (!cat) return;

    const catCards = AppState.cards.filter(c => c.cat === catId);
    if (catCards.length === 0) {
        showToast('📭 Keine Karten zum Exportieren', 'info');
        return;
    }

    // Deduplicate: collect unique DE-AR pairs
    const pairMap = new Map();
    catCards.forEach(card => {
        let de, ar;
        if (card.frontLang === 'de') { de = card.front; ar = card.back; }
        else { de = card.back; ar = card.front; }
        const key = `${de}|${ar}`;
        if (!pairMap.has(key)) {
            pairMap.set(key, { de, ar, ex: card.ex || '' });
        }
    });

    const pairs = Array.from(pairMap.values());

    // Build CSV with BOM for Excel compatibility
    let csv = '\uFEFF'; // UTF-8 BOM
    csv += 'deutsch;arabisch;beispiel\n';
    pairs.forEach(p => {
        csv += `${p.de};${p.ar};${p.ex}\n`;
    });

    // Trigger download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cat.name.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_')}_Karten.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`📤 ${pairs.length} Karten exportiert!`, 'success');
}

// ===== HELPERS =====
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ===== INIT =====
function initApp() {
    Storage.load();
    Stats.load();
    renderCategories();
    renderPending();
    setupDragDrop();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .then(reg => {
                console.log('✅ Service Worker registriert');
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'activated') {
                            showToast('🔄 App aktualisiert!', 'info');
                        }
                    });
                });
            })
            .catch(err => console.warn('SW Fehler:', err));
    }

    console.log('✅ App gestartet');
    console.log(`📊 ${AppState.categories.length} Kapitel, ${AppState.cards.length} Karten`);
}

document.addEventListener('DOMContentLoaded', initApp);
