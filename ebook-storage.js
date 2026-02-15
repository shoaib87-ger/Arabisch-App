/**
 * ebook-storage.js — IndexedDB storage for uploaded ebooks
 * Database: ebook-library, Object store: books
 */
const EbookDB = {
    DB_NAME: 'ebook-library',
    DB_VERSION: 1,
    STORE: 'books',
    _db: null,

    /** Open / create the database */
    async init() {
        if (this._db) return this._db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.STORE)) {
                    const store = db.createObjectStore(this.STORE, { keyPath: 'id' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
            };
            req.onsuccess = (e) => {
                this._db = e.target.result;
                resolve(this._db);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    },

    /** Save a book { id, name, format, blob, lastLocation, addedAt } */
    async save(bookObj) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE, 'readwrite');
            tx.objectStore(this.STORE).put(bookObj);
            tx.oncomplete = () => resolve(bookObj.id);
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    /** Get all books sorted by addedAt (newest first) */
    async list() {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE, 'readonly');
            const req = tx.objectStore(this.STORE).index('addedAt').getAll();
            req.onsuccess = () => resolve((req.result || []).reverse());
            req.onerror = (e) => reject(e.target.error);
        });
    },

    /** Get a single book by id */
    async get(id) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE, 'readonly');
            const req = tx.objectStore(this.STORE).get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = (e) => reject(e.target.error);
        });
    },

    /** Delete a book by id */
    async delete(id) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE, 'readwrite');
            tx.objectStore(this.STORE).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    /** Update lastLocation for a book */
    async updateLocation(id, location) {
        const book = await this.get(id);
        if (!book) return;
        book.lastLocation = location;
        return this.save(book);
    }
};
