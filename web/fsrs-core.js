/**
 * fsrs-core.js — FSRS-5 Spaced Repetition Scheduling Engine
 * Pure scheduling logic, zero dependencies, configurable weights.
 *
 * Ratings: 0=Again, 1=Hard, 2=Good, 3=Easy
 * States:  "new" → "review"
 */
const FSRS = (() => {
    'use strict';

    // ── FSRS-5 Default Weights (19 params) ──────────────────────────
    const DEFAULT_WEIGHTS = [
        0.4072, 1.1829, 3.1262, 15.4722,   // w0–w3: initial stability per rating
        7.2102,                              // w4: initial difficulty mean
        0.5316,                              // w5: initial difficulty modifier
        1.0651,                              // w6: difficulty reversion to mean
        0.0046,                              // w7: stability after failure multiplier
        1.5071,                              // w8: stability after failure exponent (S)
        0.1170,                              // w9: stability after failure exponent (D)
        1.0507,                              // w10: stability growth exponent (success)
        1.9946,                              // w11: stability base (success)
        0.0957,                              // w12: stability difficulty mod (success)
        0.2975,                              // w13: stability rating bonus (hard)
        2.2042,                              // w14: stability rating bonus (good)
        0.2407,                              // w15: stability rating bonus (easy)
        2.9466,                              // w16: hard interval factor
        0.5034,                              // w17: easy bonus
        0.6567                               // w18: again new interval factor (unused in some impls)
    ];

    // Clamp utility
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    /**
     * Create an FSRS scheduler instance.
     * @param {Object} opts
     * @param {number[]} opts.weights  — 19-element weight array
     * @param {number}   opts.requestRetention — target retention (0–1), default 0.9
     * @param {number}   opts.maxIntervalDays  — cap on interval, default 3650
     */
    function create(opts = {}) {
        const w = opts.weights && opts.weights.length === 19
            ? opts.weights
            : DEFAULT_WEIGHTS;
        const R = opts.requestRetention || 0.9;
        const maxIvl = opts.maxIntervalDays || 3650;

        // ── Helper: interval from stability ──
        // FSRS formula: I = S · (R^(1 / DECAY) − 1) / FACTOR
        // where DECAY = -0.5, FACTOR = 19/81 ≈ 0.2346
        const DECAY = -0.5;
        const FACTOR = 19 / 81;

        function intervalFromStability(S) {
            if (S <= 0) return 1;
            const ivl = (S / FACTOR) * (Math.pow(R, 1 / DECAY) - 1);
            return clamp(Math.round(ivl), 1, maxIvl);
        }

        // ── Initial Difficulty (for brand-new cards) ──
        function initDifficulty(rating) {
            // D0(G) = w4 − e^(w5 * (G − 1)) + 1
            const D0 = w[4] - Math.exp(w[5] * (rating - 1)) + 1;
            return clamp(D0, 1, 10);
        }

        // ── Initial Stability (for brand-new cards) ──
        function initStability(rating) {
            // S0(G) = w[G]  (w0..w3 map to ratings 0..3)
            return Math.max(w[rating] || 0.4, 0.01);
        }

        // ── Update Difficulty after review ──
        function nextDifficulty(D, rating) {
            // D' = w6 · D0(3) + (1 − w6) · (D − w7 · (rating − 3))
            const D0_easy = w[4] - Math.exp(w[5] * (3 - 1)) + 1;
            const Dp = w[6] * D0_easy + (1 - w[6]) * (D - w[7] * (rating - 3));
            return clamp(Dp, 1, 10);
        }

        // ── Retrievability (probability of recall) ──
        function retrievability(elapsedDays, S) {
            if (S <= 0 || elapsedDays <= 0) return 1;
            return Math.pow(1 + FACTOR * elapsedDays / S, DECAY);
        }

        // ── Next Stability after a SUCCESSFUL review (rating ≥ 1) ──
        function nextStabilitySuccess(D, S, r, rating) {
            // S'_r = S · (e^(w8) · (11 − D) · S^(−w9) · (e^(w10 · (1 − r)) − 1) · hardPenalty · easyBonus + 1)
            const hardPenalty = (rating === 1) ? w[15] : 1;
            const easyBonus = (rating === 3) ? w[16] : 1;
            const inner = Math.exp(w[8])
                * (11 - D)
                * Math.pow(S, -w[9])
                * (Math.exp(w[10] * (1 - r)) - 1)
                * hardPenalty
                * easyBonus;
            return Math.max(S * (inner + 1), 0.01);
        }

        // ── Next Stability after a FAILURE (rating === 0, "Again") ──
        function nextStabilityFail(D, S, r) {
            // S'_f = w11 · D^(−w12) · ((S + 1)^w13 − 1) · e^(w14 · (1 − r))
            const Sf = w[11]
                * Math.pow(D, -w[12])
                * (Math.pow(S + 1, w[13]) - 1)
                * Math.exp(w[14] * (1 - r));
            return clamp(Sf, 0.01, S); // never higher than current S on failure
        }

        /**
         * Schedule a card after a review.
         *
         * @param {Object} card – current SRS record { state, stability, difficulty, reps, lapses }
         * @param {number} rating – 0=Again, 1=Hard, 2=Good, 3=Easy
         * @param {number} elapsedDays – days since lastReviewed (0 for new cards)
         * @returns {Object} { stability, difficulty, due, interval, reps, lapses, state }
         */
        function schedule(card, rating, elapsedDays) {
            const now = Date.now();
            let S, D, interval, reps, lapses, state;

            if (card.state === 'new') {
                // ── First review ever ──
                S = initStability(rating);
                D = initDifficulty(rating);
                reps = 1;
                lapses = rating === 0 ? 1 : 0;
                state = 'review';
            } else {
                // ── Subsequent review ──
                const r = retrievability(elapsedDays, card.stability);
                D = nextDifficulty(card.difficulty, rating);
                reps = (card.reps || 0) + 1;
                lapses = card.lapses || 0;

                if (rating === 0) {
                    // Again → lapse
                    S = nextStabilityFail(D, card.stability, r);
                    lapses++;
                } else {
                    // Hard / Good / Easy → success
                    S = nextStabilitySuccess(D, card.stability, r, rating);
                }
                state = 'review';
            }

            // Compute interval from stability
            if (rating === 0) {
                // Again → short interval (review in ~10 minutes, stored as fractional day)
                interval = 1; // 1 day minimum for simplicity
            } else {
                interval = intervalFromStability(S);
            }

            const due = now + interval * 24 * 60 * 60 * 1000;

            return { stability: S, difficulty: D, due, interval, reps, lapses, state };
        }

        return { schedule, intervalFromStability, retrievability, weights: w, requestRetention: R, maxIntervalDays: maxIvl };
    }

    return { create, DEFAULT_WEIGHTS };
})();
