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
    return out;
  }

  function team(t, byAbbr) {
    const s = byAbbr?.[t.abbrev];
    return { abbr: t.abbrev, name: loc(t.commonName), place: loc(t.placeName), full: s ? loc(s.teamName) : loc(t.commonName), score: t.score };
  }
  const tvOf = (g) => [...new Set((g.tvBroadcasts || []).filter((b) => b.countryCode === "CA").map((b) => b.network))]
    .sort((a, b) => (/RDS|TVA/.test(b) ? 1 : 0) - (/RDS|TVA/.test(a) ? 1 : 0));
  const chips = (tv) => tv.length ? tv.map((t) => `<span class="chip">${esc(t)}</span>`).join("") : `<span>Télé non annoncée</span>`;

  const top = `<div class="top"><div class="wordmark">Tri<i></i>co<i></i>lore</div><div class="lbl" id="season"></div></div>`;

  function hero(d, byAbbr) {
    const sbGames = (d.scoreboard?.gamesByDate || []).flatMap((x) => x.games);
    const live = sbGames.find((g) => LIVE.has(g.gameState));
    if (live) {
      const p = live.periodDescriptor;
      const period = p ? (p.periodType === "OT" ? "Prolongation" : p.periodType === "SO" ? "Tirs de barrage" : `${Number(p.number) || ""}<span class="lc">e</span> période`) : "En cours";
      const clock = live.clock?.inIntermission ? "Entracte" : live.clock?.timeRemaining ? `${live.clock.timeRemaining} à jouer` : "";
      const row = (t, side) => `<div class="board-row ${t.abbrev === MTL ? "mtl" : ""}">
        <div class="name cond">${esc(loc(t.commonName))}<small>${side}</small></div>
        <div class="sc num">${Number.isFinite(t.score) ? t.score : "–"}</div></div>`;
      const asOf = d.meta?.updatedAt ? fClock.format(new Date(d.meta.updatedAt)) : null;
      return `<section class="hero">${top}
        <div class="lbl kick live-kick">En direct · ${period}</div>
        <div class="board">${row(live.awayTeam, "Visiteurs")}${row(live.homeTeam, "Locaux")}</div>
        <div class="state">${esc(clock)}${asOf ? `<small>Pointage en date de ${esc(asOf)} (heure de l’Est), rafraîchi environ aux 10 minutes.</small>` : ""}</div>
        <div class="meta"><span class="chip w">${esc(loc(live.venue))}</span>${chips(tvOf(live))}</div></section>`;
    }
    if (!d.schedule) return `<section class="hero">${top}<div style="margin:30px 18px 0">${errBox("Calendrier", d.errors.schedule)}</div></section>`;
    const g = d.schedule.games
      .filter((x) => !DONE.has(x.gameState) && new Date(x.startTimeUTC).getTime() > Date.now() - 4 * 3600e3)
      .sort((a, b) => a.startTimeUTC.localeCompare(b.startTimeUTC))[0];
    if (!g) return `<section class="hero">${top}<div class="lbl kick">Prochain match</div><p class="state">Aucun match à venir au calendrier.</p></section>`;
    const home = g.homeTeam.abbrev === MTL;
    const opp = team(home ? g.awayTeam : g.homeTeam, byAbbr);
    const dt = new Date(g.startTimeUTC);
    const tbd = g.gameScheduleState && g.gameScheduleState !== "OK";
    return `<section class="hero">${top}
      <div class="lbl kick">Prochain match · ${home ? "Domicile" : "Étranger"}${g.gameType === 1 ? " · Préparatoire" : ""}</div>
      <div class="datebig"><span class="day num">${esc(fDay.format(dt))}</span>
        <div class="side"><div class="wd cond">${esc(cap(fWeekday.format(dt)))}</div><div class="mo cond">${esc(fMonth.format(dt))}</div></div></div>
      <div class="opp"><div><span class="vs">${home ? "Contre les" : "Chez les"}</span><span class="name cond">${esc(opp.name)}</span><span class="place">de ${esc(opp.place)}</span></div></div>
      <div class="time"><span class="num">${tbd ? "À CONFIRMER" : `${hourOf(dt)}<span class="hh">h</span>${minOf(dt)}`}</span><small>Heure<br>de l’Est</small></div>
      <div class="meta"><span class="chip w">${esc(loc(g.venue))}</span>${chips(tvOf(g))}</div></section>`;
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
      .filter((g) => DONE.has(g.gameState) && (g.gameType === 2 || g.gameType === 3))
      .sort((a, b) => b.startTimeUTC.localeCompare(a.startTimeUTC)).slice(0, 5);
    if (!games.length) return `<section class="blk">${h}<p class="legend">Aucun match joué cette saison.</p></section>`;
    return `<section class="blk">${h}${games.map((g) => {
      const home = g.homeTeam.abbrev === MTL, us = home ? g.homeTeam : g.awayTeam, them = home ? g.awayTeam : g.homeTeam;
      const x = g.gameOutcome?.lastPeriodType;
      const code = us.score > them.score ? "V" : x === "OT" || x === "SO" ? "DP" : "D";
      const extra = x === "OT" ? "Prol." : x === "SO" ? "T.B." : "";
      const dt = new Date(g.startTimeUTC);
      const label = code === "V" ? "Victoire" : code === "DP" ? "Défaite en prolongation ou tirs de barrage" : "Défaite";
      return `<div class="res"><div class="code ${code}" title="${label}" aria-label="${label}">${code}</div>
        <div class="o cond">${esc(loc(them.commonName))}<small>${esc(fShortWd.format(dt))} ${esc(fShort.format(dt))} · ${home ? "Domicile" : "Étranger"}</small></div>
        <div class="s num">${us.score}-${them.score}${extra ? `<small>${extra}</small>` : ""}</div></div>`;
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

  const news = `<section class="blk news"><div class="lbl soon">Bientôt</div><h2 class="h cond">Nouvelles</h2>
    <p>Les manchettes arriveront ici : titre, source, date et lien vers l’article original. Rien d’autre.</p></section>`;
  const sleeve = `<div class="sleeve" aria-hidden="true"></div>`;

  function footer(d) {
    const failed = Object.keys(SOURCE_LABEL).filter((n) => d.errors[n]).map((n) => SOURCE_LABEL[n]);
    const when = d.meta?.updatedAt ? fStamp.format(new Date(d.meta.updatedAt)) : null;
    return `<p>Données : API publique de la LNH${when ? ` · dernière mise à jour le ${esc(when)} (heure de l’Est)` : ""}.</p>
      ${d.errors.meta ? `<p class="foot-warn">Heure de mise à jour inconnue (meta.json : ${esc(d.errors.meta)}).</p>` : ""}
      ${failed.length ? `<p class="foot-warn">Source en échec : ${esc(failed.join(", "))}.</p>` : ""}
      <p>Site de partisan non officiel, non affilié à la LNH ni au Club de hockey Canadien.</p>`;
  }

  load().then((d) => {
    const all = d.standings?.standings || [];
    const byAbbr = Object.fromEntries(all.map((t) => [t.teamAbbrev.default, t]));
    const me = byAbbr[MTL];
    const parts = [
      () => hero(d, byAbbr), () => band(d, me), () => results(d), () => sleeve,
      () => standings(d, me, all), () => sleeve, () => news,
    ];
    document.getElementById("app").innerHTML = parts.map((fn) => {
      try { return fn(); } catch (e) { console.error(e); return `<div class="blk">${errBox("Section", "erreur d’affichage")}</div>`; }
    }).join("");
    const season = String(d.schedule?.currentSeason || me?.seasonId || "");
    const seasonEl = document.getElementById("season");
    if (seasonEl && /^\d{8}$/.test(season)) seasonEl.textContent = `Saison ${season.slice(0, 4)}-${season.slice(4)}`;
    document.getElementById("foot").innerHTML = footer(d);
  });
})();
