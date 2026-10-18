// Tricolore — page d'accueil.
// Lit data/*.json (écrits par scripts/fetch-data.mjs depuis l'API publique de la LNH).
// Règle d'or : aucune donnée inventée. Si une source manque, on affiche un message clair.
(function () {
  "use strict";
  const TZ = "America/Toronto";
  const MTL = "MTL";
  const LIVE = new Set(["LIVE", "CRIT"]);
  const DONE = new Set(["OFF", "FINAL"]);

  const loc = (o) => (o ? o.fr || o.default : "");
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const F = (o) => new Intl.DateTimeFormat("fr-CA", { timeZone: TZ, ...o });
  const fWeekday = F({ weekday: "long" }), fDay = F({ day: "numeric" }), fMonth = F({ month: "long" });
  const fShort = F({ day: "numeric", month: "short" }), fShortWd = F({ weekday: "short" });
  const fH = F({ hour: "numeric", hourCycle: "h23" }), fM = F({ minute: "2-digit" });
  const fStamp = F({ dateStyle: "long", timeStyle: "short" }), fClock = F({ hour: "numeric", minute: "2-digit" });
  // fr-CA donne « 19 h » : on ne garde que les chiffres (correctif du « 19 h h 00 »).
  const hourOf = (d) => fH.format(d).replace(/\D/g, "");
  const minOf = (d) => fM.format(d).padStart(2, "0");

  // Proxy Cloudflare (worker/) pour le pointage en direct. En local, ?worker=http://localhost:8787 permet de tester.
  const WORKER_DEFAULT = "https://tricolore.tricolore.workers.dev";
  const WORKER = (() => {
    const q = new URLSearchParams(location.search).get("worker");
    return q && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(q) ? q : WORKER_DEFAULT;
  })();
  const POLL_MS = 15_000;
  const STALE_MS = 90 * 60 * 1000; // la vérification des données a lieu au moins aux 45 min

  const SOURCE_LABEL = { schedule: "Calendrier", scoreboard: "Match en cours", standings: "Classement" };
  const errBox = (what, detail) =>
    `<div class="err">${esc(what)} : source LNH indisponible${detail ? ` (${esc(detail)})` : ""}. Aucune donnée affichée plutôt qu’une donnée inexacte.</div>`;

  async function getJson(name) {
    const r = await fetch(`data/${name}.json`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function load() {
    const out = { errors: {}, meta: null };
    try { out.meta = await getJson("meta"); } catch (e) { out.errors.meta = e.message; }
    await Promise.all(Object.keys(SOURCE_LABEL).map(async (n) => {
      const s = out.meta?.sources?.[n];
      if (s && s.ok === false) { out.errors[n] = s.error || "échec"; out[n] = null; return; } // pas de données périmées
      try { out[n] = await getJson(n); } catch (e) { out.errors[n] = e.message; out[n] = null; }
    }));
    try { out.news = await getJson("news"); } catch (e) { out.news = null; out.errors.news = e.message; }
    return out;
  }

  function team(t, byAbbr) {
    const s = byAbbr?.[t.abbrev];
    return { abbr: t.abbrev, name: loc(t.commonName), place: loc(t.placeName), full: s ? loc(s.teamName) : loc(t.commonName), score: t.score };
  }
  const tvOf = (g) => [...new Set((g.tvBroadcasts || []).filter((b) => b.countryCode === "CA").map((b) => b.network))]
    .sort((a, b) => (/RDS|TVA/.test(b) ? 1 : 0) - (/RDS|TVA/.test(a) ? 1 : 0));
  const chips = (tv) => tv.length ? tv.map((t) => `<span class="chip">${esc(t)}</span>`).join("") : `<span>Télé non annoncée</span>`;

  let seasonText = "";
  const top = () => `<div class="top"><div class="wordmark">Tri<i></i>co<i></i>lore</div><div class="lbl">${esc(seasonText)}</div></div>`;

  function hero(d, byAbbr) {
    const sbGames = (d.scoreboard?.gamesByDate || []).flatMap((x) => x.games);
    const live = sbGames.find((g) => LIVE.has(g.gameState));
    if (live) return liveHero(live, d.meta?.updatedAt ? new Date(d.meta.updatedAt) : null, "static");
    if (!d.schedule) return `<section class="hero">${top()}<div style="margin:30px 18px 0">${errBox("Calendrier", d.errors.schedule)}</div></section>`;
    const g = d.schedule.games
      .filter((x) => !DONE.has(x.gameState) && new Date(x.startTimeUTC).getTime() > Date.now() - 4 * 3600e3)
      .sort((a, b) => a.startTimeUTC.localeCompare(b.startTimeUTC))[0];
    if (!g) return `<section class="hero">${top()}<div class="lbl kick">Prochain match</div><p class="state">Aucun match à venir au calendrier.</p></section>`;
    const home = g.homeTeam.abbrev === MTL;
    const opp = team(home ? g.awayTeam : g.homeTeam, byAbbr);
    const dt = new Date(g.startTimeUTC);
    const tbd = g.gameScheduleState && g.gameScheduleState !== "OK";
    return `<section class="hero">${top()}
      <div class="lbl kick">Prochain match · ${home ? "Domicile" : "Étranger"}${g.gameType === 1 ? " · Préparatoire" : ""}</div>
      ${(() => {
        const wd = cap(fWeekday.format(dt)), mo = fMonth.format(dt);
        const len = Math.max(wd.length, mo.length); // « mercredi », « septembre » : on réduit pour ne pas déborder
        const size = len >= 9 ? "xl" : len >= 8 ? "l" : "";
        return `<div class="datebig ${size}"><span class="day num">${esc(fDay.format(dt))}</span>
        <div class="side"><div class="wd cond">${esc(wd)}</div><div class="mo cond">${esc(mo)}</div></div></div>`;
      })()}
      <div class="opp"><div><span class="vs">${home ? "Contre les" : "Chez les"}</span><span class="name cond">${esc(opp.name)}</span><span class="place">de ${esc(opp.place)}</span></div></div>
      <div class="time"><span class="num">${tbd ? "À CONFIRMER" : `${hourOf(dt)}<span class="hh">h</span>${minOf(dt)}`}</span><small>Heure<br>de l’Est</small></div>
      <div class="meta"><span class="chip w">${esc(loc(g.venue))}</span>${chips(tvOf(g))}</div></section>`;
  }

  // Carte du match en cours ou terminé. source : "worker" (direct) ou "static" (fichiers du site).
  function liveHero(g, asOf, source, note) {
    const final = DONE.has(g.gameState);
    const p = g.periodDescriptor;
    const period = !p ? "En cours"
      : p.periodType === "OT" ? "Prolongation" : p.periodType === "SO" ? "Tirs de barrage"
      : `${Number(p.number) || ""}<span class="lc">e</span> période`;
    const clock = final ? "" : g.clock?.inIntermission ? "Entracte" : g.clock?.timeRemaining ? `${esc(g.clock.timeRemaining)} à jouer` : "";
    const row = (t, side) => `<div class="board-row ${t.abbrev === MTL ? "mtl" : ""}">
      <div class="name cond">${esc(loc(t.commonName))}<small>${side}</small></div>
      <div class="sc num">${Number.isFinite(t.score) ? t.score : "–"}</div></div>`;
    const when = asOf ? fClock.format(asOf) : null;
    const how = source === "worker" && final
      ? `Pointage final reçu à ${esc(when || "heure inconnue")} (heure de l’Est).`
      : source === "worker"
      ? `Pointage en direct${when ? ` en date de ${esc(when)}` : ""} (heure de l’Est), mis à jour aux 15 secondes.`
      : `Pointage en date de ${esc(when || "heure inconnue")} (heure de l’Est), fichiers du site rafraîchis environ aux 15 minutes.`;
    const extra = p?.periodType === "OT" ? " · Prolongation" : p?.periodType === "SO" ? " · Tirs de barrage" : "";
    return `<section class="hero">${top()}
      <div class="lbl kick ${final ? "" : "live-kick"}">${final ? `Match terminé${extra}` : `En direct · ${period}`}</div>
      <div class="board">${row(g.awayTeam, "Visiteurs")}${row(g.homeTeam, "Locaux")}</div>
      <div class="state">${final ? "Final" : clock}<small>${how}</small>${note ? `<small class="warn-note">${esc(note)}</small>` : ""}</div>
      <div class="meta"><span class="chip w">${esc(loc(g.venue))}</span>${chips(tvOf(g))}</div>${/^\d{10}$/.test(String(g.id)) ? `<a class="more hero-more" href="match.html?id=${encodeURIComponent(g.id)}">Feuille de match ›</a>` : ""}</section>`;
  }

  function band(d, me) {
    if (!me) return `<section class="band"><div class="rec">${errBox("Classement", d.errors.standings || "équipe introuvable")}</div></section>`;
    return `<section class="band" aria-label="Fiche du Canadien"><div class="rec">
      <div class="big num">${me.wins}-${me.losses}-${me.otLosses}</div>
      <div class="pts num">${me.points}<span>PTS</span></div>
      <div class="rank">${me.divisionSequence}<sup>e</sup> Atlantique<br>${me.conferenceSequence}<sup>e</sup> dans l’Est<br>${me.gamesPlayed} matchs joués</div>
    </div></section>`;
  }

  function results(d) {
    const h = `<h2 class="h cond">Derniers<br>résultats</h2>`;
    if (!d.schedule) return `<section class="blk">${h}${errBox("Résultats", d.errors.schedule)}</section>`;
    const games = d.schedule.games
      .filter((g) => DONE.has(g.gameState) && (g.gameType === 2 || g.gameType === 3) && Number.isFinite(g.homeTeam.score) && Number.isFinite(g.awayTeam.score))
      .sort((a, b) => b.startTimeUTC.localeCompare(a.startTimeUTC)).slice(0, 5);
    if (!games.length) return `<section class="blk">${h}<p class="legend">Aucun match joué cette saison.</p></section>`;
    return `<section class="blk">${h}${games.map((g) => {
      const home = g.homeTeam.abbrev === MTL, us = home ? g.homeTeam : g.awayTeam, them = home ? g.awayTeam : g.homeTeam;
      const x = g.gameOutcome?.lastPeriodType;
      const code = us.score > them.score ? "V" : x === "OT" || x === "SO" ? "DP" : "D";
      const extra = x === "OT" ? "Prol." : x === "SO" ? "T.B." : "";
      const dt = new Date(g.startTimeUTC);
      const label = code === "V" ? "Victoire" : code === "DP" ? "Défaite en prolongation ou tirs de barrage" : "Défaite";
      return `<a class="res res-a" href="match.html?id=${encodeURIComponent(g.id)}" aria-label="${label} ${us.score} à ${them.score} : feuille de match"><div class="code ${code}" title="${label}">${code}</div>
        <div class="o cond">${esc(loc(them.commonName))}<small>${esc(fShortWd.format(dt))} ${esc(fShort.format(dt))} · ${home ? "Domicile" : "Étranger"}</small></div>
        <div class="s num">${us.score}-${them.score}${extra ? `<small>${extra}</small>` : ""}</div></a>`;
    }).join("")}<p class="legend">V victoire · D défaite · DP défaite en prolongation ou tirs de barrage. Pointage du CH en premier.</p></section>`;
  }

  function standings(d, me, all) {
    const h = `<h2 class="h cond">Division<br>Atlantique</h2>`;
    if (!me) return `<section class="blk white">${h}${errBox("Classement", d.errors.standings || "équipe introuvable")}</section>`;
    const div = all.filter((t) => t.divisionAbbrev === me.divisionAbbrev).sort((a, b) => a.divisionSequence - b.divisionSequence);
    const asOf = new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(me.date + "T12:00:00Z"));
    return `<section class="blk white">${h}<table>
      <thead><tr><th>#</th><th>Équipe</th><th>PJ</th><th>V</th><th>D</th><th>DP</th><th>PTS</th></tr></thead><tbody>
      ${div.map((t) => `<tr class="${t.teamAbbrev.default === MTL ? "mtl" : ""}"><td>${t.divisionSequence}</td><td>${esc(loc(t.teamCommonName))}</td><td>${t.gamesPlayed}</td><td>${t.wins}</td><td>${t.losses}</td><td>${t.otLosses}</td><td class="pts">${t.points}</td></tr>`).join("")}
      </tbody></table><p class="asof">Classement au ${esc(asOf)}</p></section>`;
  }

  // Nouvelles : titre, source, date et lien seulement (aucun texte d'article).
  const fRel = new Intl.RelativeTimeFormat("fr-CA", { numeric: "auto" });
  const fNewsDate = F({ weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  function ago(iso) {
    const t = Date.parse(iso), min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return "à l’instant";
    if (min < 60) return fRel.format(-min, "minute");
    if (min < 24 * 60) return fRel.format(-Math.round(min / 60), "hour");
    return fNewsDate.format(new Date(t));
  }
  function news(d) {
    const h = `<h2 class="h cond">Nouvelles</h2>`;
    const status = Object.values(d.meta?.news || {});
    const failed = status.filter((s) => !s.ok);
    const failNote = failed.length
      ? `<p class="news-fail">Source indisponible : ${failed.map((s) => esc(s.name)).join(", ")}.</p>` : "";
    const items = (d.news?.items || []).filter((i) => /^https:\/\//.test(i.url));
    if (!items.length) {
      const why = d.errors.news ? `fichier des nouvelles introuvable (${esc(d.errors.news)})`
        : status.length && !status.some((s) => s.ok) ? "aucune source de nouvelles n’a répondu" : "aucune manchette récente sur le Canadien";
      return `<section class="blk news">${h}<div class="err">Nouvelles : ${why}. Aucune manchette affichée plutôt qu’une manchette inventée.</div>${failNote}</section>`;
    }
    return `<section class="blk news">${h}<ul class="news-list">
      ${items.map((i) => `<li><a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">
        <span class="news-title">${esc(i.title)}</span>
        <span class="news-meta"><b>${esc(i.source)}</b> · <time datetime="${esc(i.publishedAt)}">${esc(ago(i.publishedAt))}</time></span></a></li>`).join("")}
      </ul>${failNote}<p class="news-note">Titres et liens vers les articles originaux. Les articles appartiennent à leurs médias.</p></section>`;
  }
  const sleeve = `<div class="sleeve" aria-hidden="true"></div>`;

  function footer(d) {
    const failed = Object.keys(SOURCE_LABEL).filter((n) => d.errors[n]).map((n) => SOURCE_LABEL[n])
      .concat(Object.values(d.meta?.news || {}).filter((s) => !s.ok).map((s) => `Nouvelles (${s.name})`));
    const when = d.meta?.updatedAt ? fStamp.format(new Date(d.meta.updatedAt)) : null;
    const checked = d.meta?.checkedAt ? fStamp.format(new Date(d.meta.checkedAt)) : null;
    return `<p>Données : API publique de la LNH${when ? ` · dernière modification le ${esc(when)}` : ""}${checked ? `, vérifiées le ${esc(checked)}` : ""}${when || checked ? " (heure de l’Est)" : ""}.</p>
      ${d.errors.meta ? `<p class="foot-warn">Heure de mise à jour inconnue (meta.json : ${esc(d.errors.meta)}).</p>` : ""}
      ${failed.length ? `<p class="foot-warn">Source en échec : ${esc(failed.join(", "))}.</p>` : ""}
      <p>Site de partisan non officiel, non affilié à la LNH ni au Club de hockey Canadien.</p>`;
  }

  // Course aux séries (format LNH : 3 premiers de chaque division + 2 équipes repêchées par association).
  // Rangs tels que publiés par la LNH dans standings.json (divisionSequence, wildcardSequence) :
  // wildcardSequence vaut 0 pour les 3 premiers de division, puis 1, 2 (équipes repêchées), 3 et plus (hors séries).
  function series(d, me, all) {
    const h = `<h2 class="h cond">Course aux<br>séries</h2>`;
    if (!me) return `<section class="blk white series">${h}${errBox("Course aux séries", d.errors.standings || "équipe introuvable")}</section>`;
    const conf = all.filter((t) => t.conferenceAbbrev === me.conferenceAbbrev);
    const okNum = (t) => [t.points, t.gamesPlayed, t.divisionSequence, t.wildcardSequence].every(Number.isFinite);
    if (d.standings?.wildCardIndicator === false || conf.length < 8 || !conf.every(okNum))
      return `<section class="blk white series">${h}${errBox("Course aux séries", "rangs des équipes repêchées absents du classement LNH")}</section>`;
    const name = (t) => loc(t.teamCommonName) || t.teamAbbrev.default;
    const ord = (n, fem) => (n === 1 ? (fem ? "1<sup>re</sup>" : "1<sup>er</sup>") : `${n}<sup>e</sup>`);
    const pctF = new Intl.NumberFormat("fr-CA", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    const pct = (t) => (Number.isFinite(t.pointPctg) ? pctF.format(t.pointPctg).replace(/^0(?=,)/, "") : "—");
    const divName = me.divisionAbbrev === "A" ? "Atlantique" : me.divisionAbbrev === "M" ? "Métropolitaine" : me.divisionAbbrev === "C" ? "Centrale" : "Pacifique";
    const confName = me.conferenceAbbrev === "E" ? "l’Est" : "l’Ouest";
    const wc = conf.filter((t) => t.wildcardSequence > 0).sort((a, b) => a.wildcardSequence - b.wildcardSequence);
    const wc2 = wc.find((t) => t.wildcardSequence === 2), firstOut = wc.find((t) => t.wildcardSequence === 3);
    const div3 = conf.find((t) => t.divisionAbbrev === me.divisionAbbrev && t.divisionSequence === 3);
    const inDiv = me.divisionSequence <= 3, inWc = me.wildcardSequence === 1 || me.wildcardSequence === 2, inside = inDiv || inWc;
    const status = inDiv ? `${ord(me.divisionSequence, true)} place ${divName}` : inWc ? `${ord(me.wildcardSequence, true)} équipe repêchée dans ${confName}` : `Hors des séries`;
    const sub = inside ? "En position de séries" : `${ord(me.wildcardSequence)} dans la course aux places de repêchage`;
    const pts = (n) => `${n} pt${Math.abs(n) > 1 ? "s" : ""}`;
    // Une ligne de comparaison : écart de points + matchs joués des deux équipes.
    const cmp = (label, other, ahead) => {
      if (!other) return "";
      const gap = ahead ? me.points - other.points : other.points - me.points;
      const gpDiff = other.gamesPlayed - me.gamesPlayed;
      const gpTxt = gpDiff > 0 ? `le CH a ${gpDiff} match${gpDiff > 1 ? "s" : ""} en main` : gpDiff < 0 ? `le CH a joué ${-gpDiff} match${gpDiff < -1 ? "s" : ""} de plus` : "même nombre de matchs";
      const head = ahead ? (gap > 0 ? `${pts(gap)} d’avance` : gap === 0 ? "À égalité" : `${pts(-gap)} de retard`)
        : (gap > 0 ? `À ${pts(gap)}` : gap === 0 ? "À égalité" : `${pts(-gap)} d’avance`);
      const vs = gap === 0 ? "avec les" : ahead ? (gap > 0 ? "sur les" : "sur les") : (gap > 0 ? "des" : "sur les");
      return `<div class="sr-line"><div class="sr-lbl lbl">${label}</div>
        <div class="sr-main"><b>${head}</b> ${vs} ${esc(name(other))} <span class="sr-gp">(${other.points} pts en ${other.gamesPlayed} PJ, ${pct(other)})</span></div>
        <div class="sr-gp">CH : ${me.points} pts en ${me.gamesPlayed} PJ, ${pct(me)} · ${gpTxt}</div></div>`;
    };
    const lines = inside
      ? cmp("Coussin sur la 1<sup>re</sup> équipe exclue", firstOut, true)
      : cmp(`2<sup>e</sup> équipe repêchée`, wc2, false) + (div3 ? cmp(`3<sup>e</sup> place ${divName}`, div3, false) : "");
    const showN = Math.min(wc.length, Math.max(5, (me.wildcardSequence || 0) + 1));
    const rows = wc.slice(0, showN).map((t) => {
      const isMe = t.teamAbbrev.default === MTL;
      const gap = wc2 ? t.points - wc2.points : null;
      const rank = t.wildcardSequence <= 2 ? `${ord(t.wildcardSequence, true)}` : `${t.wildcardSequence}`;
      return `<tr class="${isMe ? "mtl" : ""}${t.wildcardSequence === 2 ? " cutline" : ""}"><td>${rank}</td><td>${esc(name(t))}</td><td>${t.gamesPlayed}</td><td class="pts">${t.points}</td><td>${pct(t)}</td><td>${t.wildcardSequence <= 2 ? "—" : gap === null ? "—" : gap === 0 ? "0" : `−${-gap}`}</td></tr>`;
    }).join("");
    const asOf = new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(me.date + "T12:00:00Z"));
    return `<section class="blk white series">${h}
      <div class="sr-status ${inside ? "in" : "out"}"><span class="cond">${status}</span><small>${sub}</small></div>
      ${lines}
      <h3 class="sr-h lbl">Places de repêchage dans ${confName}</h3>
      <table class="stats wc"><thead><tr><th>Rang</th><th>Équipe</th><th>PJ</th><th>PTS</th><th>%PTS</th><th>Écart</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="asof">Format LNH : les 3 premières équipes de chaque division et les 2 équipes repêchées de chaque association (les 2 meilleures parmi les autres équipes) font les séries.
      Rangs tels que publiés par la LNH au ${esc(asOf)} (en cas d’égalité de points : % de points, victoires en temps réglementaire, etc.).
      Rangs 1 et 2 : les 2 équipes repêchées. Écart : points de retard sur la 2<sup>e</sup> équipe repêchée. %PTS : points obtenus sur points possibles.</p></section>`;
  }

  load().then((d) => {
    const all = d.standings?.standings || [];
    const byAbbr = Object.fromEntries(all.map((t) => [t.teamAbbrev.default, t]));
    const me = byAbbr[MTL];
    const season = String(d.schedule?.currentSeason || me?.seasonId || "");
    if (/^\d{8}$/.test(season)) seasonText = `Saison ${season.slice(0, 4)}-${season.slice(4)}`;
    const parts = [
      () => `<div id="hero-slot">${hero(d, byAbbr)}</div>`, () => staleBanner(d), () => band(d, me), () => results(d), () => sleeve,
      () => standings(d, me, all), () => series(d, me, all), () => sleeve, () => news(d),
    ];
    document.getElementById("app").innerHTML = parts.map((fn) => {
      try { return fn(); } catch (e) { console.error(e); return `<div class="blk">${errBox("Section", "erreur d’affichage")}</div>`; }
    }).join("");
    document.getElementById("foot").innerHTML = footer(d);
    startLive(d);
  });

  function staleBanner(d) {
    const t = Date.parse(d.meta?.checkedAt || d.meta?.updatedAt || "");
    if (!t || Date.now() - t < STALE_MS) return "";
    return `<div class="stale" role="status">Attention : les données du site n’ont pas été vérifiées depuis le ${esc(fStamp.format(new Date(t)))} (heure de l’Est). Elles peuvent être périmées.</div>`;
  }

  // ---- Pointage en direct via le Worker ----
  // Match à suivre : en cours selon les fichiers, ou qui commence dans moins de 30 min,
  // ou commencé depuis moins de 6 h et pas encore terminé selon les fichiers.
  function liveCandidate(d) {
    const sbLive = (d.scoreboard?.gamesByDate || []).flatMap((x) => x.games).find((g) => LIVE.has(g.gameState));
    if (sbLive) return sbLive;
    const now = Date.now();
    return (d.schedule?.games || []).find((g) => {
      if (DONE.has(g.gameState)) return false;
      const start = Date.parse(g.startTimeUTC);
      return start - now <= 30 * 60e3 && now - start <= 6 * 3600e3;
    }) || null;
  }

  function startLive(d) {
    let timer = null, stopped = false, failures = 0, lastGood = null;
    const slot = () => document.getElementById("hero-slot");

    async function tick() {
      timer = null;
      if (stopped || document.hidden) return;
      const g = liveCandidate(d);
      if (!g) { timer = setTimeout(tick, 60_000); return; } // rien à suivre : on revérifie chaque minute, sans réseau
      try {
        const r = await fetch(`${WORKER}/v1/gamecenter/${encodeURIComponent(g.id)}/landing`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const live = await r.json();
        const asOf = new Date(Date.parse(r.headers.get("x-tricolore-fetched-at") || "") || Date.now());
        failures = 0; lastGood = { live, asOf };
        if (LIVE.has(live.gameState) || DONE.has(live.gameState)) slot().innerHTML = liveHero(live, asOf, "worker");
        if (DONE.has(live.gameState)) { stopped = true; return; }
      } catch (e) {
        failures += 1;
        console.warn("Pointage en direct indisponible :", e.message);
        const metaTime = d.meta?.updatedAt ? fStamp.format(new Date(d.meta.updatedAt)) : "heure inconnue";
        const note = `Pointage en direct indisponible. Affichage des données du site en date du ${metaTime} (heure de l’Est).`;
        if (lastGood && LIVE.has(lastGood.live.gameState)) slot().innerHTML = liveHero(lastGood.live, lastGood.asOf, "worker", note);
        else {
          slot().innerHTML = hero(d, Object.fromEntries((d.standings?.standings || []).map((t) => [t.teamAbbrev.default, t])));
          const st = slot().querySelector(".hero");
          if (st) st.insertAdjacentHTML("beforeend", `<p class="warn-note hero-note">${esc(note)}</p>`);
        }
      }
      timer = setTimeout(tick, failures ? Math.min(POLL_MS * 2 ** failures, 120_000) : POLL_MS);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { clearTimeout(timer); timer = null; }
      else if (!timer && !stopped) tick();
    });
    tick();
  }
})();
