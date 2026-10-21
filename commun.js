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
  const ALERTES = `<p><a class="more" href="alertes.html">Alertes de match ›</a></p>`; // lien du pied de page (alertes.html)

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
      ${ALERTES}${UNOFFICIAL}`;
  }

  // Dernier but du match, tiré du sommaire de « landing » (texte brut, à échapper avant affichage).
  // Aucune donnée trompeuse : le sommaire doit compter autant de buts que le pointage. S'il en compte moins
  // (la LNH publie le pointage avant le détail), on retourne { pending: true } plutôt que d'afficher le but
  // précédent comme le dernier. Retourne null s'il n'y a aucun but ou si les données ne concordent pas.
  // Le temps est celui écoulé dans la période (« à 11:45 de la 2e période »), pas le temps qui reste au cadran.
  const STRENGTH_TXT = { pp: "en avantage numérique", sh: "en désavantage numérique" };
  const MODIFIER_TXT = { "empty-net": "dans un filet désert", "penalty-shot": "sur un tir de pénalité" };
  function periodText(pd) {
    const n = Number(pd?.number);
    if (!Number.isInteger(n) || n < 1) return "";
    if (pd.periodType === "OT") { const k = n - (pd.maxRegulationPeriods || 3); return k > 1 ? `${k}e prolongation` : "prolongation"; }
    return n === 1 ? "1re période" : `${n}e période`;
  }
  function lastGoal(L) {
    const sc = L?.summary?.scoring;
    const a = L?.awayTeam?.score, h = L?.homeTeam?.score;
    if (!Array.isArray(sc) || !fin(a) || !fin(h)) return null;
    const goals = sc.flatMap((p) => (Array.isArray(p.goals) ? p.goals : []).map((g) => ({ g, pd: p.periodDescriptor })));
    // Après des tirs de barrage, le gagnant reçoit un but de plus au pointage, absent du sommaire.
    const so = (L.periodDescriptor?.periodType === "SO" || L.gameOutcome?.lastPeriodType === "SO") && a !== h ? 1 : 0;
    const expected = a + h - so;
    if (goals.length < expected) return { pending: true };
    if (goals.length !== expected || !goals.length) return null;
    const { g, pd } = goals[goals.length - 1];
    const name = loc(g.lastName) || loc(g.name), per = periodText(pd);
    if (!name || !per) return null;
    const abbr = loc(g.teamAbbrev);
    const team = [L.awayTeam, L.homeTeam].find((t) => t?.abbrev === abbr);
    const parts = [`But de ${name}${fin(g.goalsToDate) ? ` (${g.goalsToDate})` : ""}`];
    if (abbr !== MTL) parts.push(loc(team?.commonName) || abbr || "adversaire");
    const how = MODIFIER_TXT[g.goalModifier] || STRENGTH_TXT[g.strength];
    if (how) parts.push(how);
    const t = /^\d{1,2}:\d{2}$/.test(g.timeInPeriod || "") ? g.timeInPeriod.replace(/^0(?=\d:)/, "") : "";
    parts.push(t ? `à ${t} de la ${per}` : `en ${per}`);
    return { key: `${g.eventId ?? goals.length}|${a}-${h}`, text: parts.join(", ") };
  }

  // Assemble les sections d'une page : une section qui plante affiche une erreur, les autres s'affichent quand même.
  const sections = (parts, box = errBox) => parts.map((fn) => {
    try { return fn(); } catch (e) { console.error(e); return `<div class="blk">${box("Section", "erreur d’affichage")}</div>`; }
  }).join("");

  return { TZ, MTL, LIVE, DONE, esc, loc, fin, cap, num, F, fStamp, pct, gaa, signed, season, age, tvOf,
    WORKER, POLL_MS, WORDMARK, UNOFFICIAL, ALERTES, errBox, getJson, load, footer, sections, lastGoal };
})();
