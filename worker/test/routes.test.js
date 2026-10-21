import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../index.js";
import { MAX_SUBS } from "../alertes.js";
import { memKV, mockNet, makeSubscriber, testVapid } from "./helpers.js";

const SITE = "https://ciderfer.github.io";
let kv, env, limited;
const call = (path, { method = "GET", origin = SITE, body } = {}) => {
  const headers = { "cf-connecting-ip": "203.0.113.9" };
  if (origin) headers.origin = origin;
  if (body !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(new Request(`https://tricolore.tricolore.workers.dev${path}`, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), env);
};
const ALL = { debut: true, buts: true, final: true };

beforeEach(async () => {
  mockNet();
  kv = memKV();
  limited = false;
  const v = await testVapid();
  env = { ALERTES: kv, VAPID_PUBLIC_KEY: v.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: v.VAPID_PRIVATE_KEY, VAPID_SUBJECT: v.VAPID_SUBJECT,
    LIMITE: { limit: async () => ({ success: !limited }) } };
});

test("origine : refusée sans Origin ou avec une origine étrangère, permise pour le site et localhost", async () => {
  for (const o of [null, "https://evil.example", "https://ciderfer.github.io.evil.example", "http://localhost.evil.example"]) {
    const r = await call("/push/vapid-public-key", { origin: o });
    assert.equal(r.status, 403, String(o));
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  }
  const sub = await makeSubscriber("o");
  assert.equal((await call("/push/subscribe", { method: "POST", origin: "https://evil.example", body: { subscription: sub.json, prefs: ALL } })).status, 403);
  assert.equal(kv.writes, 0);
  for (const o of [SITE, "http://localhost:8000", "http://127.0.0.1:5500"]) {
    const r = await call("/push/vapid-public-key", { origin: o });
    assert.equal(r.status, 200); assert.equal(r.headers.get("access-control-allow-origin"), o);
  }
});

test("GET /push/vapid-public-key rend la clé publique; 503 si les alertes ne sont pas configurées", async () => {
  const r = await call("/push/vapid-public-key");
  assert.deepEqual(await r.json(), { key: env.VAPID_PUBLIC_KEY });
  delete env.ALERTES;
  assert.equal((await call("/push/vapid-public-key")).status, 503);
});

test("préflight CORS (OPTIONS) pour les POST JSON", async () => {
  const r = await call("/push/subscribe", { method: "OPTIONS" });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), SITE);
  assert.match(r.headers.get("access-control-allow-methods"), /POST/);
  assert.equal(r.headers.get("access-control-allow-headers"), "content-type");
});

test("subscribe : 201 puis aucune écriture si rien ne change; changement des choix = une écriture", async () => {
  const sub = await makeSubscriber("s");
  let r = await call("/push/subscribe", { method: "POST", body: { subscription: sub.json, prefs: ALL } });
  assert.equal(r.status, 201); assert.equal((await r.json()).prefs, "dbf");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(kv.writes, 1);
  r = await call("/push/subscribe", { method: "POST", body: { subscription: sub.json, prefs: ALL } });
  assert.equal(r.status, 200); assert.equal(kv.writes, 1);
  r = await call("/push/subscribe", { method: "POST", body: { subscription: sub.json, prefs: { debut: false, buts: true, final: true } } });
  assert.equal(r.status, 201); assert.equal((await r.json()).prefs, "bf"); assert.equal(kv.writes, 2);
  const { keys } = await kv.list({ prefix: "sub:" });
  assert.equal(keys.length, 1);
  assert.deepEqual(keys[0].metadata, { e: sub.endpoint, k: sub.p256dh, a: sub.auth, p: "bf" });
});

test("subscribe : refuse les abonnements invalides sans écrire", async () => {
  const sub = await makeSubscriber("x");
  const bad = [
    { subscription: { ...sub.json, endpoint: "https://evil.example/push" }, prefs: ALL },
    { subscription: { ...sub.json, endpoint: "http://fcm.googleapis.com/fcm/send/x" }, prefs: ALL },
    { subscription: { ...sub.json, endpoint: "http://localhost:9999/push" }, prefs: ALL }, // seulement avec PUSH_DEV=1
    { subscription: { ...sub.json, keys: { p256dh: "abc", auth: sub.auth } }, prefs: ALL },
    { subscription: { ...sub.json, keys: { p256dh: sub.p256dh, auth: "!!" } }, prefs: ALL },
    { subscription: sub.json, prefs: { debut: false, buts: false, final: false } },
    {},
  ];
  for (const b of bad) assert.equal((await call("/push/subscribe", { method: "POST", body: b })).status, 400, JSON.stringify(b).slice(0, 80));
  assert.equal((await call("/push/subscribe", { method: "POST", body: "{pas du json" })).status, 400);
  assert.equal((await call("/push/subscribe", { method: "POST", body: "x".repeat(5000) })).status, 413);
  assert.equal(kv.writes, 0);
  env.PUSH_DEV = "1";
  assert.equal((await call("/push/subscribe", { method: "POST", body: bad[2] })).status, 201, "faux service local permis en dev");
});

test("subscribe : au plus MAX_SUBS abonnés", async () => {
  for (let i = 0; i < MAX_SUBS; i++) kv.m.set(`sub:${String(i).padStart(32, "0")}`, { value: "1", metadata: { e: `https://fcm.googleapis.com/fcm/send/${i}`, k: "", a: "", p: "f" } });
  const sub = await makeSubscriber("plein");
  assert.equal((await call("/push/subscribe", { method: "POST", body: { subscription: sub.json, prefs: ALL } })).status, 503);
});

test("unsubscribe : supprime l'abonnement; aucune suppression si absent", async () => {
  const sub = await makeSubscriber("u");
  await call("/push/subscribe", { method: "POST", body: { subscription: sub.json, prefs: ALL } });
  let r = await call("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } });
  assert.equal(r.status, 200); assert.equal(kv.deletes, 1);
  assert.equal((await kv.list({ prefix: "sub:" })).keys.length, 0);
  r = await call("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } });
  assert.equal(r.status, 200); assert.equal(kv.deletes, 1);
  assert.equal((await call("/push/unsubscribe", { method: "POST", body: { endpoint: "https://evil.example/x" } })).status, 400);
});

test("méthodes et limiteur : 405 et 429 sur les routes push, routes LNH toujours en GET seulement", async () => {
  assert.equal((await call("/push/subscribe")).status, 405);
  assert.equal((await call("/push/vapid-public-key", { method: "POST", body: {} })).status, 405);
  assert.equal((await call("/push/autre", { method: "POST", body: {} })).status, 404);
  assert.equal((await call("/v1/standings/now", { method: "POST", body: {} })).status, 405);
  limited = true;
  const r = await call("/push/subscribe", { method: "POST", body: {} });
  assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "60");
  assert.equal((await call("/push/vapid-public-key")).status, 429);
});
