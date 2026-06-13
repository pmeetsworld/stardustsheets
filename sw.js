const APP_BUILD = '20260613j';
const SHELL_CACHE = 'aegis-shell-' + APP_BUILD;

self.addEventListener('install', (event) => {
  self.skipWaiting();
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

function currentUrlFor(url) {
  const scope = scopePath();
  const next = new URL(url);
  const path = next.pathname;
  const isRoot = path === scope || path === scope + '/';
  const isCampaign = isRoot || path.endsWith('/index.html') || path.endsWith('/campaign.html');
  const isSheet = path.endsWith('/sheet.html') || path.endsWith('/Character%20Sheet.html') || path.endsWith('/Character Sheet.html');
  const isDm = path.endsWith('/dm.html');

  if (!isCampaign && !isSheet && !isDm) return null;
  if (isCampaign) next.pathname = scope + '/campaign.html';
  if (next.searchParams.get('app') !== APP_BUILD) next.searchParams.set('app', APP_BUILD);
  return next;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin || request.mode !== 'navigate') return;

  const current = currentUrlFor(url);
  if (current && current.href !== url.href) {
    event.respondWith(Response.redirect(current.href, 302));
    return;
  }

  event.respondWith(fetch(new Request(request, { cache: 'no-store' })).catch(() => fetch(request)));
});
