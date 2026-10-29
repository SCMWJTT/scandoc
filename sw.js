// ScanDoc service worker: network-first, plus the Android share target.
const CACHE = 'scandoc-v1';          // bump when files are added
const SHARE = 'scandoc-share';       // holds images shared in from other apps
const FILES = ['./', 'index.html', 'config.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== SHARE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function handleShare(req) {
  const back = n => Response.redirect(new URL('./?shared=' + n, self.registration.scope).href, 303);
  try {
    const fd = await req.formData();
    const files = fd.getAll('images').filter(f => f && typeof f !== 'string');
    const c = await caches.open(SHARE);
    for (const k of await c.keys()) await c.delete(k);
    let i = 0;
    for (const f of files) {
      const key = new URL('./shared/' + (i++) + '/' + encodeURIComponent(f.name || 'image.jpg'), self.registration.scope).href;
      await c.put(key, new Response(f, { headers: { 'Content-Type': f.type || 'image/jpeg' } }));
    }
    return back(files.length);
  } catch (err) {
    return back(0);
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShare(req));
    return;
  }
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const key = url.origin + url.pathname;
  e.respondWith(
    fetch(req, { cache: 'no-store' })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
        return res;
      })
      .catch(() => caches.match(key).then(r => r || caches.match('index.html')))
  );
});
