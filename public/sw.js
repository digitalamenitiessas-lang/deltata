// Service worker Del Tata — app shell disponible offline.
// Estrategia: navegación network-first con fallback a caché (la app es local-
// first: los datos viven en IndexedDB, acá sólo se cachea el shell y estáticos).

const CACHE = "del-tata-v1";
const SHELL = ["/vender", "/caja", "/stock", "/manifest.json", "/icon-192.png", "/logo.jpg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // La API nunca se cachea: es sincronización en vivo
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // Navegación: red primero; sin red, la última versión cacheada de la página
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() =>
          caches
            .match(request)
            .then((hit) => hit ?? caches.match("/vender"))
            .then((hit) => hit ?? Response.error())
        )
    );
    return;
  }

  // Estáticos (_next, íconos): caché primero, red de respaldo
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
    )
  );
});
