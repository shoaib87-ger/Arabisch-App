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
    if (tabName === 'islam') renderIslamTab();
    if (tabName !== 'islam') PrayerTimes.stopCountdown();
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

    // Show learn modes inside categories tab
    showLearnModes();
}

// ===== LERNMODUS AUSWAHL =====
function showLearnModes() {
    const cat = AppState.categories.find(c => c.id === AppState.currentCat);
    if (!cat) return;

    const cardCount = AppState.currentCards.length;
    const prog = Stats.getChapterProgress(cat.id, AppState.cards);
    const hasEnoughForQuiz = cardCount >= 4; // Need 4+ for good distractors

    const learnArea = document.getElementById('categoryGrid');
    learnArea.innerHTML = `
      <div style="grid-column: 1 / -1;">
        <div class="learn-chapter-header">
            <button class="back-btn" onclick="switchTab('categories')">←</button>
            <h3>${cat.icon} ${escapeHtml(cat.name)}</h3>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px; text-align: center;">
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

function editWord(i) {
    const w = AppState.pending[i];
    if (!w) return;
    const row = document.getElementById(`pending-row-${i}`);
    if (!row) return;
    row.innerHTML = `
        <div class="pending-edit">
            <input type="text" id="editDe${i}" value="${escapeHtml(w.de)}" class="form-input" placeholder="Deutsch" style="margin-bottom:4px;">
            <input type="text" id="editAr${i}" value="${escapeHtml(w.ar)}" class="form-input arabic" placeholder="Arabisch" dir="rtl" style="margin-bottom:4px;">
            <div style="display:flex;gap:6px;">
                <button class="btn btn-primary btn-small" onclick="saveEditWord(${i})">✅ OK</button>
                <button class="btn btn-secondary btn-small" onclick="renderPending()">❌</button>
            </div>
        </div>
    `;
    document.getElementById(`editDe${i}`).focus();
}

function saveEditWord(i) {
    const de = document.getElementById(`editDe${i}`).value.trim();
    const ar = document.getElementById(`editAr${i}`).value.trim();
    if (!de || !ar) {
        showToast('⚠️ Beide Felder ausfüllen!', 'warning');
        return;
    }
    AppState.pending[i].de = de;
    AppState.pending[i].ar = ar;
    Storage.savePending();
    renderPending();
    showToast('✅ Geändert!', 'success');
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

    // Sync targetCat dropdown with csvTargetCat if set
    if (AppState.csvTargetCat) {
        const targetDropdown = document.getElementById('targetCat');
        if (targetDropdown) targetDropdown.value = AppState.csvTargetCat;
    }

    list.innerHTML = AppState.pending.map((w, i) => `
        <div class="pending-word" id="pending-row-${i}">
            <div class="pending-word-text">
                <strong>${escapeHtml(w.de)}</strong> → <strong class="ar">${escapeHtml(w.ar)}</strong>
                ${w.ex ? `<div class="example">💡 ${escapeHtml(w.ex)}</div>` : ''}
            </div>
            <div style="display:flex;gap:4px;">
                <button class="icon-btn" onclick="editWord(${i})" aria-label="Bearbeiten" title="Bearbeiten">✏️</button>
                <button class="remove-btn" onclick="removeWord(${i})" aria-label="Entfernen">×</button>
            </div>
        </div>
    `).join('');
}

// ===== CARD CREATION =====
function createCards() {
    // Use CSV target chapter if set, otherwise use dropdown
    const catId = AppState.csvTargetCat || document.getElementById('targetCat').value;
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
    AppState.csvTargetCat = null; // Clear CSV target
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

    document.getElementById('categoryGrid').innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center;">
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

        // ALWAYS clear ALL inline styles so CSS .flipped class controls transform
        if (el) {
            el.style.transition = '';
            el.style.transform = '';
            el.style.opacity = '';
        }

        const swipeThreshold = 80;

        if (dx < -swipeThreshold) {
            nextCard();
        } else if (dx > swipeThreshold) {
            prevCard();
        }
        // Bounce-back: inline styles already cleared above, CSS handles state
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
 * Auto-detects encoding (UTF-8 → fallback Windows-1252)
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

    // Try UTF-8 first, then fallback to Windows-1252
    tryReadCSV(file, catId, 'UTF-8', input);
}

function tryReadCSV(file, catId, encoding, input) {
    const reader = new FileReader();

    reader.onload = function (e) {
        const text = e.target.result;

        // Check for garbled text: replacement chars or lots of ? where Arabic should be
        const hasGarbled = text.includes('\uFFFD') || /\?{2,}/.test(text);
        const hasArabic = isArabic(text);

        if (encoding === 'UTF-8' && !hasArabic && hasGarbled) {
            console.log('⚠️ UTF-8 fehlgeschlagen, versuche Windows-1252...');
            tryReadCSV(file, catId, 'windows-1252', input);
            return;
        }

        // If still no Arabic after both encodings, try ISO-8859-6 (Arabic encoding)
        if (encoding === 'windows-1252' && !hasArabic) {
            console.log('⚠️ Windows-1252 fehlgeschlagen, versuche ISO-8859-6...');
            tryReadCSV(file, catId, 'ISO-8859-6', input);
            return;
        }

        processCSVText(text, catId, input);
    };

    reader.readAsText(file, encoding);
}

function processCSVText(text, catId, input) {
    // Remove BOM if present
    const cleanText = text.replace(/^\uFEFF/, '');
    const lines = cleanText.split(/\r?\n/).filter(l => l.trim());

    if (lines.length < 1) {
        showToast('⚠️ CSV ist leer', 'warning');
        input.value = '';
        return;
    }

    // Auto-detect if line 1 is a header: check if it contains Arabic
    // If first line has no Arabic, it's likely a header → skip it
    let dataLines;
    const firstLine = lines[0];
    if (!isArabic(firstLine) && /[a-zA-ZäöüÄÖÜ]/.test(firstLine)) {
        dataLines = lines.slice(1); // Skip header
    } else {
        dataLines = lines; // No header, all data
    }

    if (dataLines.length === 0) {
        showToast('⚠️ Keine Daten in CSV', 'warning');
        input.value = '';
        return;
    }

    let imported = 0;
    let skipped = 0;

    dataLines.forEach(rawLine => {
        // Clean up Excel quoting: strip surrounding quotes and leading/trailing semicolons
        let line = rawLine.trim();
        // Remove wrapping quotes: ";data;data" → ;data;data
        if (line.startsWith('"') && line.endsWith('"')) {
            line = line.slice(1, -1).trim();
        }
        // Remove leading semicolons: ;data;data → data;data
        while (line.startsWith(';')) {
            line = line.slice(1).trim();
        }

        // Detect separator: try semicolon, then tab, then comma
        let sep = ';';
        if (!line.includes(';') && line.includes('\t')) sep = '\t';
        else if (!line.includes(';') && !line.includes('\t') && line.includes(',')) sep = ',';

        // Split and filter out empty parts (handles double separators like ;;)
        const parts = line.split(sep).map(s => s.trim()).filter(s => s.length > 0);

        if (parts.length < 2) { skipped++; return; }

        // Find the Arabic part and the German part
        let de = '', ar = '', ex = '';

        // Check each part for Arabic content
        const arabicParts = [];
        const otherParts = [];

        parts.forEach(p => {
            if (isArabic(p)) {
                arabicParts.push(p);
            } else {
                otherParts.push(p);
            }
        });

        if (arabicParts.length > 0 && otherParts.length > 0) {
            ar = arabicParts.join(' '); // Join if Arabic split across parts
            de = otherParts[0];
            ex = otherParts[1] || '';
        } else {
            // Fallback: first two non-empty parts
            de = parts[0];
            ar = parts[1];
            ex = parts[2] || '';
        }

        if (!de || !ar) { skipped++; return; }

        console.log(`📥 Preview: DE="${de}" | AR="${ar}"`);
        AppState.pending.push({ de, ar, ex });
        imported++;
    });

    // Store the target chapter for later creation
    AppState.csvTargetCat = catId;

    Storage.savePending();
    renderPending();
    input.value = '';

    // Scroll to pending list so user sees the preview
    setTimeout(() => {
        const pending = document.getElementById('pendingContainer');
        if (pending) pending.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);

    if (imported > 0) {
        showToast(`📋 ${imported} Wörter geladen — prüfe unten & klicke "Karten erstellen"!`, 'success');
    }
    if (skipped > 0) {
        showToast(`⚠️ ${skipped} Zeilen übersprungen`, 'warning');
    }
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

// ===== ISLAM TAB =====
function renderIslamTab() {
    const area = document.getElementById('islamArea');
    const prayerContent = document.getElementById('prayerContent');
    prayerContent.style.display = 'none';
    area.style.display = 'block';

    const savedPage = localStorage.getItem('quranPage');
    const resumeHint = savedPage ? `<div class="islam-card-subtitle">📖 Seite ${savedPage} fortsetzen</div>` : '';

    area.innerHTML = `
        <div class="islam-subcategories">
            <div class="islam-card" onclick="QuranReader.open()">
                <div class="islam-card-icon">📖</div>
                <div class="islam-card-name">Quran</div>
                <div class="islam-card-ar">القرآن الكريم</div>
                ${resumeHint}
            </div>
            <div class="islam-card" onclick="showPrayerTimes()">
                <div class="islam-card-icon">🕌</div>
                <div class="islam-card-name">Gebetszeiten</div>
                <div class="islam-card-ar">أوقات الصلاة</div>
                <div class="islam-card-subtitle">Hamburg</div>
            </div>
        </div>
    `;
}

function showPrayerTimes() {
    const area = document.getElementById('islamArea');
    const prayerContent = document.getElementById('prayerContent');
    area.style.display = 'none';
    prayerContent.style.display = 'block';
    PrayerTimes.render(prayerContent);
}

function quranGoToPage() {
    const page = prompt('Seitenzahl eingeben:', QuranReader.currentPage);
    if (page) QuranReader.goToPage(parseInt(page));
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
