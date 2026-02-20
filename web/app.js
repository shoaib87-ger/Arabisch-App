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
    currentGroup: null,  // selected Oberkategorie
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
    // Multi-selection state
    selectionMode: false,
    selectedUnits: [],
};

// ===== HIERARCHY HELPERS =====
/** Get top-level groups (no parentId) */
function getGroups() {
    return AppState.categories
        .filter(c => !c.parentId)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
}

/** Get subcategories of a group */
function getSubcategories(groupId) {
    return AppState.categories
        .filter(c => c.parentId === groupId)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
}

/** Check if a group has children */
function hasChildren(groupId) {
    return AppState.categories.some(c => c.parentId === groupId);
}

/** Compute progress for a category (works for both sub and standalone)
 *  Uses uniqueAnswered (lastSeen != null) as primary metric, mastery (score>=3) as secondary */
function computeProgress(catId) {
    const catCards = AppState.cards.filter(c => c.cat === catId);
    if (catCards.length === 0) return { total: 0, mastered: 0, answered: 0, pct: 0 };
    const total = catCards.length;
    const answered = catCards.filter(c => c.lastSeen).length;
    const mastered = catCards.filter(c => (c.score || 0) >= 3).length;
    return {
        total,
        mastered,
        answered,
        pct: Math.round((answered / total) * 100)
    };
}

/** Get total card count for a group (own cards + all children) */
function getGroupCardCount(groupId) {
    const subs = getSubcategories(groupId);
    const subIds = subs.map(s => s.id);
    return AppState.cards.filter(c => c.cat === groupId || subIds.includes(c.cat)).length;
}

/** Get aggregated progress for a group */
function getGroupProgress(groupId) {
    const subs = getSubcategories(groupId);
    const ids = [groupId, ...subs.map(s => s.id)];
    const cards = AppState.cards.filter(c => ids.includes(c.cat));
    if (cards.length === 0) return { total: 0, mastered: 0, answered: 0, pct: 0 };
    const total = cards.length;
    const answered = cards.filter(c => c.lastSeen).length;
    const mastered = cards.filter(c => (c.score || 0) >= 3).length;
    return { total, mastered, answered, pct: total > 0 ? Math.round((answered / total) * 100) : 0 };
}

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

            // Migration: fix 'parent' → 'parentId' from broken imports
            let migrated = 0;
            AppState.categories.forEach(c => {
                if (c.parent && !c.parentId) {
                    c.parentId = c.parent;
                    delete c.parent;
                    migrated++;
                }
            });
            if (migrated > 0) {
                console.log(`🔧 Migration: ${migrated} Kategorien repariert (parent → parentId)`);
                localStorage.setItem('cats', JSON.stringify(AppState.categories));
            }

            const savedPending = sessionStorage.getItem('pending');
            if (savedPending) {
                AppState.pending = JSON.parse(savedPending);
            }

            // Cleanup: remove cards directly on a parent chapter (orphans from old import bug)
            const parentIds = new Set(AppState.categories.filter(c => !c.parentId).map(c => c.id));
            const unitIds = new Set(AppState.categories.filter(c => c.parentId).map(c => c.id));
            const beforeCount = AppState.cards.length;
            // Keep cards that belong to a unit, or to a chapter that has NO children (flat chapter)
            AppState.cards = AppState.cards.filter(card => {
                if (unitIds.has(card.cat)) return true; // card belongs to a unit — keep
                if (parentIds.has(card.cat)) {
                    // card on a parent chapter — keep only if this chapter has no units
                    const hasUnits = AppState.categories.some(c => c.parentId === card.cat);
                    return !hasUnits; // keep if flat chapter, delete if has units
                }
                return true; // unknown — keep
            });
            const removed = beforeCount - AppState.cards.length;
            if (removed > 0) {
                console.log(`🧹 Cleanup: ${removed} verwaiste Karten entfernt (direkt am Kapitel statt in Einheit)`);
                localStorage.setItem('cards', JSON.stringify(AppState.cards));
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
let _toastRafId1 = null;
let _toastRafId2 = null;
let _toastSafetyTimeout = null;
let _toastShownAt = 0; // track when toast was shown

function showToast(message, type = 'info', duration = 2800) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
        // Click to dismiss
        toast.addEventListener('click', () => {
            toast.classList.remove('visible');
            toast.className = 'toast';
            if (toastTimeout) clearTimeout(toastTimeout);
            if (_toastSafetyTimeout) clearTimeout(_toastSafetyTimeout);
            _toastShownAt = 0;
        });
    }

    if (type === 'info') {
        if (message.startsWith('✅') || message.startsWith('🎉')) type = 'success';
        else if (message.startsWith('⚠️')) type = 'warning';
        else if (message.startsWith('❌')) type = 'error';
    }

    // Clear any existing timers and pending animation frames
    if (toastTimeout) clearTimeout(toastTimeout);
    if (_toastSafetyTimeout) clearTimeout(_toastSafetyTimeout);
    if (_toastRafId1) cancelAnimationFrame(_toastRafId1);
    if (_toastRafId2) cancelAnimationFrame(_toastRafId2);

    // Force-remove visible class first (reset for new toast)
    toast.classList.remove('visible');
    toast.className = 'toast';

    toast.innerHTML = `
        <span>${message}</span>
        <div class="toast-progress" style="animation-duration: ${duration}ms;"></div>
    `;

    // Haptic feedback for toasts
    if (type === 'error' || type === 'warning') haptic('medium');
    else if (type === 'success') haptic('light');

    // Double-rAF ensures CSS transition resets properly on iOS
    _toastShownAt = Date.now();
    _toastRafId1 = requestAnimationFrame(() => {
        _toastRafId2 = requestAnimationFrame(() => {
            toast.classList.add('visible', `toast-${type}`);
            toastTimeout = setTimeout(() => {
                toast.classList.remove('visible');
                _toastShownAt = 0;
            }, duration);
            // Safety fallback: force-hide if CSS transition fails
            _toastSafetyTimeout = setTimeout(() => {
                toast.classList.remove('visible');
                toast.className = 'toast';
                _toastShownAt = 0;
            }, duration + 500);
        });
    });
}

// Watchdog: periodically check for stuck toasts (every 5s)
setInterval(() => {
    if (_toastShownAt > 0 && Date.now() - _toastShownAt > 5000) {
        const toast = document.getElementById('toast');
        if (toast && toast.classList.contains('visible')) {
            toast.classList.remove('visible');
            toast.className = 'toast';
            _toastShownAt = 0;
            console.warn('🧹 Toast watchdog: force-removed stuck toast');
        }
        _toastShownAt = 0;
    }
}, 5000);

// ===== HAPTIC FEEDBACK =====
// Uses Capacitor Haptics plugin on iOS, silent fallback elsewhere
function haptic(style = 'light') {
    try {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) {
            const Haptics = window.Capacitor.Plugins.Haptics;
            if (style === 'light') Haptics.impact({ style: 'LIGHT' });
            else if (style === 'medium') Haptics.impact({ style: 'MEDIUM' });
            else if (style === 'heavy') Haptics.impact({ style: 'HEAVY' });
            else if (style === 'success') Haptics.notification({ type: 'SUCCESS' });
            else if (style === 'warning') Haptics.notification({ type: 'WARNING' });
            else if (style === 'error') Haptics.notification({ type: 'ERROR' });
            else if (style === 'selection') Haptics.selectionStart();
        }
    } catch (e) {
        // Silently ignore — haptics are optional
    }
}

// ===== TAB NAVIGATION =====
function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));

    const tabEl = document.querySelector(`[data-tab="${tabName}"]`);
    const contentEl = document.getElementById(tabName);
    if (tabEl) tabEl.classList.add('active');
    if (contentEl) contentEl.classList.add('active');

    // Header color: green for Islam, gold for everything else
    const header = document.querySelector('.header');
    if (header) {
        header.classList.toggle('islam-active', tabName === 'islam');
    }

    if (tabName === 'categories') {
        AppState.currentGroup = null; // Reset to top-level groups view
        renderCategories();
    }
    if (tabName === 'islam') renderIslamTab();
    if (tabName !== 'islam') PrayerTimes.stopCountdown();
}

// ===== KAPITEL MANAGEMENT =====
function renderCategories() {
    const grid = document.getElementById('categoryGrid');

    // If we're inside a group view, show subcategories
    if (AppState.currentGroup) {
        renderSubcategories(AppState.currentGroup);
        updateCatDropdowns();
        return;
    }

    const groups = getGroups();

    grid.innerHTML = groups.map(cat => {
        const isGroup = hasChildren(cat.id);
        const count = isGroup ? getGroupCardCount(cat.id) : AppState.cards.filter(c => c.cat === cat.id).length;
        const prog = isGroup ? getGroupProgress(cat.id) : computeProgress(cat.id);
        const circumference = 2 * Math.PI * 14;
        const offset = circumference - (prog.pct / 100) * circumference;
        const subCount = isGroup ? getSubcategories(cat.id).length : 0;

        return `
            <div class="category-card" data-cat-id="${cat.id}" onclick="selectGroup('${cat.id}')">
                <span class="chapter-drag-handle" title="Ziehen zum Sortieren">☰</span>
                <div class="category-card-body">
                    <div class="category-icon">${cat.icon}</div>
                    <div class="category-text-group">
                        <div class="category-name">${escapeHtml(cat.name)}</div>
                        <div class="category-count">${count} Karten${subCount > 0 ? ` · ${subCount} Einheiten` : ''}</div>
                        ${count > 0 ? `
                            <div class="category-progress">
                                <svg class="progress-ring" viewBox="0 0 36 36">
                                    <circle class="progress-ring-bg" cx="18" cy="18" r="14" />
                                    <circle class="progress-ring-fill" cx="18" cy="18" r="14"
                                        stroke-dasharray="${circumference}"
                                        stroke-dashoffset="${offset}" />
                                </svg>
                                <div class="category-progress-text">${prog.answered}/${prog.total}</div>
                            </div>
                        ` : ''}
                    </div>
                </div>
                <div class="category-actions" onclick="event.stopPropagation()">
                    <button class="icon-btn" onclick="editCategory('${cat.id}')" aria-label="Bearbeiten" title="Bearbeiten">✏️</button>
                    <button class="icon-btn delete" onclick="deleteCategory('${cat.id}')" aria-label="Löschen" title="Löschen">🗑️</button>
                </div>
            </div>
        `;
    }).join('');

    initChapterDragSort();
    updateCatDropdowns();
}

/** Update all category dropdowns (targetCat + csvTargetCat) with grouped format */
function updateCatDropdowns() {
    const groups = getGroups();
    let options = '';
    groups.forEach(g => {
        const subs = getSubcategories(g.id);
        if (subs.length > 0) {
            options += `<optgroup label="${g.icon} ${escapeHtml(g.name)}">`;
            subs.forEach(s => {
                options += `<option value="${s.id}">${s.icon || '📄'} ${escapeHtml(s.name)}</option>`;
            });
            options += '</optgroup>';
            // Also allow adding directly to group
            options += `<option value="${g.id}">${g.icon} ${escapeHtml(g.name)} (direkt)</option>`;
        } else {
            options += `<option value="${g.id}">${g.icon} ${escapeHtml(g.name)}</option>`;
        }
    });

    // Preserve current selections before replacing HTML
    const sel = document.getElementById('targetCat');
    const csvSel = document.getElementById('csvTargetCat');
    const prevTarget = sel ? sel.value : null;
    const prevCsv = csvSel ? csvSel.value : null;

    if (sel) {
        sel.innerHTML = options;
        if (prevTarget) sel.value = prevTarget; // Restore selection
    }
    if (csvSel) {
        csvSel.innerHTML = options;
        if (prevCsv) csvSel.value = prevCsv; // Restore selection
    }
}

/** Select group and show subcategories */
function selectGroup(groupId) {
    AppState.currentGroup = groupId;
    AppState.learnScope = null; // Reset scope

    // Auto-select: if no subcategories but has own cards, auto-scope to group
    const subs = getSubcategories(groupId);
    const ownCards = AppState.cards.filter(c => c.cat === groupId).length;
    if (subs.length === 0 && ownCards > 0) {
        setScopeGroup(groupId);
        return; // setScopeGroup already calls renderSubcategories
    }

    renderSubcategories(groupId);
}

/** Render subcategory chips for a group — with multi-select support */
function renderSubcategories(groupId) {
    const grid = document.getElementById('categoryGrid');
    const group = AppState.categories.find(c => c.id === groupId);
    if (!group) return;

    const subs = getSubcategories(groupId);
    const groupProg = getGroupProgress(groupId);
    const totalCards = getGroupCardCount(groupId);
    const ownCards = AppState.cards.filter(c => c.cat === groupId).length;
    const selMode = AppState.selectionMode;
    const selUnits = AppState.selectedUnits || [];

    // Build current card queue from selection
    _updateSelectionCards(groupId);

    const hasEnoughForQuiz = (AppState.currentCards || []).length >= 4;
    const scopeActive = !!AppState.learnScope;
    const scopeCards = scopeActive ? AppState.currentCards.length : 0;

    // Scope label
    let scopeLabel = null;
    if (AppState.learnScope === 'group') {
        scopeLabel = `Alle ${scopeCards} Karten`;
    } else if (AppState.learnScope === 'multi' && selUnits.length > 0) {
        scopeLabel = `${selUnits.length} Einheiten (${scopeCards} Karten)`;
    } else if (AppState.learnScope === 'sub' && AppState.currentCat) {
        const s = AppState.categories.find(c => c.id === AppState.currentCat);
        scopeLabel = s ? `${s.icon || '📄'} ${escapeHtml(s.name)} (${scopeCards})` : null;
    }

    // Search field only if > 30 subs
    const searchField = subs.length > 30 ? `
        <div class="sub-search">
            <input type="text" id="subSearch" class="form-input" placeholder="🔍 Einheit suchen..."
                oninput="filterSubcategories('${groupId}')" autocomplete="off">
        </div>
    ` : '';

    const chipsHTML = subs.map(sub => {
        const prog = computeProgress(sub.id);
        const cardCount = AppState.cards.filter(c => c.cat === sub.id).length;
        const isSelected = selUnits.includes(sub.id);
        const isActiveSingle = !selMode && AppState.learnScope === 'sub' && AppState.currentCat === sub.id;
        const chipClass = selMode ? (isSelected ? 'active' : '') : (isActiveSingle ? 'active' : '');
        const clickAction = selMode
            ? `toggleUnitSelection('${sub.id}','${groupId}')`
            : `setScopeSubCat('${sub.id}','${groupId}')`;

        // Checkbox indicator in selection mode
        const checkboxHTML = selMode ? `
            <span class="sub-chip-checkbox ${isSelected ? 'checked' : ''}">
                ${isSelected ? '☑' : '☐'}
            </span>
        ` : '';

        return `
            <div class="sub-chip ${chipClass}" onclick="${clickAction}" data-name="${escapeHtml(sub.name).toLowerCase()}" data-subid="${sub.id}">
                <div class="sub-chip-top">
                    ${checkboxHTML}
                    <div class="sub-chip-name">${sub.icon || '📄'} ${escapeHtml(sub.shortLabel || sub.name)}</div>
                    ${!selMode ? `
                        <div class="sub-chip-actions" onclick="event.stopPropagation()">
                            <span class="sub-chip-drag-handle" title="Ziehen zum Sortieren">☰</span>
                            <button class="sub-action-btn" onclick="editCategory('${sub.id}')" title="Umbenennen">✏️</button>
                            <button class="sub-action-btn delete" onclick="deleteSubCategory('${sub.id}','${groupId}')" title="Löschen">🗑️</button>
                        </div>
                    ` : ''}
                </div>
                ${prog.total > 0 ? `
                    <div class="sub-chip-progress">
                        <div class="sub-chip-bar"><div class="sub-chip-bar-fill" style="width: ${prog.pct}%"></div></div>
                        <span class="sub-chip-count">${prog.answered}/${prog.total}</span>
                    </div>
                ` : '<div class="sub-chip-count">0 Karten</div>'}
            </div>
        `;
    }).join('');

    // Mode selector — always visible
    const modeSelectorHTML = `
        <div class="mode-selector">
            <button class="mode-btn ${!scopeActive ? 'disabled' : ''}" onclick="startLearnMode('cards')">
                <span class="mode-icon">📇</span>
                <span class="mode-label">Karteikarten</span>
            </button>
            <button class="mode-btn ${!scopeActive || !hasEnoughForQuiz ? 'disabled' : ''}" onclick="startLearnMode('quiz_de_ar')">
                <span class="mode-icon-badge">ABC</span>
                <span class="mode-label">Quiz DE→AR</span>
            </button>
            <button class="mode-btn ${!scopeActive || !hasEnoughForQuiz ? 'disabled' : ''}" onclick="startLearnMode('quiz_ar_de')">
                <span class="mode-icon-badge ar">أ ب ت</span>
                <span class="mode-label">Quiz AR→DE</span>
            </button>
        </div>
        ${scopeLabel ? `<div class="scope-info">📌 ${scopeLabel} ausgewählt</div>` : '<div class="scope-info scope-hint">👆 Wähle unten eine Einheit oder \"Alle Karten\"</div>'}
    `;

    // Standalone category (no subs, with own cards)
    const directLearnHTML = (subs.length === 0 && ownCards > 0) ? `
        <div class="scope-actions">
            <button class="btn btn-primary scope-all-btn ${AppState.learnScope === 'group' ? 'active' : ''}" onclick="setScopeGroup('${groupId}')">
                📇 Alle ${ownCards} Karten auswählen
            </button>
        </div>
    ` : '';

    // Selection mode toolbar
    const selectionToolbar = subs.length > 0 ? `
        <div class="selection-toolbar">
            <button class="btn btn-small ${selMode ? 'btn-primary' : 'btn-secondary'}" onclick="toggleSelectionMode('${groupId}')">
                ${selMode ? '✕ Abbrechen' : '☑ Auswählen'}
            </button>
            ${selMode ? `
                <div class="selection-toolbar-actions">
                    <button class="btn btn-small btn-secondary" onclick="selectAllUnits('${groupId}')">Alle</button>
                    <button class="btn btn-small btn-secondary" onclick="selectNoneUnits('${groupId}')">Keine</button>
                    <span class="selection-count">Ausgewählt: ${selUnits.length}</span>
                </div>
            ` : ''}
        </div>
    ` : '';

    grid.innerHTML = `
        <div style="grid-column: 1 / -1;">
            <div class="group-header">
                <button class="back-btn" onclick="backToGroups()">←</button>
                <div class="group-header-info">
                    <h3>${group.icon} ${escapeHtml(group.name)}</h3>
                    <p>${totalCards} Karten · ${subs.length > 0 ? subs.length + ' Einheiten · ' : ''}${groupProg.answered}/${groupProg.total} bearbeitet</p>
                </div>
                <div class="group-header-actions">
                    <button class="btn btn-small btn-primary" onclick="openNewSubModal('${groupId}')">+ Einheit</button>
                </div>
            </div>

            <div class="stats-card" onclick="showLernerfolg('${groupId}')">
                <div class="stats-card-header">
                    <span class="stats-card-icon">📊</span>
                    <span class="stats-card-title">Fortschritt</span>
                </div>
                <div class="stats-card-value">${groupProg.answered} / ${groupProg.total} gelernt</div>
                <div class="stats-card-bar-bg">
                    <div class="stats-card-bar-fill" style="width: ${groupProg.pct}%"></div>
                </div>
            </div>

            ${modeSelectorHTML}

            ${directLearnHTML}
            ${selectionToolbar}
            ${searchField}

            ${subs.length > 0 ? `
                <div class="sub-chip-scroll-area">
                    <div class="sub-chip-grid" id="subChipGrid">
                        ${chipsHTML}
                    </div>
                </div>

                <div class="scope-actions scope-actions-sticky">
                    <button class="btn scope-all-btn ${AppState.learnScope === 'group' ? 'active' : ''}" onclick="setScopeGroup('${groupId}')">
                        📇 Alle Karten auswählen (${totalCards})
                    </button>
                </div>
            ` : `
                ${ownCards === 0 ? `
                    <div class="empty-state">
                        <p>Noch keine Einheiten. Erstelle die erste!</p>
                        <button class="btn btn-primary" onclick="openNewSubModal('${groupId}')">+ Erste Einheit erstellen</button>
                    </div>
                ` : ''}
            `}
        </div>
    `;

    // Initialize drag & drop for subcategory chips (not in selection mode)
    if (subs.length > 1 && !selMode) {
        requestAnimationFrame(() => initDragSort(groupId));
    }
}

/** Set scope = entire group (all subcategories) */
function setScopeGroup(groupId) {
    const subs = getSubcategories(groupId);
    const allIds = [groupId, ...subs.map(s => s.id)];
    AppState.currentCat = groupId;
    AppState.currentCards = AppState.cards.filter(c => allIds.includes(c.cat));
    AppState.currentIdx = 0;
    AppState.flipped = false;
    AppState.learnScope = 'group';
    AppState.selectionMode = false;
    AppState.selectedUnits = [];
    renderSubcategories(groupId);
}

/** Set scope = single subcategory (normal click, not selection mode) */
function setScopeSubCat(subId, groupId) {
    AppState.currentCat = subId;
    AppState.currentCards = AppState.cards.filter(c => c.cat === subId);
    AppState.currentIdx = 0;
    AppState.flipped = false;
    AppState.learnScope = 'sub';
    renderSubcategories(groupId);
}

// ===== MULTI-SELECTION =====

/** Toggle selection mode on/off */
function toggleSelectionMode(groupId) {
    AppState.selectionMode = !AppState.selectionMode;
    if (!AppState.selectionMode) {
        // Exiting selection mode — clear selection, reset scope
        AppState.selectedUnits = [];
        AppState.learnScope = null;
        AppState.currentCards = [];
    }
    renderSubcategories(groupId);
}

/** Toggle a single unit in selection mode */
function toggleUnitSelection(subId, groupId) {
    const idx = AppState.selectedUnits.indexOf(subId);
    if (idx >= 0) {
        AppState.selectedUnits.splice(idx, 1);
    } else {
        AppState.selectedUnits.push(subId);
    }
    // Update learn scope
    if (AppState.selectedUnits.length > 0) {
        AppState.learnScope = 'multi';
    } else {
        AppState.learnScope = null;
        AppState.currentCards = [];
    }
    renderSubcategories(groupId);
}

/** Select all units in the group */
function selectAllUnits(groupId) {
    const subs = getSubcategories(groupId);
    AppState.selectedUnits = subs.map(s => s.id);
    AppState.learnScope = 'multi';
    renderSubcategories(groupId);
}

/** Deselect all units */
function selectNoneUnits(groupId) {
    AppState.selectedUnits = [];
    AppState.learnScope = null;
    AppState.currentCards = [];
    renderSubcategories(groupId);
}

/** Build card queue from selected units (called during render) */
function _updateSelectionCards(groupId) {
    if (AppState.learnScope === 'multi' && AppState.selectedUnits.length > 0) {
        // Merge cards from all selected units, ordered by unit order
        const unitOrder = AppState.selectedUnits.slice();
        // Sort by category order if available
        unitOrder.sort((a, b) => {
            const catA = AppState.categories.find(c => c.id === a);
            const catB = AppState.categories.find(c => c.id === b);
            return (catA?.order || 0) - (catB?.order || 0);
        });
        // Collect cards in unit order, deduplicate by de|ar key
        const seen = new Set();
        const merged = [];
        unitOrder.forEach(unitId => {
            const unitCards = AppState.cards.filter(c => c.cat === unitId);
            unitCards.forEach(card => {
                const de = card.frontLang === 'de' ? card.front : card.back;
                const ar = card.frontLang === 'de' ? card.back : card.front;
                const key = `${de}|${ar}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    merged.push(card);
                }
            });
        });
        AppState.currentCards = merged;
        AppState.currentIdx = 0;
        AppState.flipped = false;
    }
}

/** Start the chosen learn mode with the current scope */
function startLearnMode(mode) {
    if (!AppState.learnScope || AppState.currentCards.length === 0) {
        showToast('👆 Bitte zuerst eine Einheit oder \"Alle Karten\" auswählen', 'warning');
        return;
    }
    if (mode === 'cards') {
        startFlashcards();
    } else if (mode === 'quiz_de_ar') {
        if (AppState.currentCards.length < 4) { showToast('⚠️ Min. 4 Karten für Quiz nötig', 'warning'); return; }
        startQuiz('de-ar');
    } else if (mode === 'quiz_ar_de') {
        if (AppState.currentCards.length < 4) { showToast('⚠️ Min. 4 Karten für Quiz nötig', 'warning'); return; }
        startQuiz('ar-de');
    }
}

/** Filter subcategory chips by search query */
function filterSubcategories(groupId) {
    const query = (document.getElementById('subSearch')?.value || '').toLowerCase();
    const grid = document.getElementById('subChipGrid');
    if (!grid) return;
    grid.querySelectorAll('.sub-chip').forEach(chip => {
        const name = chip.dataset.name || '';
        chip.style.display = name.includes(query) ? '' : 'none';
    });
}

/** Legacy — kept for backward compat */
function selectSubCat(subId) {
    setScopeSubCat(subId, AppState.currentGroup);
}

/** Legacy — kept for backward compat */
function startGroupFlashcards(groupId) {
    setScopeGroup(groupId);
}

/** Navigate back to groups view */
function backToGroups() {
    AppState.currentGroup = null;
    AppState.selectionMode = false;
    AppState.selectedUnits = [];
    AppState.learnScope = null;
    renderCategories();
}

function openNewCatModal() {
    AppState._newCatParentId = null; // Top-level by default
    document.getElementById('newCatName').value = '';
    AppState.selectedIcon = ICONS[0];
    renderIconPicker('newCatIconPicker', ICONS[0], 'selectNewCatIcon');
    // Reset modal title
    const modal = document.getElementById('newCatModal');
    const h3 = modal.querySelector('h3');
    if (h3) h3.textContent = '➕ Neues Kapitel erstellen';
    modal.classList.add('active');
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

    // Check if creating as subcategory (from group view) or top-level
    const isGroupCheckbox = document.getElementById('newCatIsGroup');
    const parentId = AppState._newCatParentId || null;

    const newCat = {
        id: 'cat_' + Date.now(),
        name: name,
        icon: AppState.selectedIcon || ICONS[0],
        parentId: parentId,
        order: AppState.categories.filter(c => c.parentId === parentId).length
    };

    AppState.categories.push(newCat);
    AppState._newCatParentId = null;
    Storage.save();
    renderCategories();
    closeModal('newCatModal');
    showToast(`✅ "${name}" erstellt!`, 'success');
}

/** Open new subcategory modal (pre-set parentId) */
function openNewSubModal(groupId) {
    AppState._newCatParentId = groupId;
    document.getElementById('newCatName').value = '';
    AppState.selectedIcon = '📄';
    renderIconPicker('newCatIconPicker', '📄', 'selectNewCatIcon');
    document.getElementById('newCatModal').classList.add('active');
    // Update modal title
    const modal = document.getElementById('newCatModal');
    const h3 = modal.querySelector('h3');
    if (h3) h3.textContent = '➕ Neue Einheit erstellen';
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

    // Check if it's a group with children
    const children = getSubcategories(catId);
    const childIds = children.map(c => c.id);
    const allIds = [catId, ...childIds];
    const cardCount = AppState.cards.filter(c => allIds.includes(c.cat)).length;

    let msg;
    if (children.length > 0) {
        msg = `⚠️ "${cat.name}" enthält ${children.length} Einheiten und ${cardCount} Karten!\n\nGruppe komplett löschen?`;
    } else {
        msg = cardCount > 0
            ? `⚠️ "${cat.name}" enthält ${cardCount} Karten!\n\nWirklich löschen?`
            : `"${cat.name}" löschen?`;
    }
    if (!confirm(msg)) return;

    haptic('heavy');

    // Delete category + all children + all cards in these
    AppState.categories = AppState.categories.filter(c => !allIds.includes(c.id));
    AppState.cards = AppState.cards.filter(c => !allIds.includes(c.cat));

    // If we deleted while in group view, go back
    if (AppState.currentGroup === catId) AppState.currentGroup = null;

    Storage.save();
    renderCategories();
    showToast(`🗑️ "${cat.name}" gelöscht`, 'info');
}

/** Delete a subcategory (stays in group view) */
function deleteSubCategory(subId, groupId) {
    const cat = AppState.categories.find(c => c.id === subId);
    if (!cat) return;
    const cardCount = AppState.cards.filter(c => c.cat === subId).length;
    const msg = cardCount > 0
        ? `⚠️ "${cat.name}" enthält ${cardCount} Karten!\n\nWirklich löschen?`
        : `"${cat.name}" löschen?`;
    if (!confirm(msg)) return;
    AppState.categories = AppState.categories.filter(c => c.id !== subId);
    AppState.cards = AppState.cards.filter(c => c.cat !== subId);
    if (AppState.currentCat === subId) {
        AppState.currentCat = null;
        AppState.learnScope = null;
    }
    Storage.save();
    renderSubcategories(groupId);
    updateCatDropdowns();
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

/** Reset to categories top-level when switching tabs */
function resetCategoryView() {
    AppState.currentGroup = null;
    AppState.currentCat = null;
}

// ===== LERNMODUS AUSWAHL =====
// showLearnModes is now integrated inline into renderSubcategories().
// This legacy function redirects to the new flow.
function showLearnModes() {
    if (AppState.currentGroup) {
        selectGroup(AppState.currentGroup);
    } else {
        // Standalone category — show it as a group
        selectGroup(AppState.currentCat);
    }
}

function startFlashcards() {
    const catId = AppState.currentCat || AppState.currentGroup;

    // Always ask user which side should be front
    document.getElementById('categoryGrid').innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center;">
        <div class="quiz-result">
            <div class="quiz-result-icon">🃏</div>
            <h3>Kartenrichtung wählen</h3>
            <div class="details" style="margin-top: 12px;">
                Welche Sprache soll vorne stehen?
            </div>
            <button class="btn btn-primary mb-sm" style="margin-top: 16px;" onclick="_startWithDirection('de')">
                🇩🇪 Deutsch vorne
            </button>
            <button class="btn btn-primary mb-sm" onclick="_startWithDirection('ar')">
                🇸🇦 Arabisch vorne
            </button>
            <button class="btn btn-secondary mb-sm" onclick="_startWithDirection('both')">
                🔀 Gemischt
            </button>
        </div>
      </div>
    `;
}

function _startWithDirection(dir) {
    let filtered;
    if (dir === 'de') {
        filtered = AppState.currentCards.filter(c => c.frontLang === 'de');
    } else if (dir === 'ar') {
        filtered = AppState.currentCards.filter(c => c.frontLang === 'ar');
    } else {
        filtered = AppState.currentCards;
    }
    if (filtered.length === 0) {
        showToast('📭 Keine Karten in dieser Richtung', 'info');
        return;
    }
    AppState.currentCards = filtered;
    _beginFlashcards(filtered);
}

function _beginFlashcards(cards) {
    const catId = AppState.currentCat || AppState.currentGroup;
    const savedIdx = _getResumeIndex(catId);
    if (savedIdx > 0 && savedIdx < cards.length) {
        document.getElementById('categoryGrid').innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center;">
            <div class="quiz-result">
                <div class="quiz-result-icon">📖</div>
                <h3>Fortsetzen?</h3>
                <div class="details" style="margin-top: 12px;">
                    Du warst bei Karte ${savedIdx + 1} von ${cards.length}
                </div>
                <button class="btn btn-primary mb-sm" style="margin-top: 16px;" onclick="_resumeFlashcards(${savedIdx})">
                    ▶️ Fortsetzen (ab Karte ${savedIdx + 1})
                </button>
                <button class="btn btn-secondary mb-sm" onclick="_resumeFlashcards(0)">
                    🔄 Neu starten
                </button>
            </div>
          </div>
        `;
        return;
    }
    AppState.currentIdx = 0;
    AppState.flipped = false;
    showCard();
}

function _resumeFlashcards(idx) {
    AppState.currentIdx = idx;
    AppState.flipped = false;
    showCard();
}

/** Save resume position */
function _saveResumeIndex(catId, idx) {
    try {
        const key = 'flashcard_resume';
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        data[catId] = { idx, ts: Date.now() };
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) { /* ignore */ }
}

/** Get saved resume index */
function _getResumeIndex(catId) {
    try {
        const data = JSON.parse(localStorage.getItem('flashcard_resume') || '{}');
        if (data[catId]) return data[catId].idx;
    } catch (e) { /* ignore */ }
    return 0;
}

/** Clear resume position after completion */
function _clearResumeIndex(catId) {
    try {
        const data = JSON.parse(localStorage.getItem('flashcard_resume') || '{}');
        delete data[catId];
        localStorage.setItem('flashcard_resume', JSON.stringify(data));
    } catch (e) { /* ignore */ }
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

// ===== GEAR MENU =====
function toggleGearMenu(e) {
    e.stopPropagation();
    const popup = document.getElementById('gearPopup');
    popup.classList.toggle('active');
}

function closeGearMenu() {
    const popup = document.getElementById('gearPopup');
    if (popup) popup.classList.remove('active');
}

// Close gear menu on outside click or ESC
document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('gearMenuWrapper');
    if (wrapper && !wrapper.contains(e.target)) closeGearMenu();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeGearMenu();
});

/** Show export dialog — pick a chapter first */
function showGlobalExportDialog() {
    const groups = getGroups();
    if (groups.length === 0) { showToast('📭 Keine Kapitel vorhanden', 'info'); return; }
    if (groups.length === 1) { showExportDialog(groups[0].id); return; }
    // Build a quick-pick list
    const options = groups.map(g => `${g.icon} ${g.name}`).join('\n');
    const pick = prompt('Welches Kapitel exportieren?\n\n' + options);
    if (!pick) return;
    const found = groups.find(g => pick.includes(g.name));
    if (found) showExportDialog(found.id);
    else showToast('⚠️ Kapitel nicht gefunden', 'warning');
}

/** Show merge dialog — pick a chapter first */
function showGlobalMergeDialog() {
    const groups = getGroups();
    if (groups.length < 2) { showToast('ℹ️ Min. 2 Kapitel zum Zusammenfassen nötig', 'info'); return; }
    const options = groups.map(g => `${g.icon} ${g.name}`).join('\n');
    const pick = prompt('Welches Kapitel verschieben?\n\n' + options);
    if (!pick) return;
    const found = groups.find(g => pick.includes(g.name));
    if (found) showMergeDialog(found.id);
    else showToast('⚠️ Kapitel nicht gefunden', 'warning');
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
            <div class="fmt-toolbar">
                <button class="fmt-btn" onclick="wrapSelection('editDe${i}','**')" title="Fett">B</button>
                <button class="fmt-btn fmt-italic" onclick="wrapSelection('editDe${i}','*')" title="Kursiv">I</button>
                <span class="fmt-hint">Text markieren → B/I drücken</span>
            </div>
            <input type="text" id="editDe${i}" value="${escapeAttr(w.de)}" class="form-input" placeholder="Deutsch" style="margin-bottom:4px;">
            <div class="fmt-toolbar">
                <button class="fmt-btn" onclick="wrapSelection('editAr${i}','**')" title="Fett">B</button>
                <button class="fmt-btn fmt-italic" onclick="wrapSelection('editAr${i}','*')" title="Kursiv">I</button>
            </div>
            <input type="text" id="editAr${i}" value="${escapeAttr(w.ar)}" class="form-input arabic" placeholder="Arabisch" dir="rtl" style="margin-bottom:4px;">
            <div style="display:flex;gap:6px;">
                <button class="btn btn-primary btn-small" onclick="saveEditWord(${i})">✅ OK</button>
                <button class="btn btn-secondary btn-small" onclick="renderPending()">❌</button>
            </div>
        </div>
    `;
    document.getElementById(`editDe${i}`).focus();
}

/** Wrap selected text in an input field with markdown markers */
function wrapSelection(inputId, marker) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const text = input.value;

    if (start === end) {
        // No selection: insert markers at cursor
        input.value = text.slice(0, start) + marker + marker + text.slice(start);
        input.setSelectionRange(start + marker.length, start + marker.length);
    } else {
        // Wrap selected text
        const selected = text.slice(start, end);
        // Check if already wrapped — toggle off
        if (text.slice(start - marker.length, start) === marker && text.slice(end, end + marker.length) === marker) {
            input.value = text.slice(0, start - marker.length) + selected + text.slice(end + marker.length);
            input.setSelectionRange(start - marker.length, end - marker.length);
        } else {
            input.value = text.slice(0, start) + marker + selected + marker + text.slice(end);
            input.setSelectionRange(start + marker.length, end + marker.length);
        }
    }
    input.focus();
}

/** Escape for HTML attribute (value="...") */
function escapeAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
                <span>${renderFormattedText(w.de)}</span> → <span class="ar">${renderFormattedText(w.ar)}</span>
                ${w.ex ? `<div class="example">💡 ${escapeHtml(w.ex)}</div>` : ''}
            </div>
            <div class="pending-word-actions">
                <button class="icon-btn" onclick="editWord(${i})" aria-label="Bearbeiten" title="Bearbeiten">✏️</button>
                <button class="remove-btn" onclick="removeWord(${i})" aria-label="Entfernen">×</button>
            </div>
        </div>
    `).join('');
}

/**
 * Render text with inline markdown formatting → HTML.
 * Supports **bold** and *italic*. Escapes HTML first for safety.
 * Order: bold first (** before *) to avoid conflict.
 */
function renderFormattedText(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    // **bold** → <b>bold</b>
    html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    // *italic* → <i>italic</i>
    html = html.replace(/\*(.+?)\*/g, '<i>$1</i>');
    return html;
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
                ex: w.ex, note: w.note || '', cat: catId,
                score: 0, correctCount: 0, wrongCount: 0, lastSeen: null
            });
            created++;
        }
        if (dir === 'both' || dir === 'ar-de') {
            AppState.cards.push({
                front: w.ar, back: w.de,
                frontLang: 'ar', backLang: 'de',
                ex: w.ex, note: w.note || '', cat: catId,
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
                    <div class="flashcard-text ${card.frontLang === 'ar' ? 'ar' : ''}">${renderFormattedText(card.front)}</div>
                    ${card.frontLang === 'de' && card.note ? `<div class="flashcard-note">📝 ${escapeHtml(card.note)}</div>` : ''}
                </div>
                <div class="flashcard-face flashcard-back">
                    <div class="flashcard-number">${AppState.currentIdx + 1}/${AppState.currentCards.length}</div>
                    <div class="flashcard-text ${(card.backLang || (card.frontLang === 'de' ? 'ar' : 'de')) === 'ar' ? 'ar' : ''}">${renderFormattedText(card.back)}</div>
                    ${card.frontLang === 'ar' && card.note ? `<div class="flashcard-note">📝 ${escapeHtml(card.note)}</div>` : ''}
                    ${card.ex ? `<div class="flashcard-example">💡 ${escapeHtml(card.ex)}</div>` : ''}
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
    haptic('light');
}

function nextCard() {
    if (AppState.currentIdx < AppState.currentCards.length - 1) {
        const el = document.getElementById('flashcardEl');
        if (el) {
            el.classList.add('swipe-left');
            setTimeout(() => {
                AppState.currentIdx++;
                AppState.flipped = false;
                _saveResumeIndex(AppState.currentCat || AppState.currentGroup, AppState.currentIdx);
                showCard();
            }, 300);
        } else {
            AppState.currentIdx++;
            AppState.flipped = false;
            _saveResumeIndex(AppState.currentCat || AppState.currentGroup, AppState.currentIdx);
            showCard();
        }
    } else {
        // Last card reached — show completion
        showFlashcardCompletion();
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
 * Populate the CSV import chapter selector (uses grouped format)
 */
function renderCSVCatSelect() {
    updateCatDropdowns();
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

/**
 * Clean a CSV field: strip unwanted characters that are noise, not content.
 * Removes: stray quotes " ' `, exclamation marks !, tildes ~, carets ^, pipes |,
 * backslashes \, number signs # (at start/end), excess whitespace.
 * Preserves: hyphens, parentheses, Arabic diacritics, question marks, dots, commas.
 */
function cleanCSVField(str) {
    if (!str) return str;
    // Strip surrounding quotes (single, double, backtick)
    str = str.replace(/^["'`]+|["'`]+$/g, '');
    // Remove stray quotes inside text
    str = str.replace(/[""`'']/g, '');
    // Remove ! at start or end
    str = str.replace(/^!+|!+$/g, '');
    // Remove other noise characters
    str = str.replace(/[~^|\\#]/g, '');
    // Collapse multiple spaces
    str = str.replace(/\s{2,}/g, ' ');
    return str.trim();
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

        // Auto-clean unwanted characters from fields
        de = cleanCSVField(de);
        ar = cleanCSVField(ar);
        ex = cleanCSVField(ex);

        if (!de || !ar) { skipped++; return; }

        // Extract note from German text (de): split on first " - " or "-" or " \u2013 " (en-dash)
        let note = '';
        const dashPatterns = [' - ', ' \u2013 '];
        let dashIdx = -1;
        let dashLen = 0;

        // First try German field for hyphen-separated notes
        for (const pat of dashPatterns) {
            const idx = de.indexOf(pat);
            if (idx > 0) { dashIdx = idx; dashLen = pat.length; break; }
        }
        // Fallback: bare "-" in German text
        if (dashIdx < 0) {
            const bareIdx = de.indexOf('-');
            if (bareIdx > 0) {
                const rightPart = de.substring(bareIdx + 1).trim();
                if (rightPart && rightPart.length > 1) {
                    dashIdx = bareIdx;
                    dashLen = 1;
                }
            }
        }
        if (dashIdx > 0) {
            note = de.substring(dashIdx + dashLen).trim();
            de = de.substring(0, dashIdx).trim();
        }

        // If no note from German, also try Arabic field (existing behavior)
        if (!note) {
            dashIdx = -1;
            dashLen = 0;
            for (const pat of dashPatterns) {
                const idx = ar.indexOf(pat);
                if (idx > 0) { dashIdx = idx; dashLen = pat.length; break; }
            }
            if (dashIdx < 0) {
                const bareIdx = ar.indexOf('-');
                if (bareIdx > 0) {
                    const rightPart = ar.substring(bareIdx + 1).trim();
                    if (rightPart && !isArabic(rightPart)) {
                        dashIdx = bareIdx;
                        dashLen = 1;
                    }
                }
            }
            if (dashIdx > 0) {
                note = ar.substring(dashIdx + dashLen).trim();
                ar = ar.substring(0, dashIdx).trim();
            }
        }

        console.log(`📥 Preview: DE="${de}" | AR="${ar}"${note ? ` | NOTE="${note}"` : ''}`);
        AppState.pending.push({ de, ar, ex, note });
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
            <div class="islam-card" onclick="PrayerTimes.open()">
                <div class="islam-card-icon">🕌</div>
                <div class="islam-card-name">Gebetszeiten</div>
                <div class="islam-card-ar">أوقات الصلاة</div>
                <div class="islam-card-subtitle">Hamburg</div>
            </div>
            <div class="islam-card" onclick="QiblaFinder.open()">
                <div class="islam-card-icon">🧭</div>
                <div class="islam-card-name">Qibla Finder</div>
                <div class="islam-card-ar">اتجاه القبلة</div>
                <div class="islam-card-subtitle">Kompass → Mekka</div>
            </div>
            <div class="islam-card" onclick="EbookUI.open()">
                <div class="islam-card-icon">📚</div>
                <div class="islam-card-name">Ebook Reader</div>
                <div class="islam-card-ar">قارئ الكتب</div>
                <div class="islam-card-subtitle">EPUB · PDF · TXT · HTML</div>
            </div>
        </div>
    `;
}

function showPrayerTimes() {
    PrayerTimes.open();
}

function quranGoToPage() {
    const page = prompt('Seitenzahl eingeben:', QuranReader.currentPage);
    if (page) QuranReader.goToPage(parseInt(page));
}

// ===== CHAPTER DRAG & DROP + MERGE =====

/** Init drag handles on chapter cards */
function initChapterDragSort() {
    const grid = document.getElementById('categoryGrid');
    if (!grid) return;
    const cards = grid.querySelectorAll('.category-card');
    let dragSrcEl = null;
    let dragSrcId = null;
    let touchClone = null;
    let longPressTimer = null;
    let isDragging = false;

    function lockBodyScroll() {
        document.body.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';
    }
    function unlockBodyScroll() {
        document.body.style.overflow = '';
        document.body.style.touchAction = '';
    }
    function cleanup() {
        isDragging = false;
        if (touchClone && touchClone.parentNode) touchClone.parentNode.removeChild(touchClone);
        touchClone = null;
        if (longPressTimer) clearTimeout(longPressTimer);
        longPressTimer = null;
        unlockBodyScroll();
        cards.forEach(c => {
            c.classList.remove('dragging', 'drag-over');
            c.style.opacity = '';
        });
    }

    cards.forEach(card => {
        const handle = card.querySelector('.chapter-drag-handle');
        if (!handle) return;
        const catId = card.dataset.catId;

        // Desktop drag
        handle.addEventListener('mousedown', () => {
            card.setAttribute('draggable', 'true');
        });
        card.addEventListener('dragstart', e => {
            dragSrcEl = card;
            dragSrcId = catId;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', catId);
        });
        card.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (card !== dragSrcEl) card.classList.add('drag-over');
        });
        card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
        card.addEventListener('drop', e => {
            e.preventDefault();
            e.stopPropagation();
            card.classList.remove('drag-over');
            if (dragSrcId && catId !== dragSrcId) {
                reorderChapters(dragSrcId, catId);
            }
        });
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            card.removeAttribute('draggable');
            dragSrcEl = null;
            dragSrcId = null;
            cards.forEach(c => c.classList.remove('drag-over'));
        });

        // Mobile long-press drag (iOS friendly)
        handle.style.touchAction = 'none';
        handle.addEventListener('touchstart', e => {
            const touch = e.touches[0];
            const startY = touch.clientY;
            const startX = touch.clientX;
            longPressTimer = setTimeout(() => {
                isDragging = true;
                dragSrcId = catId;
                dragSrcEl = card;
                lockBodyScroll();

                // Haptic feedback
                if (navigator.vibrate) navigator.vibrate(30);

                // Create clone
                touchClone = card.cloneNode(true);
                touchClone.classList.add('drag-clone');
                touchClone.style.cssText = `
                    position: fixed; z-index: 10000; pointer-events: none;
                    width: ${card.offsetWidth}px; opacity: 0.85;
                    left: ${card.getBoundingClientRect().left}px;
                    top: ${touch.clientY - 30}px;
                    transform: scale(1.03) rotate(1deg);
                    box-shadow: 0 8px 32px rgba(0,0,0,0.25);
                    transition: none;
                `;
                document.body.appendChild(touchClone);
                card.style.opacity = '0.3';
            }, 300);
        }, { passive: true });

        handle.addEventListener('touchmove', e => {
            if (!isDragging) {
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
                return;
            }
            e.preventDefault();
            const touch = e.touches[0];
            if (touchClone) touchClone.style.top = (touch.clientY - 30) + 'px';

            // Find target card
            const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
            cards.forEach(c => c.classList.remove('drag-over'));
            if (elementBelow) {
                const targetCard = elementBelow.closest('.category-card');
                if (targetCard && targetCard !== dragSrcEl) {
                    targetCard.classList.add('drag-over');
                }
            }
        }, { passive: false });

        handle.addEventListener('touchend', e => {
            if (!isDragging) {
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
                return;
            }
            const touch = e.changedTouches[0];
            const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
            if (elementBelow) {
                const targetCard = elementBelow.closest('.category-card');
                const targetId = targetCard ? targetCard.dataset.catId : null;
                if (targetId && targetId !== dragSrcId) {
                    reorderChapters(dragSrcId, targetId);
                }
            }
            cleanup();
        });

        handle.addEventListener('touchcancel', cleanup);
    });
}

/** Reorder top-level chapters */
function reorderChapters(fromId, toId) {
    const groups = getGroups();
    const fromIdx = groups.findIndex(g => g.id === fromId);
    const toIdx = groups.findIndex(g => g.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;

    const [moved] = groups.splice(fromIdx, 1);
    groups.splice(toIdx, 0, moved);

    groups.forEach((g, i) => {
        const cat = AppState.categories.find(c => c.id === g.id);
        if (cat) cat.order = i;
    });

    Storage.save();
    renderCategories();
    showToast('✅ Reihenfolge gespeichert', 'success');
}

// ===== CHAPTER MERGE =====
let _mergeSourceId = null;

function showMergeDialog(catId) {
    if (event) event.stopPropagation();
    _mergeSourceId = catId;
    const source = AppState.categories.find(c => c.id === catId);
    if (!source) return;

    const groups = getGroups().filter(g => g.id !== catId);
    if (groups.length === 0) {
        showToast('⚠️ Kein anderes Kapitel vorhanden', 'warning');
        return;
    }

    const subs = getSubcategories(catId);
    const unitCount = subs.length;
    const cardCount = subs.reduce((sum, s) => sum + AppState.cards.filter(c => c.cat === s.id).length, 0)
        + AppState.cards.filter(c => c.cat === catId).length;

    document.getElementById('mergeSourceInfo').textContent =
        `${source.icon} "${source.name}" — ${unitCount} Einheiten, ${cardCount} Karten`;

    const sel = document.getElementById('mergeTargetChapter');
    sel.innerHTML = groups.map(g =>
        `<option value="${g.id}">${g.icon} ${escapeHtml(g.name)}</option>`
    ).join('');

    document.getElementById('mergeChapterModal').classList.add('active');
}

function doMergeChapters() {
    const sourceId = _mergeSourceId;
    if (!sourceId) return;
    const targetId = document.getElementById('mergeTargetChapter').value;
    if (!targetId) return;

    const source = AppState.categories.find(c => c.id === sourceId);
    const target = AppState.categories.find(c => c.id === targetId);
    if (!source || !target) return;

    // Confirmation
    const sourceUnits = getSubcategories(sourceId);
    const totalCards = sourceUnits.reduce((s, u) => s + AppState.cards.filter(c => c.cat === u.id).length, 0)
        + AppState.cards.filter(c => c.cat === sourceId).length;

    if (!confirm(`"${source.name}" in "${target.name}" zusammenführen?\n\n${sourceUnits.length} Einheiten und ${totalCards} Karten werden verschoben.\n"${source.name}" wird danach gelöscht.`)) {
        return;
    }

    // Move units from source to target
    const existingTargetUnits = getSubcategories(targetId);
    let maxOrder = existingTargetUnits.length;

    sourceUnits.forEach((unit, i) => {
        const cat = AppState.categories.find(c => c.id === unit.id);
        if (cat) {
            cat.parentId = targetId;
            cat.order = maxOrder + i;
        }
    });

    // Move direct cards from source chapter to target chapter
    AppState.cards.forEach(card => {
        if (card.cat === sourceId) {
            card.cat = targetId;
        }
    });

    // Remove source chapter
    AppState.categories = AppState.categories.filter(c => c.id !== sourceId);

    Storage.save();
    _mergeSourceId = null;
    closeModal('mergeChapterModal');
    renderCategories();
    showToast(`✅ "${source.name}" → "${target.name}" zusammengeführt`, 'success');
}

// ===== BEREICH 1: DRAG & DROP SORTING =====
function initDragSort(groupId) {
    const grid = document.getElementById('subChipGrid');
    if (!grid) return;
    const chips = grid.querySelectorAll('.sub-chip');
    let dragSrcEl = null;
    let dragSrcId = null;
    let touchClone = null;
    let touchStartY = 0;
    let longPressTimer = null;
    let isDragging = false;

    function lockBodyScroll() {
        document.body.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';
    }

    function unlockBodyScroll() {
        document.body.style.overflow = '';
        document.body.style.touchAction = '';
    }

    chips.forEach(chip => {
        const subId = chip.getAttribute('data-subid');
        if (!subId) return;
        chip.setAttribute('data-sub-id', subId);
        chip.setAttribute('draggable', 'true');

        // Set touch-action on drag handle
        const handle = chip.querySelector('.sub-chip-drag-handle');
        if (handle) {
            handle.style.touchAction = 'none';
        }

        // Desktop drag events
        chip.addEventListener('dragstart', (e) => {
            dragSrcEl = chip;
            dragSrcId = subId;
            chip.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', subId);
        });

        chip.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            chip.classList.add('drag-over');
        });

        chip.addEventListener('dragleave', () => {
            chip.classList.remove('drag-over');
        });

        chip.addEventListener('drop', (e) => {
            e.preventDefault();
            chip.classList.remove('drag-over');
            if (dragSrcEl === chip) return;
            const targetId = chip.getAttribute('data-sub-id');
            reorderSubcategories(groupId, dragSrcId, targetId);
        });

        chip.addEventListener('dragend', () => {
            chip.classList.remove('dragging');
            grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
        });

        // Mobile: long-press on drag handle to initiate drag
        const touchTarget = handle || chip;
        touchTarget.addEventListener('touchstart', (e) => {
            touchStartY = e.touches[0].clientY;
            longPressTimer = setTimeout(() => {
                isDragging = true;
                dragSrcEl = chip;
                dragSrcId = subId;
                chip.classList.add('dragging');
                lockBodyScroll();

                // Haptic feedback
                if (navigator.vibrate) navigator.vibrate(50);

                // Create visual clone
                touchClone = chip.cloneNode(true);
                touchClone.classList.add('drag-clone');
                touchClone.style.position = 'fixed';
                touchClone.style.pointerEvents = 'none';
                touchClone.style.zIndex = '9999';
                touchClone.style.width = chip.offsetWidth + 'px';
                const rect = chip.getBoundingClientRect();
                touchClone.style.left = rect.left + 'px';
                touchClone.style.top = rect.top + 'px';
                document.body.appendChild(touchClone);
            }, 300);
        }, { passive: true });

        touchTarget.addEventListener('touchmove', (e) => {
            if (!isDragging || !dragSrcEl || !touchClone) {
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
                return;
            }
            e.preventDefault();
            const touch = e.touches[0];
            touchClone.style.left = (touch.clientX - touchClone.offsetWidth / 2) + 'px';
            touchClone.style.top = (touch.clientY - 20) + 'px';

            // Highlight target chip
            grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            if (target) {
                const targetChip = target.closest('.sub-chip');
                if (targetChip && targetChip !== dragSrcEl) {
                    targetChip.classList.add('drag-over');
                }
            }
        }, { passive: false });

        touchTarget.addEventListener('touchend', (e) => {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            if (!isDragging || !dragSrcEl || !touchClone) {
                isDragging = false;
                return;
            }

            const touch = e.changedTouches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            if (target) {
                const targetChip = target.closest('.sub-chip');
                if (targetChip && targetChip !== dragSrcEl) {
                    const targetId = targetChip.getAttribute('data-sub-id');
                    if (targetId) reorderSubcategories(groupId, dragSrcId, targetId);
                }
            }

            // Cleanup
            dragSrcEl.classList.remove('dragging');
            if (touchClone && touchClone.parentNode) touchClone.parentNode.removeChild(touchClone);
            touchClone = null;
            dragSrcEl = null;
            isDragging = false;
            unlockBodyScroll();
            grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
        });

        // Cancel drag on touchcancel
        touchTarget.addEventListener('touchcancel', () => {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            if (dragSrcEl) dragSrcEl.classList.remove('dragging');
            if (touchClone && touchClone.parentNode) touchClone.parentNode.removeChild(touchClone);
            touchClone = null;
            dragSrcEl = null;
            isDragging = false;
            unlockBodyScroll();
            grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
        });
    });
}

function reorderSubcategories(groupId, fromId, toId) {
    const subs = getSubcategories(groupId);
    const fromIdx = subs.findIndex(s => s.id === fromId);
    const toIdx = subs.findIndex(s => s.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;

    // Move item
    const [moved] = subs.splice(fromIdx, 1);
    subs.splice(toIdx, 0, moved);

    // Update order values
    subs.forEach((sub, i) => {
        const cat = AppState.categories.find(c => c.id === sub.id);
        if (cat) cat.order = i;
    });

    Storage.save();
    renderSubcategories(groupId);
    showToast('✅ Reihenfolge gespeichert', 'success');
}

// ===== BEREICH 2: LERNERFOLG VIEW =====
function showLernerfolg(groupId) {
    const grid = document.getElementById('categoryGrid');
    const group = AppState.categories.find(c => c.id === groupId);
    if (!group || !grid) return;

    const subs = getSubcategories(groupId);
    const allIds = [groupId, ...subs.map(s => s.id)];

    // Calculate stats per period
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    const history = Stats.data.history || {};
    let todayStats = { learned: 0, quiz: 0, correct: 0 };
    let weekStats = { learned: 0, quiz: 0, correct: 0 };
    let monthStats = { learned: 0, quiz: 0, correct: 0 };
    let totalStats = { learned: 0, quiz: 0, correct: 0 };

    Object.entries(history).forEach(([date, entry]) => {
        totalStats.learned += entry.learned || 0;
        totalStats.quiz += entry.quiz || 0;
        totalStats.correct += entry.correct || 0;
        if (date >= monthAgo) {
            monthStats.learned += entry.learned || 0;
            monthStats.quiz += entry.quiz || 0;
            monthStats.correct += entry.correct || 0;
        }
        if (date >= weekAgo) {
            weekStats.learned += entry.learned || 0;
            weekStats.quiz += entry.quiz || 0;
            weekStats.correct += entry.correct || 0;
        }
        if (date === today) {
            todayStats = { ...entry };
        }
    });

    // Completed units (all word pairs answered)
    let completedUnits = 0;
    subs.forEach(sub => {
        const prog = computeProgress(sub.id);
        if (prog.total > 0 && prog.answered >= prog.total) completedUnits++;
    });

    const quizAccuracy = (stats) => stats.quiz > 0 ? Math.round((stats.correct / stats.quiz) * 100) : 0;

    const groupProg = getGroupProgress(groupId);

    grid.innerHTML = `
        <div style="grid-column: 1 / -1;">
            <div class="group-header">
                <button class="back-btn" onclick="renderSubcategories('${groupId}')">←</button>
                <div class="group-header-info">
                    <h3>📊 Lernerfolg — ${group.icon} ${escapeHtml(group.name)}</h3>
                    <p>${groupProg.answered}/${groupProg.total} bearbeitet · ${completedUnits}/${subs.length} Einheiten</p>
                </div>
            </div>

            <div class="lernerfolg-container">
                <div class="lernerfolg-section">
                    <h4>📅 Heute</h4>
                    <div class="lernerfolg-grid">
                        <div class="lernerfolg-card">
                            <div class="lernerfolg-number">${todayStats.learned}</div>
                            <div class="lernerfolg-label">Gelernte Karten</div>
                        </div>
                        <div class="lernerfolg-card">
                            <div class="lernerfolg-number">${quizAccuracy(todayStats)}%</div>
                            <div class="lernerfolg-label">Quiz-Erfolg</div>
                        </div>
                    </div>
                </div>

                <div class="lernerfolg-section">
                    <h4>📆 Woche</h4>
                    <div class="lernerfolg-grid">
                        <div class="lernerfolg-card">
                            <div class="lernerfolg-number">${weekStats.learned}</div>
                            <div class="lernerfolg-label">Gelernte Karten</div>
                        </div>
                        <div class="lernerfolg-card">
                            <div class="lernerfolg-number">${quizAccuracy(weekStats)}%</div>
                            <div class="lernerfolg-label">Quiz-Erfolg</div>
                        </div>
                    </div>
                </div>

                <div class="lernerfolg-section">
                    <h4>🗓️ Monat</h4>
                    <div class="lernerfolg-grid">
                        <div class="lernerfolg-card">
                            <div class="lernerfolg-number">${monthStats.learned}</div>
                            <div class="lernerfolg-label">Gelernte Karten</div>
                        </div>
                        <div class="lernerfolg-card">
                            <div class="lernerfolg-number">${quizAccuracy(monthStats)}%</div>
                            <div class="lernerfolg-label">Quiz-Erfolg</div>
                        </div>
                    </div>
                </div>

                <div class="lernerfolg-section">
                    <h4>🏆 Gesamt</h4>
                    <div class="lernerfolg-grid">
                        <div class="lernerfolg-card">
                            <div class="lernerfolg-number">${totalStats.learned}</div>
                            <div class="lernerfolg-label">Gelernte Karten</div>
                        </div>
                        <div class="lernerfolg-card">
                            <div class="lernerfolg-number">${quizAccuracy(totalStats)}%</div>
                            <div class="lernerfolg-label">Quiz-Erfolg</div>
                        </div>
                    </div>
                </div>

                <div class="lernerfolg-section">
                    <h4>📖 Einheiten-Fortschritt</h4>
                    <div class="lernerfolg-units">
                        ${subs.map(sub => {
        const p = computeProgress(sub.id);
        return `
                                <div class="lernerfolg-unit-row">
                                    <span class="lernerfolg-unit-name">${sub.icon || '📄'} ${escapeHtml(sub.name)}</span>
                                    <div class="lernerfolg-unit-bar">
                                        <div class="lernerfolg-unit-fill" style="width: ${p.pct}%"></div>
                                    </div>
                                    <span class="lernerfolg-unit-pct">${p.answered}/${p.total}</span>
                                </div>
                            `;
    }).join('')}
                    </div>
                </div>

                ${Stats.data.streak > 0 ? `
                    <div class="lernerfolg-streak">🔥 ${Stats.data.streak} Tag${Stats.data.streak !== 1 ? 'e' : ''} Streak!</div>
                ` : ''}
            </div>
        </div>
    `;
}

// ===== BEREICH 4: CONFETTI ANIMATION =====
function showConfetti() {
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti-canvas';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    const particles = [];
    const colors = ['#c8952e', '#f5d478', '#4CAF50', '#2196F3', '#FF5722', '#E91E63', '#9C27B0'];

    for (let i = 0; i < 120; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: -10 - Math.random() * 100,
            w: 6 + Math.random() * 6,
            h: 4 + Math.random() * 4,
            color: colors[Math.floor(Math.random() * colors.length)],
            vx: (Math.random() - 0.5) * 4,
            vy: 2 + Math.random() * 4,
            rotation: Math.random() * 360,
            rotSpeed: (Math.random() - 0.5) * 10,
            opacity: 1
        });
    }

    let frame = 0;
    function animate() {
        frame++;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.1;
            p.rotation += p.rotSpeed;
            if (frame > 60) p.opacity -= 0.015;

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation * Math.PI / 180);
            ctx.globalAlpha = Math.max(0, p.opacity);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        });

        if (frame < 150 && particles.some(p => p.opacity > 0)) {
            requestAnimationFrame(animate);
        } else {
            canvas.remove();
        }
    }
    requestAnimationFrame(animate);
}

function getMotivationMessage(pct) {
    if (pct === 100) return { emoji: '🏆', text: 'Perfekt! Großartige Leistung!' };
    if (pct >= 80) return { emoji: '🌟', text: 'Sehr gut gemacht!' };
    if (pct >= 50) return { emoji: '👍', text: 'Gute Arbeit! Weiter so!' };
    return { emoji: '💪', text: 'Bleib dran, du schaffst das!' };
}

function showFlashcardCompletion() {
    const total = AppState.currentCards.length;
    const cat = AppState.categories.find(c => c.id === AppState.currentCat);
    if (!cat) return;

    // Mark all cards in scope as "seen"
    AppState.currentCards.forEach(card => {
        if (!card.lastSeen) card.lastSeen = Date.now();
    });
    Storage.save();

    // Clear resume position (completed)
    _clearResumeIndex(AppState.currentCat || AppState.currentGroup);

    showConfetti();

    document.getElementById('categoryGrid').innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center;">
        <div class="quiz-result">
            <div class="quiz-result-icon">🎉</div>
            <h3>Alle ${total} Karten durchgearbeitet!</h3>
            <div class="details" style="margin-top: 12px;">
                ${getMotivationMessage(100).text}
            </div>
            <button class="btn btn-primary mb-sm" style="margin-top: 16px;" onclick="startFlashcards()">
                🔄 Nochmal üben
            </button>
            <button class="btn btn-secondary mb-sm" onclick="showLearnModes()">
                ← Zurück
            </button>
        </div>
      </div>
    `;
}

// ===== EXPORT / IMPORT SYSTEM =====

/** State for export dialog */
let _exportDialogCatId = null;

/** Show export choice dialog */
function showExportDialog(catId) {
    if (event) event.stopPropagation();
    _exportDialogCatId = catId;

    const cat = AppState.categories.find(c => c.id === catId);
    if (!cat) return;

    const subs = getSubcategories(catId);
    const totalCards = subs.length > 0 ? getGroupCardCount(catId) : AppState.cards.filter(c => c.cat === catId).length;
    const info = document.getElementById('exportModalInfo');
    info.textContent = `${cat.icon} ${cat.name} — ${totalCards} Karten${subs.length > 0 ? `, ${subs.length} Einheiten` : ''}`;

    document.getElementById('exportModal').classList.add('active');
}

/** Export full JSON (chapter + units + cards) */
function exportFullJSON() {
    const catId = _exportDialogCatId;
    if (!catId) return;
    closeModal('exportModal');

    const cat = AppState.categories.find(c => c.id === catId);
    if (!cat) return;

    const subs = getSubcategories(catId);
    const exportData = {
        version: 1,
        type: 'arabisch-app-export',
        exportedAt: new Date().toISOString(),
        chapter: {
            name: cat.name,
            icon: cat.icon || '',
        },
        units: [],
        cards: []
    };

    if (subs.length > 0) {
        // Export with sub-units
        subs.forEach((sub, idx) => {
            const unitId = `unit_${idx}`;
            exportData.units.push({
                id: unitId,
                name: sub.name,
                icon: sub.icon || '',
                shortLabel: sub.shortLabel || '',
                order: sub.order || idx
            });
            const subCards = AppState.cards.filter(c => c.cat === sub.id);
            subCards.forEach(card => {
                exportData.cards.push({
                    unitRef: unitId,
                    front: card.front,
                    back: card.back,
                    frontLang: card.frontLang || 'de',
                    note: card.note || ''
                });
            });
        });
        // Also export cards directly on the chapter
        const ownCards = AppState.cards.filter(c => c.cat === catId);
        ownCards.forEach(card => {
            exportData.cards.push({
                unitRef: null,
                front: card.front,
                back: card.back,
                frontLang: card.frontLang || 'de',
                note: card.note || ''
            });
        });
    } else {
        // Flat chapter — no units
        const catCards = AppState.cards.filter(c => c.cat === catId);
        catCards.forEach(card => {
            exportData.cards.push({
                unitRef: null,
                front: card.front,
                back: card.back,
                frontLang: card.frontLang || 'de',
                note: card.note || ''
            });
        });
    }

    if (exportData.cards.length === 0) {
        showToast('📭 Keine Karten zum Exportieren', 'info');
        return;
    }

    const json = JSON.stringify(exportData, null, 2);
    downloadFile(json, sanitizeFilename(cat.name) + '.json', 'application/json;charset=utf-8;');
    showToast(`📦 ${exportData.cards.length} Karten + ${exportData.units.length} Einheiten exportiert!`, 'success');
}

/** Export CSV only (old behavior) */
function exportCSVOnly() {
    const catId = _exportDialogCatId;
    if (!catId) return;
    closeModal('exportModal');
    exportCSV(catId);
}

function exportCSV(catId) {
    if (event) event.stopPropagation();

    const cat = AppState.categories.find(c => c.id === catId);
    if (!cat) return;

    const subs = getSubcategories(catId);

    // If has subcategories → ZIP export
    if (subs.length > 0) {
        exportZIP(catId, cat, subs);
        return;
    }

    // Single chapter → CSV
    const catCards = AppState.cards.filter(c => c.cat === catId);
    if (catCards.length === 0) {
        showToast('📭 Keine Karten zum Exportieren', 'info');
        return;
    }

    const csv = buildCSV(catCards);
    downloadFile(csv, sanitizeFilename(cat.name) + '.csv', 'text/csv;charset=utf-8;');
    const pairCount = csv.split('\n').length - 2;
    showToast(`📤 ${pairCount} Karten exportiert!`, 'success');
}

/** Trigger import file picker (JSON or ZIP) */
function triggerImport() {
    if (event) event.stopPropagation();
    document.getElementById('importFileInput').click();
}

/** Pending import data (set before showing target modal) */
let _pendingImportData = null;

/** Handle imported file — auto-detect JSON or ZIP */
function handleImportFile(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    input.value = '';

    const name = file.name.toLowerCase();

    if (name.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = JSON.parse(e.target.result);
                if (!data || data.type !== 'arabisch-app-export' || !data.chapter || !Array.isArray(data.cards)) {
                    showToast('❌ Ungültiges JSON-Format', 'error');
                    return;
                }
                _pendingImportData = data;
                showImportTargetModal(data);
            } catch (err) {
                console.error('JSON parse error:', err);
                showToast('❌ JSON-Datei konnte nicht gelesen werden', 'error');
            }
        };
        reader.readAsText(file, 'UTF-8');
    } else if (name.endsWith('.zip')) {
        if (typeof JSZip === 'undefined') {
            showToast('❌ JSZip nicht geladen', 'error');
            return;
        }
        JSZip.loadAsync(file).then(zip => {
            parseZipImport(zip, name.replace('.zip', ''));
        }).catch(err => {
            console.error('ZIP read error:', err);
            showToast('❌ ZIP konnte nicht gelesen werden', 'error');
        });
    } else {
        showToast('❌ Nur .json oder .zip Dateien', 'error');
    }
}

/** Parse ZIP: each CSV file = 1 unit */
async function parseZipImport(zip, zipName) {
    const data = {
        type: 'arabisch-app-export',
        chapter: { name: zipName.replace(/_/g, ' '), icon: '📦' },
        units: [],
        cards: []
    };

    const csvFiles = Object.keys(zip.files).filter(f => f.endsWith('.csv') && !f.startsWith('__MACOSX'));
    for (let i = 0; i < csvFiles.length; i++) {
        const fileName = csvFiles[i];
        const unitId = `unit_${i}`;
        const unitName = fileName.replace('.csv', '').replace(/_/g, ' ');
        data.units.push({ id: unitId, name: unitName, icon: '📄', order: i });

        const csvText = await zip.files[fileName].async('text');
        const lines = csvText.split('\n').filter(l => l.trim());
        // Skip header if present
        const startIdx = (lines[0] && (lines[0].toLowerCase().includes('arabic') || lines[0].toLowerCase().includes('german'))) ? 1 : 0;
        for (let j = startIdx; j < lines.length; j++) {
            const parts = lines[j].split(/[,;\t]/).map(s => s.trim());
            if (parts.length >= 2 && parts[0] && parts[1]) {
                // Detect column order: if first col has Arabic chars → ar,de; else de,ar
                const hasArabic = /[\u0600-\u06FF]/.test(parts[0]);
                let arVal = hasArabic ? parts[0] : parts[1];
                let deVal = hasArabic ? parts[1] : parts[0];
                // Extract note from arabic field
                let noteVal = '';
                const dashPos = arVal.indexOf(' - ');
                if (dashPos > 0) {
                    noteVal = arVal.substring(dashPos + 3).trim();
                    arVal = arVal.substring(0, dashPos).trim();
                }
                data.cards.push({
                    unitRef: unitId,
                    front: deVal,
                    back: arVal,
                    frontLang: 'de',
                    note: noteVal
                });
            }
        }
    }

    if (data.cards.length === 0) {
        showToast('📭 Keine Karten in ZIP gefunden', 'info');
        return;
    }

    _pendingImportData = data;
    showImportTargetModal(data);
}

/** Show import target selection modal */
function showImportTargetModal(data) {
    const unitCount = data.units ? data.units.length : 0;
    const cardCount = data.cards ? data.cards.length : 0;
    const chapterName = data.chapter ? data.chapter.name : 'Import';

    // Info
    const info = document.getElementById('importModalInfo');
    info.textContent = `📦 "${chapterName}" — ${cardCount} Karten${unitCount > 0 ? `, ${unitCount} Einheiten` : ''}`;

    // Chapter name input
    const nameInput = document.getElementById('importChapterName');
    nameInput.value = chapterName;

    // Populate target chapter dropdown
    const targetSelect = document.getElementById('importTargetChapter');
    const groups = getGroups();
    targetSelect.innerHTML = groups.map(g =>
        `<option value="${g.id}">${g.icon} ${escapeHtml(g.name)}</option>`
    ).join('');

    // Default: new chapter
    document.getElementById('importModeNew').checked = true;
    document.getElementById('importNewChapterSection').style.display = '';
    document.getElementById('importExistingSection').style.display = 'none';

    document.getElementById('importTargetModal').classList.add('active');
}

/** Toggle import mode radio */
function toggleImportMode() {
    const isNew = document.getElementById('importModeNew').checked;
    document.getElementById('importNewChapterSection').style.display = isNew ? '' : 'none';
    document.getElementById('importExistingSection').style.display = isNew ? 'none' : '';
}

/** Execute the import with selected target */
function doImport() {
    const data = _pendingImportData;
    if (!data) return;

    const isNew = document.getElementById('importModeNew').checked;
    let targetChapterId;
    let chapterNameForSummary;

    if (isNew) {
        // Create new chapter
        const name = document.getElementById('importChapterName').value.trim() || data.chapter.name || 'Importiert';
        targetChapterId = 'cat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        AppState.categories.push({
            id: targetChapterId,
            name: name,
            icon: data.chapter.icon || '📖',
            parentId: null,
            order: getGroups().length
        });
        chapterNameForSummary = name;
    } else {
        // Use existing chapter
        targetChapterId = document.getElementById('importTargetChapter').value;
        const existing = AppState.categories.find(c => c.id === targetChapterId);
        chapterNameForSummary = existing ? existing.name : 'Unbekannt';
    }

    // Create units
    const unitIdMap = {};
    const existingUnits = getSubcategories(targetChapterId);
    const existingUnitNames = existingUnits.map(u => u.name.toLowerCase());
    let maxOrder = existingUnits.length;

    if (data.units && data.units.length > 0) {
        data.units.forEach((unit, idx) => {
            const unitId = 'cat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '_u' + idx;
            unitIdMap[unit.id] = unitId;

            // Deduplicate name
            let unitName = unit.name || `Einheit ${idx + 1}`;
            if (existingUnitNames.includes(unitName.toLowerCase())) {
                let counter = 2;
                while (existingUnitNames.includes(`${unitName} (Import ${counter})`.toLowerCase())) counter++;
                unitName = `${unitName} (Import ${counter})`;
            }
            existingUnitNames.push(unitName.toLowerCase());

            AppState.categories.push({
                id: unitId,
                name: unitName,
                icon: unit.icon || '📄',
                shortLabel: unit.shortLabel || '',
                parentId: targetChapterId,
                order: maxOrder + (unit.order || idx)
            });
        });
    }

    // Create cards
    let cardCount = 0;
    data.cards.forEach(cardData => {
        let targetCat = targetChapterId;
        if (cardData.unitRef && unitIdMap[cardData.unitRef]) {
            targetCat = unitIdMap[cardData.unitRef];
        }

        const exists = AppState.cards.some(c =>
            c.cat === targetCat && c.front === cardData.front && c.back === cardData.back
        );
        if (!exists) {
            AppState.cards.push({
                id: 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8),
                cat: targetCat,
                front: cardData.front,
                back: cardData.back,
                frontLang: cardData.frontLang || 'de',
                backLang: (cardData.frontLang || 'de') === 'de' ? 'ar' : 'de',
                note: cardData.note || '',
                score: 0,
                lastSeen: null
            });
            cardCount++;
        }
    });

    Storage.save();
    _pendingImportData = null;
    closeModal('importTargetModal');
    renderCategories();

    const unitCount = data.units ? data.units.length : 0;
    const summaryParts = [`${cardCount} Karten`];
    if (unitCount > 0) summaryParts.push(`${unitCount} Einheiten`);
    summaryParts.push(`→ "${chapterNameForSummary}"`);
    showToast(`✅ Importiert: ${summaryParts.join(', ')}`, 'success');
}

async function exportZIP(catId, cat, subs) {
    if (typeof JSZip === 'undefined') {
        showToast('❌ JSZip nicht geladen', 'error');
        return;
    }

    const zip = new JSZip();
    let totalPairs = 0;

    subs.forEach(sub => {
        const subCards = AppState.cards.filter(c => c.cat === sub.id);
        if (subCards.length === 0) return;
        const csv = buildCSV(subCards);
        const filename = sanitizeFilename(sub.name) + '.csv';
        zip.file(filename, csv);
        totalPairs += csv.split('\n').length - 2;
    });

    // Also include cards directly in the group
    const ownCards = AppState.cards.filter(c => c.cat === catId);
    if (ownCards.length > 0) {
        const csv = buildCSV(ownCards);
        zip.file(sanitizeFilename(cat.name) + '_direkt.csv', csv);
        totalPairs += csv.split('\n').length - 2;
    }

    if (totalPairs === 0) {
        showToast('📭 Keine Karten zum Exportieren', 'info');
        return;
    }

    try {
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = sanitizeFilename(cat.name) + '.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`📤 ${totalPairs} Karten als ZIP exportiert!`, 'success');
    } catch (e) {
        console.error('ZIP export error:', e);
        showToast('❌ Export fehlgeschlagen', 'error');
    }
}

function buildCSV(cards) {
    const pairMap = new Map();
    cards.forEach(card => {
        let de, ar;
        if (card.frontLang === 'de') { de = card.front; ar = card.back; }
        else { de = card.back; ar = card.front; }
        const key = `${de}|${ar}`;
        if (!pairMap.has(key)) pairMap.set(key, { ar, de, note: card.note || '' });
    });

    let csv = '\uFEFF'; // UTF-8 BOM
    csv += 'arabic;german\n';
    pairMap.forEach(p => {
        // Recombine note back into German field for round-trip compatibility
        const deExport = p.note ? `${p.de} - ${p.note}` : p.de;
        csv += `${p.ar};${deExport}\n`;
    });
    return csv;
}

function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, '_').substring(0, 100);
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
function initApp() {
    Storage.load();
    Stats.load();
    renderCategories();
    renderPending();
    setupDragDrop();

    // Only register Service Worker in browser context (not in Capacitor native app)
    // In Capacitor, files are embedded locally — SW caching is unnecessary
    if (!window.Capacitor && 'serviceWorker' in navigator) {
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
