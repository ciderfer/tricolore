// Tricolore — page Alignement et statistiques.
// Lit data/roster.json et data/stats.json (écrits par scripts/fetch-data.mjs depuis l'API publique de la LNH).
// Règle d'or : aucune donnée inventée. Si une source manque, on affiche un message clair.
(function () {
  "use strict";
  const { esc, loc, fin, pct, gaa, signed, age, WORDMARK, errBox } = T;

  const SOURCE_LABEL = { roster: "Alignement", stats: "Statistiques" };

  const POS = { C: "Centre", L: "Ailier gauche", R: "Ailier droit", D: "Défenseur", G: "Gardien" };
  const POS_SHORT = { C: "C", L: "AG", R: "AD", D: "D" };
  const SIDE = { L: "gauche", R: "droite" };
  const shortName = (p) => `${loc(p.firstName).charAt(0)}. ${loc(p.lastName)}`;
  function header(d) {
    return `<section class="hero page-hero"><div class="top"><div class="wordmark">${WORDMARK}</div><div class="lbl">${esc(T.season(d.stats?.season))}</div></div>
      <h1 class="page-title cond">Alignement<br><span>et statistiques</span></h1></section>`;
  }

  function leaders(d) {
    const sk = d.stats?.skaters;
    if (!Array.isArray(sk)) return `<section class="band"><div class="leaders-wrap">${errBox("Meneurs", d.errors.stats || "données absentes")}</div></section>`;
    const played = sk.filter((p) => fin(p.gamesPlayed) && p.gamesPlayed > 0);
    const cat = (key, label) => {
      const vals = played.filter((p) => fin(p[key]));
      const best = Math.max(...vals.map((p) => p[key]));
      if (!vals.length || !(best > 0)) return `<div class="ldr"><div class="lbl">${label}</div><div class="ldr-v num">—</div><div class="ldr-n">Personne encore</div></div>`;
      const top = vals.filter((p) => p[key] === best).sort((a, b) => loc(a.lastName).localeCompare(loc(b.lastName), "fr"));
      const names = top.slice(0, 2).map((p) => esc(loc(p.lastName))).join(", ") + (top.length > 2 ? ` +${top.length - 2}` : "");
      return `<div class="ldr"><div class="lbl">${label}</div><div class="ldr-v num">${best}</div><div class="ldr-n cond">${names}</div></div>`;
    };
    return `<section class="band"><div class="leaders-wrap"><div class="lbl band-lbl">Meneurs du CH</div><div class="leaders">
      ${cat("points", "Points")}${cat("goals", "Buts")}${cat("assists", "Passes")}</div></div></section>`;
  }

  function roster(d) {
    const h = `<h2 class="h cond">Alignement</h2>`;
    const r = d.roster;
    if (!r || !Array.isArray(r.forwards)) return `<section class="blk">${h}${errBox("Alignement", d.errors.roster || "données absentes")}</section>`;
    const group = (title, list) => {
      if (!Array.isArray(list) || !list.length) return "";
      const rows = [...list].sort((a, b) => (a.sweaterNumber ?? 999) - (b.sweaterNumber ?? 999)).map((p) => {
        const a = age(p.birthDate);
        const hand = SIDE[p.shootsCatches] ? `${p.positionCode === "G" ? "Attrape" : "Lance"} de la ${SIDE[p.shootsCatches]}` : "";
        const info = [POS[p.positionCode] || p.positionCode, a != null ? `${a} ans` : "", hand].filter(Boolean).join(" · ");
        return `<li class="pl"><span class="pl-no num">${fin(p.sweaterNumber) ? p.sweaterNumber : "—"}</span>
          <a class="pl-id pl-link" href="joueur.html?id=${encodeURIComponent(p.id)}"><span class="pl-name cond">${esc(loc(p.firstName))} ${esc(loc(p.lastName))}</span><span class="pl-info">${esc(info)}</span></a></li>`;
      }).join("");
      return `<h3 class="grp lbl">${title} <span>${list.length}</span></h3><ul class="roster">${rows}</ul>`;
    };
    return `<section class="blk">${h}${group("Attaquants", r.forwards)}${group("Défenseurs", r.defensemen)}${group("Gardiens", r.goalies)}</section>`;
  }

  // Nom dans les tableaux : lien vers la fiche si le joueur est dans l'alignement actuel (fiche générée).
  function nameCell(d, p) {
    const ids = new Set(["forwards", "defensemen", "goalies"].flatMap((k) => d.roster?.[k] || []).map((x) => x.id));
    const nm = `<span class="nm">${esc(shortName(p))}</span>`;
    return ids.has(p.playerId) ? `<a class="nm-link" href="joueur.html?id=${encodeURIComponent(p.playerId)}">${nm}</a>` : nm;
  }

  function gameTypeText(gt) { return gt === 3 ? "Séries" : gt === 1 ? "Préparatoire" : "Saison régulière"; }

  function skaters(d) {
    const h = `<h2 class="h cond">Patineurs</h2>`;
    const s = d.stats;
    if (!s || !Array.isArray(s.skaters)) return `<section class="blk white">${h}${errBox("Statistiques", d.errors.stats || "données absentes")}</section>`;
    const list = s.skaters.filter((p) => fin(p.gamesPlayed) && p.gamesPlayed > 0)
      .sort((a, b) => b.points - a.points || b.goals - a.goals || a.gamesPlayed - b.gamesPlayed || loc(a.lastName).localeCompare(loc(b.lastName), "fr"));
    if (!list.length) return `<section class="blk white">${h}<p class="asof">Aucun match joué pour l’instant.</p></section>`;
    const n = (v) => (fin(v) ? v : "—");
    return `<section class="blk white">${h}<p class="tbl-sub lbl">${esc(gameTypeText(s.gameType))}</p><table class="stats sk">
      <thead><tr><th>Joueur</th><th>PJ</th><th>B</th><th>A</th><th>PTS</th><th>+/-</th></tr></thead><tbody>
      ${list.map((p) => `<tr><td>${nameCell(d, p)}<span class="ps">${esc(POS_SHORT[p.positionCode] || p.positionCode || "")}</span></td><td>${n(p.gamesPlayed)}</td><td>${n(p.goals)}</td><td>${n(p.assists)}</td><td class="pts">${n(p.points)}</td><td>${fin(p.plusMinus) ? signed(p.plusMinus) : "—"}</td></tr>`).join("")}
      </tbody></table><p class="asof">PJ parties jouées · B buts · A passes · PTS points · +/- différentiel. Seuls les joueurs ayant joué sont listés.</p></section>`;
  }

  function goalies(d) {
    const h = `<h2 class="h cond">Gardiens</h2>`;
    const s = d.stats;
    if (!s || !Array.isArray(s.goalies)) return `<section class="blk white">${h}${errBox("Statistiques des gardiens", d.errors.stats || "données absentes")}</section>`;
    const list = s.goalies.filter((p) => fin(p.gamesPlayed) && p.gamesPlayed > 0).sort((a, b) => b.gamesPlayed - a.gamesPlayed || b.wins - a.wins);
    if (!list.length) return `<section class="blk white">${h}<p class="asof">Aucun match joué pour l’instant.</p></section>`;
    const n = (v) => (fin(v) ? v : "—");
    return `<section class="blk white">${h}<table class="stats gl">
      <thead><tr><th>Gardien</th><th>PJ</th><th>V</th><th>D</th><th>DP</th><th>%ARR</th><th>MOY</th></tr></thead><tbody>
      ${list.map((p) => `<tr><td>${nameCell(d, p)}</td><td>${n(p.gamesPlayed)}</td><td>${n(p.wins)}</td><td>${n(p.losses)}</td><td>${n(p.overtimeLosses)}</td><td class="pts">${pct(p.savePercentage)}</td><td>${gaa(p.goalsAgainstAverage)}</td></tr>`).join("")}
      </tbody></table><p class="asof">V victoires · D défaites · DP défaites en prolongation ou tirs de barrage · %ARR pourcentage d’arrêts · MOY moyenne de buts alloués.</p></section>`;
  }


  const sleeve = `<div class="sleeve" aria-hidden="true"></div>`;
  T.load(Object.keys(SOURCE_LABEL)).then((d) => {
    const parts = [() => header(d), () => leaders(d), () => roster(d), () => sleeve, () => skaters(d), () => goalies(d)];
    document.getElementById("app").innerHTML = T.sections(parts);
    const failed = Object.keys(SOURCE_LABEL).filter((n) => d.errors[n]).map((n) => SOURCE_LABEL[n]);
    document.getElementById("foot").innerHTML = T.footer(d.meta, d.errors.meta, failed);
  });
})();
