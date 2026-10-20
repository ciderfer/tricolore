// Tricolore — fonctions communes à toutes les pages. Chargé avant le script de chaque page
// (balises <script defer> dans l'ordre). Règle d'or : aucune donnée inventée.
window.T = (() => {
  "use strict";
  const TZ = "America/Toronto";
  const MTL = "MTL";
  const LIVE = new Set(["LIVE", "CRIT"]);
  const DONE = new Set(["OFF", "FINAL"]);

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const loc = (o) => (o ? o.fr || o.default : "");
  const fin = (n) => typeof n === "number" && Number.isFinite(n);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const num = (v) => (fin(v) ? String(v) : "—"); // nombre de l'API, ou tiret s'il manque (jamais de texte brut dans le HTML)

  // Dates et heures : toujours à l'heure de l'Est.
  const F = (o) => new Intl.DateTimeFormat("fr-CA", { timeZone: TZ, ...o });
  const fStamp = F({ dateStyle: "long", timeStyle: "short" });
  const fPct = new Intl.NumberFormat("fr-CA", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const fGaa = new Intl.NumberFormat("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v) => (fin(v) ? fPct.format(v).replace(/^0(?=,)/, "") : "—"); // ,912
  const gaa = (v) => (fin(v) ? fGaa.format(v) : "—");
  const signed = (v) => (!fin(v) ? "—" : v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");
  const season = (id) => (/^\d{8}$/.test(String(id ?? "")) ? `Saison ${String(id).slice(0, 4)}-${String(id).slice(4)}` : "");

  // Âge à la date d'aujourd'hui (heure de l'Est), à partir de la date de naissance AAAA-MM-JJ.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  function age(birth) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth || "")) return null;
    const [y, m, d] = birth.split("-").map(Number), [ty, tm, td] = today.split("-").map(Number);
    return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  }

  // Chaînes canadiennes, réseaux francophones (RDS, TVA) d'abord.
  const tvOf = (g) => [...new Set((g.tvBroadcasts || []).filter((b) => b.countryCode === "CA").map((b) => b.network))]
    .sort((a, b) => (/RDS|TVA/.test(b) ? 1 : 0) - (/RDS|TVA/.test(a) ? 1 : 0));

  // Proxy Cloudflare (worker/) pour les données en direct. En local, ?worker=http://localhost:8787 permet de tester.
  const WORKER = (() => {
    const q = new URLSearchParams(location.search).get("worker");
    return q && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(q) ? q : "https://tricolore.tricolore.workers.dev";
  })();
  const POLL_MS = 15_000;

  const WORDMARK = "Tri<i></i>co<i></i>lore";
  const UNOFFICIAL = "<p>Site de partisan non officiel, non affilié à la LNH ni au Club de hockey Canadien.</p>";

  // lnh : la source est un fichier du site tiré de l'API LNH (sinon : le relais en direct ou une fiche).
  const errBox = (what, detail, lnh = true) =>
    `<div class="err">${esc(what)} : source ${lnh ? "LNH " : ""}indisponible${detail ? ` (${esc(detail)})` : ""}. Aucune donnée affichée plutôt qu’une donnée inexacte.</div>`;

  async function getJson(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  // Lit data/meta.json et data/<nom>.json en même temps (un seul aller-retour réseau), puis meta.json décide :
  // une source marquée en échec est écartée même si son ancien fichier a été reçu (pas de données périmées).
  async function load(names) {
    const out = { errors: {}, meta: null };
    const why = (r) => r.reason?.message || "échec";
    const [meta, ...rest] = await Promise.allSettled(["meta", ...names].map((n) => getJson(`data/${n}.json`)));
    if (meta.status === "fulfilled") out.meta = meta.value; else out.errors.meta = why(meta);
    names.forEach((n, i) => {
      const s = out.meta?.sources?.[n];
      if (s && s.ok === false) { out.errors[n] = s.error || "échec"; out[n] = null; return; }
      if (rest[i].status === "fulfilled") out[n] = rest[i].value;
      else { out[n] = null; out.errors[n] = why(rest[i]); }
    });
    return out;
  }

  // Pied de page des pages qui lisent data/ : heures de modification et de vérification, sources en échec.
  function footer(meta, metaErr, failed = []) {
    const when = meta?.updatedAt ? fStamp.format(new Date(meta.updatedAt)) : null;
    const checked = meta?.checkedAt ? fStamp.format(new Date(meta.checkedAt)) : null;
    return `<p>Données : API publique de la LNH${when ? ` · dernière modification le ${esc(when)}` : ""}${checked ? `, vérifiées le ${esc(checked)}` : ""}${when || checked ? " (heure de l’Est)" : ""}.</p>
      ${metaErr ? `<p class="foot-warn">Heure de mise à jour inconnue (meta.json : ${esc(metaErr)}).</p>` : ""}
      ${failed.length ? `<p class="foot-warn">Source en échec : ${esc(failed.join(", "))}.</p>` : ""}
      ${UNOFFICIAL}`;
  }

  // Assemble les sections d'une page : une section qui plante affiche une erreur, les autres s'affichent quand même.
  const sections = (parts, box = errBox) => parts.map((fn) => {
    try { return fn(); } catch (e) { console.error(e); return `<div class="blk">${box("Section", "erreur d’affichage")}</div>`; }
  }).join("");

  return { TZ, MTL, LIVE, DONE, esc, loc, fin, cap, num, F, fStamp, pct, gaa, signed, season, age, tvOf,
    WORKER, POLL_MS, WORDMARK, UNOFFICIAL, errBox, getJson, load, footer, sections };
})();
