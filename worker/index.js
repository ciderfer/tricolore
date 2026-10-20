// Tricolore — mini proxy CORS vers l'API publique de la LNH (api-web.nhle.com).
// Seulement des requêtes GET, seulement les chemins du Canadien listés ci-dessous,
// seulement pour le site (et localhost en développement). Aucun secret.
// Feuilles de match (gamecenter) : seulement les matchs où joue le Canadien, vérifié avec
// la page « landing » du match. Cache : 5 s en direct, plus long pour un match terminé.
// Minuterie (scheduled, voir wrangler.toml) : aux 15 minutes, lance la tâche « Données LNH »
// sur GitHub (workflow_dispatch), parce que l'horaire de GitHub Actions saute la plupart
// des exécutions. Seul secret : GH_TOKEN, un jeton limité à ce repo (Actions : écriture).
// Limiteur de débit (liaison LIMITE, voir wrangler.toml) : au plus 300 requêtes par minute par adresse IP,
// pour qu'une boucle (l'en-tête Origin se falsifie) n'épuise pas le quota quotidien. Limite généreuse :
// au Centre Bell, beaucoup de partisans partagent l'adresse IP de leur opérateur.

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

export default {
  async scheduled(_event, env) {
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
  },

  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const okOrigin = ALLOWED_ORIGIN.test(origin) ? origin : null;
    if (!okOrigin) return reply(403, { error: "origine non permise" }, null);
    if (request.method !== "GET") return reply(405, { error: "GET seulement" }, okOrigin, { allow: "GET" });
    if (env.LIMITE) {
      const { success } = await env.LIMITE.limit({ key: request.headers.get("cf-connecting-ip") || "inconnue" });
      if (!success) return reply(429, { error: "trop de requêtes, réessayez dans une minute" }, okOrigin, { "retry-after": "60", "cache-control": "no-store" });
    }

    const { pathname } = new URL(request.url);
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
