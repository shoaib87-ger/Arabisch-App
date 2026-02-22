/**
 * epub-reader.js — JS wrapper for the EpubReader Capacitor plugin.
 * Opens EPUB files in a native iOS reader with chapter navigation.
 *
 * Usage:
 *   await EpubReaderBridge.pickAndOpen();  // file picker → reader
 *   await EpubReaderBridge.openEpub('/path/to/book.epub');
 */
const EpubReaderBridge = (() => {
    'use strict';

    /**
     * Check if native EPUB reader plugin is available
     */
    function isAvailable() {
        return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.EpubReader);
    }

    /**
     * Show native file picker for .epub files, then open in reader.
     * @returns {Promise<{closed: boolean, lastChapter: number}>}
     */
    async function pickAndOpen() {
        if (!isAvailable()) {
            throw new Error('EpubReader plugin not available (requires iOS native app)');
        }
        return await window.Capacitor.Plugins.EpubReader.pickAndOpen();
    }

    /**
     * Open an EPUB from a known file path.
     * @param {string} path - Absolute path to the .epub file
     * @returns {Promise<{closed: boolean, lastChapter: number}>}
     */
    async function openEpub(path) {
        if (!isAvailable()) {
            throw new Error('EpubReader plugin not available');
        }
        return await window.Capacitor.Plugins.EpubReader.openEpub({ path });
    }

    return { isAvailable, pickAndOpen, openEpub };
})();
