// Tricolore — service worker des alertes de match (portée /tricolore/). Seulement push et notificationclick :
// aucun gestionnaire « fetch », donc aucune mise en cache; les pages lisent toujours les données fraîches.
// Le message (chiffré par le Worker) contient seulement ce que l'API LNH a rendu : { title, body, tag, game }.
"use strict";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = {}; }
  // Sur iPhone, chaque push doit afficher une notification (sinon Safari finit par retirer l'abonnement).
  const title = typeof d.title === "string" && d.title ? d.title : "Tricolore";
  const options = {
    body: typeof d.body === "string" ? d.body : "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    lang: "fr-CA",
    data: { game: /^\d{10}$/.test(String(d.game ?? "")) ? String(d.game) : null },
  };
  if (typeof d.tag === "string" && d.tag) options.tag = d.tag; // même alerte reçue deux fois : remplacée, pas doublée
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const game = event.notification.data?.game;
  const url = new URL(game ? `match.html?id=${game}` : "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url === url && "focus" in w) return w.focus();
    }
    return self.clients.openWindow(url);
  })());
});
