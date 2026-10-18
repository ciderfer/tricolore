// Tricolore — mini proxy CORS vers l'API publique de la LNH (api-web.nhle.com).
// Seulement des requêtes GET, seulement les chemins du Canadien listés ci-dessous,
// seulement pour le site (et localhost en développement). Aucun secret.

const UPSTREAM = "https://api-web.nhle.com";

// [motif du chemin, durée de cache en secondes]
const ROUTES = [
  [/^\/v1\/scoreboard\/MTL\/now$/, 5],
  [/^\/v1\/score\/now$/, 5],
  [/^\/v1\/gamecenter\/\d{10}\/(landing|boxscore)$/, 5],
  [/^\/v1\/club-schedule-season\/MTL\/now$/, 60],
  [/^\/v1\/standings\/now$/, 60],
];

const ALLOWED_ORIGIN = /^(https:\/\/ciderfer\.github\.io|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/;

// Petit cache en mémoire (par instance du Worker) : fonctionne aussi sur workers.dev.
const memo = new Map();

function reply(status, body, origin, extra = {}) {
  const headers = { "content-type": "application/json; charset=utf-8", vary: "Origin", "access-control-expose-headers": "x-tricolore-fetched-at, x-tricolore-cache", ...extra };
  if (origin) headers["access-control-allow-origin"] = origin;
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const okOrigin = ALLOWED_ORIGIN.test(origin) ? origin : null;
    if (!okOrigin) return reply(403, { error: "origine non permise" }, null);
    if (request.method !== "GET") return reply(405, { error: "GET seulement" }, okOrigin, { allow: "GET" });

    const { pathname } = new URL(request.url);
    const route = ROUTES.find(([re]) => re.test(pathname));
    if (!route) return reply(404, { error: "chemin non permis" }, okOrigin);
    const ttl = route[1];

    const now = Date.now();
    const hit = memo.get(pathname);
    if (hit && now - hit.at < ttl * 1000) {
      return reply(200, hit.body, okOrigin, {
        "cache-control": `public, max-age=${ttl}`, "x-tricolore-cache": "HIT",
        "x-tricolore-fetched-at": new Date(hit.at).toISOString(),
      });
    }
    try {
      const up = await fetch(UPSTREAM + pathname, {
        redirect: "follow",
        headers: { "user-agent": "tricolore (site de partisan; github.com/ciderfer/tricolore)" },
      });
      if (!up.ok) return reply(502, { error: `LNH : HTTP ${up.status}` }, okOrigin, { "cache-control": "no-store" });
      const body = await up.text();
      memo.set(pathname, { at: now, body });
      if (memo.size > 50) memo.delete(memo.keys().next().value);
      return reply(200, body, okOrigin, {
        "cache-control": `public, max-age=${ttl}`, "x-tricolore-cache": "MISS",
        "x-tricolore-fetched-at": new Date(now).toISOString(),
      });
    } catch (err) {
      return reply(502, { error: "LNH injoignable" }, okOrigin, { "cache-control": "no-store" });
    }
  },
};
