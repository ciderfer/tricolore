import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../index.js";
import { memKV, mockNet, stage, START } from "./helpers.js";

let net;
beforeEach(() => { net = mockNet(); net.stage = stage(0, "PRE"); });
const at = (iso) => ({ scheduledTime: Date.parse(iso), cron: "* * * * *" });

test("minute % 15 === 0 : lance data.yml (une fois, comme l'ancien */15), les autres minutes non", async () => {
  const env = { GH_TOKEN: "jeton-test" };
  for (const m of ["00", "15", "30", "45"]) await worker.scheduled(at(`2026-10-21T02:${m}:00Z`), env);
  assert.equal(net.github.length, 4);
  const { url, init } = net.github[0];
  assert.equal(url, "https://api.github.com/repos/ciderfer/tricolore/actions/workflows/data.yml/dispatches");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.authorization, "Bearer jeton-test");
  assert.equal(init.body, JSON.stringify({ ref: "main" }));
  for (let m = 1; m < 15; m++) await worker.scheduled(at(`2026-10-21T02:${String(m).padStart(2, "0")}:00Z`), env);
  assert.equal(net.github.length, 4);
  // 24 h de minuterie chaque minute : 96 lancements, comme avant.
  net.github.length = 0;
  for (let i = 0; i < 1440; i++) await worker.scheduled({ scheduledTime: Date.parse("2026-10-21T00:00:00Z") + i * 60_000 }, env);
  assert.equal(net.github.length, 96);
});

test("réponse GitHub autre que 204 = erreur; GH_TOKEN manquant = erreur (aux 15 minutes seulement)", async () => {
  net.githubStatus = 403;
  await assert.rejects(worker.scheduled(at("2026-10-21T02:15:00Z"), { GH_TOKEN: "x" }), /GitHub : HTTP 403/);
  await assert.rejects(worker.scheduled(at("2026-10-21T02:30:00Z"), {}), /GH_TOKEN manquant/);
  await worker.scheduled(at("2026-10-21T02:31:00Z"), {}); // pas de lancement, pas d'erreur
});

test("une erreur des alertes n'empêche pas le lancement de data.yml (et vice versa)", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("https://api.github.com/")) { net.github.push(url); return new Response(null, { status: 204 }); }
    return new Response("panne", { status: 503 });
  };
  const env = { GH_TOKEN: "x", ALERTES: memKV(), VAPID_PUBLIC_KEY: "k", VAPID_PRIVATE_KEY: "k", VAPID_SUBJECT: "mailto:a@b.c" };
  await assert.rejects(worker.scheduled(at("2026-10-21T02:45:00Z"), env), /LNH .* HTTP 503/);
  assert.equal(net.github.length, 1);
});

test("minuterie chaque minute pendant un match : une seule lecture KV par minute, aucune écriture sans événement", async () => {
  const kv = memKV();
  const env = { ALERTES: kv, VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_KEY: "x", VAPID_SUBJECT: "mailto:a@b.c" };
  net.stage = stage(4); // en direct; première vue : ligne de base (1 écriture)
  for (let i = 0; i < 10; i++) await worker.scheduled({ scheduledTime: START + (61 + i) * 60_000 }, env);
  assert.equal(kv.writes, 1); assert.equal(kv.reads, 10); assert.equal(kv.lists, 0);
});
