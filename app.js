/**
 * app.js — Hauptlogik: State-Management, UI, Kategorien, Karteikarten
 * Sauberes State-Management mit vollständigem Reset
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

            // Pending aus sessionStorage wiederherstellen
            const savedPending = sessionStorage.getItem('pending');
            if (savedPending) {
                AppState.pending = JSON.parse(savedPending);
            }

            console.log(`📊 Geladen: ${AppState.categories.length} Kategorien, ${AppState.cards.length} Karten, ${AppState.pending.length} Pending`);
        } catch (e) {
            console.error('❌ Storage Load Error:', e);
        }
    },

    save() {
        try {
            localStorage.setItem('cats', JSON.stringify(AppState.categories));
            localStorage.setItem('cards', JSON.stringify(AppState.cards));
            console.log(`💾 Gespeichert: ${AppState.cards.length} Karten, ${AppState.categories.length} Kategorien`);
        } catch (e) {
            console.error('❌ Storage Save Error:', e);
            if (e.name === 'QuotaExceededError') {
                showToast('⚠️ Speicher voll! Lösche alte Kategorien.');
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

// ===== TOAST NOTIFICATION =====
let toastTimeout = null;
function showToast(message, duration = 2500) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;

    if (toastTimeout) clearTimeout(toastTimeout);

    requestAnimationFrame(() => {
        toast.classList.add('visible');
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
}

// ===== CATEGORY MANAGEMENT =====
function renderCategories() {
    const grid = document.getElementById('categoryGrid');
    const sel = document.getElementById('targetCat');

    grid.innerHTML = AppState.categories.map(cat => {
        const count = AppState.cards.filter(c => c.cat === cat.id).length;
        return `
            <div class="category-card" onclick="selectCat('${cat.id}')">
                <div class="category-actions" onclick="event.stopPropagation()">
                    <button class="icon-btn" onclick="editCategory('${cat.id}')" aria-label="Bearbeiten">✏️</button>
                    <button class="icon-btn delete" onclick="deleteCategory('${cat.id}')" aria-label="Löschen">🗑️</button>
                </div>
                <div class="category-icon">${cat.icon}</div>
                <div class="category-name">${cat.name}</div>
                <div class="category-count">${count} Karten</div>
            </div>
        `;
    }).join('');

    if (sel) {
        sel.innerHTML = AppState.categories.map(c =>
            `<option value="${c.id}">${c.icon} ${c.name}</option>`
        ).join('');
    }
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
        showToast('⚠️ Bitte einen Namen eingeben!');
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
    showToast(`✅ "${name}" erstellt!`);
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
        showToast('⚠️ Bitte Namen eingeben!');
        return;
    }
    cat.name = newName;
    cat.icon = AppState.selectedIcon;
    Storage.save();
    renderCategories();
    closeModal('editModal');
    AppState.editingCatId = null;
    showToast('✅ Aktualisiert!');
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
    showToast(`🗑️ "${cat.name}" gelöscht`);
}

function selectCat(id) {
    AppState.currentCat = id;
    AppState.currentCards = AppState.cards.filter(c => c.cat === id);
    AppState.currentIdx = 0;
    AppState.flipped = false;
    if (AppState.currentCards.length === 0) {
        showToast('📭 Keine Karten in dieser Kategorie');
        return;
    }
    switchTab('learn');
    showCard();
}

// ===== ICON PICKER HELPERS =====
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

// ===== UPLOAD & OCR WORKFLOW =====
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
        showToast('⏳ Bitte warten, OCR läuft noch...');
        return;
    }

    const file = input.files[0];
    console.log('📁 Datei:', file.name, 'Typ:', file.type, 'Größe:', (file.size / 1024).toFixed(1) + ' KB');

    // Warnung wenn Pending voll
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
            showToast('❌ Format nicht unterstützt (JPG, PNG, PDF)');
        }
    } catch (error) {
        console.error('❌ Upload Error:', error);
        updateProgress('❌ Fehler: ' + error.message, 100, 'danger');
        showToast('❌ ' + error.message);
    } finally {
        AppState.isProcessing = false;
        input.value = ''; // File input reset
    }
}

async function processImage(file) {
    showProgress();
    updateProgress('🔧 Bild wird optimiert...', 10);

    // 1. Preprocessing
    const { blob, thumbnail } = await ImagePreprocessor.process(file);

    // 2. Preview anzeigen
    showPreview(thumbnail);

    // 3. OCR ausführen
    const words = await performOCR(blob, (status, pct) => updateProgress(status, pct));

    // 4. Ergebnisse verarbeiten
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
        showToast('⚠️ Keine Wortpaare erkannt. Versuche ein besseres Foto.');
        hideProgressDelayed();
        return;
    }

    AppState.pending = AppState.pending.concat(words);
    Storage.savePending();
    renderPending();
    updateProgress(`✅ ${words.length} Wortpaare erkannt!`, 100, 'success');
    showToast(`✅ ${words.length} Wortpaare erkannt!`);
    hideProgressDelayed();
}

// ===== PROGRESS UI =====
function showProgress() {
    const container = document.getElementById('progressContainer');
    container.classList.add('visible');
}

function updateProgress(status, percent, type = 'normal') {
    const statusEl = document.getElementById('progressStatus');
    const barEl = document.getElementById('progressBar');
    if (statusEl) statusEl.textContent = status;
    if (barEl) {
        barEl.style.width = percent + '%';
        if (type === 'success') barEl.style.background = '#4caf50';
        else if (type === 'warning') barEl.style.background = '#ff9800';
        else if (type === 'danger') barEl.style.background = '#f44336';
        else barEl.style.background = 'white';
    }
}

function hideProgressDelayed() {
    setTimeout(() => {
        const container = document.getElementById('progressContainer');
        container.classList.remove('visible');
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
        showToast('⚠️ Deutsch + Arabisch ausfüllen!');
        return;
    }
    AppState.pending.push({ de, ar, ex });
    Storage.savePending();
    document.getElementById('germanWord').value = '';
    document.getElementById('arabicWord').value = '';
    document.getElementById('exampleText').value = '';
    renderPending();
    showToast('➕ Wort hinzugefügt');
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

    if (!catId) { showToast('⚠️ Kategorie wählen!'); return; }
    if (AppState.pending.length === 0) { showToast('⚠️ Keine Wörter vorhanden!'); return; }

    let created = 0;
    AppState.pending.forEach(w => {
        if (dir === 'both' || dir === 'de-ar') {
            AppState.cards.push({
                front: w.de, back: w.ar,
                frontLang: 'de', backLang: 'ar',
                ex: w.ex, cat: catId
            });
            created++;
        }
        if (dir === 'both' || dir === 'ar-de') {
            AppState.cards.push({
                front: w.ar, back: w.de,
                frontLang: 'ar', backLang: 'de',
                ex: w.ex, cat: catId
            });
            created++;
        }
    });

    Storage.save();

    // === VOLLSTÄNDIGER RESET ===
    fullReset();

    const cat = AppState.categories.find(c => c.id === catId);
    showToast(`✅ ${created} Karten erstellt in "${cat.name}"!`);
    renderCategories();
}

// ===== FULL RESET =====
function fullReset() {
    console.log('🧹 Vollständiger Reset...');

    // 1. Pending leeren
    Storage.clearPending();

    // 2. Preview-URL freigeben
    if (AppState.previewURL) {
        URL.revokeObjectURL(AppState.previewURL);
        AppState.previewURL = null;
    }

    // 3. Processing-Flag
    AppState.isProcessing = false;

    // 4. File Input
    const input = document.getElementById('fileInput');
    if (input) input.value = '';

    // 5. UI zurücksetzen
    hidePreview();
    hideProgressDelayed();
    renderPending();

    console.log('✅ Reset abgeschlossen');
}

// ===== FLASHCARD LEARNING =====
function showCard() {
    const card = AppState.currentCards[AppState.currentIdx];
    const cat = AppState.categories.find(c => c.id === AppState.currentCat);
    if (!card || !cat) return;

    document.getElementById('learnArea').innerHTML = `
        <div class="flashcard-container">
            <div class="flashcard ${AppState.flipped ? 'flipped' : ''}" id="flashcardEl" onclick="flipCard()">
                <div class="flashcard-face flashcard-front">
                    <div class="flashcard-number">${cat.icon} ${escapeHtml(cat.name)} — ${AppState.currentIdx + 1}/${AppState.currentCards.length}</div>
                    <div class="flashcard-text ${card.frontLang === 'ar' ? 'ar' : ''}">${escapeHtml(card.front)}</div>
                    <div class="flashcard-hint">👆 Tap zum Umdrehen</div>
                </div>
                <div class="flashcard-face flashcard-back">
                    <div class="flashcard-number">${cat.icon} ${escapeHtml(cat.name)} — ${AppState.currentIdx + 1}/${AppState.currentCards.length}</div>
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
}

function flipCard() {
    AppState.flipped = !AppState.flipped;
    const el = document.getElementById('flashcardEl');
    if (el) el.classList.toggle('flipped', AppState.flipped);
}

function nextCard() {
    if (AppState.currentIdx < AppState.currentCards.length - 1) {
        AppState.currentIdx++;
        AppState.flipped = false;
        showCard();
    } else {
        showToast('🎉 Alle Karten durch!');
    }
}

function prevCard() {
    if (AppState.currentIdx > 0) {
        AppState.currentIdx--;
        AppState.flipped = false;
        showCard();
    }
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
    renderCategories();
    renderPending();

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .then(reg => {
                console.log('✅ Service Worker registriert');
                // Sofort updaten wenn neue Version vorhanden
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'activated') {
                            showToast('🔄 App aktualisiert! Bitte neu laden.');
                        }
                    });
                });
            })
            .catch(err => console.warn('SW Fehler:', err));
    }

    console.log('✅ App gestartet');
    console.log(`📊 ${AppState.categories.length} Kategorien, ${AppState.cards.length} Karten`);
}

// Start
document.addEventListener('DOMContentLoaded', initApp);
