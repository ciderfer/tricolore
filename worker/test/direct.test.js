import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { Direct } from "../index.js";
import { stage, GAME_ID } from "./helpers.js";

// Faux navigateur (connexion WebSocket) et faux contexte de Durable Object.
const sock = (tag) => ({ tag, got: [], closed: null, send(m) { this.got.push(JSON.parse(m)); }, close(c) { this.closed = c; } });
function ctx(socks) {
  const store = new Map([["id", String(GAME_ID)]]);
  return { storage: { get: async (k) => store.get(k), put: async (k, v) => store.set(k, v) },
    getWebSockets: (tag) => socks.filter((s) => !s.closed && (!tag || s.tag === tag)) };
}
let net;
beforeEach(() => {
  net = { landing: stage(1, "LIVE").landing, calls: [], fail: false };
  globalThis.fetch = async (url) => {
    const part = String(url).split("/").pop();
    net.calls.push(part);
    if (net.fail) return new Response("", { status: 503 });
    return Response.json(part === "landing" ? net.landing : { part, id: GAME_ID });
  };
});

test("une lecture pour tous : landing à chacun, boxscore et right-rail seulement aux feuilles de match", async () => {
  const home = sock("landing"), sheet = sock("all");
  const d = new Direct(ctx([home, sheet]), {});
  assert.equal(await d.poll(), 5_000);
  assert.deepEqual(net.calls.sort(), ["boxscore", "landing", "right-rail"]);
  assert.deepEqual(home.got.map((m) => m.part), ["landing"]);
  assert.deepEqual(sheet.got.map((m) => m.part).sort(), ["boxscore", "landing", "right-rail"]);
  assert.equal(home.got[0].body.id, GAME_ID);
  assert.ok(Date.parse(home.got[0].at));
  // Rien de neuf à la LNH : rien n'est renvoyé; boxscore et right-rail attendent la minute.
  await d.poll();
  assert.equal(home.got.length, 1); assert.equal(sheet.got.length, 3);
  assert.deepEqual(net.calls.slice(3), ["landing"]);
  // Un but : seulement landing repart, à tout le monde.
  net.landing = stage(2, "LIVE").landing;
  await d.poll();
  assert.equal(home.got.length, 2); assert.equal(sheet.got.length, 4);
});

test("sans feuille de match ouverte, boxscore et right-rail ne sont jamais lus", async () => {
  const d = new Direct(ctx([sock("landing"), sock("landing")]), {});
  await d.poll(); await d.poll();
  assert.deepEqual(net.calls, ["landing", "landing"]);
});

test("match terminé : envoi complet, puis fermeture (1000) et plus de lecture", async () => {
  const s = sock("all");
  const d = new Direct(ctx([s]), {});
  await d.poll();
  net.landing = stage(3, "FINAL").landing;
  assert.equal(await d.poll(), 0);
  assert.equal(s.closed, 1000);
  assert.equal(s.got.filter((m) => m.part === "landing").at(-1).body.gameState, "FINAL");
  assert.deepEqual(net.calls.slice(-3).sort(), ["boxscore", "landing", "right-rail"]);
  net.calls.length = 0;
  assert.equal(await d.poll(), 0);
  assert.deepEqual(net.calls, []); // plus personne : aucune lecture
});

test("match d'autres équipes : fermeture 4404, rien d'envoyé", async () => {
  const s = sock("landing");
  net.landing = { ...net.landing, awayTeam: { abbrev: "BOS" }, homeTeam: { abbrev: "TOR" } };
  const d = new Direct(ctx([s]), {});
  assert.equal(await d.poll(), 0);
  assert.equal(s.closed, 4404); assert.deepEqual(s.got, []);
});

test("LNH en panne : l'erreur est dite une fois, sans donnée; le retour de la LNH renvoie le pointage", async () => {
  const s = sock("landing");
  const d = new Direct(ctx([s]), {});
  net.fail = true;
  await d.poll(); await d.poll();
  assert.deepEqual(s.got, [{ part: "landing", error: "LNH : HTTP 503" }]);
  net.fail = false;
  assert.equal(await d.poll(), 5_000);
  assert.equal(s.got[1].body.id, GAME_ID);
});

test("deux lectures en même temps (alarme + nouvelle connexion) : une seule lecture LNH", async () => {
  const d = new Direct(ctx([sock("landing")]), {});
  await Promise.all([d.poll(), d.poll()]);
  assert.deepEqual(net.calls, ["landing"]);
});

test("route /direct : origine, chemin, WebSocket seulement", async () => {
  let reached = null;
  const env = { DIRECT: { idFromName: (n) => n, get: (id) => ({ fetch: async () => { reached = id; return new Response("ok"); } }) } };
  const call = (path, headers = {}) => worker.fetch(new Request(`https://tricolore.tricolore.workers.dev${path}`, { headers: { origin: "https://ciderfer.github.io", ...headers } }), env);
  assert.equal((await call(`/direct/${GAME_ID}`, { origin: "https://evil.example", upgrade: "websocket" })).status, 403);
  assert.equal((await call("/direct/123", { upgrade: "websocket" })).status, 404);
  assert.equal((await call(`/direct/${GAME_ID}`)).status, 426);
  assert.equal(reached, null);
  assert.equal((await call(`/direct/${GAME_ID}?parts=all`, { upgrade: "websocket" })).status, 200);
  assert.equal(reached, String(GAME_ID));
});

test("rien de neuf pendant 25 s : un signe de vie (ping) à tous", async () => {
  const s = sock("landing");
  const d = new Direct(ctx([s]), {});
  await d.poll();
  d.lastSend -= 26_000;
  await d.poll();
  assert.deepEqual(s.got.map((m) => m.part), ["landing", "ping"]);
});

// ---- Première connexion : jamais un pointage périmé (alarme arrêtée, objet resté en mémoire) ----
// Horloge réglable : Date.now remplacé le temps du test.
function clock(t0 = Date.parse("2026-10-24T00:00:00Z")) {
  const real = Date.now; let t = t0;
  Date.now = () => t;
  return { tick(ms) { t += ms; }, get now() { return t; }, restore() { Date.now = real; } };
}
const data = (s) => s.got.filter((m) => m.part !== "ping"); // le signe de vie des 25 s n'est pas un pointage
const goals = (m) => m.body.summary.scoring.flatMap((p) => p.goals).length;

test("connexion après 30 s sans partisan : lecture LNH immédiate, premier pointage frais (pas l'ancien)", async () => {
  const c = clock();
  try {
    const socks = [sock("landing")];
    const d = new Direct(ctx(socks), {});
    await d.welcome(socks[0], false);
    socks[0].closed = 1000;
    c.tick(5_000);
    assert.equal(await d.poll(), 0); // plus personne : l'alarme s'arrête
    c.tick(25_000);
    net.landing = stage(2, "LIVE").landing; // but marqué pendant ce temps
    net.calls.length = 0;
    const s = sock("landing"); socks.push(s);
    await d.welcome(s, false);
    assert.deepEqual(net.calls, ["landing"]); // une lecture, tout de suite
    assert.equal(s.got.length, 1);
    assert.equal(goals(s.got[0]), 2);
    assert.equal(Date.parse(s.got[0].at), c.now); // daté de cette lecture, pas d'il y a 30 s
  } finally { c.restore(); }
});

test("état périmé mais inchangé : envoyé une fois, avec l'heure de la nouvelle lecture; rien aux autres", async () => {
  const c = clock();
  try {
    const a = sock("landing"), socks = [a];
    const d = new Direct(ctx(socks), {});
    await d.welcome(a, false);
    c.tick(30_000); // alarme en retard (ou arrêtée), même pointage à la LNH
    const b = sock("landing"); socks.push(b);
    await d.welcome(b, false);
    assert.equal(net.calls.length, 2);
    assert.equal(data(b).length, 1); assert.equal(Date.parse(data(b)[0].at), c.now);
    assert.equal(data(a).length, 1); // inchangé : pas de renvoi au partisan déjà là
  } finally { c.restore(); }
});

test("état frais (alarme en marche, lu il y a 2 s) : envoyé tout de suite, sans appel LNH de plus", async () => {
  const c = clock();
  try {
    const socks = [sock("landing")];
    const d = new Direct(ctx(socks), {});
    await d.poll();
    const readAt = c.now;
    c.tick(2_000);
    net.calls.length = 0;
    const s = sock("landing"); socks.push(s);
    await d.welcome(s, false);
    assert.deepEqual(net.calls, []);
    assert.equal(s.got.length, 1); assert.equal(Date.parse(s.got[0].at), readAt);
  } finally { c.restore(); }
});

test("feuille de match : boxscore et right-rail frais (< 1 min) resservis sans relire; landing périmé relu", async () => {
  const c = clock();
  try {
    const socks = [sock("all")];
    const d = new Direct(ctx(socks), {});
    await d.welcome(socks[0], true);
    assert.deepEqual(net.calls.sort(), ["boxscore", "landing", "right-rail"]);
    socks[0].closed = 1000;
    c.tick(20_000); net.calls.length = 0;
    const s = sock("all"); socks.push(s);
    await d.welcome(s, true);
    assert.deepEqual(net.calls, ["landing"]);
    assert.deepEqual(s.got.map((m) => m.part).sort(), ["boxscore", "landing", "right-rail"]);
    assert.equal(Date.parse(s.got.find((m) => m.part === "landing").at), c.now);
  } finally { c.restore(); }
});

test("connexion périmée sur un match fini : le pointage final arrive avant la fermeture (1000)", async () => {
  const c = clock();
  try {
    net.landing = stage(3, "FINAL").landing;
    const socks = [];
    const d = new Direct(ctx(socks), {});
    d.keys.landing = JSON.stringify(net.landing); d.readAt.landing = c.now; d.state = "FINAL"; // lu, puis tous partis
    c.tick(120_000);
    const s = sock("landing"); socks.push(s);
    await d.welcome(s, false);
    assert.equal(data(s).length, 1); assert.equal(data(s)[0].body.gameState, "FINAL");
    assert.equal(s.closed, 1000);
  } finally { c.restore(); }
});

test("fetch() (connexion réelle) : le premier envoi passe par welcome, avec lecture si rien de frais", async () => {
  const RealResponse = globalThis.Response;
  const socks = [];
  globalThis.WebSocketPair = class { constructor() { this[0] = {}; this[1] = sock(); } };
  globalThis.Response = class extends RealResponse { // Node refuse le statut 101 : on le note seulement
    constructor(b, init) { super(b, init?.status === 101 ? { status: 200 } : init); this.upgraded = init?.status === 101; }
    static json(...a) { return RealResponse.json(...a); } };
  try {
    const waits = [];
    const c = ctx(socks);
    let alarm = null;
    Object.assign(c, { acceptWebSocket: (ws, [tag]) => { ws.tag = tag; socks.push(ws); }, waitUntil: (p) => waits.push(p) });
    Object.assign(c.storage, { getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; } });
    const d = new Direct(c, {});
    const r = await d.fetch(new Request(`https://direct/direct/${GAME_ID}`));
    assert.ok(r.upgraded);
    await Promise.all(waits);
    assert.deepEqual(net.calls, ["landing"]);
    assert.equal(socks[0].got.length, 1); assert.equal(socks[0].got[0].body.id, GAME_ID);
    assert.ok(alarm > 0);
  } finally { globalThis.Response = RealResponse; delete globalThis.WebSocketPair; }
});
