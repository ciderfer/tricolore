// Tricolore — page Calendrier : toute la saison du Canadien, groupée par mois.
// Lit data/schedule.json (écrit par scripts/fetch-data.mjs depuis l'API publique de la LNH).
// Règle d'or : aucune donnée inventée. Si la source manque, on affiche un message clair.
(function () {
  "use strict";
  const TZ = "America/Toronto";
  const MTL = "MTL";
  const LIVE = new Set(["LIVE", "CRIT"]);
  const DONE = new Set(["OFF", "FINAL"]);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const loc = (o) => (o ? o.fr || o.default : "");
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const F = (o) => new Intl.DateTimeFormat("fr-CA", { timeZone: TZ, ...o });
  const fMonthKey = F({ year: "numeric", month: "2-digit" }), fMonthName = F({ month: "long", year: "numeric" });
  const fDay = F({ day: "numeric" }), fWd = F({ weekday: "short" });
  const fH = F({ hour: "numeric", hourCycle: "h23" }), fM = F({ minute: "2-digit" });
  const fStamp = F({ dateStyle: "long", timeStyle: "short" });
  const clock = (d) => `${fH.format(d).replace(/\D/g, "")}<span class="hh">h</span>${fM.format(d).padStart(2, "0")}`;

  const errBox = (what, detail) =>
    `<div class="err">${esc(what)} : source LNH indisponible${detail ? ` (${esc(detail)})` : ""}. Aucune donnée affichée plutôt qu’une donnée inexacte.</div>`;
  async function getJson(name) {
    const r = await fetch(`data/${name}.json`, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  async function load() {
    const out = { errors: {}, meta: null, schedule: null };
    try { out.meta = await getJson("meta"); } catch (e) { out.errors.meta = e.message; }
    const s = out.meta?.sources?.schedule;
    if (s && s.ok === false) out.errors.schedule = s.error || "échec"; // pas de données périmées
    else { try { out.schedule = await getJson("schedule"); } catch (e) { out.errors.schedule = e.message; } }
    return out;
  }

  // Même règle que l'accueil : premier match non terminé, commencé il y a moins de 4 h.
  const isNext = (g) => !DONE.has(g.gameState) && new Date(g.startTimeUTC).getTime() > Date.now() - 4 * 3600e3;
  const tvOf = (g) => [...new Set((g.tvBroadcasts || []).filter((b) => b.countryCode === "CA").map((b) => b.network))]
    .sort((a, b) => (/RDS|TVA/.test(b) ? 1 : 0) - (/RDS|TVA/.test(a) ? 1 : 0));
  const STATE_TXT = { PPD: "Reporté", CNCL: "Annulé", SUSP: "Suspendu", TBD: "À confirmer" };

  function row(g, next) {
    const home = g.homeTeam.abbrev === MTL, us = home ? g.homeTeam : g.awayTeam, them = home ? g.awayTeam : g.homeTeam;
    const dt = new Date(g.startTimeUTC);
    const tags = [home ? "Domicile" : "Étranger", g.gameType === 1 ? "Préparatoire" : g.gameType === 3 ? "Séries" : ""].filter(Boolean).join(" · ");
    const opp = `<div class="cg-opp"><span class="cg-vs">${home ? "Contre les" : "Chez les"}</span><span class="cond cg-name">${esc(loc(them.commonName))}</span>
      <span class="cg-tag">${esc(tags)}</span></div>`;
    const date = `<div class="cg-date"><span class="num cg-d">${esc(fDay.format(dt))}</span><span class="cg-wd">${esc(fWd.format(dt).replace(".", ""))}</span></div>`;
    let right, extraCls = "", label;
    const special = g.gameScheduleState && g.gameScheduleState !== "OK" ? STATE_TXT[g.gameScheduleState] || g.gameScheduleState : "";
    if (DONE.has(g.gameState)) {
      if (Number.isFinite(us.score) && Number.isFinite(them.score)) {
        const x = g.gameOutcome?.lastPeriodType;
        const win = us.score > them.score;
        const code = win ? "V" : "D";
        const extra = x === "OT" ? "Prol." : x === "SO" ? "T.B." : "";
        label = `${win ? "Victoire" : "Défaite"} ${us.score} à ${them.score}${extra ? (x === "OT" ? " en prolongation" : " en tirs de barrage") : ""}`;
        right = `<div class="cg-res" aria-label="${esc(label)}"><span class="cg-code ${code}${extra && !win ? " DP" : ""}">${code}</span><span class="num cg-score">${us.score}-${them.score}</span>${extra ? `<span class="cg-x">${extra}</span>` : ""}</div>`;
        extraCls = " done";
      } else right = `<div class="cg-res"><span class="cg-na">Résultat non disponible</span></div>`;
    } else if (LIVE.has(g.gameState)) {
      right = `<div class="cg-res"><a class="cg-live" href="./">En cours ›</a></div>`;
    } else {
      const tv = tvOf(g);
      right = `<div class="cg-up"><span class="num cg-time">${special ? `<span class="cg-special">${esc(special)}</span>` : clock(dt)}</span>${tv.length ? `<span class="cg-tv">${tv.map(esc).join(" · ")}</span>` : `<span class="cg-tv none">Télé non annoncée</span>`}</div>`;
    }
    return `<li class="cg${extraCls}${next ? " next" : ""}"${next ? ' id="prochain"' : ""} data-id="${esc(g.id)}">${next ? `<span class="cg-flag lbl">Prochain match</span>` : ""}${date}${opp}${right}</li>`;
  }

  function body(d) {
    const h = `<section class="hero page-hero"><div class="top"><div class="wordmark">Tri<i></i>co<i></i>lore</div><div class="lbl">${esc(seasonText(d))}</div></div>
      <h1 class="page-title cond">Calendrier<br><span>${d.schedule ? "Toute la saison" : "&nbsp;"}</span></h1></section>`;
    if (!d.schedule || !Array.isArray(d.schedule.games)) return `${h}<section class="blk">${errBox("Calendrier", d.errors.schedule || "données absentes")}</section>`;
    const games = [...d.schedule.games].filter((g) => g.startTimeUTC).sort((a, b) => a.startTimeUTC.localeCompare(b.startTimeUTC));
    if (!games.length) return `${h}<section class="blk"><p class="legend">Aucun match au calendrier.</p></section>`;
    const next = games.find(isNext);
    const months = new Map();
    for (const g of games) {
      const k = fMonthKey.format(new Date(g.startTimeUTC));
      if (!months.has(k)) months.set(k, []);
      months.get(k).push(g);
    }
    const played = games.filter((g) => DONE.has(g.gameState) && g.gameType !== 1).length;
    const left = games.filter((g) => !DONE.has(g.gameState) && g.gameType !== 1).length;
    return `${h}<section class="band"><div class="cal-sum"><span><b class="num">${played}</b> joués</span><span><b class="num">${left}</b> à venir</span>
      ${next ? `<a href="#prochain" class="cal-jump">Prochain ›</a>` : ""}</div></section>
      ${icsBlock()}
      ${[...months.values()].map((list) => `<section class="blk cal-month"><h2 class="h cond">${esc(cap(fMonthName.format(new Date(list[0].startTimeUTC))))}</h2>
        <ul class="cal">${list.map((g) => row(g, g === next)).join("")}</ul></section>`).join("")}
      <section class="blk cal-legend"><p class="legend">V victoire · D défaite · Prol. en prolongation · T.B. en tirs de barrage. Pointage du CH en premier. Heures de l’Est. Saison régulière et séries comptées dans « joués » et « à venir » (matchs préparatoires exclus).</p></section>`;
  }
  // Abonnement au calendrier : webcal:// pour que l'iPhone s'abonne (mises à jour automatiques),
  // plus un lien de téléchargement du fichier .ics (écrit par la tâche planifiée, data/canadiens.ics).
  function icsBlock() {
    const file = new URL("data/canadiens.ics", location.href);
    const webcal = file.href.replace(/^https?:/, "webcal:");
    return `<section class="blk ics"><a class="ics-btn" href="${esc(webcal)}">Ajouter à mon calendrier</a>
      <p class="ics-note">Abonnement : les matchs de la saison (et des séries) s’ajoutent à votre calendrier et se mettent à jour d’eux-mêmes (heure, télé, pointage final).
      Sinon, <a href="${esc(file.href)}" download="canadiens.ics">télécharger le fichier .ics</a> (sans mise à jour).</p></section>`;
  }
  function seasonText(d) {
    const s = String(d.schedule?.currentSeason || "");
    return /^\d{8}$/.test(s) ? `Saison ${s.slice(0, 4)}-${s.slice(4)}` : "";
  }
  function footer(d) {
    const when = d.meta?.updatedAt ? fStamp.format(new Date(d.meta.updatedAt)) : null;
    const checked = d.meta?.checkedAt ? fStamp.format(new Date(d.meta.checkedAt)) : null;
    return `<p>Données : API publique de la LNH${when ? ` · dernière modification le ${esc(when)}` : ""}${checked ? `, vérifiées le ${esc(checked)}` : ""}${when || checked ? " (heure de l’Est)" : ""}.</p>
      ${d.errors.meta ? `<p class="foot-warn">Heure de mise à jour inconnue (meta.json : ${esc(d.errors.meta)}).</p>` : ""}
      ${d.errors.schedule ? `<p class="foot-warn">Source en échec : Calendrier.</p>` : ""}
      <p>Site de partisan non officiel, non affilié à la LNH ni au Club de hockey Canadien.</p>`;
  }

  load().then((d) => {
    let html;
    try { html = body(d); } catch (e) { console.error(e); html = `<div class="blk">${errBox("Calendrier", "erreur d’affichage")}</div>`; }
    document.getElementById("app").innerHTML = html;
    document.getElementById("foot").innerHTML = footer(d);
    const n = document.getElementById("prochain");
    if (n && !location.hash) n.scrollIntoView({ block: "center" });
  });
})();
