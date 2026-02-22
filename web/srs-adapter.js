/**
 * srs-adapter.js — Zero-touch bridge between existing AppState.cards and SRS system.
 * Reads cards from localStorage, creates SRS records in IndexedDB.
 * NEVER modifies AppState or Storage.
 */
const SrsAdapter = (() => {
    'use strict';

    // ── Deterministic card ID (FNV-1a hash) ─────────────────────────
    function hashId(str) {
        let hash = 0x811c9dc5; // FNV offset basis
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193); // FNV prime
        }
        // Convert to positive hex string
        return 'srs_' + (hash >>> 0).toString(16).padStart(8, '0');
    }

    function cardId(card) {
        return hashId((card.front || '') + '|' + (card.back || '') + '|' + (card.cat || ''));
    }

    /**
     * Sync all existing AppState.cards into SRS IndexedDB.
     * Creates new SRS records for cards not yet tracked.
     * Skips cards that already have SRS records (preserves state).
     * @returns {Object} { total, created, existing }
     */
    async function syncCards() {
        await SrsDB.init();

        // Read existing app cards from localStorage (same source as AppState.cards)
        let appCards;
        try {
            appCards = JSON.parse(localStorage.getItem('cards')) || [];
        } catch (e) {
            appCards = [];
        }

        let created = 0;
        let existing = 0;

        for (const card of appCards) {
            const id = cardId(card);
            const existingRecord = await SrsDB.getCard(id);

            if (existingRecord) {
                existing++;
                continue;
            }

            // Determine deck from category
            const deck = card.cat || 'default';

            // Create new SRS record
            const srsRecord = {
                id,
                deck,
                due: 0,                 // due immediately (new card)
                stability: 0,
                difficulty: 0,
                reps: 0,
                lapses: 0,
                lastReviewed: 0,
                state: 'new',
                // Store reference data for display
                front: card.front || '',
                back: card.back || '',
                frontLang: card.frontLang || 'de',
                backLang: card.backLang || 'ar',
                noteDe: card.noteDe || '',
                noteAr: card.noteAr || '',
                ex: card.ex || ''
            };

            await SrsDB.putCard(srsRecord);
            created++;
        }

        console.log(`🧠 SRS Sync: ${appCards.length} Karten, ${created} neu, ${existing} vorhanden`);

        return { total: appCards.length, created, existing };
    }

    /**
     * Get the display data for an SRS card.
     * Returns the SRS record directly (it stores front/back/notes).
     */
    function getDisplayData(srsCard) {
        return {
            front: srsCard.front || '',
            back: srsCard.back || '',
            frontLang: srsCard.frontLang || 'de',
            backLang: srsCard.backLang || 'ar',
            noteDe: srsCard.noteDe || '',
            noteAr: srsCard.noteAr || '',
            ex: srsCard.ex || ''
        };
    }

    /**
     * Get deck (category) name from AppState.categories.
     */
    function getDeckName(deckId) {
        const cats = (typeof AppState !== 'undefined' && AppState.categories) || [];
        const cat = cats.find(c => c.id === deckId);
        return cat ? `${cat.icon || ''} ${cat.name || deckId}`.trim() : deckId;
    }

    /**
     * Get unique decks from SRS cards.
     */
    async function getDecks() {
        const allCards = await SrsDB.getAllCards();
        const deckSet = new Map();
        for (const card of allCards) {
            if (!deckSet.has(card.deck)) {
                deckSet.set(card.deck, { id: card.deck, name: getDeckName(card.deck), count: 0 });
            }
            deckSet.get(card.deck).count++;
        }
        return Array.from(deckSet.values());
    }

    return { syncCards, cardId, hashId, getDisplayData, getDeckName, getDecks };
})();
