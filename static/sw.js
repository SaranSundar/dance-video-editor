const CACHE = 'clipit-v3';
const SHELL = ['/'];

self.addEventListener('install', (e) => {
	e.waitUntil(
		caches.open(CACHE).then((cache) => cache.addAll(SHELL))
	);
	self.skipWaiting();
});

self.addEventListener('activate', (e) => {
	e.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
		)
	);
	self.clients.claim();
});

self.addEventListener('fetch', (e) => {
	const url = new URL(e.request.url);

	if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
	if (url.protocol === 'blob:' || url.protocol === 'data:') return;

	// Navigation: network-first, fall back to cached shell
	if (e.request.mode === 'navigate') {
		e.respondWith(
			fetch(e.request)
				.then((res) => {
					const clone = res.clone();
					caches.open(CACHE).then((cache) => cache.put(e.request, clone));
					return res;
				})
				.catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
		);
		return;
	}

	// Static assets (_app/ JS/CSS): cache-first, cache on first fetch
	if (url.pathname.startsWith('/_app/')) {
		e.respondWith(
			caches.match(e.request).then((cached) => {
				if (cached) return cached;
				return fetch(e.request).then((res) => {
					const clone = res.clone();
					caches.open(CACHE).then((cache) => cache.put(e.request, clone));
					return res;
				});
			})
		);
		return;
	}

	// Everything else: network-first, fall back to cache
	e.respondWith(
		fetch(e.request)
			.then((res) => {
				const clone = res.clone();
				caches.open(CACHE).then((cache) => cache.put(e.request, clone));
				return res;
			})
			.catch(() => caches.match(e.request))
	);
});
