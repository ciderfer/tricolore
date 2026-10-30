// Tricolore — alertes de match (Web Push) : abonnements et détection des événements du Canadien.
//
// Stockage (KV, liaison ALERTES) :
//   « sub:<empreinte> » : un abonné par clé, tout dans les métadonnées { e: endpoint, k: p256dh, a: auth, p: "dbf" }.
//       Une seule opération list() rend donc tous les abonnés, sans lecture par abonné.
//   « etat » : ce qui a déjà été envoyé, par match : { g: { <id>: { d: 1 (début), b: [eventId des buts], f: 1 (final) } } }.
// Budget KV (gratuit : 1 000 écritures, 1 000 list et 100 000 lectures par jour) : la minuterie ne lit « etat » que
// pendant un match (ou peu après), et n'écrit que quand un événement est détecté (au plus ~10 écritures par match).
// Jamais d'écriture à chaque minute.
// Aucune donnée inventée : les messages ne reprennent que ce que l'API LNH rend (noms, pointage, période, temps).
import { sendPush, vapidAuth } from "./push.js";

const UPSTREAM = "https://api-web.nhle.com";
const MTL = "MTL";
const LIVE = new Set(["LIVE", "CRIT"]);
const DONE = new Set(["OFF", "FINAL"]);
export const MAX_SUBS = 500;       // une seule lecture list() du KV (1 000 clés au plus)
// Plan gratuit : 50 sous-requêtes par exécution. Minuterie : 2 lectures LNH, GitHub aux 15 min, l'objet Envoi, plus ce lot.
export const BATCH = 40;
const RECENT_MS = 8 * 3600 * 1000; // un match terminé n'est suivi (pour l'alerte « Final ») que 8 h après le début
const KEEP_GAMES = 4;              // nombre de matchs gardés dans « etat »
const PREFS = { debut: "d", buts: "b", final: "f" };

// Services de push connus (https seulement) : Apple (iPhone), Google (Chrome; jmt17 pour Chromium), Mozilla, Microsoft.
// En local (PUSH_DEV=1 dans .dev.vars), un faux service sur localhost.
const PUSH_HOSTS = /^(web\.push\.apple\.com|fcm\.googleapis\.com|jmt17\.google\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
export function endpointOk(endpoint, env = {}) {
  if (typeof endpoint !== "string" || endpoint.length > 600) return false;
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol === "https:" && PUSH_HOSTS.test(u.hostname) && !u.port) return true;
  return env.PUSH_DEV === "1" && u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
}

async function subKey(endpoint) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
  return "sub:" + [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const B64U = /^[A-Za-z0-9_-]+={0,2}$/;
// Valide le corps de /push/subscribe. Rend { meta } ou { error }.
export function parseSubscription(body, env) {
  const s = body?.subscription;
  if (!s || !endpointOk(s.endpoint, env)) return { error: "abonnement invalide (service de push inconnu)" };
  const k = s.keys?.p256dh, a = s.keys?.auth;
  if (typeof k !== "string" || !B64U.test(k) || k.length < 86 || k.length > 90) return { error: "clé p256dh invalide" };
  if (typeof a !== "string" || !B64U.test(a) || a.length < 22 || a.length > 24) return { error: "secret auth invalide" };
  const prefs = body.prefs || {};
  const p = Object.entries(PREFS).filter(([name]) => prefs[name] === true).map(([, c]) => c).join("");
  if (!p) return { error: "choisissez au moins une alerte" };
  return { meta: { e: s.endpoint, k, a, p } };
}

export async function subscribe(env, body) {
  const { meta, error } = parseSubscription(body, env);
  if (error) return { status: 400, body: { error } };
  const key = await subKey(meta.e);
  const old = await env.ALERTES.getWithMetadata(key);
  if (old.value !== null && JSON.stringify(old.metadata) === JSON.stringify(meta)) return { status: 200, body: { ok: true, prefs: meta.p } };
  if (old.value === null) {
    const { keys } = await env.ALERTES.list({ prefix: "sub:", limit: MAX_SUBS + 1 });
    if (keys.length >= MAX_SUBS) return { status: 503, body: { error: "alertes complètes pour l’instant" } };
  }
  await env.ALERTES.put(key, "1", { metadata: meta });
  return { status: 201, body: { ok: true, prefs: meta.p } };
}

export async function unsubscribe(env, body) {
  const endpoint = body?.endpoint;
  if (!endpointOk(endpoint, env)) return { status: 400, body: { error: "abonnement invalide" } };
  const key = await subKey(endpoint);
  if ((await env.ALERTES.get(key)) !== null) await env.ALERTES.delete(key); // pas d'écriture inutile
  return { status: 200, body: { ok: true } };
}

async function listSubs(env) {
  const out = [];
  let cursor;
  do {
    const r = await env.ALERTES.list({ prefix: "sub:", cursor });
    for (const k of r.keys) if (k.metadata?.e) out.push({ key: k.name, endpoint: k.metadata.e, keys: { p256dh: k.metadata.k, auth: k.metadata.a }, p: k.metadata.p || "" });
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}

// ---------- Détection (fonctions pures, testées) ----------

const team = (t) => (t.abbrev === MTL ? "CH" : t.commonName?.fr || t.commonName?.default || t.abbrev);
const longName = (t) => t.commonName?.fr || t.commonName?.default || t.abbrev;

function periodLabel(pd) {
  if (!pd || typeof pd.number !== "number") return "";
  if (pd.periodType === "SO") return "Tirs de barrage";
  if (pd.periodType === "OT") {
    const k = pd.number - (pd.maxRegulationPeriods || 3);
    return k <= 1 ? "Prolongation" : `${k}e prolongation`;
  }
  return pd.number === 1 ? "1re période" : `${pd.number}e période`;
}

// Choisit le match du Canadien à suivre dans scoreboard/MTL/now : en direct, sinon terminé depuis peu.
export function pickGame(scoreboard, nowMs) {
  const games = (scoreboard?.gamesByDate || []).flatMap((d) => d.games || [])
    .filter((g) => g && /^\d{10}$/.test(String(g.id)) && (g.awayTeam?.abbrev === MTL || g.homeTeam?.abbrev === MTL));
  return games.find((g) => LIVE.has(g.gameState))
    || games.find((g) => DONE.has(g.gameState) && nowMs - Date.parse(g.startTimeUTC) < RECENT_MS && nowMs >= Date.parse(g.startTimeUTC))
    || null;
}

// Buts de la feuille « landing », dans l'ordre (sans les tirs de barrage).
export function goalsOf(landing) {
  const out = [];
  for (const p of landing?.summary?.scoring || []) {
    if (p.periodDescriptor?.periodType === "SO") continue;
    for (const g of p.goals || []) if (typeof g.eventId === "number") out.push({ ...g, pd: p.periodDescriptor });
  }
  return out;
}

function scoreLine(game, away, home) {
  const us = game.awayTeam.abbrev === MTL ? "away" : "home";
  const [u, t] = us === "away" ? [game.awayTeam, game.homeTeam] : [game.homeTeam, game.awayTeam];
  const [su, st] = us === "away" ? [away, home] : [home, away];
  return `${team(u)} ${su}, ${team(t)} ${st}`;
}

function goalPayload(game, g) {
  const id = game.id, abbrev = g.teamAbbrev?.default;
  const scorer = g.name?.default || [g.firstName?.default, g.lastName?.default].filter(Boolean).join(" ");
  const opp = game.awayTeam.abbrev === MTL ? game.homeTeam : game.awayTeam;
  const title = abbrev === MTL ? "But du CH !" : `But · ${longName(opp)}`;
  const parts = [];
  if (scorer) parts.push(typeof g.goalsToDate === "number" ? `${scorer} (${g.goalsToDate})` : scorer);
  if (typeof g.awayScore === "number" && typeof g.homeScore === "number") parts.push(scoreLine(game, g.awayScore, g.homeScore));
  const when = [periodLabel(g.pd), g.timeInPeriod].filter(Boolean).join(", ");
  if (when) parts.push(when);
  return { title, body: parts.join(" · "), tag: `${id}-but-${g.eventId}`, game: id };
}

function startPayload(game) {
  const body = `${longName(game.awayTeam)} @ ${longName(game.homeTeam)}${game.venue?.default ? ` · ${game.venue.default}` : ""}`;
  return { title: "Le match commence", body, tag: `${game.id}-debut`, game: game.id };
}

function finalPayload(game) {
  const a = game.awayTeam.score, h = game.homeTeam.score;
  if (typeof a !== "number" || typeof h !== "number") return null; // pas de pointage : pas d'alerte
  const us = game.awayTeam.abbrev === MTL ? a : h, them = game.awayTeam.abbrev === MTL ? h : a;
  const type = game.periodDescriptor?.periodType;
  const how = type === "OT" ? " en prolongation" : type === "SO" ? " en tirs de barrage" : "";
  const res = us > them ? "victoire" : us < them ? "défaite" : "";
  return { title: res ? `Final : ${res}${how}` : "Final", body: scoreLine(game, a, h), tag: `${game.id}-final`, game: game.id };
}

// Compare l'état du match à ce qui a déjà été envoyé (rec). Rend { events, rec } ; rec est null si rien n'a changé.
// - Premier coup d'œil sur un match en direct : « Le match commence » si on est en 1re période sans but;
//   sinon (Worker déployé ou alertes activées en cours de match) on note les buts déjà marqués, sans rien envoyer.
// - Un match terminé jamais vu en direct est ignoré (pas d'alerte « Final » pour un vieux match).
export function detect(game, landing, rec) {
  const live = LIVE.has(game.gameState), done = DONE.has(game.gameState);
  if (!live && !done) return { events: [], rec: null };
  if (done && (!rec || rec.f)) return { events: [], rec: null };
  const goals = landing ? goalsOf(landing) : null; // null : feuille illisible, on ne décide rien sur les buts
  const events = [];
  const next = rec ? { ...rec, b: [...(rec.b || [])] } : { b: [] };
  if (!rec) {
    const a = game.awayTeam?.score, h = game.homeTeam?.score;
    const fresh = game.periodDescriptor?.number === 1 && a === 0 && h === 0 && (!goals || goals.length === 0);
    if (fresh) { events.push({ kind: "d", ttl: 900, payload: startPayload(game) }); next.d = 1; }
    if (goals) next.b = goals.map((g) => g.eventId);
    else if (!fresh) return { events: [], rec: null }; // on attendra une feuille lisible pour la ligne de base
    return { events, rec: next };
  }
  if (goals) {
    for (const g of goals) {
      if (next.b.includes(g.eventId)) continue;
      events.push({ kind: "b", ttl: 600, payload: goalPayload(game, g) });
      next.b.push(g.eventId);
    }
  }
  if (done) {
    const p = finalPayload(game);
    if (p) events.push({ kind: "f", ttl: 6 * 3600, payload: p });
    next.f = 1;
  }
  return { events, rec: events.length || next.f !== rec.f ? next : null };
}

// ---------- Minuterie ----------

async function getJson(base, path) {
  const r = await fetch(base + path, { headers: { "user-agent": "tricolore (site de partisan; github.com/ciderfer/tricolore)" } });
  if (!r.ok) throw new Error(`LNH ${path} : HTTP ${r.status}`);
  return r.json();
}

// Une exécution de la minuterie (chaque minute). Rend un petit bilan (pour les journaux et les tests).
export async function runAlertes(env, nowMs = Date.now()) {
  if (!env.ALERTES || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return { skipped: "config" };
  const base = env.NHL_API || UPSTREAM;
  const game = pickGame(await getJson(base, "/v1/scoreboard/MTL/now"), nowMs);
  if (!game) return { skipped: "aucun match" };

  const etat = (await env.ALERTES.get("etat", "json")) || { g: {} };
  const rec = etat.g?.[game.id] || null;
  if (DONE.has(game.gameState) && (!rec || rec.f)) return { skipped: "terminé", game: game.id };
  let landing = null;
  try { landing = await getJson(base, `/v1/gamecenter/${game.id}/landing`); } catch (e) { console.error(e.message); }

  const { events, rec: next } = detect(game, landing, rec);
  if (!next) return { game: game.id, events: 0, sent: 0 };

  // Un envoi par abonné et par événement, dans l'ordre. Les BATCH premiers partent tout de suite; la suite est
  // confiée à l'objet « Envoi » (envoi.js), qui l'envoie par lots, une alarme par lot (quelques secondes en tout).
  const subs = events.length ? await listSubs(env) : [];
  const items = events.flatMap((ev) => subs.filter((s) => s.p.includes(ev.kind)).map((s) => ({ s, ev })));
  const later = items.slice(BATCH);
  const r = await sendBatch(env, items.slice(0, BATCH), nowMs);
  if (later.length) {
    try {
      const r2 = await env.ENVOI.get(env.ENVOI.idFromName("alertes")).fetch("https://envoi/", { method: "POST", body: JSON.stringify(later) });
      if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
    } catch (e) { console.error(`alertes : ${later.length} envois perdus (objet Envoi : ${e.message})`); }
  }
  etat.g = { ...(etat.g || {}), [game.id]: next };
  const ids = Object.keys(etat.g).sort();
  for (const id of ids.slice(0, Math.max(0, ids.length - KEEP_GAMES))) delete etat.g[id];
  await env.ALERTES.put("etat", JSON.stringify(etat)); // seule écriture de la minuterie : quand il y a du nouveau
  return { game: game.id, events: events.length, ...r, queued: later.length };
}

// Envoie un lot [{ s: abonné, ev: événement }] (au plus BATCH). Retire du KV les abonnements expirés (404 ou 410).
// Utilisé par la minuterie (premier lot) et par l'objet « Envoi » (la suite).
export async function sendBatch(env, items, nowMs = Date.now()) {
  const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
  const auths = new Map(); // un jeton VAPID par service de push (même « aud »), calculé une fois
  for (const { s } of items) {
    const o = new URL(s.endpoint).origin;
    if (!auths.has(o)) auths.set(o, await vapidAuth(s.endpoint, vapid, Math.floor(nowMs / 1000)));
  }
  const dead = new Set();
  let sent = 0, failed = 0;
  await Promise.all(items.map(async ({ s, ev }) => {
    const origin = new URL(s.endpoint).origin;
    try {
      const st = await sendPush(s, ev.payload, vapid, { ttl: ev.ttl, topic: ev.payload.tag, auth: auths.get(origin) });
      if (st === 404 || st === 410) dead.add(s.key);
      else if (st >= 200 && st < 300) sent++;
      else { failed++; console.error(`push ${origin} : HTTP ${st}`); }
    } catch (e) { failed++; console.error(`push ${origin} : ${e.message}`); }
  }));
  await Promise.all([...dead].map((k) => env.ALERTES.delete(k)));
  return { sent, failed, removed: dead.size };
}
