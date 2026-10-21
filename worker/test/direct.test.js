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
