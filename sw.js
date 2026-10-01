/* Service worker mínimo: rede primeiro, cache como reserva (a app abre offline). */
const CACHE = 'pagacerto-v19';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/parser.js', 'js/models.js', 'js/db.js', 'js/repo.js', 'js/crypto.js', 'js/sync.js', 'js/notify.js', 'js/pdftext.js', 'js/ads.js', 'js/app.js', 'privacidade.html', 'termos.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
