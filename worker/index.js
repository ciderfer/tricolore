// Tricolore — mini proxy CORS vers l'API publique de la LNH (api-web.nhle.com).
// Seulement des requêtes GET, seulement les chemins du Canadien listés ci-dessous,
// seulement pour le site (et localhost en développement). Aucun secret.
// Feuilles de match (gamecenter) : seulement les matchs où joue le Canadien, vérifié avec
// la page « landing » du match. Cache : 5 s en direct, plus long pour un match terminé.
// Minuterie (scheduled, voir wrangler.toml) : chaque minute; aux 15 minutes (minute % 15 === 0), lance la tâche
// « Données LNH » sur GitHub (workflow_dispatch), parce que l'horaire de GitHub Actions saute la plupart
// des exécutions. Secret : GH_TOKEN, un jeton limité à ce repo (Actions : écriture).
// Limiteur de débit (liaison LIMITE, voir wrangler.toml) : au plus 300 requêtes par minute par adresse IP,
// pour qu'une boucle (l'en-tête Origin se falsifie) n'épuise pas le quota quotidien. Limite généreuse :
// au Centre Bell, beaucoup de partisans partagent l'adresse IP de leur opérateur.
// Alertes de match (Web Push, voir alertes.js et push.js) : POST /push/subscribe, POST /push/unsubscribe et
// GET /push/vapid-public-key, mêmes règles (origine permise, limiteur). Minuterie chaque minute : regarde l'état
// du match du Canadien (une lecture LNH, plus la feuille du match quand il est en cours) et envoie les alertes.
// Secrets des alertes : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:). Liaison KV : ALERTES.
import { runAlertes, subscribe, unsubscribe } from "./alertes.js";

const UPSTREAM = "https://api-web.nhle.com";

// [motif du chemin, durée de cache en secondes, ou "game" = selon l'état du match]
const ROUTES = [
  [/^\/v1\/scoreboard\/MTL\/now$/, 5],
  [/^\/v1\/score\/now$/, 5],
  [/^\/v1\/gamecenter\/\d{10}\/(landing|boxscore|right-rail)$/, "game"],
  [/^\/v1\/club-schedule-season\/MTL\/now$/, 60],
  [/^\/v1\/standings\/now$/, 60],
];

// Cache d'une feuille de match selon l'état : en direct 5 s, terminé (OFF, officiel) 1 h.
const GAME_TTL = { LIVE: 5, CRIT: 5, PRE: 30, FUT: 300, FINAL: 120, OFF: 3600 };

const ALLOWED_ORIGIN = /^(https:\/\/ciderfer\.github\.io|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/;

// Petit cache en mémoire (par instance du Worker) : fonctionne aussi sur workers.dev.
const memo = new Map();

function reply(status, body, origin, extra = {}) {
  const headers = { "content-type": "application/json; charset=utf-8", vary: "Origin", "access-control-expose-headers": "x-tricolore-fetched-at, x-tricolore-cache", ...extra };
  if (origin) headers["access-control-allow-origin"] = origin;
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

// Lit un chemin de l'API, ou le cache. ttl : nombre fixe, ou "game" (selon l'état du match).
async function getUpstream(path, ttl, now, fallbackTtl = 5) {
  const hit = memo.get(path);
  if (hit && now - hit.at < hit.ttl * 1000) return { ...hit, cache: "HIT" };
  let up;
  try {
    up = await fetch(UPSTREAM + path, {
      redirect: "follow",
      headers: { "user-agent": "tricolore (site de partisan; github.com/ciderfer/tricolore)" },
    });
  } catch { return { error: "LNH injoignable" }; }
  if (!up.ok) return { error: `LNH : HTTP ${up.status}` };
  const body = await up.text();
  const entry = { at: now, body, ttl: typeof ttl === "number" ? ttl : 5 };
  if (ttl === "game") {
    let j;
    try { j = JSON.parse(body); } catch { return { error: "réponse LNH illisible" }; }
    entry.ttl = GAME_TTL[j.gameState] ?? fallbackTtl; // right-rail n'a pas d'état : celui de « landing »
    if (j.awayTeam && j.homeTeam) entry.mtl = j.awayTeam.abbrev === "MTL" || j.homeTeam.abbrev === "MTL";
  }
  memo.set(path, entry);
  if (memo.size > 60) memo.delete(memo.keys().next().value);
  return { ...entry, cache: "MISS" };
}

const DISPATCH = "https://api.github.com/repos/ciderfer/tricolore/actions/workflows/data.yml/dispatches";

// Lance la tâche « Données LNH » sur GitHub. Toute réponse autre que 204 est une erreur.
export async function dispatchData(env) {
  if (!env.GH_TOKEN) throw new Error("GH_TOKEN manquant : tâche de données non lancée");
  const r = await fetch(DISPATCH, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GH_TOKEN}`, accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28", "user-agent": "tricolore-worker",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (r.status !== 204) throw new Error(`GitHub : HTTP ${r.status} ${await r.text()}`);
}

// Routes /push/* (le limiteur et l'origine sont déjà vérifiés). Corps JSON de 4 Ko au plus.
async function push(request, env, pathname, origin) {
  const nostore = { "cache-control": "no-store" };
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST",
      "access-control-allow-headers": "content-type", "access-control-max-age": "86400", vary: "Origin" } });
  }
  const want = pathname === "/push/vapid-public-key" ? "GET" : "POST";
  if (!["/push/vapid-public-key", "/push/subscribe", "/push/unsubscribe"].includes(pathname)) return reply(404, { error: "chemin non permis" }, origin);
  if (request.method !== want) return reply(405, { error: `${want} seulement` }, origin, { allow: want });
  if (!env.ALERTES || !env.VAPID_PUBLIC_KEY) return reply(503, { error: "alertes pas encore configurées" }, origin, nostore);
  if (want === "GET") return reply(200, { key: env.VAPID_PUBLIC_KEY }, origin, { "cache-control": "public, max-age=3600" });
  const text = await request.text();
  if (text.length > 4096) return reply(413, { error: "requête trop grosse" }, origin, nostore);
  let body;
  try { body = JSON.parse(text); } catch { return reply(400, { error: "JSON invalide" }, origin, nostore); }
  const r = pathname === "/push/subscribe" ? await subscribe(env, body) : await unsubscribe(env, body);
  return reply(r.status, r.body, origin, nostore);
}

export default {
  // Minuterie chaque minute (wrangler.toml) : aux 15 minutes (0, 15, 30, 45), la tâche de données comme avant;
  // chaque minute, les alertes. Une tâche en échec n'empêche pas l'autre; l'erreur est relancée ensuite.
  async scheduled(event, env) {
    const t = event?.scheduledTime ?? Date.now();
    const tasks = [runAlertes(env, t).then((r) => { if (r.events || r.failed || r.removed) console.log("alertes", JSON.stringify(r)); })];
    if (new Date(t).getUTCMinutes() % 15 === 0) tasks.unshift(dispatchData(env));
    const errs = (await Promise.allSettled(tasks)).filter((r) => r.status === "rejected").map((r) => r.reason);
    if (errs.length === 1) throw errs[0];
    if (errs.length) throw new AggregateError(errs, errs.map((e) => e?.message).join(" · "));
  },

  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const okOrigin = ALLOWED_ORIGIN.test(origin) ? origin : null;
    if (!okOrigin) return reply(403, { error: "origine non permise" }, null);
    const { pathname } = new URL(request.url);
    const isPush = pathname.startsWith("/push/");
    if (!isPush && request.method !== "GET") return reply(405, { error: "GET seulement" }, okOrigin, { allow: "GET" });
    if (env.LIMITE) {
      const { success } = await env.LIMITE.limit({ key: request.headers.get("cf-connecting-ip") || "inconnue" });
      if (!success) return reply(429, { error: "trop de requêtes, réessayez dans une minute" }, okOrigin, { "retry-after": "60", "cache-control": "no-store" });
    }
    if (isPush) return push(request, env, pathname, okOrigin);

    const route = ROUTES.find(([re]) => re.test(pathname));
    if (!route) return reply(404, { error: "chemin non permis" }, okOrigin);
    const now = Date.now();
    const fail = (error) => reply(502, { error }, okOrigin, { "cache-control": "no-store" });
    const notMtl = () => reply(404, { error: "match du Canadien seulement" }, okOrigin);

    let landingTtl = 5;
    if (route[1] === "game") {
      // Le match doit opposer le Canadien : on vérifie avec « landing » (mise en cache aussi).
      const id = pathname.split("/")[3];
      const landing = await getUpstream(`/v1/gamecenter/${id}/landing`, "game", now);
      if (landing.error) return fail(landing.error);
      if (!landing.mtl) return notMtl();
      landingTtl = landing.ttl;
    }
    const res = await getUpstream(pathname, route[1], now, landingTtl);
    if (res.error) return fail(res.error);
    return reply(200, res.body, okOrigin, {
      "cache-control": `public, max-age=${res.ttl}`, "x-tricolore-cache": res.cache,
      "x-tricolore-fetched-at": new Date(res.at).toISOString(),
    });
  },
};
