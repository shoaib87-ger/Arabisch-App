const CACHE_NAME = 'dr-shoaibs-app-v6';

const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './preprocessing.js',
  './ocr.js',
  './pdf-handler.js',
  './manifest.json',
  './quran-reader.js',
  './data/quran_toc.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-180.png',
  './assets/icon-128.png',
  './assets/icon-32.png',
  './assets/icon-16.png',
  // Ebook Reader modules
  './ebook-storage.js',
  './ebook-detect.js',
  './ebook-readers.js',
  './ebook-ui.js',
  // Local libs (pinned versions)
  './lib/jszip.min.js',
  './lib/epub.min.js',
  './lib/purify.min.js',
  'https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&display=swap'
];

// PDF wird NICHT precached (50 MB zu groß) — wird per network-first zur Laufzeit gecached
const PDF_URL = './assets/quran_ar_de_v2.pdf';

// CDN-Ressourcen die gecached werden sollen (langlebig)
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js'
];

// Installation — Cache alle Core-Assets
self.addEventListener('install', event => {
  console.log('Service Worker: Installing v5...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching core assets');
        // CDN-Assets separat cachen (können fehlschlagen)
        CDN_ASSETS.forEach(url => {
          cache.add(url).catch(err => console.warn('CDN cache failed:', url, err));
        });
        return cache.addAll(CORE_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activation — Alte Caches KOMPLETT löschen
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating v5...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('Service Worker: Deleting old cache', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch — Strategie:
//   PDF: Network-First (garantiert neue Version nach Deploy)
//   App-Dateien: Network-First mit Cache-Fallback
//   CDN/Fonts: Cache-First
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // === PDF: Network-First (immer neueste Version holen) ===
  if (url.origin === location.origin && url.pathname.endsWith('.pdf')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline → Cache nutzen
          return caches.match(event.request);
        })
    );
    return;
  }

  // === App-eigene Dateien: Network-First ===
  if (url.origin === location.origin) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }

  // === CDN/Fonts: Cache-First ===
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) return response;
        return fetch(event.request).then(fetchResponse => {
          if (fetchResponse.ok) {
            const clone = fetchResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return fetchResponse;
        });
      })
  );
});
