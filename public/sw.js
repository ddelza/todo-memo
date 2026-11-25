// 오프라인에서도 화면이 뜨도록: 페이지 파일은 네트워크 우선, Firebase SDK는 캐시 우선
const C = 'todo-memo-v1';
const SHELL = ['./', 'index.html', 'app.js', 'style.css', 'icon-192.png', 'manifest.json'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(C).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/')) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => { const cp = res.clone(); caches.open(C).then((c) => c.put(e.request, cp)); return res; })));
    return;
  }
  if (u.origin !== location.origin || u.pathname.startsWith('/__/') || u.pathname.endsWith('.apk')) return;
  e.respondWith(fetch(e.request).then((res) => { if (res.ok) { const cp = res.clone(); caches.open(C).then((c) => c.put(e.request, cp)); } return res; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
