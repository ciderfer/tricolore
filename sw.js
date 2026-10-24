// Tricolore — service worker (portée /tricolore/) : alertes de match (push, notificationclick) et site hors ligne.
// Le message push (chiffré par le Worker) contient seulement ce que l'API LNH a rendu : { title, body, tag, game }.
//
// Hors ligne (dans les estrades, au Centre Bell) : l'enveloppe du site (pages, CSS, JS, polices, icônes) et les
// fichiers data/*.json sont gardés en mémoire à l'installation, puis à chaque lecture réussie.
// - Pages et data/*.json : réseau d'abord. Sans réseau (ou s'il ne répond pas en 4 s), la copie en mémoire, et la
//   page est prévenue (message « tricolore-hors-ligne ») : horsligne.js affiche alors « Hors ligne : données du … ».
// - JS et CSS versionnés (?v=, ajouté par pages.yml) : la copie de cette version exacte si on l'a, sinon le réseau;
//   une seule version gardée par fichier. Sans version (essais locaux) : réseau d'abord.
// - Jamais touchés : tout ce qui sort du site (relais Cloudflare, API LNH) et le WebSocket du pointage en direct.
//   Un pointage en direct n'est donc jamais resservi de la mémoire comme s'il était actuel.
// CACHE : changer le numéro quand la stratégie change; l'activation efface les anciennes versions.
"use strict";

const CACHE = "tricolore-v1";
const TIMEOUT_MS = 4_000;
const SHELL = [
  "./", "calendrier.html", "alignement.html", "match.html", "joueur.html", "alertes.html",
  "commun.js", "navigation.js", "horsligne.js", "app.js", "calendrier.js", "alignement.js", "blesses.js", "match.js", "joueur.js", "alertes.js",
  "styles.css", "blesses.css", "alertes.css",
  "fonts/archivo-latin.woff2", "fonts/graduate-latin.woff2",
  "manifest.webmanifest", "icons/favicon.svg", "icons/favicon-32.png", "icons/favicon.ico", "icons/apple-touch-icon.png", "icons/icon-192.png",
];
const DATA = ["meta", "schedule", "scoreboard", "standings", "roster", "stats", "news", "injuries"].map((n) => `data/${n}.json`);

const scopeUrl = () => new URL(self.registration.scope);
const bare = (u) => { const x = new URL(u); x.search = ""; x.hash = ""; return x.href; };

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Un fichier manquant ne doit pas empêcher l'installation (les alertes passent par ce service worker).
    await Promise.allSettled([...SHELL, ...DATA].map((p) => cache.add(new Request(new URL(p, scopeUrl()).href, { cache: "no-cache" }))));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("tricolore-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url), scope = scopeUrl();
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return; // relais, LNH : jamais
  const rel = url.pathname.slice(scope.pathname.length);
  if (rel === "sw.js") return;
  if (req.mode === "navigate" || rel === "" || rel.endsWith(".html")) {
    event.respondWith(networkFirst(event, rel === "index.html" ? scope.href : bare(url), true));
  } else if (rel.startsWith("data/") && rel.endsWith(".json")) {
    event.respondWith(networkFirst(event, bare(url), true));
  } else if (/\.(js|css|webmanifest)$/.test(rel) || /^(fonts|icons)\//.test(rel)) {
    event.respondWith(url.searchParams.has("v") ? versioned(event) : networkFirst(event, bare(url), false));
  }
});

// Réseau d'abord; la copie en mémoire si le réseau échoue ou tarde. tell : prévenir la page (données en mémoire).
async function networkFirst(event, key, tell) {
  const cache = await caches.open(CACHE);
  const net = fetch(event.request).then(async (r) => { if (r.ok) await cache.put(key, r.clone()); return r; });
  event.waitUntil(net.catch(() => {})); // une réponse tardive met quand même la copie à jour
  let timer;
  const late = new Promise((res) => { timer = setTimeout(res, TIMEOUT_MS, null); });
  try {
    const r = await Promise.race([net, late]);
    if (r) return r;
  } catch { /* hors ligne */ } finally { clearTimeout(timer); }
  const hit = await cache.match(key);
  if (!hit) return net; // rien en mémoire : on attend le réseau (ou son erreur)
  if (tell) notify(event, key, hit);
  return hit;
}

// JS et CSS ?v= : cette version exacte en mémoire, sinon le réseau (et elle remplace l'ancienne); hors ligne,
// n'importe quelle version gardée de ce fichier plutôt qu'une page sans style ni script.
async function versioned(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  try {
    const r = await fetch(event.request);
    if (r.ok) {
      const copy = r.clone();
      event.waitUntil((async () => { await cache.delete(event.request, { ignoreSearch: true }); await cache.put(event.request, copy); })());
    }
    return r;
  } catch (e) {
    const old = await cache.match(event.request, { ignoreSearch: true });
    if (old) return old;
    throw e;
  }
}

// Prévient la page (ou la page en train de s'ouvrir) qu'elle montre une copie en mémoire, avec l'heure de cette copie.
function notify(event, key, res) {
  const id = event.clientId || event.resultingClientId;
  if (!id) return;
  const msg = { type: "tricolore-hors-ligne", url: key, date: res.headers.get("date") };
  event.waitUntil((async () => {
    for (let i = 0; i < 20; i++) { // une page qui s'ouvre n'existe pas encore comme client : on attend un peu
      const c = await self.clients.get(id);
      if (c) { c.postMessage(msg); return; }
      await new Promise((r) => setTimeout(r, 250));
    }
  })());
}

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
