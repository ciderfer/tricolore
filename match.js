// Tricolore — feuille de match (match.html?id=AAAATTNNNN).
// Données : pages « landing », « boxscore » et « right-rail » du match, via le Worker Cloudflare
// (worker/). En direct, tant que l'onglet est visible : « landing » (pointage, buts, pénalités) aux 15 s,
// « boxscore » et « right-rail » (gardiens, tirs, statistiques) chaque minute, pour ménager le quota
// du relais; la page l'indique. À la fin du match, tout est relu une dernière fois.
// Si le Worker échoue, on affiche le pointage du calendrier du site (data/schedule.json) s'il existe,
// avec un message clair. Règle d'or : aucune donnée inventée.
(function () {
  "use strict";
  const { MTL, LIVE, DONE, esc, loc, fin, cap, F, pct, WORKER, POLL_MS, WORDMARK, UNOFFICIAL } = T;
  const fDate = F({ weekday: "long", day: "numeric", month: "long" });
  const fH = F({ hour: "numeric", hourCycle: "h23" }), fM = F({ minute: "2-digit" });
  const hm = (d) => `${fH.format(d).replace(/\D/g, "")} h ${fM.format(d).padStart(2, "0")}`;
  const SLOW_MS = 60_000; // gardiens, tirs et statistiques : chaque minute pendant le match
  const ID = new URLSearchParams(location.search).get("id") || "";

  const errBox = (what, detail) => T.errBox(what, detail, false);
  // Lien retour : en mode app (écran d'accueil), il n'y a pas de bouton retour de Safari.
  // Si on arrive d'une page du site, on y revient (history.back garde la position dans la page);
  // sinon (lien partagé, favori), on va au calendrier.
  const BACK = (() => {
    try {
      const r = new URL(document.referrer);
      if (r.origin === location.origin && !/\/match\.html$/.test(r.pathname)) return { href: r.href, label: "‹ Retour", history: true };
    } catch { /* pas de page précédente */ }
    return { href: "calendrier.html", label: "‹ Calendrier", history: false };
  })();
  document.addEventListener("click", (e) => {
    if (BACK.history && history.length > 1 && e.target.closest?.("a.back")) { e.preventDefault(); history.back(); }
  });
  const top = () => `<div class="top"><h1 class="wordmark" aria-label="Tricolore · Feuille de match">${WORDMARK}</h1><div class="lbl"><a class="back" href="${esc(BACK.href)}">${BACK.label}</a></div></div>`;

  async function viaWorker(part) {
    const r = await fetch(`${WORKER}/v1/gamecenter/${ID}/${part}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    let body = null;
    try { body = await r.json(); } catch { /* corps illisible */ }
    if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
    if (!body || String(body.id ?? ID) !== ID && part !== "right-rail") throw new Error("réponse inattendue");
    return { body, at: r.headers.get("x-tricolore-fetched-at") };
  }
  async function part(p) {
    try { return await viaWorker(p); }
    catch (e) { return { err: e.name === "TimeoutError" ? "délai dépassé" : e.message }; }
  }
  // Dernière lecture de boxscore et right-rail. Une lecture en échec efface l'ancienne (pas de données périmées).
  const slow = { boxscore: null, "right-rail": null, errors: {}, at: 0, when: null };
  async function readSlow() {
    const res = await Promise.all(["boxscore", "right-rail"].map(part));
    slow.at = Date.now();
    slow.when = new Date(Date.parse(res[0].at || res[1].at || "") || slow.at);
    ["boxscore", "right-rail"].forEach((k, i) => { slow[k] = res[i].body || null; slow.errors[k] = res[i].err; });
  }
  async function loadAll(first) {
    const due = first || Date.now() - slow.at >= SLOW_MS;
    const [l] = await Promise.all([part("landing"), due ? readSlow() : null]);
    // Pas en direct (fin du match, entre autres) : tout relire tout de suite, pour un affichage final complet.
    if (!due && l.body && !LIVE.has(l.body.gameState)) await readSlow();
    return { landing: l.body || null, at: l.at, boxscore: slow.boxscore, "right-rail": slow["right-rail"],
      errors: { landing: l.err, ...slow.errors }, slowWhen: slow.when };
  }
  // Note sous les sections lues chaque minute, pendant le match seulement.
  const slowNote = (L, when) => LIVE.has(L.gameState)
    ? `<p class="asof slow-note">Mis à jour chaque minute pendant le match${when ? ` (dernière lecture à ${esc(hm(when))})` : ""}.</p>` : "";
  async function staticGame() {
    try {
      const r = await fetch("data/schedule.json", { cache: "no-cache" });
      if (!r.ok) return null;
      return (await r.json()).games.find((g) => String(g.id) === ID) || null;
    } catch { return null; }
  }

  // Périodes : 1re, 2e, 3e, Prolongation (2e prolongation en séries), Tirs de barrage
  function periodName(pd) {
    if (!pd) return "";
    const reg = pd.maxRegulationPeriods || 3;
    if (pd.periodType === "SO") return "Tirs de barrage";
    if (pd.periodType === "OT") { const k = pd.number - reg; return k > 1 ? `<span class="ord">${k}<span class="lc">e</span></span> prolongation` : "Prolongation"; }
    return `<span class="ord">${pd.number}<span class="lc">${pd.number === 1 ? "re" : "e"}</span></span> période`;
  }
  const teamName = (t) => loc(t.commonName) || t.abbrev;
  const STRENGTH = { pp: ["AN", "Avantage numérique"], sh: ["DN", "Désavantage numérique"] };
  const PEN = {
    slashing: "cinglage", interference: "obstruction", holding: "retenue", hooking: "accrocher", elbowing: "coup de coude",
    tripping: "faire trébucher", "high-sticking": "bâton élevé", "high-sticking-double-minor": "bâton élevé (double mineure)",
    roughing: "rudesse", "cross-checking": "double-échec", boarding: "mise en échec contre la bande", fighting: "bagarre",
    "too-many-men-on-the-ice": "trop de joueurs sur la glace", "delay-of-game": "retarder le match", "delay-of-game-puck-over-glass": "retarder le match (rondelle hors de la patinoire)",
    "unsportsmanlike-conduct": "conduite antisportive", charging: "charge", "interference-goalkeeper": "obstruction sur le gardien",
    "goalie-interference": "obstruction sur le gardien", "holding-the-stick": "retenir le bâton", embellishment: "plongeon",
    kneeing: "coup de genou", spearing: "darder", misconduct: "inconduite", "game-misconduct": "inconduite de match",
    "match-penalty": "pénalité de match", "butt-ending": "six-pouces", "head-butting": "coup de tête", clipping: "mise en échec à basse hauteur",
    "illegal-check-to-head": "mise en échec illégale à la tête", "closing-hand-on-puck": "refermer la main sur la rondelle",
    "abuse-of-officials": "abus envers les officiels", "instigator": "instigateur", "throwing-equipment": "lancer de l’équipement",
  };
  const penName = (k) => PEN[k] || String(k || "pénalité").replace(/-/g, " ");
  const DECISION = { W: "Victoire", L: "Défaite", O: "Défaite (prol./TB)" };
  const initial = (p) => (p ? `${loc(p.firstName).charAt(0)}. ${loc(p.lastName)}` : "");

  function hero(L, B, at, note) {
    const st = L.gameState, live = LIVE.has(st), done = DONE.has(st);
    const pd = L.periodDescriptor, x = B?.gameOutcome?.lastPeriodType || (done ? pd?.periodType : null);
    const extra = x === "OT" ? " · Prolongation" : x === "SO" ? " · Tirs de barrage" : "";
    const kick = live ? `En direct · ${periodName(pd)}` : done ? `${st === "OFF" ? "Final" : "Final (non officiel)"}${extra}` : "Match à venir";
    const clock = live ? (L.clock?.inIntermission ? `Entracte${L.clock?.timeRemaining ? ` · ${esc(L.clock.timeRemaining)}` : ""}` : L.clock?.timeRemaining ? `${esc(L.clock.timeRemaining)} à jouer` : "") : "";
    const row = (t, side) => `<div class="board-row ${t.abbrev === MTL ? "mtl" : ""}"><div class="name cond">${esc(teamName(t))}<small>${side}${fin(t.sog) ? ` · ${t.sog} tirs` : ""}</small></div>
      <div class="sc num">${fin(t.score) ? t.score : "–"}</div></div>`;
    const dt = new Date(L.startTimeUTC);
    const asOf = at ? hm(new Date(at)) : null;
    const how = live ? `Pointage, buts et pénalités en direct${asOf ? ` en date de ${esc(asOf)}` : ""} (heure de l’Est), mis à jour aux 15 secondes. Tirs, statistiques et gardiens : chaque minute.` : "";
    return `<section class="hero">${top()}
      <div class="lbl kick ${live ? "live-kick" : ""}">${kick}</div>
      <div class="board">${row(L.awayTeam, "Visiteurs")}${row(L.homeTeam, "Locaux")}</div>
      <div class="state">${clock || (done ? "" : hm(dt))}<small>${esc(cap(fDate.format(dt)))} · ${esc(loc(L.venue))}${L.gameType === 3 ? " · Séries" : L.gameType === 1 ? " · Préparatoire" : ""}</small>${how ? `<small>${how}</small>` : ""}${note ? `<small class="warn-note">${esc(note)}</small>` : ""}</div></section>`;
  }

  function goals(L) {
    const h = `<h2 class="h cond">Buts</h2>`;
    const sc = L.summary?.scoring;
    if (!Array.isArray(sc)) return `<section class="blk goals-blk">${h}${errBox("Buts", "sommaire absent")}</section>`;
    if (!sc.some((p) => p.goals?.length) && !DONE.has(L.gameState) && !LIVE.has(L.gameState)) return "";
    const rows = sc.map((p) => {
      const list = (p.goals || []).map((g) => {
        const s = STRENGTH[g.strength];
        const tags = [s ? `<abbr title="${s[1]}">${s[0]}</abbr>` : "", g.goalModifier === "empty-net" ? `<abbr title="Filet désert">FD</abbr>` : "",
          g.goalModifier === "penalty-shot" ? `<abbr title="Tir de pénalité">TP</abbr>` : ""].filter(Boolean).join(" ");
        const team = loc(g.teamAbbrev) || "";
        const ast = (g.assists || []).map((a) => `${esc(loc(a.name) || initial(a))}${fin(a.assistsToDate) ? ` (${a.assistsToDate})` : ""}`).join(", ");
        return `<li class="gl ${team === MTL ? "mtl" : ""}"><span class="gl-t num">${esc(g.timeInPeriod || "")}</span>
          <span class="gl-who"><span class="gl-team">${esc(team)}</span> <b class="cond">${esc(initial(g))}</b>${fin(g.goalsToDate) ? ` <span class="gl-n">(${g.goalsToDate})</span>` : ""}${tags ? ` <span class="gl-tag">${tags}</span>` : ""}
          <span class="gl-ast">${ast ? `Passes : ${ast}` : "Sans aide"}</span></span>
          <span class="gl-sc num">${fin(g.awayScore) && fin(g.homeScore) ? `${g.awayScore}-${g.homeScore}` : ""}</span></li>`;
      }).join("");
      return `<h3 class="grp lbl">${periodName(p.periodDescriptor)}</h3>${list ? `<ul class="goals">${list}</ul>` : `<p class="none">Aucun but</p>`}`;
    }).join("");
    const so = L.summary?.shootout;
    const shoot = Array.isArray(so) && so.length ? `<h3 class="grp lbl">Tirs de barrage</h3><ul class="goals">${so.map((t) => `<li class="gl ${loc(t.teamAbbrev) === MTL ? "mtl" : ""}"><span class="gl-t num">${esc(t.sequence ?? "")}</span><span class="gl-who"><span class="gl-team">${esc(loc(t.teamAbbrev) || "")}</span> <b class="cond">${esc(initial(t))}</b><span class="gl-ast">${t.result === "goal" ? "But" : t.result === "save" ? "Arrêt" : "Raté"}</span></span><span class="gl-sc num">${fin(t.awayScore) && fin(t.homeScore) ? `${t.awayScore}-${t.homeScore}` : ""}</span></li>`).join("")}</ul>` : "";
    return `<section class="blk goals-blk">${h}${rows}${shoot}<p class="legend">Pointage visiteurs-locaux après chaque but. AN avantage numérique · DN désavantage numérique · FD filet désert. Entre parenthèses : total de la saison.</p></section>`;
  }

  function shots(L, R, err, when) {
    const h = `<h2 class="h cond">Tirs et statistiques</h2>`;
    if (!R) {
      const base = fin(L.awayTeam.sog) && fin(L.homeTeam.sog)
        ? `<p class="asof">Tirs au but : ${esc(L.awayTeam.abbrev)} ${L.awayTeam.sog} · ${esc(L.homeTeam.abbrev)} ${L.homeTeam.sog}</p>` : "";
      return `<section class="blk white shots-blk">${h}${base}${errBox("Tirs par période et statistiques d’équipe", err || "données absentes")}</section>`;
    }
    const sbp = Array.isArray(R.shotsByPeriod) ? R.shotsByPeriod : [];
    const per = (pd) => {
      const k = pd.number - (pd.maxRegulationPeriods || 3); // rang de la prolongation
      return pd.periodType === "SO" ? "TB" : pd.periodType === "OT" ? (k > 1 ? `P${k}` : "Prol.") : `${pd.number}`;
    };
    const tot = (k) => sbp.reduce((s, p) => s + (fin(p[k]) ? p[k] : 0), 0);
    const tbl = sbp.length ? `<table class="stats shots"><thead><tr><th>Tirs</th>${sbp.map((p) => `<th>${per(p.periodDescriptor)}</th>`).join("")}<th>Total</th></tr></thead><tbody>
      <tr class="${L.awayTeam.abbrev === MTL ? "mtl" : ""}"><td><span class="nm">${esc(L.awayTeam.abbrev)}</span></td>${sbp.map((p) => `<td>${fin(p.away) ? p.away : "—"}</td>`).join("")}<td class="pts">${tot("away")}</td></tr>
      <tr class="${L.homeTeam.abbrev === MTL ? "mtl" : ""}"><td><span class="nm">${esc(L.homeTeam.abbrev)}</span></td>${sbp.map((p) => `<td>${fin(p.home) ? p.home : "—"}</td>`).join("")}<td class="pts">${tot("home")}</td></tr></tbody></table>` : "";
    const LABEL = { powerPlay: "Avantages numériques", faceoffWinningPctg: "Mises en jeu (%)", pim: "Minutes de pénalité", hits: "Mises en échec", blockedShots: "Tirs bloqués", giveaways: "Revirements", takeaways: "Récupérations" };
    const fmt = (k, v) => (k === "faceoffWinningPctg" && fin(v) ? `${Math.round(v * 100)} %` : esc(v ?? "—"));
    const st = (R.teamGameStats || []).filter((s) => LABEL[s.category]);
    const list = st.length ? `<table class="stats tstats"><thead><tr><th></th><th>${esc(L.awayTeam.abbrev)}</th><th>${esc(L.homeTeam.abbrev)}</th></tr></thead><tbody>
      ${st.map((s) => `<tr><td>${LABEL[s.category]}</td><td>${fmt(s.category, s.awayValue)}</td><td>${fmt(s.category, s.homeValue)}</td></tr>`).join("")}</tbody></table>` : "";
    return `<section class="blk white shots-blk">${h}${tbl}${list}${slowNote(L, when)}</section>`;
  }

  function goalies(L, B, err, when) {
    const h = `<h2 class="h cond">Gardiens</h2>`;
    if (!B?.playerByGameStats) return `<section class="blk white gk-blk">${h}${errBox("Gardiens", err || "données absentes")}</section>`;
    const rows = [["awayTeam", L.awayTeam.abbrev], ["homeTeam", L.homeTeam.abbrev]].flatMap(([side, ab]) =>
      (B.playerByGameStats[side]?.goalies || []).filter((g) => g.toi && g.toi !== "00:00").map((g) => ({ ...g, ab })));
    if (!rows.length) return `<section class="blk white gk-blk">${h}<p class="asof">Aucun gardien n’a encore joué.</p></section>`;
    return `<section class="blk white gk-blk">${h}<table class="stats gk"><thead><tr><th>Gardien</th><th>Arrêts</th><th>%ARR</th><th>Temps</th></tr></thead><tbody>
      ${rows.map((g) => `<tr class="${g.ab === MTL ? "mtl" : ""}"><td><span class="nm">${esc(loc(g.name))}</span><span class="ps">${esc(g.ab)}${g.decision && DECISION[g.decision] ? ` · ${DECISION[g.decision]}` : ""}</span></td>
        <td>${fin(g.saves) && fin(g.shotsAgainst) ? `${g.saves}/${g.shotsAgainst}` : esc(g.saveShotsAgainst || "—")}</td><td class="pts">${pct(g.savePctg)}</td><td>${esc(g.toi)}</td></tr>`).join("")}
      </tbody></table>${slowNote(L, when)}</section>`;
  }

  function stars(L) {
    const s = L.summary?.threeStars;
    if (!Array.isArray(s) || !s.length) return "";
    return `<section class="band"><div class="leaders-wrap"><div class="lbl band-lbl">Les trois étoiles</div><div class="leaders">
      ${[...s].sort((a, b) => a.star - b.star).map((p) => `<div class="ldr"><div class="lbl">${"★".repeat(p.star)}</div><div class="ldr-n cond">${esc(loc(p.name))}</div>
        <div class="star-line">${esc(p.teamAbbrev || "")}${p.position === "G" ? (fin(p.savePctg) ? ` · ${pct(p.savePctg)}` : "") : fin(p.goals) ? ` · ${p.goals} B, ${p.assists ?? 0} A` : ""}</div></div>`).join("")}
      </div></div></section>`;
  }

  function penalties(L) {
    const ps = L.summary?.penalties;
    const h = `<h2 class="h cond">Pénalités</h2>`;
    if (!Array.isArray(ps)) return `<section class="blk pen-blk">${h}${errBox("Pénalités", "sommaire absent")}</section>`;
    const any = ps.some((p) => p.penalties?.length);
    if (!any) return DONE.has(L.gameState) || LIVE.has(L.gameState) ? `<section class="blk pen-blk">${h}<p class="none">Aucune pénalité.</p></section>` : "";
    return `<section class="blk pen-blk">${h}${ps.filter((p) => p.penalties?.length).map((p) => `<h3 class="grp lbl">${periodName(p.periodDescriptor)}</h3><ul class="pens">
      ${p.penalties.map((x) => {
        const server = typeof x.servedBy === "string" ? x.servedBy : loc(x.servedBy) || (x.servedBy?.lastName ? initial(x.servedBy) : "");
        const who = x.committedByPlayer ? initial(x.committedByPlayer) : server.trim() ? `Punition d’équipe (purgée par ${server.trim()})` : "Punition d’équipe";
        return `<li><span class="num">${esc(x.timeInPeriod || "")}</span> <b>${esc(loc(x.teamAbbrev) || "")}</b> ${esc(who)} · ${fin(x.duration) ? `${x.duration} min` : ""} · ${esc(penName(x.descKey))}</li>`;
      }).join("")}</ul>`).join("")}</section>`;
  }

  // Repli : pointage du calendrier du site seulement.
  function fallback(g, err) {
    const done = DONE.has(g.gameState);
    const row = (t, side) => `<div class="board-row ${t.abbrev === MTL ? "mtl" : ""}"><div class="name cond">${esc(teamName(t))}<small>${side}</small></div>
      <div class="sc num">${done && fin(t.score) ? t.score : "–"}</div></div>`;
    const dt = new Date(g.startTimeUTC), x = g.gameOutcome?.lastPeriodType;
    return `<section class="hero">${top()}<div class="lbl kick">${done ? `Final${x === "OT" ? " · Prolongation" : x === "SO" ? " · Tirs de barrage" : ""}` : LIVE.has(g.gameState) ? "En cours" : "Match à venir"}</div>
      <div class="board">${row(g.awayTeam, "Visiteurs")}${row(g.homeTeam, "Locaux")}</div>
      <div class="state">${esc(cap(fDate.format(dt)))}<small>${esc(loc(g.venue))}</small></div></section>
      <section class="blk">${errBox("Feuille de match", err)}<p class="legend">Pointage tiré du calendrier du site${LIVE.has(g.gameState) ? " (pas de pointage en direct sans la feuille de match)" : ""}. Les buts, tirs, gardiens et pénalités viennent de la feuille de match de la LNH, indisponible pour l’instant.</p></section>`;
  }

  let timer = null, failures = 0;
  async function render(first) {
    const app = document.getElementById("app");
    if (!/^\d{10}$/.test(ID)) {
      app.innerHTML = `<section class="hero">${top()}</section><section class="blk"><div class="err">Aucun match choisi (adresse incomplète). Choisissez un match dans le <a href="calendrier.html">calendrier</a>.</div></section>`;
      return;
    }
    const d = await loadAll(first);
    const L = d.landing;
    if (!L) {
      failures++;
      const g = await staticGame();
      if (first || !app.dataset.ok) {
        app.innerHTML = g ? fallback(g, d.errors.landing)
          : `<section class="hero">${top()}</section><section class="blk">${errBox("Feuille de match", d.errors.landing)}<p class="legend">Match ${esc(ID)} introuvable dans le calendrier du site.</p></section>`;
      } else {
        const n = document.querySelector(".state");
        if (n && !n.querySelector(".warn-note")) n.insertAdjacentHTML("beforeend", `<small class="warn-note">Mise à jour impossible (${esc(d.errors.landing)}). Données affichées : dernière lecture réussie.</small>`);
      }
      schedule(g && LIVE.has(g.gameState));
      return;
    }
    failures = 0;
    const parts = [() => hero(L, d.boxscore, d.at), () => goals(L), () => stars(L), () => shots(L, d["right-rail"], d.errors["right-rail"], d.slowWhen), () => goalies(L, d.boxscore, d.errors.boxscore, d.slowWhen), () => penalties(L)];
    const y = scrollY;
    app.innerHTML = T.sections(parts, errBox);
    app.dataset.ok = "1";
    if (!first) scrollTo(0, y);
    const away = teamName(L.awayTeam), home = teamName(L.homeTeam);
    document.title = `${away} ${fin(L.awayTeam.score) ? L.awayTeam.score : ""} – ${fin(L.homeTeam.score) ? L.homeTeam.score : ""} ${home} · Tricolore`.replace(/\s+/g, " ");
    schedule(LIVE.has(L.gameState) || L.gameState === "PRE");
  }
  function schedule(again) {
    clearTimeout(timer);
    if (!again) return;
    const wait = failures ? Math.min(POLL_MS * 2 ** failures, 120_000) : POLL_MS;
    timer = setTimeout(() => { if (document.visibilityState === "visible") render(false); else schedule(true); }, wait);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && timer) { clearTimeout(timer); render(false); } });
  document.getElementById("foot").innerHTML = `<p>Données : API publique de la LNH, par le relais Tricolore (Cloudflare). Heures de l’Est.</p>${UNOFFICIAL}`;
  render(true);
})();
