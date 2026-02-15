const CACHE_NAME = 'dr-shoaibs-app-v4';

const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './preprocessing.js',
  './ocr.js',
  './pdf-handler.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-180.png',
  './assets/icon-128.png',
  './assets/icon-32.png',
  './assets/icon-16.png',
  'https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&display=swap'
];

// CDN-Ressourcen die gecached werden sollen (langlebig)
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js'
];

// Installation — Cache alle Core-Assets
self.addEventListener('install', event => {
  console.log('Service Worker: Installing v4...');
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

// Activation — Alte Caches löschen
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating v3...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('Service Worker: Deleting cache', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch — Strategie: Network-First für HTML/JS, Cache-First für CDN/Fonts
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // App-eigene Dateien: Network-First (damit Updates ankommen!)
  if (url.origin === location.origin) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Erfolgreiche Netzwerk-Antwort → Cache aktualisieren
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

  // CDN/Fonts: Cache-First (ändert sich selten)
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
