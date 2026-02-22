/**
 * srs-db.js — IndexedDB storage layer for FSRS Spaced Repetition
 * Stores: srs_cards (review state), srs_reviews (history), srs_meta (settings)
 */
const SrsDB = (() => {
    'use strict';

    const DB_NAME = 'srs_database';
    const DB_VERSION = 1;
    let _db = null;

    // ── Open / Upgrade ──────────────────────────────────────────────
    function init() {
        if (_db) return Promise.resolve(_db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                // srs_cards: main SRS state per card
                if (!db.objectStoreNames.contains('srs_cards')) {
                    const store = db.createObjectStore('srs_cards', { keyPath: 'id' });
                    store.createIndex('due', 'due', { unique: false });
                    store.createIndex('deck', 'deck', { unique: false });
                    store.createIndex('state', 'state', { unique: false });
                }
                // srs_reviews: review history log
                if (!db.objectStoreNames.contains('srs_reviews')) {
                    const rStore = db.createObjectStore('srs_reviews', { keyPath: 'id', autoIncrement: true });
                    rStore.createIndex('cardId', 'cardId', { unique: false });
                    rStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                // srs_meta: settings (weights, retention, etc.)
                if (!db.objectStoreNames.contains('srs_meta')) {
                    db.createObjectStore('srs_meta', { keyPath: 'key' });
                }
            };
            req.onsuccess = () => {
                _db = req.result;
                resolve(_db);
            };
        });
    }

    // ── Generic helpers ─────────────────────────────────────────────
    function _tx(storeName, mode = 'readonly') {
        return _db.transaction(storeName, mode).objectStore(storeName);
    }

    function _promisify(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    // ── srs_cards CRUD ──────────────────────────────────────────────
    async function getCard(id) {
        await init();
        return _promisify(_tx('srs_cards').get(id));
    }

    async function putCard(record) {
        await init();
        return _promisify(_tx('srs_cards', 'readwrite').put(record));
    }

    async function getAllCards() {
        await init();
        return _promisify(_tx('srs_cards').getAll());
    }

    async function deleteCard(id) {
        await init();
        return _promisify(_tx('srs_cards', 'readwrite').delete(id));
    }

    /**
     * Get all cards due now or earlier.
     * @param {string} [deckFilter] — optional deck/cat ID to filter
     * @returns {Promise<Array>} cards sorted by due (ascending)
     */
    async function getDueCards(deckFilter) {
        await init();
        const now = Date.now();
        return new Promise((resolve, reject) => {
            const store = _tx('srs_cards');
            const idx = store.index('due');
            const range = IDBKeyRange.upperBound(now);
            const results = [];
            const req = idx.openCursor(range);
            req.onerror = () => reject(req.error);
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const card = cursor.value;
                    if (!deckFilter || card.deck === deckFilter) {
                        results.push(card);
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
        });
    }

    /**
     * Count cards due now.
     */
    async function countDue(deckFilter) {
        const cards = await getDueCards(deckFilter);
        return cards.length;
    }

    /**
     * Count new cards (state === "new").
     */
    async function countNew(deckFilter) {
        await init();
        return new Promise((resolve, reject) => {
            const store = _tx('srs_cards');
            const idx = store.index('state');
            const range = IDBKeyRange.only('new');
            let count = 0;
            const req = idx.openCursor(range);
            req.onerror = () => reject(req.error);
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    if (!deckFilter || cursor.value.deck === deckFilter) count++;
                    cursor.continue();
                } else {
                    resolve(count);
                }
            };
        });
    }

    // ── srs_reviews (history log) ───────────────────────────────────
    async function logReview(entry) {
        await init();
        entry.timestamp = entry.timestamp || Date.now();
        return _promisify(_tx('srs_reviews', 'readwrite').add(entry));
    }

    async function getReviewHistory(cardId) {
        await init();
        return new Promise((resolve, reject) => {
            const store = _tx('srs_reviews');
            const idx = store.index('cardId');
            const range = IDBKeyRange.only(cardId);
            const results = [];
            const req = idx.openCursor(range);
            req.onerror = () => reject(req.error);
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
        });
    }

    // ── srs_meta (settings) ─────────────────────────────────────────
    async function getMeta(key) {
        await init();
        const record = await _promisify(_tx('srs_meta').get(key));
        return record ? record.value : null;
    }

    async function setMeta(key, value) {
        await init();
        return _promisify(_tx('srs_meta', 'readwrite').put({ key, value }));
    }

    // ── Export / Import ─────────────────────────────────────────────
    async function exportAll() {
        await init();
        const cards = await getAllCards();
        const meta = await _promisify(_tx('srs_meta').getAll());
        const reviews = await _promisify(_tx('srs_reviews').getAll());
        return { cards, meta, reviews, exportedAt: Date.now() };
    }

    async function importAll(data) {
        await init();
        const tx = _db.transaction(['srs_cards', 'srs_meta', 'srs_reviews'], 'readwrite');
        const cardStore = tx.objectStore('srs_cards');
        const metaStore = tx.objectStore('srs_meta');
        const reviewStore = tx.objectStore('srs_reviews');

        if (data.cards) {
            for (const card of data.cards) cardStore.put(card);
        }
        if (data.meta) {
            for (const m of data.meta) metaStore.put(m);
        }
        if (data.reviews) {
            for (const r of data.reviews) reviewStore.put(r);
        }

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    return {
        init, getCard, putCard, getAllCards, deleteCard,
        getDueCards, countDue, countNew,
        logReview, getReviewHistory,
        getMeta, setMeta,
        exportAll, importAll
    };
})();
