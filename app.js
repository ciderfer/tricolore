// Tricolore — page d'accueil.
// Lit data/*.json (écrits par scripts/fetch-data.mjs depuis l'API publique de la LNH).
// Règle d'or : aucune donnée inventée. Si une source manque, on affiche un message clair.
(function () {
  "use strict";
  const { MTL, LIVE, DONE, esc, loc, cap, num, F, fStamp, pct, tvOf, WORKER, POLL_MS, WORDMARK, errBox } = T;
  const fWeekday = F({ weekday: "long" }), fDay = F({ day: "numeric" }), fMonth = F({ month: "long" });
  const fShort = F({ day: "numeric", month: "short" }), fShortWd = F({ weekday: "short" });
  const fH = F({ hour: "numeric", hourCycle: "h23" }), fM = F({ minute: "2-digit" });
  const fClock = F({ hour: "numeric", minute: "2-digit" });
  // fr-CA donne « 19 h » : on ne garde que les chiffres (correctif du « 19 h h 00 »).
  const hourOf = (d) => fH.format(d).replace(/\D/g, "");
  const minOf = (d) => fM.format(d).padStart(2, "0");

  const STALE_MS = 90 * 60 * 1000; // la vérification des données a lieu au moins aux 45 min

  const SOURCE_LABEL = { schedule: "Calendrier", scoreboard: "Match en cours", standings: "Classement" };

  function team(t, byAbbr) {
    const s = byAbbr?.[t.abbrev];
    return { abbr: t.abbrev, name: loc(t.commonName), place: loc(t.placeName), full: s ? loc(s.teamName) : loc(t.commonName), score: t.score };
  }
  const chips = (tv) => tv.length ? tv.map((t) => `<span class="chip">${esc(t)}</span>`).join("") : `<span>Télé non annoncée</span>`;

  let seasonText = "";
  const top = () => `<div class="top"><h1 class="wordmark" aria-label="Tricolore">${WORDMARK}</h1><div class="lbl">${esc(seasonText)}</div></div>`;

  function hero(d, byAbbr) {
    const sbGames = (d.scoreboard?.gamesByDate || []).flatMap((x) => x.games);
    const live = sbGames.find((g) => LIVE.has(g.gameState));
    if (live) return liveHero(live, d.meta?.updatedAt ? new Date(d.meta.updatedAt) : null, "static");
    if (!d.schedule) return `<section class="hero">${top()}<div class="hero-err">${errBox("Calendrier", d.errors.schedule)}</div></section>`;
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
      <div class="opp"><div><span class="vs">${home ? "Contre les" : "Chez les"}</span><span class="name cond${Math.max(...opp.name.split(/\s+/).map((w) => w.length)) >= 9 ? " long" : ""}">${esc(opp.name)}</span><span class="place">de ${esc(opp.place)}</span></div></div>
      <div class="time"><span class="num">${tbd ? "À CONFIRMER" : `${hourOf(dt)}<span class="hh">h</span>${minOf(dt)}`}</span><small>Heure<br>de l’Est</small></div>
      <div class="meta"><span class="chip w">${esc(loc(g.venue))}</span>${chips(tvOf(g))}</div>${faceAFace(d, g, home, opp, byAbbr)}</section>`;
  }

  // Face-à-face (grand écran seulement, masqué sur téléphone) : les deux équipes selon standings.json,
  // et le rang de ce match parmi les affrontements de la saison selon schedule.json. Rien d'autre.
  const DIV_FR = { A: "Atlantique", M: "Métropolitaine", C: "Centrale", P: "Pacifique" };
  const CONF_FR = { E: "Est", W: "Ouest" };
  const STREAK_FR = { W: "V", L: "D", OT: "DP" };
  function faceAFace(d, g, home, opp, byAbbr) {
    const a = byAbbr?.[MTL], b = byAbbr?.[opp.abbr];
    const ok = (t) => t && [t.wins, t.losses, t.otLosses, t.points, t.divisionSequence, t.conferenceSequence].every(Number.isFinite);
    if (!ok(a) || !ok(b)) return "";
    const rec = (w, l, o) => [w, l, o].every(Number.isFinite) ? `${w}-${l}-${o}` : "—";
    const hr = (t) => rec(t.homeWins, t.homeLosses, t.homeOtLosses), rr = (t) => rec(t.roadWins, t.roadLosses, t.roadOtLosses);
    const streak = (t) => STREAK_FR[t.streakCode] && Number.isFinite(t.streakCount) ? `${t.streakCount} ${STREAK_FR[t.streakCode]}` : "—";
    const goals = (t) => Number.isFinite(t.goalFor) && Number.isFinite(t.goalAgainst) ? `${t.goalFor}-${t.goalAgainst}` : "—";
    const row = (label, x, y, t) => `<div class="faf-r"><span class="faf-l">${label}</span><span class="faf-v${t ? " t" : ""}">${x}</span><span class="faf-v${t ? " t" : ""}">${y}</span></div>`;
    const vs = (d.schedule?.games || []).filter((x) => x.gameType === g.gameType && [x.homeTeam.abbrev, x.awayTeam.abbrev].includes(opp.abbr))
      .sort((p, q) => p.startTimeUTC.localeCompare(q.startTimeUTC));
    const i = vs.findIndex((x) => x.id === g.id);
    const nth = i >= 0 && vs.length > 1 ? `${i === 0 ? "1<sup>er</sup>" : `${i + 1}<sup>e</sup>`} de ${vs.length} affrontements cette saison` : "";
    const asOf = a.date ? new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(a.date + "T12:00:00Z")) : "";
    return `<div class="faf" aria-label="Face-à-face"><div class="faf-r faf-h"><span class="lbl">Face-à-face</span><span class="cond">Canadien</span><span class="cond">${esc(opp.name)}</span></div>
      ${row("Fiche", rec(a.wins, a.losses, a.otLosses), rec(b.wins, b.losses, b.otLosses))}
      ${row("Points", `${a.points}`, `${b.points}`)}
      ${row("Division", `${rang(a.divisionSequence)} ${DIV_FR[a.divisionAbbrev] || ""}`, `${rang(b.divisionSequence)} ${DIV_FR[b.divisionAbbrev] || ""}`, true)}
      ${row("Association", `${rang(a.conferenceSequence)} ${CONF_FR[a.conferenceAbbrev] || ""}`, `${rang(b.conferenceSequence)} ${CONF_FR[b.conferenceAbbrev] || ""}`, true)}
      ${row("Buts pour-contre", goals(a), goals(b))}
      ${home ? row("Domicile / étranger", hr(a), rr(b)) : row("Étranger / domicile", rr(a), hr(b))}
      ${row("Séquence", streak(a), streak(b))}
      <p class="faf-n">${nth ? `${nth}. ` : ""}Classement LNH${asOf ? ` au ${esc(asOf)}` : ""}.</p></div>`;
  }

  // Carte du match en cours ou terminé. source : "worker" (direct) ou "static" (fichiers du site).
  function liveHero(g, asOf, source, note) {
    const final = DONE.has(g.gameState);
    const p = g.periodDescriptor;
    const period = !p ? "En cours"
      : p.periodType === "OT" ? "Prolongation" : p.periodType === "SO" ? "Tirs de barrage"
      : `<span class="ord">${Number(p.number) || ""}<span class="lc">${Number(p.number) === 1 ? "re" : "e"}</span></span> période`;
    const clock = final ? "" : g.clock?.inIntermission ? "Entracte" : g.clock?.timeRemaining ? `${esc(g.clock.timeRemaining)} à jouer` : "";
    const row = (t, side) => `<div class="board-row ${t.abbrev === MTL ? "mtl" : ""}">
      <div class="name cond">${esc(loc(t.commonName))}<small>${side}</small></div>
      <div class="sc num">${Number.isFinite(t.score) ? t.score : "–"}</div></div>`;
    const when = asOf ? fClock.format(asOf) : null;
    const how = source === "worker" && final
      ? `Pointage final reçu à ${esc(when || "heure inconnue")} (heure de l’Est).`
      : source === "worker"
      ? `Pointage en direct${when ? ` en date de ${esc(when)}` : ""} (heure de l’Est), mis à jour automatiquement.`
      : `Pointage en date de ${esc(when || "heure inconnue")} (heure de l’Est), fichiers du site rafraîchis environ aux 15 minutes.`;
    const extra = p?.periodType === "OT" ? " · Prolongation" : p?.periodType === "SO" ? " · Tirs de barrage" : "";
    // Dernier but : seulement avec le sommaire lu au Worker (les fichiers du site n'en ont pas).
    const lg = source === "worker" ? T.lastGoal(g) : null;
    const goal = lg?.text ? `<p class="last-goal"><span class="lbl">Dernier but</span>${esc(lg.text)}</p>`
      : lg?.pending ? `<p class="last-goal"><span class="lbl">Dernier but</span>Détails du but en attente de la LNH.</p>` : "";
    return `<section class="hero">${top()}
      <div class="lbl kick ${final ? "" : "live-kick"}">${final ? `Match terminé${extra}` : `En direct · ${period}`}</div>
      <div class="board">${row(g.awayTeam, "Visiteurs")}${row(g.homeTeam, "Locaux")}</div>
      <div class="state">${final ? "Final" : clock}<small>${how}</small>${note ? `<small class="warn-note">${esc(note)}</small>` : ""}</div>${goal}
      <div class="meta"><span class="chip w">${esc(loc(g.venue))}</span>${chips(tvOf(g))}</div>${/^\d{10}$/.test(String(g.id)) ? `<a class="more hero-more" href="match.html?id=${encodeURIComponent(g.id)}">Feuille de match ›</a>` : ""}</section>`;
  }

  // Rang au classement (sous-entendu : place) : 1re, 2e, 3e…
  const rang = (n) => (n === 1 ? "1<sup>re</sup>" : `${n}<sup>e</sup>`);
  function band(d, me) {
    if (!me) return `<section class="band"><div class="rec">${errBox("Classement", d.errors.standings || "équipe introuvable")}</div></section>`;
    return `<section class="band" aria-label="Fiche du Canadien"><div class="rec">
      <div class="big num">${me.wins}-${me.losses}-${me.otLosses}</div>
      <div class="pts num">${me.points}<span>PTS</span></div>
      <div class="rank"><span>${rang(me.divisionSequence)} Atlantique</span><br><span>${rang(me.conferenceSequence)} dans l’Est</span><br><span>${me.gamesPlayed} match${me.gamesPlayed > 1 ? "s" : ""} joué${me.gamesPlayed > 1 ? "s" : ""}</span></div>
    </div></section>`;
  }

  function results(d) {
    const h = `<h2 class="h cond">Derniers <br>résultats</h2>`;
    if (!d.schedule) return `<section class="blk">${h}${errBox("Résultats", d.errors.schedule)}</section>`;
    const games = d.schedule.games
      .filter((g) => DONE.has(g.gameState) && (g.gameType === 2 || g.gameType === 3) && Number.isFinite(g.homeTeam.score) && Number.isFinite(g.awayTeam.score))
      .sort((a, b) => b.startTimeUTC.localeCompare(a.startTimeUTC)).slice(0, 5);
    if (!games.length) return `<section class="blk">${h}<p class="legend">Aucun match joué cette saison.</p></section>`;
    return `<section class="blk">${h}${games.map((g) => {
      const home = g.homeTeam.abbrev === MTL, us = home ? g.homeTeam : g.awayTeam, them = home ? g.awayTeam : g.homeTeam;
      const x = g.gameOutcome?.lastPeriodType;
      const code = us.score > them.score ? "V" : x === "OT" || x === "SO" ? "DP" : "D";
      const extra = x === "OT" ? "Prol." : x === "SO" ? "TB" : "";
      const dt = new Date(g.startTimeUTC);
      const label = code === "V" ? "Victoire" : code === "DP" ? "Défaite en prolongation ou tirs de barrage" : "Défaite";
      return `<a class="res res-a" href="match.html?id=${encodeURIComponent(g.id)}" aria-label="${label} ${us.score} à ${them.score} : feuille de match"><div class="code ${code}" title="${label}">${code}</div>
        <div class="o cond">${esc(loc(them.commonName))}<small>${esc(fShortWd.format(dt))} ${esc(fShort.format(dt))} · ${home ? "Domicile" : "Étranger"}</small></div>
        <div class="s num">${us.score}-${them.score}${extra ? `<small>${extra}</small>` : ""}</div></a>`;
    }).join("")}<p class="legend">V victoire · D défaite · DP défaite en prolongation ou tirs de barrage. Pointage du CH en premier.</p></section>`;
  }

  function standings(d, me, all) {
    const h = `<h2 class="h cond">Division <br>Atlantique</h2>`;
    if (!me) return `<section class="blk white">${h}${errBox("Classement", d.errors.standings || "équipe introuvable")}</section>`;
    const div = all.filter((t) => t.divisionAbbrev === me.divisionAbbrev).sort((a, b) => a.divisionSequence - b.divisionSequence);
    const asOf = new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(me.date + "T12:00:00Z"));
    return `<section class="blk white">${h}<table>
      <thead><tr><th>#</th><th>Équipe</th><th>PJ</th><th>V</th><th>D</th><th>DP</th><th>PTS</th></tr></thead><tbody>
      ${div.map((t) => `<tr class="${t.teamAbbrev.default === MTL ? "mtl" : ""}"><td>${num(t.divisionSequence)}</td><td>${esc(loc(t.teamCommonName))}</td><td>${num(t.gamesPlayed)}</td><td>${num(t.wins)}</td><td>${num(t.losses)}</td><td>${num(t.otLosses)}</td><td class="pts">${num(t.points)}</td></tr>`).join("")}
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
    return T.footer(d.meta, d.errors.meta, failed);
  }

  // Course aux séries (format LNH : 3 premiers de chaque division + 2 équipes repêchées par association).
  // Rangs tels que publiés par la LNH dans standings.json (divisionSequence, wildcardSequence) :
  // wildcardSequence vaut 0 pour les 3 premiers de division, puis 1, 2 (équipes repêchées), 3 et plus (hors séries).
  function series(d, me, all) {
    const h = `<h2 class="h cond">Course aux <br>séries</h2>`;
    if (!me) return `<section class="blk white series">${h}${errBox("Course aux séries", d.errors.standings || "équipe introuvable")}</section>`;
    const conf = all.filter((t) => t.conferenceAbbrev === me.conferenceAbbrev);
    const okNum = (t) => [t.points, t.gamesPlayed, t.divisionSequence, t.wildcardSequence].every(Number.isFinite);
    if (d.standings?.wildCardIndicator === false || conf.length < 8 || !conf.every(okNum))
      return `<section class="blk white series">${h}${errBox("Course aux séries", "rangs des équipes repêchées absents du classement LNH")}</section>`;
    const name = (t) => loc(t.teamCommonName) || t.teamAbbrev.default;
    const ord = (n, fem) => (n === 1 ? (fem ? "1<sup>re</sup>" : "1<sup>er</sup>") : `${n}<sup>e</sup>`);
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
      const vs = gap === 0 ? "avec les" : !ahead && gap > 0 ? "des" : "sur les";
      return `<div class="sr-line"><div class="sr-lbl lbl">${label}</div>
        <div class="sr-main"><b>${head}</b> ${vs} ${esc(name(other))} <span class="sr-gp">(${other.points} pts en ${other.gamesPlayed} PJ, ${pct(other.pointPctg)})</span></div>
        <div class="sr-gp">CH : ${me.points} pts en ${me.gamesPlayed} PJ, ${pct(me.pointPctg)} · ${gpTxt}</div></div>`;
    };
    const lines = inside
      ? cmp("Coussin sur la 1<sup>re</sup> équipe exclue", firstOut, true)
      : cmp(`2<sup>e</sup> équipe repêchée`, wc2, false) + (div3 ? cmp(`3<sup>e</sup> place ${divName}`, div3, false) : "");
    const showN = Math.min(wc.length, Math.max(5, (me.wildcardSequence || 0) + 1));
    const rows = wc.slice(0, showN).map((t) => {
      const isMe = t.teamAbbrev.default === MTL;
      const gap = wc2 ? t.points - wc2.points : null;
      const rank = t.wildcardSequence <= 2 ? `${ord(t.wildcardSequence, true)}` : `${t.wildcardSequence}`;
      return `<tr class="${isMe ? "mtl" : ""}${t.wildcardSequence === 2 ? " cutline" : ""}"><td>${rank}</td><td>${esc(name(t))}</td><td>${t.gamesPlayed}</td><td class="pts">${t.points}</td><td>${pct(t.pointPctg)}</td><td>${t.wildcardSequence <= 2 ? "—" : gap === null ? "—" : gap === 0 ? "0" : `−${-gap}`}</td></tr>`;
    }).join("");
    const asOf = new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(me.date + "T12:00:00Z"));
    return `<section class="blk white series">${h}
      <div class="sr-status ${inside ? "in" : "out"}"><span class="cond">${status}</span><small>${sub}</small></div>
      ${lines}
      <h3 class="sr-h lbl">Places de repêchage dans ${confName}</h3>
      <table class="stats wc"><thead><tr><th>Rang</th><th>Équipe</th><th>PJ</th><th>PTS</th><th>%PTS</th><th>Écart</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="asof">Format LNH : les 3 premières équipes de chaque division et les 2 équipes repêchées de chaque association (les 2 meilleures parmi les autres équipes) font les séries.
      Rangs tels que publiés par la LNH au ${esc(asOf)} (en cas d’égalité de points : % de points, victoires en temps réglementaire, etc.).
      Rangs 1 et 2 (sur fond blanc) : les 2 équipes repêchées. Écart : points de retard sur la 2<sup>e</sup> équipe repêchée. %PTS : points obtenus sur points possibles.</p></section>`;
  }

  T.load([...Object.keys(SOURCE_LABEL), "news"]).then((d) => {
    const all = d.standings?.standings || [];
    const byAbbr = Object.fromEntries(all.map((t) => [t.teamAbbrev.default, t]));
    const me = byAbbr[MTL];
    seasonText = T.season(d.schedule?.currentSeason || me?.seasonId);
    const parts = [
      () => `<div id="hero-slot">${hero(d, byAbbr)}</div>`, () => staleBanner(d), () => band(d, me), () => results(d), () => sleeve,
      () => standings(d, me, all), () => series(d, me, all), () => sleeve, () => news(d),
    ];
    document.getElementById("app").innerHTML = T.sections(parts);
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
    // busy : une requête est en cours. Sans ce drapeau, revenir sur l'onglet pendant une requête
    // lançait une deuxième boucle de mises à jour (puis une troisième, etc.).
    let timer = null, busy = false, stopped = false, failures = 0, lastGood = null, feed = null, noSocket = false;
    const slot = () => document.getElementById("hero-slot");
    // Annonce des buts pour VoiceOver : zone persistante (la carte est redessinée à chaque mise à jour), qui ne parle
    // que lorsqu'un nouveau but apparaît pendant qu'on regarde, pas au chargement de la page.
    const announcer = document.createElement("p");
    announcer.className = "sr-only";
    announcer.setAttribute("aria-live", "polite");
    document.getElementById("app").append(announcer);
    let goalKey;

    function good(live, asOf) {
      failures = 0; lastGood = { live, asOf };
      const lg = T.lastGoal(live);
      if (lg?.key) {
        if (goalKey !== undefined && lg.key !== goalKey) announcer.textContent = lg.text;
        goalKey = lg.key;
      } else if (goalKey === undefined && !lg?.pending) goalKey = null; // aucun but encore : le premier sera annoncé
      if (LIVE.has(live.gameState) || DONE.has(live.gameState)) slot().innerHTML = liveHero(live, asOf, "worker");
      if (DONE.has(live.gameState)) { stopped = true; feed?.stop(); }
    }
    function bad(why) {
      failures += 1;
      console.warn("Pointage en direct indisponible :", why);
      const metaTime = d.meta?.updatedAt ? fStamp.format(new Date(d.meta.updatedAt)) : "heure inconnue";
      const note = `Pointage en direct indisponible. Affichage des données du site en date du ${metaTime} (heure de l’Est).`;
      if (lastGood && LIVE.has(lastGood.live.gameState)) {
        const staleNote = `Pointage en direct indisponible. Dernier pointage reçu à ${fClock.format(lastGood.asOf)} (heure de l’Est).`;
        slot().innerHTML = liveHero(lastGood.live, lastGood.asOf, "worker", staleNote);
      } else {
        slot().innerHTML = hero(d, Object.fromEntries((d.standings?.standings || []).map((t) => [t.teamAbbrev.default, t])));
        const st = slot().querySelector(".hero");
        if (st) st.insertAdjacentHTML("beforeend", `<p class="warn-note hero-note">${esc(note)}</p>`);
      }
    }
    const stamp = (s) => new Date(Date.parse(s || "") || Date.now());

    async function tick() {
      timer = null;
      if (stopped || document.hidden) return;
      const g = liveCandidate(d);
      if (!g) { timer = setTimeout(tick, 60_000); return; } // rien à suivre : on revérifie chaque minute, sans réseau
      // D'abord la connexion poussée par le relais; si elle ne s'ouvre pas, lecture aux 15 s comme avant.
      if (!noSocket) {
        feed ??= T.liveSocket(g.id, false, (m) => {
          if (m.part !== "landing" || stopped) return;
          if (m.body && String(m.body.id) === String(g.id)) good(m.body, stamp(m.at)); else if (m.error) bad(m.error);
        }, () => { feed = null; noSocket = true; tick(); });
        return;
      }
      busy = true;
      try {
        const r = await fetch(`${WORKER}/v1/gamecenter/${encodeURIComponent(g.id)}/landing`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        good(await r.json(), stamp(r.headers.get("x-tricolore-fetched-at")));
      } catch (e) { bad(e.message); } finally { busy = false; }
      if (stopped || document.hidden) return; // onglet caché pendant la requête : visibilitychange relancera au retour
      timer = setTimeout(tick, failures ? Math.min(POLL_MS * 2 ** failures, 120_000) : POLL_MS);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { clearTimeout(timer); timer = null; }
      else if (!timer && !busy && !stopped && !feed) tick();
    });
    tick();
  }
})();
