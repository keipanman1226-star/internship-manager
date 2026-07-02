// ================================================
// サービスワーカー
// アプリの見た目(HTML/CSS/JS/アイコン)をあらかじめ端末に保存しておき、
// 電波が悪い場所や機内モードでもアプリを開けるようにする。
// ※ 応募データ自体はこれまで通りlocalStorageに保存され、ここでは扱わない。
// ================================================

// キャッシュの名前。ファイルの中身を更新したときはこの名前を変えると、
// 古いキャッシュを破棄して新しいファイルに差し替えられる。
const CACHE_NAME = "internship-manager-v2";

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

// リクエストが来たとき: まずネットワークから最新のファイルを取りに行き、
// 取得できたらキャッシュを最新版に更新する(電波があれば常に最新のアプリが表示される)。
// 電波が悪い・オフラインでネットワークが使えないときだけ、保存しておいたキャッシュを使う。
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
