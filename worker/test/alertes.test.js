import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { runAlertes, detect, pickGame, subscribe } from "../alertes.js";
import { memKV, mockNet, stage, makeSubscriber, testVapid, GAME_ID, START } from "./helpers.js";

let net, kv, env, subs;
const MIN = 60_000;
async function addSub(s, prefs = { debut: true, buts: true, final: true }) {
  net.push.set(s.endpoint, s);
  const r = await subscribe(env, { subscription: s.json, prefs });
  assert.equal(r.status, 201);
}
beforeEach(async () => {
  net = mockNet();
  kv = memKV();
  const v = await testVapid();
  env = { ALERTES: kv, VAPID_PUBLIC_KEY: v.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: v.VAPID_PRIVATE_KEY, VAPID_SUBJECT: v.VAPID_SUBJECT };
  subs = { a: await makeSubscriber("a"), f: await makeSubscriber("f"), mort: await makeSubscriber("mort") };
});

test("un match complet : avant-match, début, buts, final, sans doublon; écritures KV seulement aux envois", async () => {
  await addSub(subs.a);
  await addSub(subs.f, { debut: false, buts: false, final: true });
  const w0 = kv.writes;
  let t = START - 30 * MIN;
  const run = async (st) => { net.stage = st; const r = await runAlertes(env, t); t += MIN; return r; };
  const titles = () => net.pushes.map((p) => `${p.to}:${p.payload.title}`);

  // Avant le match : rien, aucune lecture ni écriture KV.
  const r0 = kv.reads;
  assert.equal((await run(stage(0, "PRE"))).skipped, "aucun match");
  assert.equal(kv.reads, r0); assert.equal(kv.writes, w0);

  // Mise au jeu : « Le match commence » (une écriture), puis rien les minutes suivantes.
  t = START + MIN;
  await run(stage(0, "LIVE"));
  assert.deepEqual(titles(), ["a:Le match commence"]);
  assert.equal(net.pushes[0].payload.body, "Sharks @ Canadiens · Centre Bell");
  assert.equal(net.pushes[0].payload.tag, `${GAME_ID}-debut`);
  assert.equal(net.pushes[0].headers.topic, `${GAME_ID}-debut`);
  assert.equal(net.pushes[0].headers["content-encoding"], "aes128gcm");
  assert.match(net.pushes[0].headers.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.equal(kv.writes, w0 + 1);
  for (let i = 0; i < 5; i++) await run(stage(0, "LIVE"));
  assert.equal(net.pushes.length, 1); assert.equal(kv.writes, w0 + 1);

  // Premier but (Celebrini, SJS) : une alerte, une écriture; répété : rien.
  await run(stage(1));
  assert.equal(net.pushes.length, 2);
  assert.deepEqual(net.pushes[1].payload, { title: "But · Sharks", body: "M. Celebrini (4) · CH 0, Sharks 1 · 1re période, 13:49", tag: `${GAME_ID}-but-277`, game: GAME_ID });
  await run(stage(1)); await run(stage(1));
  assert.equal(net.pushes.length, 2); assert.equal(kv.writes, w0 + 2);

  // Deux buts entre deux minutes (Suzuki, Slafkovský) : deux alertes, une seule écriture.
  await run(stage(3));
  assert.deepEqual(net.pushes.slice(2).map((p) => p.payload.title), ["But du CH !", "But du CH !"]);
  assert.equal(net.pushes[3].payload.body, "J. Slafkovský (2) · CH 2, Sharks 1 · 2e période, 01:49");
  assert.equal(kv.writes, w0 + 3);

  // Fin du match en prolongation, avec les buts restants vus en même temps.
  t = START + 160 * MIN;
  await run(stage(7, "FINAL"));
  const fin = net.pushes.filter((p) => p.payload.tag === `${GAME_ID}-final`);
  assert.deepEqual(fin.map((p) => p.to).sort(), ["a", "f"]);
  assert.equal(fin[0].payload.title, "Final : défaite en prolongation");
  assert.equal(fin[0].payload.body, "CH 3, Sharks 4");
  const ot = net.pushes.find((p) => p.payload.tag === `${GAME_ID}-but-1103`);
  assert.equal(ot.payload.body, "M. Celebrini (5) · CH 3, Sharks 4 · Prolongation, 02:13");
  assert.equal(kv.writes, w0 + 4);

  // Les minutes suivantes (FINAL puis OFF) : aucun doublon, aucune écriture, pas de lecture de la feuille.
  const before = net.pushes.length, nhl = net.nhl;
  await run(stage(7, "FINAL")); const off = stage(7, "OFF"); await run(off); await run(off);
  assert.equal(net.pushes.length, before); assert.equal(kv.writes, w0 + 4);
  assert.equal(net.nhl - nhl, 3, "seulement le scoreboard");

  // L'abonné « final seulement » n'a reçu que le final; l'autre a tout reçu (1 début, 7 buts, 1 final).
  assert.deepEqual(net.pushes.filter((p) => p.to === "f").map((p) => p.payload.title), ["Final : défaite en prolongation"]);
  assert.equal(net.pushes.filter((p) => p.to === "a").length, 9);
  assert.deepEqual(new Set(net.pushes.filter((p) => p.to === "a").map((p) => p.payload.tag)).size, 9, "pas de doublon");
});

test("abonnement expiré (410) : retiré du KV au premier envoi", async () => {
  await addSub(subs.a); await addSub(subs.mort);
  subs.mort.status = 410;
  net.stage = stage(0, "LIVE");
  const r = await runAlertes(env, START);
  assert.equal(r.removed, 1); assert.equal(r.sent, 1);
  const { keys } = await kv.list({ prefix: "sub:" });
  assert.equal(keys.length, 1); assert.equal(keys[0].metadata.e, subs.a.endpoint);
});

test("alertes activées en cours de match : ligne de base sans envoi (une écriture), puis seulement les nouveaux buts", async () => {
  await addSub(subs.a);
  const w0 = kv.writes;
  net.stage = stage(4);
  await runAlertes(env, START + 60 * MIN);
  assert.equal(net.pushes.length, 0); assert.equal(kv.writes, w0 + 1);
  await runAlertes(env, START + 61 * MIN);
  assert.equal(kv.writes, w0 + 1);
  net.stage = stage(5);
  await runAlertes(env, START + 70 * MIN);
  assert.deepEqual(net.pushes.map((p) => p.payload.tag), [`${GAME_ID}-but-834`]);
});

test("match déjà terminé jamais vu en direct : aucune alerte, aucune écriture", async () => {
  await addSub(subs.a);
  const w0 = kv.writes;
  net.stage = stage(7, "FINAL");
  assert.equal((await runAlertes(env, START + 3 * 3600_000)).skipped, "terminé");
  assert.equal(net.pushes.length, 0); assert.equal(kv.writes, w0);
});

test("sans abonné : l'événement est noté une fois (pas de list ni d'écriture à chaque minute)", async () => {
  net.stage = stage(0, "LIVE");
  await runAlertes(env, START); await runAlertes(env, START + MIN); await runAlertes(env, START + 2 * MIN);
  assert.equal(kv.writes, 1); assert.equal(kv.lists, 1);
});

test("sans configuration (pas de KV ou de clés VAPID) : ne fait rien, aucune requête", async () => {
  assert.equal((await runAlertes({}, START)).skipped, "config");
  assert.equal((await runAlertes({ ALERTES: kv }, START)).skipped, "config");
  assert.equal(net.nhl, 0);
});

test("pickGame et detect : cas limites", () => {
  const live = stage(2).scoreboard;
  assert.equal(pickGame(live, START + MIN).id, GAME_ID);
  assert.equal(pickGame(stage(7, "OFF").scoreboard, START + 9 * 3600_000), null, "terminé depuis longtemps");
  assert.equal(pickGame(stage(0, "FUT").scoreboard, START - MIN), null);
  const g = stage(2).scoreboard.gamesByDate[0].games[0];
  assert.deepEqual(detect(g, null, null), { events: [], rec: null }, "feuille illisible : on attend");
  assert.deepEqual(detect(g, null, { d: 1, b: [277] }), { events: [], rec: null });
});
