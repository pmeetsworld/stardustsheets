const APP_BUILD = '20260628c';
const SHELL_CACHE = 'aegis-shell-' + APP_BUILD;

const SHELL_FILES = [
  'campaign.html?app=' + APP_BUILD,
  'sheet.html?app=' + APP_BUILD,
  'dm.html?app=' + APP_BUILD,
  'encounter.html?app=' + APP_BUILD,
  'styles.css?v=' + APP_BUILD,
  'cloud-config.js?v=' + APP_BUILD,
  'cloud-save.js?v=' + APP_BUILD,
  'dm.js?v=' + APP_BUILD,
  'encounter.js?v=' + APP_BUILD,
  'field-map.js?v=' + APP_BUILD,
  'image-slot.js?v=' + APP_BUILD,
  'sheet.js?v=' + APP_BUILD,
  'view-mode.js?v=' + APP_BUILD,
  'manifest.webmanifest',
  'assets/aegis-app-icon.svg',
  'assets/aegis-app-icon-192.png',
  'assets/aegis-app-icon-512.png',
  'assets/aegis-apple-touch-icon.png',
  'assets/aegis-panel-texture.png',
  'assets/fonts.css',
  'assets/fonts/space-grotesk-400.woff2',
  'assets/fonts/space-grotesk-500.woff2',
  'assets/fonts/space-grotesk-600.woff2',
  'assets/fonts/space-grotesk-700.woff2',
  'assets/fonts/space-mono-400.woff2',
  'assets/fonts/space-mono-700.woff2'
];

function scopedUrl(path) {
  return new URL(path, self.registration.scope).href;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES.map(scopedUrl)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('aegis-shell-') && key !== SHELL_CACHE)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

function scopePath() {
  const path = new URL(self.registration.scope).pathname;
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

function pageType(url) {
  const scope = scopePath();
  const path = url.pathname;
  if (path === scope || path === scope + '/' || path.endsWith('/index.html') || path.endsWith('/campaign.html')) {
    return 'campaign.html';
  }
  if (path.endsWith('/sheet.html') || path.endsWith('/Character%20Sheet.html') || path.endsWith('/Character Sheet.html')) {
    return 'sheet.html';
  }
  if (path.endsWith('/dm.html')) return 'dm.html';
  if (path.endsWith('/encounter.html')) return 'encounter.html';
  return '';
}

function currentUrlFor(url) {
  const type = pageType(url);
  if (!type) return null;

  const next = new URL(url);
  if (type === 'campaign.html') next.pathname = scopePath() + '/campaign.html';
  if (next.searchParams.get('app') !== APP_BUILD) next.searchParams.set('app', APP_BUILD);
  return next;
}

async function navigationResponse(request, url) {
  try {
    return await fetch(new Request(request, { cache: 'no-store' }));
  } catch (error) {
    const type = pageType(url) || 'campaign.html';
    const cached = await caches.match(scopedUrl(type + '?app=' + APP_BUILD));
    if (cached) return cached;
    throw error;
  }
}

async function staticResponse(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin || request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    const current = currentUrlFor(url);
    if (current && current.href !== url.href) {
      event.respondWith(Response.redirect(current.href, 302));
      return;
    }
    event.respondWith(navigationResponse(request, url));
    return;
  }

  event.respondWith(staticResponse(request));
});
