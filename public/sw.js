// Service worker Del Tata — app shell disponible offline y notificaciones push.
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

// ── Notificaciones push ─────────────────────────────────────────────────────
// El servidor manda { titulo, cuerpo, url, tag } cifrado; el navegador ya lo
// entrega descifrado. Siempre se muestra algo: iOS corta los avisos de un
// sitio que recibe push y no muestra la notificación.
self.addEventListener("push", (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = { cuerpo: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(datos.titulo || "Del Tata", {
      body: datos.cuerpo || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      lang: "es-AR",
      // Misma etiqueta = reemplaza al aviso anterior (apertura → cierre de caja)
      tag: datos.tag || undefined,
      renotify: Boolean(datos.tag),
      data: { url: datos.url || "/auditoria" },
    })
  );
});

// Tocar el aviso abre la pantalla que corresponde, reusando la app si ya
// estaba abierta en vez de abrir otra ventana.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = new URL(
    (event.notification.data && event.notification.data.url) || "/auditoria",
    self.location.origin
  ).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((ventanas) => {
        const propia = ventanas.find((v) => new URL(v.url).origin === self.location.origin);
        if (!propia) return self.clients.openWindow(destino);
        return propia
          .focus()
          .then((v) => (v && "navigate" in v ? v.navigate(destino) : v))
          .catch(() => self.clients.openWindow(destino));
      })
  );
});
