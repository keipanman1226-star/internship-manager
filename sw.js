// ================================================
// サービスワーカー
// アプリの見た目(HTML/CSS/JS/アイコン)をあらかじめ端末に保存しておき、
// 電波が悪い場所や機内モードでもアプリを開けるようにする。
// ※ 応募データ自体はこれまで通りlocalStorageに保存され、ここでは扱わない。
// ================================================

// キャッシュの名前。ファイルの中身を更新したときはこの名前を変えると、
// 古いキャッシュを破棄して新しいファイルに差し替えられる。
const CACHE_NAME = "internship-manager-v1";

// オフラインでも開けるようにしておきたいファイル一覧(アプリの外枠)
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// インストール時: アプリの外枠をまとめてキャッシュしておく
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// 有効化時: 古いバージョンのキャッシュが残っていれば削除する
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// リクエストが来たとき: まずキャッシュを探し、なければネットワークから取得する
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
