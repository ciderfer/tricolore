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

  // Jour du match dit simplement, selon le calendrier de Montréal : « Ce soir », « Cet après-midi », « Aujourd’hui »,
  // « Demain », le jour de la semaine (moins d'une semaine), sinon rien (la date suffit).
  const fYmd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }), fHour = F({ hour: "numeric", hourCycle: "h23" }), fWeekday = F({ weekday: "long" });
  function dayLabel(start, now = new Date()) {
    const days = Math.round((Date.parse(fYmd.format(start)) - Date.parse(fYmd.format(now))) / 86_400_000);
    if (days === 0) { const h = Number(fHour.format(start).replace(/\D/g, "")); return h >= 17 ? "Ce soir" : h >= 12 ? "Cet après-midi" : "Aujourd’hui"; }
    if (days === 1) return "Demain";
    return days > 1 && days < 7 ? cap(fWeekday.format(start)) : "";
  }

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

  // Résultat d'un match fini, pour le CH : V, D ou DP (défaite en prolongation ou en tirs de barrage).
  function outcome(g) {
    const home = g.homeTeam.abbrev === MTL, us = home ? g.homeTeam : g.awayTeam, them = home ? g.awayTeam : g.homeTeam;
    const x = g.gameOutcome?.lastPeriodType, win = us.score > them.score;
    const extra = x === "OT" ? "Prol." : x === "SO" ? "TB" : "";
    const label = `${win ? "Victoire" : "Défaite"}${x === "OT" ? " en prolongation" : x === "SO" ? " en tirs de barrage" : ""}`;
    return { code: win ? "V" : extra ? "DP" : "D", extra, label };
  }

  // Proxy Cloudflare (worker/) pour les données en direct. En local, ?worker=http://localhost:8787 permet de tester.
  const WORKER = (() => {
    const q = new URLSearchParams(location.search).get("worker");
    return q && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(q) ? q : "https://tricolore.tricolore.workers.dev";
  })();
  const POLL_MS = 15_000;

  // Pointage poussé par le relais (WebSocket, voir worker/direct.js) : une connexion par page, au lieu d'une requête
  // aux 15 s (le quota gratuit du relais compte les requêtes). onMsg reçoit {part, at, body} ou {part, error}.
  // Reconnexion si la connexion tombe ou se tait plus de 90 s (iPhone en veille). Trois échecs de suite sans
  // aucun message : onFail, et la page revient aux lectures aux 15 s. Fermée par le relais à la fin du match.
  function liveSocket(id, all, onMsg, onFail) {
    const url = `${WORKER.replace(/^http/, "ws")}/direct/${encodeURIComponent(id)}${all ? "?parts=all" : ""}`;
    let ws = null, fails = 0, over = false, retry = null, lastMsg = 0;
    const drop = () => { const w = ws; ws = null; try { w?.close(); } catch { /* déjà fermée */ } };
    function open() {
      clearTimeout(retry); retry = null;
      if (over || ws) return;
      const w = ws = new WebSocket(url);
      let got = false;
      lastMsg = Date.now();
      w.onmessage = (e) => {
        if (ws !== w) return;
        got = true; fails = 0; lastMsg = Date.now();
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m && typeof m.part === "string") onMsg(m);
      };
      w.onclose = (e) => {
        if (ws !== w) return; // fermée par nous (reconnexion)
        ws = null;
        if (over || e.code === 1000 || e.code === 4404) { over = true; return; }
        if (!got && ++fails >= 3) { over = true; onFail(); return; }
        retry = setTimeout(open, Math.min(2000 * 2 ** fails, 30_000));
      };
    }
    // Au retour sur l'onglet : connexion morte ou muette depuis plus de 90 s, on la refait.
    const check = () => { if (!over && !document.hidden && (!ws || Date.now() - lastMsg > 90_000)) { drop(); open(); } };
    document.addEventListener("visibilitychange", check);
    const watch = setInterval(check, 30_000);
    open();
    return { stop() { over = true; clearInterval(watch); clearTimeout(retry); drop(); } };
  }

  const WORDMARK = "Tri<i></i>co<i></i>lore";
  const UNOFFICIAL = "<p>Site de partisan non officiel, non affilié à la LNH ni au Club de hockey Canadien.</p>";
  const ALERTES = `<p><a class="more" href="alertes.html">Alertes de match ›</a></p>`; // lien du pied de page (alertes.html)

  // Message d'erreur pour le partisan : ce qui manque, sans jargon. La cause technique (ex. « HTTP 503 ») reste dans
  // data-detail, pour qui inspecte la page.
  const errBox = (what, detail) =>
    `<div class="err"${detail ? ` data-detail="${esc(detail)}"` : ""}>${esc(what)} : indisponible pour le moment. Aucune donnée affichée plutôt qu’une donnée inexacte.</div>`;

  async function getJson(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  // ---- Alertes de match (Web Push) : abonnement partagé par l'accueil (app.js) et la page Alertes (alertes.js) ----
  // Ce que l'appareil permet. iPhone et iPad : les alertes marchent seulement depuis l'icône de l'écran d'accueil (iOS 16.4+).
  function pushDevice(nav = navigator, win = window) {
    const ua = nav.userAgent || "";
    const iOS = /iPhone|iPad|iPod/.test(ua) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
    return {
      iOS,
      safari: /Version\/[\d.]+.*Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\//.test(ua),
      standalone: !!win.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true,
      push: "serviceWorker" in nav && "PushManager" in win && "Notification" in win,
      denied: win.Notification?.permission === "denied",
    };
  }
  // Carte de l'accueil : "installer" (iPhone ou iPad dans Safari, hors de l'écran d'accueil), "activer" (push possible,
  // pas abonné) ou "" (pas de carte : masquée sur cet appareil, déjà abonné, notifications refusées, ou push impossible).
  function alertCard(dev, subscribed, hidden = false) {
    if (hidden) return "";
    if (dev.iOS && !dev.standalone) return dev.safari ? "installer" : "";
    return dev.push && !dev.denied && !subscribed ? "activer" : "";
  }

  const PUSH_STORE = "tricolore.alertes"; // choix enregistrés sur cet appareil (le Worker garde les mêmes)
  // Carte « Alertes de match » masquée sur cet appareil (le lien du pied de page reste).
  const CARD_STORE = "tricolore.carte-alertes";
  function cardHidden() { try { return localStorage.getItem(CARD_STORE) === "masquee"; } catch { return false; } }
  function hideCard() { try { localStorage.setItem(CARD_STORE, "masquee"); } catch { /* stockage indisponible : masquée pour cette visite */ } }
  function pushPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PUSH_STORE) || "null");
      if (p && typeof p === "object") return { debut: p.debut !== false, buts: p.buts !== false, final: p.final !== false };
    } catch { /* stockage indisponible : choix par défaut */ }
    return { debut: true, buts: true, final: true };
  }
  function savePushPrefs(p) { try { localStorage.setItem(PUSH_STORE, JSON.stringify(p)); } catch { /* rien */ } }

  async function pushPost(path, body) {
    const r = await fetch(WORKER + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    let j = null;
    try { j = await r.json(); } catch { /* corps illisible */ }
    if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
    return j;
  }
  async function pushKey() {
    let key;
    try { key = (await getJson(`${WORKER}/push/vapid-public-key`)).key; } catch (e) { throw new Error(`relais Tricolore : ${e.message}`); }
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{80,100}$/.test(key)) throw new Error("clé du relais invalide");
    return key;
  }
  const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  // À appeler dans le geste de l'utilisateur : Safari exige que subscribe() (qui demande aussi la permission) parte tout de suite.
  // Si le relais refuse, l'abonnement du navigateur est retiré (pas d'abonnement que le Worker ne connaît pas).
  function pushSubscribe(reg, key, prefs) {
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) }).then(async (sub) => {
      try { await pushPost("/push/subscribe", { subscription: sub.toJSON(), prefs }); } catch (e) { await sub.unsubscribe().catch(() => {}); throw e; }
      savePushPrefs(prefs);
      return sub;
    });
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
      ${metaErr ? `<p class="foot-warn" data-detail="${esc(metaErr)}">Heure de mise à jour inconnue.</p>` : ""}
      ${failed.length ? `<p class="foot-warn">Indisponible pour le moment : ${esc(failed.join(", "))}.</p>` : ""}
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

  return { TZ, MTL, LIVE, DONE, esc, loc, fin, cap, num, F, fStamp, pct, gaa, signed, season, dayLabel, age, tvOf, outcome,
    WORKER, POLL_MS, liveSocket, WORDMARK, UNOFFICIAL, ALERTES, errBox, getJson, load, footer, sections, lastGoal,
    pushDevice, alertCard, cardHidden, hideCard, pushPrefs, savePushPrefs, pushPost, pushKey, pushSubscribe };
})();
