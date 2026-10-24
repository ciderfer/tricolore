// Tests du service worker hors ligne (sw.js), chargé dans un bac à sable avec de faux caches, réseau et clients.
// Lancer : node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const SRC = readFileSync(new URL("sw.js", ROOT), "utf8");
const SCOPE = "https://ciderfer.github.io/tricolore/";

// Cache API en mémoire (clé : URL complète).
function cacheStorage() {
  const stores = new Map();
  const key = (r) => (typeof r === "string" ? r : r.url);
  const strip = (u) => u.split("?")[0];
  const open = (name) => {
    if (!stores.has(name)) {
      const m = new Map();
      stores.set(name, {
        m,
        async match(r, o = {}) { const k = key(r); if (m.has(k)) return m.get(k).clone(); if (o.ignoreSearch) for (const [kk, v] of m) if (strip(kk) === strip(k)) return v.clone(); },
        async put(r, res) { m.set(key(r), res.clone()); },
        async add(r) { const res = await globalThis.__net(r); if (!res.ok) throw new Error("HTTP " + res.status); m.set(key(r), res); },
        async delete(r, o = {}) { let n = 0; for (const kk of [...m.keys()]) if (kk === key(r) || (o.ignoreSearch && strip(kk) === strip(key(r)))) { m.delete(kk); n++; } return n > 0; },
      });
    }
    return stores.get(name);
  };
  return { stores, open: async (n) => open(n), keys: async () => [...stores.keys()], delete: async (n) => stores.delete(n),
    match: async (r, o) => { for (const s of stores.values()) { const h = await s.match(r, o); if (h) return h; } } };
}

function load() {
  const handlers = {}, posted = [], clientsById = { page: { postMessage: (m) => posted.push(m) } };
  const net = { online: true, calls: [], body: (u) => `contenu de ${u}`, delay: 0 };
  globalThis.__net = async (r) => {
    const u = typeof r === "string" ? r : r.url;
    net.calls.push(u);
    if (net.delay) await new Promise((res) => setTimeout(res, net.delay));
    if (!net.online) throw new TypeError("Failed to fetch");
    return new Response(net.body(u), { status: 200, headers: { date: "Sat, 24 Oct 2026 21:00:00 GMT" } });
  };
  const caches = cacheStorage();
  const self = {
    addEventListener: (t, f) => { handlers[t] = f; },
    registration: { scope: SCOPE, showNotification: async () => {} },
    clients: { claim: async () => {}, get: async (id) => clientsById[id], matchAll: async () => [] },
    skipWaiting: async () => {},
  };
  const ctx = vm.createContext({ self, caches, fetch: (r) => globalThis.__net(r), Request, Response, URL, setTimeout, clearTimeout, Promise, console });
  const exp = vm.runInContext(`${SRC}\n;({ CACHE, SHELL, DATA, TIMEOUT_MS })`, ctx);
  // Lance un événement « fetch » comme le navigateur; rend la réponse (ou undefined si le SW laisse passer).
  async function get(url, { mode = "cors", clientId = "page" } = {}) {
    let p, waits = [];
    handlers.fetch({ request: new Request(url, mode === "navigate" ? {} : { mode }),
      clientId, resultingClientId: "", respondWith: (x) => { p = x; }, waitUntil: (x) => waits.push(x) });
    if (!p) return undefined;
    const r = await p; await Promise.all(waits); return r;
  }
  async function lifecycle(t) { const waits = []; handlers[t]({ waitUntil: (x) => waits.push(x) }); await Promise.all(waits); }
  return { handlers, posted, net, caches, exp, get, lifecycle };
}

test("installation : enveloppe du site et data/*.json en mémoire; un fichier manquant ne bloque rien", async () => {
  const sw = load();
  const base = sw.net.body;
  sw.net.body = (u) => base(u);
  const realNet = globalThis.__net;
  globalThis.__net = async (r) => (r.url.endsWith("news.json") ? new Response("", { status: 404 }) : realNet(r));
  await sw.lifecycle("install");
  const m = (await sw.caches.open(sw.exp.CACHE)).m;
  for (const p of ["", "calendrier.html", "alignement.html", "styles.css", "app.js", "data/meta.json", "data/schedule.json", "fonts/archivo-latin.woff2"])
    assert.ok(m.has(SCOPE + p), `${p} en mémoire`);
  assert.ok(!m.has(SCOPE + "data/news.json")); // 404 : sauté, l'installation réussit quand même
});

test("la liste d'installation suit le dépôt : chaque page, script, feuille de style et donnée lue par le site", () => {
  const { SHELL, DATA } = load().exp;
  const all = [...SHELL, ...DATA];
  for (const p of all) if (p !== "./") assert.ok(existsSync(new URL(p, ROOT)), `${p} existe`);
  const top = readdirSync(ROOT).filter((f) => /\.(html|js|css)$/.test(f) && f !== "sw.js");
  for (const f of top) assert.ok(f === "index.html" ? all.includes("./") : all.includes(f), `${f} dans la liste de sw.js`);
  for (const f of readdirSync(new URL("data/", ROOT)).filter((f) => f.endsWith(".json"))) assert.ok(DATA.includes(`data/${f}`), `data/${f} dans DATA`);
});

test("activation : les anciennes versions du cache sont effacées, les autres caches gardés", async () => {
  const sw = load();
  await sw.caches.open("tricolore-v0"); await sw.caches.open("autre-chose"); await sw.caches.open(sw.exp.CACHE);
  await sw.lifecycle("activate");
  assert.deepEqual((await sw.caches.keys()).sort(), ["autre-chose", sw.exp.CACHE].sort());
});

test("données : réseau d'abord (copie mise à jour), puis la copie hors ligne, et la page est prévenue", async () => {
  const sw = load();
  sw.net.body = () => JSON.stringify({ updatedAt: "2026-10-24T21:00:00Z" });
  let r = await sw.get(SCOPE + "data/meta.json");
  assert.equal((await r.json()).updatedAt, "2026-10-24T21:00:00Z");
  assert.deepEqual(sw.posted, []); // réseau : rien à signaler
  sw.net.online = false;
  r = await sw.get(SCOPE + "data/meta.json?x=1");
  assert.equal((await r.json()).updatedAt, "2026-10-24T21:00:00Z");
  assert.equal(sw.posted.length, 1);
  assert.equal(sw.posted[0].type, "tricolore-hors-ligne");
  assert.equal(sw.posted[0].date, "Sat, 24 Oct 2026 21:00:00 GMT");
});

test("hors ligne sans copie : l'erreur réseau passe (la page affiche son message d'erreur habituel)", async () => {
  const sw = load();
  sw.net.online = false;
  await assert.rejects(sw.get(SCOPE + "data/joueurs/8480018.json"));
  assert.deepEqual(sw.posted, []);
});

test("réseau trop lent (plus de 4 s) : la copie tout de suite, puis la réponse tardive met la copie à jour", async () => {
  const sw = load();
  await sw.get(SCOPE + "data/schedule.json");
  sw.net.delay = sw.exp.TIMEOUT_MS + 300;
  sw.net.body = () => "nouveau";
  const t0 = Date.now();
  const r = await sw.get(SCOPE + "data/schedule.json");
  assert.ok(Date.now() - t0 >= sw.exp.TIMEOUT_MS);
  assert.equal(sw.posted.length, 1);
  const c = await sw.caches.open(sw.exp.CACHE);
  assert.equal(await (await c.match(SCOPE + "data/schedule.json")).text(), "nouveau"); // waitUntil a attendu la réponse
  assert.match(await r.text(), /contenu de/);
});

test("pages : réseau d'abord; hors ligne, la copie (match.html?id=… sert match.html, index.html sert ./)", async () => {
  const sw = load();
  await sw.lifecycle("install");
  sw.net.online = false;
  const r1 = await sw.get(SCOPE + "match.html?id=2026020182", { mode: "navigate" });
  assert.match(await r1.text(), /match\.html/);
  const r2 = await sw.get(SCOPE + "index.html", { mode: "navigate" });
  assert.equal(await r2.text(), `contenu de ${SCOPE}`);
});

test("JS et CSS ?v= : version exacte en mémoire sans réseau; une seule version gardée; hors ligne, l'ancienne plutôt que rien", async () => {
  const sw = load();
  await sw.lifecycle("install"); // styles.css sans version
  sw.net.calls.length = 0;
  await sw.get(SCOPE + "styles.css?v=aaaa1111");
  await sw.get(SCOPE + "styles.css?v=aaaa1111");
  assert.deepEqual(sw.net.calls, [SCOPE + "styles.css?v=aaaa1111"]); // une seule lecture réseau
  const m = (await sw.caches.open(sw.exp.CACHE)).m;
  assert.deepEqual([...m.keys()].filter((k) => k.includes("styles.css")), [SCOPE + "styles.css?v=aaaa1111"]);
  sw.net.online = false;
  const r = await sw.get(SCOPE + "styles.css?v=bbbb2222");
  assert.equal(await r.text(), `contenu de ${SCOPE}styles.css?v=aaaa1111`);
});

test("jamais touchés : relais Cloudflare, API LNH, autre site, POST, sw.js lui-même", async () => {
  const sw = load();
  assert.equal(await sw.get("https://tricolore.tricolore.workers.dev/v1/gamecenter/2026020182/landing"), undefined);
  assert.equal(await sw.get("https://api-web.nhle.com/v1/schedule/now"), undefined);
  assert.equal(await sw.get("https://ciderfer.github.io/autre/index.html", { mode: "navigate" }), undefined);
  assert.equal(await sw.get(SCOPE + "sw.js"), undefined);
  let called = false;
  sw.handlers.fetch({ request: new Request(SCOPE + "data/meta.json", { method: "POST", body: "x" }), respondWith: () => { called = true; } });
  assert.equal(called, false);
  assert.deepEqual(sw.net.calls, []);
});

test("alertes de match intactes : push et notificationclick toujours là", () => {
  const sw = load();
  assert.equal(typeof sw.handlers.push, "function");
  assert.equal(typeof sw.handlers.notificationclick, "function");
});

test("chaque page charge horsligne.js après commun.js (bandeau et enregistrement du service worker)", () => {
  for (const f of readdirSync(ROOT).filter((f) => f.endsWith(".html"))) {
    const h = readFileSync(new URL(f, ROOT), "utf8");
    assert.ok(h.indexOf('src="horsligne.js"') > h.indexOf('src="commun.js"') && h.includes('src="horsligne.js"'), f);
  }
});
