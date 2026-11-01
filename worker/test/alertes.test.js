import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { runAlertes, detect, pickGame, subscribe, BATCH } from "../alertes.js";
import { memKV, mockNet, stage, makeSubscriber, testVapid, withEnvoi, GAME_ID, START } from "./helpers.js";

let net, kv, env, subs, obj;
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
  obj = withEnvoi(env);
  subs = { a: await makeSubscriber("a"), f: await makeSubscriber("f"), mort: await makeSubscriber("mort") };
});

test("un match complet : avant-match, début, buts, final, sans doublon; écritures KV seulement aux envois", async () => {
  await addSub(subs.a);
  await addSub(subs.f, { debut: false, buts: false, final: true });
  const w0 = obj.ctx.writes;
  let t = START - 30 * MIN;
  const run = async (st) => { net.stage = st; const r = await runAlertes(env, t); t += MIN; return r; };
  const titles = () => net.pushes.map((p) => `${p.to}:${p.payload.title}`);

  // Avant le match : rien, aucune lecture KV, rien de noté.
  const r0 = kv.reads;
  assert.equal((await run(stage(0, "PRE"))).skipped, "aucun match");
  assert.equal(kv.reads, r0); assert.equal(obj.ctx.writes, w0);

  // Mise au jeu : « Le match commence » (une écriture), puis rien les minutes suivantes.
  t = START + MIN;
  await run(stage(0, "LIVE"));
  assert.deepEqual(titles(), ["a:Le match commence"]);
  assert.equal(net.pushes[0].payload.body, "Sharks @ Canadiens · Centre Bell");
  assert.equal(net.pushes[0].payload.tag, `${GAME_ID}-debut`);
  assert.equal(net.pushes[0].headers.topic, `${GAME_ID}-debut`);
  assert.equal(net.pushes[0].headers["content-encoding"], "aes128gcm");
  assert.match(net.pushes[0].headers.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.equal(obj.ctx.writes, w0 + 1);
  for (let i = 0; i < 5; i++) await run(stage(0, "LIVE"));
  assert.equal(net.pushes.length, 1); assert.equal(obj.ctx.writes, w0 + 1);

  // Premier but (Celebrini, SJS) : une alerte, une écriture; répété : rien.
  await run(stage(1));
  assert.equal(net.pushes.length, 2);
  assert.deepEqual(net.pushes[1].payload, { title: "But · Sharks", body: "M. Celebrini (4) · CH 0, Sharks 1 · 1re période, 13:49", tag: `${GAME_ID}-but-277`, game: GAME_ID });
  await run(stage(1)); await run(stage(1));
  assert.equal(net.pushes.length, 2); assert.equal(obj.ctx.writes, w0 + 2);

  // Deux buts entre deux minutes (Suzuki, Slafkovský) : deux alertes, une seule écriture.
  // Envoyées en parallèle : l'ordre d'arrivée n'est pas garanti.
  await run(stage(3));
  assert.deepEqual(net.pushes.slice(2).map((p) => p.payload.title), ["But du CH !", "But du CH !"]);
  assert.deepEqual(net.pushes.slice(2).map((p) => p.payload.body).sort(), [
    "J. Slafkovský (2) · CH 2, Sharks 1 · 2e période, 01:49",
    "N. Suzuki (5) · CH 1, Sharks 1 · 1re période, 16:38",
  ]);
  assert.equal(obj.ctx.writes, w0 + 3);

  // Fin du match en prolongation, avec les buts restants vus en même temps.
  t = START + 160 * MIN;
  await run(stage(7, "FINAL"));
  const fin = net.pushes.filter((p) => p.payload.tag === `${GAME_ID}-final`);
  assert.deepEqual(fin.map((p) => p.to).sort(), ["a", "f"]);
  assert.equal(fin[0].payload.title, "Final : défaite en prolongation");
  assert.equal(fin[0].payload.body, "CH 3, Sharks 4");
  const ot = net.pushes.find((p) => p.payload.tag === `${GAME_ID}-but-1103`);
  assert.equal(ot.payload.body, "M. Celebrini (5) · CH 3, Sharks 4 · Prolongation, 02:13");
  assert.equal(obj.ctx.writes, w0 + 4);

  // Les minutes suivantes (FINAL puis OFF) : aucun doublon, aucune écriture, pas de lecture de la feuille.
  const before = net.pushes.length, nhl = net.nhl;
  await run(stage(7, "FINAL")); const off = stage(7, "OFF"); await run(off); await run(off);
  assert.equal(net.pushes.length, before); assert.equal(obj.ctx.writes, w0 + 4);
  assert.equal(net.pushes.length, before);

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
  const w0 = obj.ctx.writes;
  net.stage = stage(4);
  await runAlertes(env, START + 60 * MIN);
  assert.equal(net.pushes.length, 0); assert.equal(obj.ctx.writes, w0 + 1);
  await runAlertes(env, START + 61 * MIN);
  assert.equal(obj.ctx.writes, w0 + 1);
  net.stage = stage(5);
  await runAlertes(env, START + 70 * MIN);
  assert.deepEqual(net.pushes.map((p) => p.payload.tag), [`${GAME_ID}-but-834`]);
});

test("match déjà terminé jamais vu en direct : aucune alerte, aucune écriture", async () => {
  await addSub(subs.a);
  const w0 = obj.ctx.writes;
  net.stage = stage(7, "FINAL");
  assert.equal((await runAlertes(env, START + 3 * 3600_000)).events, 0);
  assert.equal(net.pushes.length, 0); assert.equal(obj.ctx.writes, w0);
});

test("sans abonné : l'événement est noté une fois (pas de list ni d'écriture à chaque minute)", async () => {
  net.stage = stage(0, "LIVE");
  await runAlertes(env, START); await runAlertes(env, START + MIN); await runAlertes(env, START + 2 * MIN);
  assert.equal(obj.ctx.writes, 1); assert.equal(kv.lists, 1);
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

test("120 appareils : 40 tout de suite, le reste par l'objet Envoi, un lot par alarme; ≤ 50 sous-requêtes par exécution", async () => {
  const all = [];
  for (let i = 0; i < 120; i++) { const s = await makeSubscriber(`s${i}`); all.push(s); await addSub(s); }
  all[70].status = 410; // expiré : retiré par l'objet Envoi
  const { envoi, ctx: c } = obj;
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (...a) => { calls++; return real(...a); };

  net.stage = stage(0, "LIVE");
  const r = await runAlertes(env, START);
  assert.equal(r.sent, BATCH); assert.equal(r.queued, 120 - BATCH);
  assert.ok(calls <= 50, `minuterie : ${calls} requêtes`);
  assert.equal(net.pushes.length, BATCH);

  let alarms = 0;
  while (c.storage.takeAlarm() != null) {
    calls = 0; alarms++;
    await envoi.alarm();
    assert.ok(calls <= 50, `alarme : ${calls} requêtes`);
  }
  assert.equal(alarms, Math.ceil((120 - BATCH) / BATCH));
  const got = net.pushes.map((p) => p.to);
  assert.equal(got.length, 119); assert.equal(new Set(got).size, 119, "un seul envoi par appareil");
  assert.ok(got.every((n) => n !== "s70"));
  assert.deepEqual([...c.m.keys()].filter((k) => k.startsWith("q:")), [], "file vide");
  assert.equal((await kv.list({ prefix: "sub:" })).keys.length, 119);

  // Minute suivante, rien de neuf : aucun envoi, rien en file.
  await runAlertes(env, START + MIN);
  assert.equal(net.pushes.length, 119); assert.equal(c.storage.takeAlarm(), null);
});

test("objet Envoi absent ou en panne : le premier lot part quand même, l'état est noté (pas de doublon)", async () => {
  for (let i = 0; i < BATCH + 5; i++) { const s = await makeSubscriber(`p${i}`); await addSub(s); }
  const real = env.ENVOI.get();
  env.ENVOI = { idFromName: (n) => n, get: () => ({ fetch: async (url, init) => { if (url.endsWith("/etat")) return real.fetch(url, init); throw new Error("panne"); } }) };
  net.stage = stage(0, "LIVE");
  const r = await runAlertes(env, START);
  assert.equal(r.sent, BATCH);
  await runAlertes(env, START + MIN);
  assert.equal(net.pushes.length, BATCH);
});

// « But refusé » : le 31 octobre (2026020223), le but 222 a disparu de la feuille après une reprise.
// Ici : le 3e but (Slafkovský) est annoncé, puis retiré de la feuille et du pointage.
function refuse(st) {
  st.landing.summary.scoring.forEach((p) => { p.goals = p.goals.filter((g) => g.eventId !== st.gone); });
  return st;
}
function sansTroisieme() {
  const st = stage(3); const g3 = st.landing.summary.scoring.flatMap((p) => p.goals)[2];
  st.gone = g3.eventId; refuse(st);
  const game = st.scoreboard.gamesByDate[0].games[0];
  if (game.awayTeam.abbrev === g3.teamAbbrev.default) game.awayTeam.score--; else game.homeTeam.score--;
  return st;
}
const refus = () => net.pushes.filter((p) => p.payload.title.startsWith("But refusé"));

test("but refusé : une seule correction, à la 2e lecture de suite, puis le but sort de la liste", async () => {
  await addSub(subs.a);
  let t = START + MIN;
  const run = async (st) => { net.stage = st; await runAlertes(env, t); t += MIN; };
  await run(stage(0, "LIVE")); await run(stage(3));
  const gone = sansTroisieme().gone;
  await run(sansTroisieme());
  assert.equal(refus().length, 0, "1re lecture sans le but : on attend");
  await run(sansTroisieme());
  assert.deepEqual(refus().map((p) => p.payload), [{ title: "But refusé : CH", body: "Le but est annulé. Le score est maintenant CH 1, Sharks 1", tag: `${GAME_ID}-refuse-${gone}`, game: GAME_ID }]);
  const w = obj.ctx.writes;
  for (let i = 0; i < 3; i++) await run(sansTroisieme());
  assert.equal(refus().length, 1, "pas de doublon"); assert.equal(obj.ctx.writes, w, "aucune écriture de plus");
  assert.ok(!obj.ctx.m.get("etat").g[GAME_ID].b.includes(gone)); assert.equal(kv.m.get("etat"), undefined, "plus rien dans le KV");
});

test("but refusé : rien si le but est toujours là, ni pour une disparition d'une seule lecture", async () => {
  await addSub(subs.a);
  let t = START + MIN;
  const run = async (st) => { net.stage = st; await runAlertes(env, t); t += MIN; };
  await run(stage(0, "LIVE")); await run(stage(3)); await run(stage(3));
  assert.equal(refus().length, 0);
  await run(sansTroisieme()); await run(stage(3)); await run(sansTroisieme()); await run(stage(3));
  assert.equal(refus().length, 0, "pépin d'une lecture : pas de correction");
  // Feuille vide mais pointage du tableau inchangé : pépin, pas de correction.
  const vide = stage(3); vide.landing.summary.scoring.forEach((p) => { p.goals = []; });
  await run(vide); await run(vide);
  assert.equal(refus().length, 0, "feuille vide incohérente avec le pointage");
  assert.equal(net.pushes.filter((p) => p.payload.title.startsWith("But")).length, 3, "aucun but réannoncé");
});

test("but refusé : sur la feuille finale, correction tout de suite (une seule) avec le final", () => {
  const avant = stage(3).landing.summary.scoring.flatMap((p) => p.goals).map((x) => x.eventId);
  const st = sansTroisieme(); const gm = st.scoreboard.gamesByDate[0].games[0];
  gm.gameState = "FINAL";
  const r = detect(gm, st.landing, { d: 1, b: avant }); // ancien « etat » sans équipe : titre sans équipe
  assert.deepEqual(r.events.map((e) => e.payload.title), ["But refusé", "Final"]);
  assert.equal(r.events[0].payload.body, "Le but est annulé. Le score est maintenant CH 1, Sharks 1");
  assert.ok(!r.rec.b.includes(st.gone)); assert.equal(r.rec.f, 1);
});

// Doublons : « etat » est dans l'objet Envoi (cohérence forte), plus dans le KV (cohérence à terme).
test("deux minuteries avec les mêmes données, même en même temps : chaque but une seule fois, « But refusé » une fois", async () => {
  await addSub(subs.a);
  let t = START + MIN;
  const both = async (st) => { net.stage = st; await Promise.all([runAlertes(env, t), runAlertes(env, t)]); t += MIN; };
  await both(stage(0, "LIVE")); await both(stage(3)); await both(stage(3));
  const gone = sansTroisieme().gone;
  await both(sansTroisieme()); await both(sansTroisieme()); await both(sansTroisieme());
  const tags = net.pushes.map((p) => p.payload.tag);
  assert.deepEqual(tags.filter((x) => x.includes("-but-")).length, 3);
  assert.equal(new Set(tags).size, tags.length, "aucun doublon");
  assert.deepEqual(tags.filter((x) => x.includes("-refuse-")), [`${GAME_ID}-refuse-${gone}`]);
  assert.equal(kv.m.get("etat"), undefined, "rien d'écrit dans le KV");
});

test("passage KV -> objet : l'ancien « etat » du KV est repris (match en cours, aucun ré-envoi), puis plus lu", async () => {
  await addSub(subs.a);
  const vieux = stage(3).landing.summary.scoring.flatMap((p) => p.goals).map((g) => g.eventId);
  await kv.put("etat", JSON.stringify({ g: { [GAME_ID]: { d: 1, b: vieux } } }));
  net.stage = stage(3);
  await runAlertes(env, START + 60 * MIN);
  assert.equal(net.pushes.length, 0, "buts déjà annoncés avant le passage : rien");
  net.stage = stage(4);
  await runAlertes(env, START + 61 * MIN);
  assert.equal(net.pushes.length, 1, "seulement le nouveau but");
  assert.deepEqual(obj.ctx.m.get("etat").g[GAME_ID].b, [...vieux, net.pushes[0].payload.tag.split("-but-")[1] * 1]);
  const r = kv.reads;
  net.stage = stage(4);
  await runAlertes(env, START + 62 * MIN);
  assert.equal(kv.reads, r, "état dans l'objet : plus de lecture du KV");
  assert.equal(net.pushes.length, 1);
});
