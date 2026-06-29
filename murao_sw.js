// v2: キャッシュ優先 → ネットワーク優先に変更
// （旧v1は一度キャッシュしたら更新が一切反映されない不具合があったため修正）
const CACHE = 'murao-salary-v2';
const ASSETS = [
  '/kuraji/murao_salary.html',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&family=DM+Mono:wght@400;500&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ネットワーク優先：オンライン時は常に最新版を取得してキャッシュを更新。
// オフライン時のみキャッシュにフォールバック（圏外・通信不可対策）。
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).then(res => {
      const resClone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, resClone)).catch(()=>{});
      return res;
    }).catch(() => caches.match(e.request))
  );
});
